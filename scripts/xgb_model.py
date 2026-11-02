"""XGBoost model for co-labeling: fixed (non-tuned) hyperparameters -- the
saved xgboost_non_tuned.json benchmark (F1=0.815, 8.4s) beat the Optuna-tuned
run (F1=0.802, 503s) on this dataset, so no search is run here, just a
5-fold time-series CV report (robustness check, not a tuning objective) plus
a final fit on the full training period. Model + isotonic calibrator are
persisted so scripts/co_label.py can load them without retraining."""
import os
import time

import joblib
import numpy as np
from sklearn.metrics import f1_score
from sklearn.model_selection import TimeSeriesSplit
import xgboost as xgb

from calibration import fit_calibrator
from data import get_dataset
from metrics import compute_metrics, save_result

N_JOBS = 22  # per global parallelization guidance: 22-24 workers on 24-core machine
CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
os.makedirs(CKPT_DIR, exist_ok=True)

FIXED_PARAMS = dict(
    n_estimators=300, max_depth=6, learning_rate=0.1,
    tree_method="hist", n_jobs=N_JOBS, eval_metric="aucpr",
)


def make_cv_folds(time_steps_train, n_splits=5):
    """Time-series aware CV: split by unique time step order, not random rows."""
    uniq = np.sort(np.unique(time_steps_train))
    tscv = TimeSeriesSplit(n_splits=n_splits)
    folds = []
    for tr_idx, va_idx in tscv.split(uniq):
        tr_steps, va_steps = uniq[tr_idx], uniq[va_idx]
        folds.append((tr_steps, va_steps))
    return folds


def cv_report(Xtr, ytr, ts_train, scale_pos_weight, n_splits=5):
    """Report F1 per fold with the fixed hyperparameters -- no search, just
    a check that the fixed config holds up across different train/val
    boundaries through the timeline."""
    folds = make_cv_folds(ts_train, n_splits=n_splits)
    fold_f1s = []
    for tr_steps, va_steps in folds:
        tr_mask = np.isin(ts_train, tr_steps)
        va_mask = np.isin(ts_train, va_steps)
        clf = xgb.XGBClassifier(scale_pos_weight=scale_pos_weight, **FIXED_PARAMS)
        clf.fit(Xtr[tr_mask], ytr[tr_mask])
        prob = clf.predict_proba(Xtr[va_mask])[:, 1]
        pred = (prob >= 0.5).astype(int)
        fold_f1s.append(f1_score(ytr[va_mask], pred, zero_division=0))
    return fold_f1s


def calibration_holdout(ts_train, frac=0.15):
    """Last slice of the training period by time, used only to fit the
    isotonic calibrator -- never touches the test set."""
    uniq = np.sort(np.unique(ts_train))
    cut = uniq[int(len(uniq) * (1 - frac))]
    fit_steps_mask = ts_train < cut
    cal_steps_mask = ts_train >= cut
    return fit_steps_mask, cal_steps_mask


def run(Xtr, ytr, ts_train, Xte, yte, scale_pos_weight):
    fold_f1s = cv_report(Xtr, ytr, ts_train, scale_pos_weight, n_splits=5)
    print(f"5-fold CV F1 per fold: {[round(f, 4) for f in fold_f1s]} "
          f"mean={np.mean(fold_f1s):.4f}")

    fit_mask, cal_mask = calibration_holdout(ts_train)

    t0 = time.time()
    clf = xgb.XGBClassifier(scale_pos_weight=scale_pos_weight, **FIXED_PARAMS)
    clf.fit(Xtr[fit_mask], ytr[fit_mask])
    train_seconds = time.time() - t0

    cal_raw = clf.predict_proba(Xtr[cal_mask])[:, 1]
    calibrator = fit_calibrator(cal_raw, ytr[cal_mask])

    # Refit on the full training period for the model that actually gets
    # saved/deployed -- the held-out calibration slice above is only used to
    # fit the calibrator, not thrown away from the final model.
    clf_final = xgb.XGBClassifier(scale_pos_weight=scale_pos_weight, **FIXED_PARAMS)
    clf_final.fit(Xtr, ytr)

    test_raw = clf_final.predict_proba(Xte)[:, 1]
    m = compute_metrics(yte, test_raw)
    save_result(
        "xgboost_main", m,
        extra={"params": FIXED_PARAMS, "cv_fold_f1": fold_f1s,
               "cv_mean_f1": float(np.mean(fold_f1s))},
        train_seconds=train_seconds,
    )

    joblib.dump(clf_final, os.path.join(CKPT_DIR, "xgb_model.joblib"))
    joblib.dump(calibrator, os.path.join(CKPT_DIR, "xgb_calibrator.joblib"))
    print(f"[saved] {CKPT_DIR}/xgb_model.joblib, xgb_calibrator.joblib")
    print(m["classification_report"])
    return m


if __name__ == "__main__":
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    Xtr, Xte = X_xgb[train_mask], X_xgb[test_mask]
    ytr, yte = y[train_mask], y[test_mask]
    ts_train = df["time_step"].to_numpy()[train_mask]
    scale_pos_weight = (ytr == 0).sum() / (ytr == 1).sum()

    run(Xtr, ytr, ts_train, Xte, yte, scale_pos_weight)
