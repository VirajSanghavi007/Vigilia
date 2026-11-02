"""GNN (Main) model for co-labeling: architecture and hyperparameters fixed
to the best known config from the earlier unified_gnn_optuna_tuned_v2 sweep
(hidden=256, dropout=0.14, lr=0.00445, weight_decay=6e-6, keep_frac=0.80,
cache_edges=True, 3 alternating SAGE/GAT layers, 4 heads) -- no Optuna here,
this is a fixed-config train + evaluate run, not a search.

Trains on raw features only (data.build_gnn_features): no pre-computed
neighbor-mean/rolling-window columns, since those are XGBoost-only (see
data.py) -- the GNN derives neighbor structure through its own SAGE/GAT
message passing and temporal signal through its own learned time embedding.

Loss is focal loss (scripts/losses.py) instead of plain BCE, swept across
alpha in {0.3, 0.5, 0.7} per an explicit request to trade off illicit-catch
rate against false-positive volume (each false positive is a transaction a
human reviewer has to look at). All three alpha runs are trained, evaluated
on a 3-fold rolling CV (reporting only, not a tuning objective) and on the
held-out test set, and results are saved per-alpha so the tradeoff can be
picked from the numbers rather than guessed in advance.

Full-batch on GPU (graph comfortably fits 8GB VRAM)."""
import os
import time
import warnings

import joblib
import numpy as np
import torch
import torch.nn.functional as F
from sklearn.exceptions import UndefinedMetricWarning
from sklearn.metrics import f1_score
from sklearn.model_selection import TimeSeriesSplit
from torch_geometric.data import Data
from torch_geometric.nn import GATConv, SAGEConv

from calibration import fit_calibrator
from data import get_dataset
from losses import focal_loss_with_logits
from metrics import compute_metrics, save_result

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
os.makedirs(CKPT_DIR, exist_ok=True)

FIXED_NUM_LAYERS = 3
N_CV_FOLDS = 3
ALPHAS = [0.3, 0.5, 0.7]

BEST_PARAMS = dict(
    hidden=256, dropout=0.1399600146736454, lr=0.004452441363965912,
    weight_decay=6.064113646149096e-06, keep_frac=0.8013750356917485,
    cache_edges=True, epochs=125, patience=26,
)


