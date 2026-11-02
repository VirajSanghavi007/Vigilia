"""Sparse autoencoder trained ONLY on labeled-licit nodes: it learns what
'normal' (licit) transactions look like in raw feature space, and anything
it reconstructs poorly is anomalous relative to that -- illicit transactions
by design (never seen during training), and potentially unlabeled nodes too,
if they're genuinely out-of-distribution the way structural_breakdown.py and
consistency_check.py both suggest.

This is deliberately NOT a third vote in the co-labeling scheme (scripts/
co_label.py) -- it's an unsupervised sanity check on the unlabeled
population: does reconstruction error on unlabeled nodes look like the
licit distribution it was trained on, the illicit distribution it never
saw, or something in between/distinct from both?

Sparsity is enforced via an L1 penalty on the bottleneck activations (the
simpler of the two standard sparse-autoencoder formulations -- the
alternative is a KL-divergence target-activation penalty, which needs
bounded [0,1] activations; L1 works directly with ReLU and is enough to
encourage a compact code here).

Trained on raw features only (data.build_gnn_features) -- same rationale as
gnn_main.py/graph_transformer.py: this is meant to capture what the feature
space itself looks like, not re-derive XGBoost's hand-engineered graph
aggregates.
"""
import argparse
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from data import get_dataset
from group_stats import compare_groups

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(CKPT_DIR, exist_ok=True)
CKPT_PATH = os.path.join(CKPT_DIR, "sparse_autoencoder.pt")


class SparseAutoencoder(torch.nn.Module):
    def __init__(self, in_dim, hidden=64, bottleneck=16):
        super().__init__()
        self.encoder = torch.nn.Sequential(
            torch.nn.Linear(in_dim, hidden), torch.nn.ReLU(),
            torch.nn.Linear(hidden, bottleneck), torch.nn.ReLU(),
        )
        self.decoder = torch.nn.Sequential(
            torch.nn.Linear(bottleneck, hidden), torch.nn.ReLU(),
            torch.nn.Linear(hidden, in_dim),
        )

    def forward(self, x):
        code = self.encoder(x)
        recon = self.decoder(code)
        return recon, code


def sparse_loss(x, recon, code, sparsity_weight=1e-3):
    recon_loss = F.mse_loss(recon, x)
    sparsity_penalty = code.abs().mean()  # L1 on bottleneck activations
    return recon_loss + sparsity_weight * sparsity_penalty, recon_loss, sparsity_penalty


@torch.no_grad()
def reconstruction_error(model, X, batch_size=8192):
    model.eval()
    errors = np.zeros(X.shape[0], dtype=np.float32)
    for start in range(0, X.shape[0], batch_size):
        end = min(start + batch_size, X.shape[0])
        x = X[start:end]
        recon, _ = model(x)
        errors[start:end] = ((recon - x) ** 2).mean(dim=1).cpu().numpy()
    return errors


def fit_scaler(X):
    """Robust (median/IQR) scaling instead of mean/std: Elliptic's raw
    features are heavy-tailed, and a z-score scaler lets a handful of
    extreme outliers dominate both the fitted mean/std AND the MSE
    reconstruction loss -- the first run of this script showed exactly that
    failure mode (illicit reconstructed BETTER than licit, AUC=0.24, worse
    than random). Median/IQR is far less sensitive to the outliers that
    z-score scaling gets distorted by."""
    median = np.median(X, axis=0, keepdims=True)
    q75 = np.percentile(X, 75, axis=0, keepdims=True)
    q25 = np.percentile(X, 25, axis=0, keepdims=True)
    iqr = q75 - q25
    iqr = np.where(iqr < 1e-8, 1.0, iqr)
    return median, iqr


def apply_scaler(X, center, scale, clip=10.0):
    """Scale, then clip to a bounded range. Clipping matters specifically
    for the unlabeled population: if those nodes carry genuinely extreme
    feature values, an unbounded linear decoder extrapolates wildly outside
    the range it was ever trained on, producing reconstruction-error numbers
    that reflect network extrapolation behavior rather than a meaningful,
    comparable anomaly score. Clipping keeps every input in the range the
    decoder actually learned to reconstruct."""
    scaled = (X - center) / scale
    if clip is not None:
        scaled = np.clip(scaled, -clip, clip)
    return scaled


