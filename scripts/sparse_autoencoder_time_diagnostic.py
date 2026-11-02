"""Diagnostic: is the sparse autoencoder's inverted sanity-check AUC (0.297
pooled across the whole test period -- illicit reconstructs BETTER than
licit, the opposite of what a one-class anomaly detector should do) a
temporal-drift confound, or a real property of the data?

Elliptic has documented covariate drift after ~time step 43. If licit
transactions later in the test period just look structurally different from
the train-period licit distribution the autoencoder learned, pooling all
test time steps together could produce Simpson's-paradox-style behavior:
error could rise over time for BOTH classes (drift), while still being
higher for illicit than licit WITHIN any single time step (a real signal),
with the pooled comparison masking that because different time steps sit at
different baseline error levels.

This computes ROC-AUC of reconstruction error vs. label separately within
each time step that has both classes present, rather than pooled -- if the
per-step AUCs are consistently >0.5 (even while pooled AUC is <0.5), that's
drift; if per-step AUCs are still consistently <0.5, the inversion is real
and not a confound.
"""
import argparse
import os

import numpy as np
import torch
from sklearn.metrics import roc_auc_score

from data import get_dataset
from sparse_autoencoder import SparseAutoencoder, apply_scaler, reconstruction_error

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
CKPT_PATH = os.path.join(CKPT_DIR, "sparse_autoencoder.pt")


def auc_by_time_step(errors, labels, time_steps, mask, min_per_class=5):
    """ROC-AUC of `errors` vs `labels`, computed separately per unique value
    of `time_steps` within `mask` -- only for steps with at least
    `min_per_class` examples of both classes (AUC is undefined/noisy
    otherwise)."""
    errors = np.asarray(errors)[mask]
    labels = np.asarray(labels)[mask]
    steps = np.asarray(time_steps)[mask]

    per_step = {}
    for t in np.unique(steps):
        step_mask = steps == t
        step_labels = labels[step_mask]
        n_pos = int((step_labels == 1).sum())
        n_neg = int((step_labels == 0).sum())
        if n_pos < min_per_class or n_neg < min_per_class:
            continue
        auc = roc_auc_score(step_labels, errors[step_mask])
        per_step[int(t)] = {"auc": float(auc), "n_pos": n_pos, "n_neg": n_neg}
    return per_step


def summarize(per_step):
    aucs = [v["auc"] for v in per_step.values()]
    if not aucs:
        return {"n_steps": 0, "mean_auc": None, "median_auc": None, "frac_above_half": None}
    return {
        "n_steps": len(aucs),
        "mean_auc": float(np.mean(aucs)),
        "median_auc": float(np.median(aucs)),
        "frac_above_half": float(np.mean([a > 0.5 for a in aucs])),
    }


def run(min_per_class=5):
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    time_steps = df["time_step"].to_numpy()

    ckpt = torch.load(CKPT_PATH, map_location=DEVICE, weights_only=False)
    model = SparseAutoencoder(X_gnn.shape[1]).to(DEVICE)
    model.load_state_dict(ckpt["model_state"])
    X_scaled = apply_scaler(X_gnn, ckpt["center"], ckpt["scale"], clip=10.0)
    errors = reconstruction_error(model, torch.tensor(X_scaled, dtype=torch.float32, device=DEVICE))

    pooled_auc = roc_auc_score(y[test_mask], errors[test_mask])
    print(f"pooled test-period AUC (for reference, matches earlier result): {pooled_auc:.4f}")

    per_step = auc_by_time_step(errors, y, time_steps, test_mask, min_per_class=min_per_class)
    summary = summarize(per_step)

    print(f"\nper-time-step AUC ({summary['n_steps']} steps with >= {min_per_class} of each class):")
    for t, v in sorted(per_step.items()):
        print(f"  step {t}: auc={v['auc']:.4f} (n_illicit={v['n_pos']}, n_licit={v['n_neg']})")
    print(f"\nmean per-step AUC={summary['mean_auc']:.4f} median={summary['median_auc']:.4f} "
          f"fraction of steps with AUC>0.5: {summary['frac_above_half']:.2f}")

    if summary["mean_auc"] is not None and summary["mean_auc"] > 0.55 and pooled_auc < 0.5:
        verdict = ("DRIFT CONFOUND: per-step AUC is meaningfully better than pooled AUC -- "
                   "the inversion looks like a temporal-drift artifact, not a real anti-signal.")
    elif summary["mean_auc"] is not None and summary["mean_auc"] < 0.45:
        verdict = ("REAL INVERSION: per-step AUC is still consistently below 0.5 -- "
                   "illicit really does reconstruct better than licit within individual time "
                   "steps too, so this is not a drift confound. One-class reconstruction error "
                   "is not a usable anomaly signal for this dataset as built.")
    else:
        verdict = "INCONCLUSIVE: per-step AUC is close to 0.5, no strong signal either way."
    print(f"\nVERDICT: {verdict}")

    return {"pooled_auc": float(pooled_auc), "per_step": per_step, "summary": summary,
            "verdict": verdict}


if __name__ == "__main__":
    import json
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-per-class", type=int, default=5)
    args = parser.parse_args()
    result = run(min_per_class=args.min_per_class)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(os.path.join(RESULTS_DIR, "sparse_autoencoder_time_diagnostic.json"), "w") as f:
        json.dump(result, f, indent=2)
    print(f"[saved] {os.path.join(RESULTS_DIR, 'sparse_autoencoder_time_diagnostic.json')}")
