import numpy as np

from calibration import apply_calibrator, fit_calibrator


def test_calibrator_is_monotonic_and_bounded():
    rng = np.random.default_rng(0)
    n = 200
    labels = (rng.random(n) > 0.8).astype(int)
    # raw scores correlated with label but poorly scaled (like an uncalibrated model)
    raw = np.clip(labels * 0.9 + rng.normal(0, 0.3, n), -2, 2)

    calibrator = fit_calibrator(raw, labels)
    order = np.argsort(raw)
    calibrated = apply_calibrator(calibrator, raw[order])
    assert np.all(np.diff(calibrated) >= -1e-9)  # monotonic non-decreasing
    assert calibrated.min() >= 0.0
    assert calibrated.max() <= 1.0


def test_calibrator_out_of_bounds_scores_are_clipped_not_extrapolated():
    labels = np.array([0, 0, 1, 1])
    raw = np.array([0.1, 0.2, 0.8, 0.9])
    calibrator = fit_calibrator(raw, labels)
    far_out_of_range = apply_calibrator(calibrator, np.array([-100.0, 100.0]))
    assert far_out_of_range[0] >= 0.0
    assert far_out_of_range[1] <= 1.0