def train(X_licit, epochs=100, hidden=64, bottleneck=16, sparsity_weight=1e-3, lr=1e-3):
    model = SparseAutoencoder(X_licit.shape[1], hidden=hidden, bottleneck=bottleneck).to(DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    x = torch.tensor(X_licit, dtype=torch.float32, device=DEVICE)

    t0 = time.time()
    for epoch in range(epochs):
        model.train()
        opt.zero_grad()
        recon, code = model(x)
        loss, recon_loss, sparsity_penalty = sparse_loss(x, recon, code, sparsity_weight)
        loss.backward()
        opt.step()
        print_every = max(1, epochs // 20)
        if epoch % print_every == 0 or epoch == epochs - 1:
            elapsed = time.time() - t0
            eta = elapsed / (epoch + 1) * (epochs - epoch - 1)
            print(f"epoch {epoch}/{epochs} loss={loss.item():.4f} "
                  f"recon={recon_loss.item():.4f} sparsity={sparsity_penalty.item():.4f} "
                  f"elapsed={elapsed:.1f}s eta={eta:.1f}s")
    return model


def run(epochs=100, sparsity_weight=1e-3):
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    labeled_mask = train_mask | test_mask

    center, scale = fit_scaler(X_gnn[train_mask])
    X_scaled = apply_scaler(X_gnn, center, scale, clip=10.0)

    licit_train_mask = train_mask & (y == 0)
    print(f"training on {licit_train_mask.sum()} labeled-licit training nodes only "
          f"(never sees illicit or unlabeled nodes)")
    model = train(X_scaled[licit_train_mask], epochs=epochs, sparsity_weight=sparsity_weight)

    all_errors = reconstruction_error(model, torch.tensor(X_scaled, dtype=torch.float32, device=DEVICE))

    # Sanity check: on the labeled TEST set, does reconstruction error alone
    # (an unsupervised score, never trained on illicit examples) separate
    # illicit from licit at all? If not, the anomaly signal isn't meaningful
    # and nothing downstream about the unlabeled comparison should be trusted.
    from sklearn.metrics import roc_auc_score
    test_auc = roc_auc_score(y[test_mask], all_errors[test_mask])
    print(f"[sanity check] reconstruction-error-as-anomaly-score ROC-AUC on labeled test set: "
          f"{test_auc:.4f} (0.5 = no signal, useless; meaningfully >0.5 = real anomaly signal)")

    licit_mask_all = labeled_mask & (y == 0)
    illicit_mask_all = labeled_mask & (y == 1)
    unlabeled_mask = ~labeled_mask

    licit_vs_unlabeled = compare_groups(
        np.concatenate([all_errors[licit_mask_all], all_errors[unlabeled_mask]]),
        np.array([True] * int(licit_mask_all.sum()) + [False] * int(unlabeled_mask.sum())),
        alternative="two-sided",
    )
    illicit_vs_unlabeled = compare_groups(
        np.concatenate([all_errors[illicit_mask_all], all_errors[unlabeled_mask]]),
        np.array([True] * int(illicit_mask_all.sum()) + [False] * int(unlabeled_mask.sum())),
        alternative="two-sided",
    )

    print(f"[licit vs unlabeled] licit_mean_error={licit_vs_unlabeled['labeled_mean']:.4f} "
          f"unlabeled_mean_error={licit_vs_unlabeled['unlabeled_mean']:.4f} "
          f"p={licit_vs_unlabeled['p_value']:.2e}")
    print(f"[illicit vs unlabeled] illicit_mean_error={illicit_vs_unlabeled['labeled_mean']:.4f} "
          f"unlabeled_mean_error={illicit_vs_unlabeled['unlabeled_mean']:.4f} "
          f"p={illicit_vs_unlabeled['p_value']:.2e}")

    licit_mean = all_errors[licit_mask_all].mean()
    illicit_mean = all_errors[illicit_mask_all].mean()
    unlabeled_mean = all_errors[unlabeled_mask].mean()
    print(f"[summary] licit={licit_mean:.4f} illicit={illicit_mean:.4f} unlabeled={unlabeled_mean:.4f} "
          f"-- unlabeled sits {'closer to illicit' if abs(unlabeled_mean-illicit_mean) < abs(unlabeled_mean-licit_mean) else 'closer to licit'}")

    torch.save({"model_state": model.state_dict(), "center": center, "scale": scale}, CKPT_PATH)
    print(f"[saved] {CKPT_PATH}")

    return {
        "test_auc": float(test_auc),
        "licit_mean_error": float(licit_mean),
        "illicit_mean_error": float(illicit_mean),
        "unlabeled_mean_error": float(unlabeled_mean),
        "licit_vs_unlabeled": licit_vs_unlabeled,
        "illicit_vs_unlabeled": illicit_vs_unlabeled,
    }


if __name__ == "__main__":
    import json
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--sparsity-weight", type=float, default=1e-3)
    args = parser.parse_args()
    result = run(epochs=args.epochs, sparsity_weight=args.sparsity_weight)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(os.path.join(RESULTS_DIR, "sparse_autoencoder.json"), "w") as f:
        json.dump(result, f, indent=2)
    print(f"[saved] {os.path.join(RESULTS_DIR, 'sparse_autoencoder.json')}")
