"""Co-labeling: label every node illicit only where both the XGBoost model
and the GNN (Main) model agree, flag disagreements with an asterisk instead
of silently picking a side, and attach each model's own calibrated
confidence so a reviewer can see why a node was flagged.

Disagreement default: illicit. Per explicit decision -- missing a true
illicit transaction is treated as worse than an extra review, so a
disagreement still gets flagged for review (asterisked, not silently
dropped to licit).
"""
import argparse
import os

import joblib
import numpy as np
import torch

from calibration import apply_calibrator
from data import get_dataset
from gnn_main import UnifiedGNN, build_data

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def load_xgb():
    model = joblib.load(os.path.join(CKPT_DIR, "xgb_model.joblib"))
    calibrator = joblib.load(os.path.join(CKPT_DIR, "xgb_calibrator.joblib"))
    return model, calibrator


def load_gnn(alpha):
    ckpt = torch.load(os.path.join(CKPT_DIR, f"gnn_main_alpha_{alpha}.pt"), map_location=DEVICE,
                       weights_only=False)  # our own checkpoint, contains a numpy scalar (threshold)
    calibrator = joblib.load(os.path.join(CKPT_DIR, f"gnn_main_alpha_{alpha}_calibrator.joblib"))
    return ckpt, calibrator


def score_xgb(model, calibrator, X):
    raw = model.predict_proba(X)[:, 1]
    return raw, apply_calibrator(calibrator, raw)


@torch.no_grad()
def score_gnn(ckpt, calibrator, X_gnn, y, edge_index, time_steps):
    n_time_steps = int(time_steps.max())
    model = UnifiedGNN(X_gnn.shape[1], n_time_steps, hidden=ckpt["params"]["hidden"],
                        dropout=ckpt["params"]["dropout"]).to(DEVICE)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    dummy_mask = np.zeros(len(y), dtype=bool)
    data = build_data(X_gnn, y, edge_index, time_steps, dummy_mask, dummy_mask)
    out = model(data.x, data.edge_index, data.time_step)
    raw = torch.sigmoid(out).cpu().numpy()
    return raw, apply_calibrator(calibrator, raw)


def co_label(xgb_pred, gnn_pred, xgb_conf, gnn_conf):
    """Returns (label, flag) arrays. label: 0=licit, 1=illicit.
    flag: '' if both models agreed, '*' if they disagreed."""
    agree_illicit = (xgb_pred == 1) & (gnn_pred == 1)
    agree_licit = (xgb_pred == 0) & (gnn_pred == 0)
    disagree = ~(agree_illicit | agree_licit)

    label = np.where(agree_illicit, 1, np.where(agree_licit, 0, 1))  # disagreement -> illicit
    flag = np.where(disagree, "*", "")
    return label, flag


def run(gnn_alpha, xgb_threshold=0.5):
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    time_steps = df["time_step"].to_numpy()

    xgb_model, xgb_calibrator = load_xgb()
    xgb_raw, xgb_conf = score_xgb(xgb_model, xgb_calibrator, X_xgb)
    xgb_pred = (xgb_raw >= xgb_threshold).astype(int)

    gnn_ckpt, gnn_calibrator = load_gnn(gnn_alpha)
    gnn_raw, gnn_conf = score_gnn(gnn_ckpt, gnn_calibrator, X_gnn, y, edge_index, time_steps)
    gnn_pred = (gnn_raw >= gnn_ckpt["chosen_threshold"]).astype(int)

    label, flag = co_label(xgb_pred, gnn_pred, xgb_conf, gnn_conf)

    out = df[["txId", "time_step"]].copy()
    out["co_label"] = label
    out["flag"] = flag
    out["xgb_confidence"] = xgb_conf
    out["gnn_confidence"] = gnn_conf
    out["original_label"] = y  # -1 = was unlabeled

    n_disagree = int((flag == "*").sum())
    n_illicit = int((label == 1).sum())
    print(f"co-labeled {len(out)} nodes: {n_illicit} illicit ({n_disagree} flagged as disagreements)")
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--gnn-alpha", type=float, default=0.5,
                         help="which alpha-sweep GNN checkpoint to use (0.3, 0.5, or 0.7)")
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "results",
                                                        "co_labeled.csv"))
    args = parser.parse_args()

    result = run(args.gnn_alpha)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    result.to_csv(args.out, index=False)
    print(f"[saved] {args.out}")
