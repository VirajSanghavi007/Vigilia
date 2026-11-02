"""Regularization-consistency check: is the unlabeled Elliptic population
genuinely distributionally different from the labeled population, or is the
huge co-labeling disagreement rate (scripts/co_label.py) just noise?

Method: run each already-trained model repeatedly with its own regularizer
active (MC-Dropout for the GNN -- dropout stays on at inference instead of
being switched off; a small bootstrap ensemble for XGBoost, since trees
don't have a runtime dropout equivalent) and measure per-node prediction
variance across the repeated runs. A model that is genuinely well-specified
for a region of feature space gives consistent (low-variance) predictions
there even under its own regularization noise; if unlabeled nodes show much
higher variance than labeled nodes, that's real evidence the model is
extrapolating into a region it wasn't fit to represent -- i.e. the unlabeled
population really is different, not just unobserved.
"""
import argparse
import os

import joblib
import numpy as np
import torch
import xgboost as xgb

from data import get_dataset
from gnn_main import UnifiedGNN, build_data
from graph_transformer import GraphTransformer
from group_stats import compare_groups

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def enable_mc_dropout(model):
    """UnifiedGNN applies dropout functionally (F.dropout(..., training=
    self.training) inside forward, not via an nn.Dropout submodule), so
    dropout only becomes stochastic when the module's own .training flag is
    True -- i.e. model.train(), not model.eval(). BatchNorm layers are then
    explicitly forced back to eval mode so they use their fixed running
    statistics instead of also injecting batch-dependent noise unrelated to
    the dropout regularizer this check is meant to isolate."""
    model.train()
    for module in model.modules():
        if isinstance(module, torch.nn.modules.batchnorm._BatchNorm):
            module.eval()


@torch.no_grad()
def mc_dropout_variance(model, data, n_passes=30):
    enable_mc_dropout(model)
    probs = np.zeros((n_passes, data.x.shape[0]), dtype=np.float32)
    for i in range(n_passes):
        out = model(data.x, data.edge_index, data.time_step)
        probs[i] = torch.sigmoid(out).cpu().numpy()
    return probs.std(axis=0), probs.mean(axis=0)


def bootstrap_xgb_variance(Xtr, ytr, X_all, scale_pos_weight, n_models=7, base_params=None):
    """Train n_models on bootstrap resamples of the training set with the
    same fixed hyperparameters but different random seeds; use prediction
    variance across the ensemble as the tree-model analog of MC-Dropout
    variance."""
    rng = np.random.default_rng(0)
    n = len(ytr)
    probs = np.zeros((n_models, X_all.shape[0]), dtype=np.float32)
    for i in range(n_models):
        idx = rng.integers(0, n, size=n)  # bootstrap resample
        clf = xgb.XGBClassifier(
            n_estimators=300, max_depth=6, learning_rate=0.1, tree_method="hist",
            n_jobs=22, eval_metric="aucpr", scale_pos_weight=scale_pos_weight,
            random_state=i,
        )
        clf.fit(Xtr[idx], ytr[idx])
        probs[i] = clf.predict_proba(X_all)[:, 1]
    return probs.std(axis=0), probs.mean(axis=0)


def load_message_passing_model(name, X_gnn, n_time_steps, gnn_alpha=0.5):
    """name: 'gnn_main' (SAGE/GAT, from the co-labeling pipeline) or
    'graph_transformer' (TransformerConv, K=5, exploratory comparison)."""
    if name == "gnn_main":
        ckpt = torch.load(os.path.join(CKPT_DIR, f"gnn_main_alpha_{gnn_alpha}.pt"),
                           map_location=DEVICE, weights_only=False)
        model = UnifiedGNN(X_gnn.shape[1], n_time_steps, hidden=ckpt["params"]["hidden"],
                            dropout=ckpt["params"]["dropout"]).to(DEVICE)
        model.load_state_dict(ckpt["model_state"])
        return model
    elif name == "graph_transformer":
        ckpt = torch.load(os.path.join(CKPT_DIR, "graph_transformer_k5.pt"),
                           map_location=DEVICE, weights_only=False)
        model = GraphTransformer(X_gnn.shape[1], n_time_steps).to(DEVICE)
        model.load_state_dict(ckpt["model_state"])
        return model
    raise ValueError(f"unknown model name: {name}")


def run(model_name="gnn_main", gnn_alpha=0.5, n_passes=30, n_xgb_models=7, include_xgb=True):
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    time_steps = df["time_step"].to_numpy()
    labeled_mask = train_mask | test_mask  # y != -1, by construction of get_dataset
    n_time_steps = int(time_steps.max())

    print(f"=== {model_name}: MC-Dropout consistency ===")
    model = load_message_passing_model(model_name, X_gnn, n_time_steps, gnn_alpha)
    dummy_mask = np.zeros(len(y), dtype=bool)
    data = build_data(X_gnn, y, edge_index, time_steps, dummy_mask, dummy_mask)
    mp_std, mp_mean = mc_dropout_variance(model, data, n_passes=n_passes)
    mp_report = compare_groups(mp_std, labeled_mask, alternative="greater")
    print(f"labeled mean std={mp_report['labeled_mean']:.4f} "
          f"unlabeled mean std={mp_report['unlabeled_mean']:.4f} "
          f"ratio={mp_report['ratio_unlabeled_to_labeled_mean']:.2f}x "
          f"p={mp_report['p_value']:.2e}")

    results = {model_name: mp_report}

    if include_xgb:
        print("=== XGBoost: bootstrap-ensemble consistency ===")
        Xtr, ytr = X_xgb[train_mask], y[train_mask]
        scale_pos_weight = (ytr == 0).sum() / (ytr == 1).sum()
        xgb_std, xgb_mean = bootstrap_xgb_variance(Xtr, ytr, X_xgb, scale_pos_weight, n_models=n_xgb_models)
        xgb_report = compare_groups(xgb_std, labeled_mask, alternative="greater")
        print(f"labeled mean std={xgb_report['labeled_mean']:.4f} "
              f"unlabeled mean std={xgb_report['unlabeled_mean']:.4f} "
              f"ratio={xgb_report['ratio_unlabeled_to_labeled_mean']:.2f}x "
              f"p={xgb_report['p_value']:.2e}")
        results["xgb"] = xgb_report

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["gnn_main", "graph_transformer"], default="gnn_main")
    parser.add_argument("--gnn-alpha", type=float, default=0.5)
    parser.add_argument("--n-passes", type=int, default=30)
    parser.add_argument("--n-xgb-models", type=int, default=7)
    parser.add_argument("--no-xgb", action="store_true")
    args = parser.parse_args()
    run(args.model, args.gnn_alpha, args.n_passes, args.n_xgb_models, include_xgb=not args.no_xgb)