class UnifiedGNN(torch.nn.Module):
    """Alternating SAGE/GAT layers + learned time-step embedding + BatchNorm
    + residual connections."""

    def __init__(self, in_dim, n_time_steps, hidden=128, num_layers=FIXED_NUM_LAYERS,
                 heads=4, dropout=0.3, time_emb_dim=8, use_batchnorm=True,
                 use_residual=True):
        super().__init__()
        self.time_emb = torch.nn.Embedding(n_time_steps + 1, time_emb_dim)
        self.use_batchnorm = use_batchnorm
        self.use_residual = use_residual
        self.dropout = dropout

        self.convs = torch.nn.ModuleList()
        self.norms = torch.nn.ModuleList()
        self.res_proj = torch.nn.ModuleList()

        dim = in_dim + time_emb_dim
        for i in range(num_layers):
            if i % 2 == 0:
                self.convs.append(SAGEConv(dim, hidden))
            else:
                self.convs.append(GATConv(dim, hidden // heads, heads=heads, dropout=dropout))
            self.norms.append(torch.nn.BatchNorm1d(hidden) if use_batchnorm else torch.nn.Identity())
            self.res_proj.append(torch.nn.Linear(dim, hidden) if (use_residual and dim != hidden)
                                  else torch.nn.Identity())
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
            x = h + proj(x) if self.use_residual else h
        return self.out(x).squeeze(-1)


def drop_edges(edge_index, keep_frac, generator):
    """DropEdge-style structural subsampling: randomly keep `keep_frac` of
    edges. Used both as a regularizer ('Subsampling') and, when the caller
    reuses the same returned tensor across epochs, as a fixed structural
    mask ('Caching')."""
    if keep_frac >= 1.0:
        return edge_index
    m = edge_index.size(1)
    k = max(1, int(m * keep_frac))
    perm = torch.randperm(m, generator=generator, device="cpu")[:k]
    return edge_index[:, perm.to(edge_index.device)]


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


def rolling_folds(ts_train, n_splits=N_CV_FOLDS):
    """Expanding-window rolling CV over unique time steps: fold i trains on
    everything before a cutoff and validates on the next chunk. Reporting
    only here (no hyperparameter search), so folds are a robustness check,
    not an optimization objective."""
    uniq = np.sort(np.unique(ts_train))
    tscv = TimeSeriesSplit(n_splits=n_splits)
    return [(uniq[tr], uniq[va]) for tr, va in tscv.split(uniq)]


def best_threshold_f1(y_true, probs, n_steps=37):
    """Scan thresholds and return (best_f1, best_threshold)."""
    best_f1, best_t = 0.0, 0.5
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=UndefinedMetricWarning)
        for t in np.linspace(0.05, 0.95, n_steps):
            y_pred = (probs >= t).astype(int)
            f1 = f1_score(y_true, y_pred, zero_division=0)
            if f1 > best_f1:
                best_f1, best_t = f1, t
    return best_f1, best_t


def mask_for_steps(all_time_steps, base_mask, steps):
    m = np.isin(all_time_steps, steps) & base_mask
    return torch.tensor(m)


@torch.no_grad()
def evaluate_probs(model, data, edge_index, mask):
    model.eval()
    out = model(data.x, edge_index, data.time_step)
    probs = torch.sigmoid(out[mask]).cpu().numpy()
    labels = data.y[mask].cpu().numpy()
    return labels, probs


def train_model(data, fit_mask, val_mask, alpha, max_epochs, patience, verbose=False):
    n_time_steps = int(data.time_step.max().item())
    model = UnifiedGNN(
        data.num_node_features, n_time_steps, hidden=BEST_PARAMS["hidden"],
        dropout=BEST_PARAMS["dropout"],
    ).to(DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=BEST_PARAMS["lr"],
                            weight_decay=BEST_PARAMS["weight_decay"])
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode="max", factor=0.5, patience=5)

    gen = torch.Generator().manual_seed(0)
    cached_edges = (drop_edges(data.edge_index, BEST_PARAMS["keep_frac"], gen)
                    if BEST_PARAMS["cache_edges"] else None)

    best_f1, best_threshold, best_state, bad_epochs = -1.0, 0.5, None, 0
    t0 = time.time()
    for epoch in range(max_epochs):
        model.train()
        edge_index = (cached_edges if BEST_PARAMS["cache_edges"]
                      else drop_edges(data.edge_index, BEST_PARAMS["keep_frac"], gen))
        opt.zero_grad()
        out = model(data.x, edge_index, data.time_step)
        loss = focal_loss_with_logits(out[fit_mask], data.y[fit_mask], alpha=alpha)
        loss.backward()
        opt.step()

        val_labels, val_probs = evaluate_probs(model, data, data.edge_index, val_mask)
        val_f1, val_threshold = best_threshold_f1(val_labels, val_probs)
        scheduler.step(val_f1)
        if verbose and (epoch % 10 == 0 or epoch == max_epochs - 1):
            elapsed = time.time() - t0
            eta = elapsed / (epoch + 1) * (max_epochs - epoch - 1)
            print(f"[alpha={alpha}] epoch {epoch}/{max_epochs} loss={loss.item():.4f} "
                  f"val_f1={val_f1:.4f}@t={val_threshold:.2f} elapsed={elapsed:.1f}s eta={eta:.1f}s")

        if val_f1 > best_f1:
            best_f1, best_threshold = val_f1, val_threshold
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            bad_epochs = 0
        else:
            bad_epochs += 1
        if bad_epochs >= patience:
            break

    model.load_state_dict(best_state)
    return model, best_f1, best_threshold


