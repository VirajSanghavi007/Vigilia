"""Graph Transformer (TransformerConv, K=5 layers) as a third model to
compare against the SAGE/GAT GNN (Main) on the same regularization-
consistency question: is it any more stable on the unlabeled population?

Trained on raw features only (data.build_gnn_features), same as gnn_main.py,
for the same reason -- it should derive neighbor/time structure itself
rather than being fed the XGBoost-only engineered columns.

This is a single fixed-config exploratory run (BCE + pos_weight, no Optuna,
no focal-loss sweep) -- not proposed as a co-labeling replacement, just a
comparison point for the unlabeled-consistency question. Architecture
mirrors UnifiedGNN's BatchNorm+residual+time-embedding wrapper so the only
real variable is TransformerConv vs. alternating SAGE/GAT."""
import os
import time

import numpy as np
import torch
import torch.nn.functional as F
from torch_geometric.data import Data
from torch_geometric.nn import TransformerConv

from data import get_dataset
from metrics import compute_metrics, save_result

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
os.makedirs(CKPT_DIR, exist_ok=True)
CKPT_PATH = os.path.join(CKPT_DIR, "graph_transformer_k5.pt")

K_HOPS = 5


class GraphTransformer(torch.nn.Module):
    """K stacked TransformerConv layers + learned time-step embedding +
    BatchNorm + residual connections (same wrapper as UnifiedGNN, so the
    comparison isolates the conv operator, not incidental architecture
    differences)."""

    def __init__(self, in_dim, n_time_steps, hidden=128, num_layers=K_HOPS,
                 heads=4, dropout=0.3, time_emb_dim=8):
        super().__init__()
        self.time_emb = torch.nn.Embedding(n_time_steps + 1, time_emb_dim)
        self.dropout = dropout

        self.convs = torch.nn.ModuleList()
        self.norms = torch.nn.ModuleList()
        self.res_proj = torch.nn.ModuleList()

        dim = in_dim + time_emb_dim
        for _ in range(num_layers):
            self.convs.append(TransformerConv(dim, hidden // heads, heads=heads, dropout=dropout))
            self.norms.append(torch.nn.BatchNorm1d(hidden))
            self.res_proj.append(torch.nn.Linear(dim, hidden) if dim != hidden else torch.nn.Identity())
            dim = hidden
        self.out = torch.nn.Linear(dim, 1)

    def forward(self, x, edge_index, time_step):
        t = self.time_emb(time_step)
        x = torch.cat([x, t], dim=1)
        for conv, norm, proj in zip(self.convs, self.norms, self.res_proj):
            h = conv(x, edge_index)
            h = norm(h)
            h = F.elu(h)
            h = F.dropout(h, p=self.dropout, training=self.training)
            x = h + proj(x)
        return self.out(x).squeeze(-1)


def build_data(X, y, edge_index, time_steps, train_mask, test_mask):
    data = Data(
        x=torch.tensor(X, dtype=torch.float32),
        edge_index=torch.tensor(edge_index, dtype=torch.long),
        y=torch.tensor(np.where(y < 0, 0, y), dtype=torch.float32),
        time_step=torch.tensor(time_steps, dtype=torch.long),
    )
    data.train_mask = torch.tensor(train_mask)
    data.test_mask = torch.tensor(test_mask)
    return data.to(DEVICE)


@torch.no_grad()
def evaluate(model, data, mask):
    model.eval()
    out = model(data.x, data.edge_index, data.time_step)
    probs = torch.sigmoid(out[mask]).cpu().numpy()
    labels = data.y[mask].cpu().numpy()
    return compute_metrics(labels, probs)


def train(data, scale_pos_weight, epochs=150, patience=15):
    n_time_steps = int(data.time_step.max().item())
    model = GraphTransformer(data.num_node_features, n_time_steps).to(DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=0.005, weight_decay=5e-4)
    best_val, best_state, bad_epochs = -1.0, None, 0

    pos_weight = torch.tensor([scale_pos_weight], device=DEVICE)
    t0 = time.time()
    for epoch in range(epochs):
        model.train()
        opt.zero_grad()
        out = model(data.x, data.edge_index, data.time_step)
        loss = F.binary_cross_entropy_with_logits(
            out[data.train_mask], data.y[data.train_mask], pos_weight=pos_weight
        )
        loss.backward()
        opt.step()

        val_auc = evaluate(model, data, data.train_mask)["roc_auc"]
        elapsed = time.time() - t0
        eta = elapsed / (epoch + 1) * (epochs - epoch - 1)
        if epoch % 5 == 0 or epoch == epochs - 1:
            print(f"epoch {epoch}/{epochs} loss={loss.item():.4f} train_auc={val_auc:.4f} "
                  f"elapsed={elapsed:.1f}s eta={eta:.1f}s")

        if val_auc > best_val:
            best_val = val_auc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            bad_epochs = 0
        else:
            bad_epochs += 1
        if bad_epochs >= patience:
            print(f"early stopping at epoch {epoch}")
            break

    model.load_state_dict(best_state)
    return model


if __name__ == "__main__":
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    time_steps = df["time_step"].to_numpy()
    data = build_data(X_gnn, y, edge_index, time_steps, train_mask, test_mask)
    scale_pos_weight = float((y[train_mask] == 0).sum() / (y[train_mask] == 1).sum())

    t0 = time.time()
    model = train(data, scale_pos_weight)
    train_seconds = time.time() - t0

    m = evaluate(model, data, data.test_mask)
    save_result("graph_transformer_k5", m, extra={"k_hops": K_HOPS}, train_seconds=train_seconds)
    torch.save({"model_state": model.state_dict(), "k_hops": K_HOPS}, CKPT_PATH)
    print(f"[saved] {CKPT_PATH}")
    print(m["classification_report"])
