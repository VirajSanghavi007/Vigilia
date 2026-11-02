"""GNNExplainer on the saved GNN (Main) model: for a sample of labeled and
unlabeled nodes, fit a per-node feature-importance mask and compare which
features the model actually leans on between the two populations. Runs on a
2-hop subgraph per target node (not the full 204k-node graph) since
GNNExplainer optimizes a mask via gradient descent per explained node --
full-graph masks would be far too slow to fit for a diagnostic sample.
"""
import argparse
import os

import numpy as np
import torch
from torch_geometric.explain import Explainer, GNNExplainer
from torch_geometric.utils import k_hop_subgraph

from data import FEAT_COLS, get_dataset
from gnn_main import UnifiedGNN

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


class _TimeStepWrapper(torch.nn.Module):
    """GNNExplainer calls model(x, edge_index, **kwargs) and expects a
    [N, num_classes]-shaped output for binary_classification mode; wrap
    UnifiedGNN's raw scalar-per-node output into a [N, 1] shape and thread
    the fixed time_step tensor through as a closed-over kwarg."""

    def __init__(self, model, time_step):
        super().__init__()
        self.model = model
        self.time_step = time_step

    def forward(self, x, edge_index):
        return self.model(x, edge_index, self.time_step).unsqueeze(-1)


def explain_node(model, X_gnn, y, edge_index, time_steps, node_idx, num_hops=2, epochs=100):
    n = X_gnn.shape[0]
    sub_nodes, sub_edge_index, mapping, _ = k_hop_subgraph(
        int(node_idx), num_hops, torch.tensor(edge_index, dtype=torch.long), relabel_nodes=True,
        num_nodes=n,
    )
    sub_x = torch.tensor(X_gnn[sub_nodes.numpy()], dtype=torch.float32).to(DEVICE)
    sub_time_step = torch.tensor(time_steps[sub_nodes.numpy()], dtype=torch.long).to(DEVICE)
    sub_edge_index = sub_edge_index.to(DEVICE)
    local_idx = int(mapping[0])

    wrapped = _TimeStepWrapper(model, sub_time_step).to(DEVICE)
    explainer = Explainer(
        model=wrapped,
        algorithm=GNNExplainer(epochs=epochs),
        explanation_type="model",
        node_mask_type="attributes",
        edge_mask_type="object",
        model_config=dict(mode="binary_classification", task_level="node", return_type="raw"),
    )
    explanation = explainer(x=sub_x, edge_index=sub_edge_index, index=local_idx)
    feature_importance = explanation.node_mask[local_idx].detach().cpu().numpy()
    return feature_importance, len(sub_nodes)


def top_features_by_group(mean_importance_labeled, mean_importance_unlabeled, feature_names, top_k=15):
    diff = mean_importance_unlabeled - mean_importance_labeled
    order = np.argsort(-np.abs(diff))[:top_k]
    return [
        {"feature": feature_names[i],
         "importance_labeled": float(mean_importance_labeled[i]),
         "importance_unlabeled": float(mean_importance_unlabeled[i]),
         "diff": float(diff[i])}
        for i in order
    ]


def run(gnn_alpha=0.5, n_samples=25, num_hops=2, epochs=100, seed=0):
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    time_steps = df["time_step"].to_numpy()
    labeled_mask = train_mask | test_mask

    ckpt = torch.load(os.path.join(CKPT_DIR, f"gnn_main_alpha_{gnn_alpha}.pt"),
                       map_location=DEVICE, weights_only=False)
    n_time_steps = int(time_steps.max())
    model = UnifiedGNN(X_gnn.shape[1], n_time_steps, hidden=ckpt["params"]["hidden"],
                        dropout=ckpt["params"]["dropout"]).to(DEVICE)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    rng = np.random.default_rng(seed)
    labeled_idx = rng.choice(np.where(labeled_mask)[0], size=n_samples, replace=False)
    unlabeled_idx = rng.choice(np.where(~labeled_mask)[0], size=n_samples, replace=False)

    print(f"explaining {n_samples} labeled + {n_samples} unlabeled nodes "
          f"({num_hops}-hop subgraphs, {epochs} epochs each)...")

    labeled_importances, unlabeled_importances = [], []
    for i, idx in enumerate(labeled_idx):
        imp, sub_n = explain_node(model, X_gnn, y, edge_index, time_steps, idx, num_hops, epochs)
        labeled_importances.append(imp)
        if i % 5 == 0:
            print(f"  labeled {i}/{n_samples} (subgraph size={sub_n})")
    for i, idx in enumerate(unlabeled_idx):
        imp, sub_n = explain_node(model, X_gnn, y, edge_index, time_steps, idx, num_hops, epochs)
        unlabeled_importances.append(imp)
        if i % 5 == 0:
            print(f"  unlabeled {i}/{n_samples} (subgraph size={sub_n})")

    mean_labeled = np.mean(labeled_importances, axis=0)
    mean_unlabeled = np.mean(unlabeled_importances, axis=0)

    top = top_features_by_group(mean_labeled, mean_unlabeled, FEAT_COLS, top_k=15)
    print("Top 15 features by importance shift (unlabeled - labeled):")
    for row in top:
        print(f"  {row['feature']:15s} labeled={row['importance_labeled']:.4f} "
              f"unlabeled={row['importance_unlabeled']:.4f} diff={row['diff']:+.4f}")

    overall_labeled = float(mean_labeled.sum())
    overall_unlabeled = float(mean_unlabeled.sum())
    print(f"[total feature-mask magnitude] labeled={overall_labeled:.3f} "
          f"unlabeled={overall_unlabeled:.3f}")

    return {"top_features": top, "overall_labeled": overall_labeled,
            "overall_unlabeled": overall_unlabeled, "n_samples": n_samples}


if __name__ == "__main__":
    import json
    parser = argparse.ArgumentParser()
    parser.add_argument("--gnn-alpha", type=float, default=0.5)
    parser.add_argument("--n-samples", type=int, default=25)
    parser.add_argument("--epochs", type=int, default=100)
    args = parser.parse_args()
    result = run(args.gnn_alpha, args.n_samples, epochs=args.epochs)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(os.path.join(RESULTS_DIR, "gnn_explain.json"), "w") as f:
        json.dump(result, f, indent=2)
    print(f"[saved] {os.path.join(RESULTS_DIR, 'gnn_explain.json')}")