def cv_report(data, time_steps, train_mask, ts_train, alpha):
    folds = rolling_folds(ts_train, N_CV_FOLDS)
    fold_f1s = []
    for fit_steps, val_steps in folds:
        fit_mask = mask_for_steps(time_steps, train_mask, fit_steps).to(DEVICE)
        val_mask = mask_for_steps(time_steps, train_mask, val_steps).to(DEVICE)
        _, fold_f1, _ = train_model(data, fit_mask, val_mask, alpha,
                                     BEST_PARAMS["epochs"], BEST_PARAMS["patience"])
        fold_f1s.append(fold_f1)
    return fold_f1s, folds


def run_alpha(data, time_steps, train_mask, ts_train, test_mask, alpha):
    fold_f1s, folds = cv_report(data, time_steps, train_mask, ts_train, alpha)
    print(f"[alpha={alpha}] 3-fold CV F1 per fold: {[round(f, 4) for f in fold_f1s]} "
          f"mean={np.mean(fold_f1s):.4f}")

    # Final fit: train on the last rolling fold's fit set (closest in time to
    # the real test period), pick threshold + calibrator on that fold's own
    # validation slice, then apply to the held-out test set.
    last_fit_steps, last_val_steps = folds[-1]
    fit_mask = mask_for_steps(time_steps, train_mask, last_fit_steps).to(DEVICE)
    val_mask = mask_for_steps(time_steps, train_mask, last_val_steps).to(DEVICE)

    t0 = time.time()
    model, _, chosen_threshold = train_model(
        data, fit_mask, val_mask, alpha, BEST_PARAMS["epochs"], BEST_PARAMS["patience"],
        verbose=True,
    )
    train_seconds = time.time() - t0

    val_labels, val_probs = evaluate_probs(model, data, data.edge_index, val_mask)
    calibrator = fit_calibrator(val_probs, val_labels)

    test_labels, test_probs = evaluate_probs(model, data, data.edge_index, test_mask)
    m = compute_metrics(test_labels, test_probs, threshold=chosen_threshold)
    n_flagged = int((test_probs >= chosen_threshold).sum())
    print(f"[alpha={alpha}] test: n_flagged_illicit={n_flagged} "
          f"f1={m['f1']:.4f} roc_auc={m['roc_auc']:.4f}")

    save_result(
        f"gnn_main_alpha_{alpha}", m,
        extra={"alpha": alpha, "params": BEST_PARAMS, "cv_fold_f1": fold_f1s,
               "cv_mean_f1": float(np.mean(fold_f1s)), "chosen_threshold": chosen_threshold,
               "n_flagged_illicit_test": n_flagged, "loss": "focal_loss",
               "objective": f"focal loss (alpha={alpha}, gamma=2.0), no Optuna, fixed v2 architecture"},
        train_seconds=train_seconds,
    )

    ckpt_path = os.path.join(CKPT_DIR, f"gnn_main_alpha_{alpha}.pt")
    torch.save({"model_state": model.state_dict(), "params": BEST_PARAMS,
                "alpha": alpha, "chosen_threshold": chosen_threshold}, ckpt_path)
    joblib.dump(calibrator, os.path.join(CKPT_DIR, f"gnn_main_alpha_{alpha}_calibrator.joblib"))
    print(f"[saved] {ckpt_path}")
    return m


def run_sweep(alphas=ALPHAS):
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    time_steps = df["time_step"].to_numpy()
    data = build_data(X_gnn, y, edge_index, time_steps, train_mask, test_mask)
    ts_train = time_steps[train_mask]
    test_mask_t = torch.tensor(test_mask).to(DEVICE)

    results = {}
    for alpha in alphas:
        print(f"=== alpha = {alpha} ===")
        results[alpha] = run_alpha(data, time_steps, train_mask, ts_train, test_mask_t, alpha)
    return results


if __name__ == "__main__":
    run_sweep()
