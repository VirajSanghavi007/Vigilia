import numpy as np

from xgb_model import calibration_holdout, cv_report, make_cv_folds


def test_make_cv_folds_are_time_ordered_and_disjoint():
    ts_train = np.arange(1, 35)  # 34 unique steps, like the real train split
    folds = make_cv_folds(ts_train, n_splits=5)
    assert len(folds) == 5
    for tr_steps, va_steps in folds:
        assert tr_steps.max() < va_steps.min()


def test_calibration_holdout_is_tail_slice_and_disjoint():
    ts_train = np.repeat(np.arange(1, 21), 3)  # 20 unique steps, 3 rows each
    fit_mask, cal_mask = calibration_holdout(ts_train, frac=0.15)
    assert not np.any(fit_mask & cal_mask)
    assert ts_train[fit_mask].max() < ts_train[cal_mask].min()
    assert cal_mask.sum() > 0


def test_cv_report_returns_one_f1_per_fold():
    rng = np.random.default_rng(0)
    n = 400
    ts_train = np.sort(rng.integers(1, 20, size=n))
    Xtr = rng.random((n, 5))
    ytr = (Xtr[:, 0] > 0.5).astype(int)  # learnable signal so folds aren't degenerate
    scale_pos_weight = (ytr == 0).sum() / max((ytr == 1).sum(), 1)

    fold_f1s = cv_report(Xtr, ytr, ts_train, scale_pos_weight, n_splits=3)
    assert len(fold_f1s) == 3
    assert all(0.0 <= f <= 1.0 for f in fold_f1s)
