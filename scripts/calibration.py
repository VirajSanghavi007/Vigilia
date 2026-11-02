"""Isotonic calibration so raw scores from different model families (XGBoost
predict_proba vs. GNN sigmoid-of-logits) are comparable as confidence scores
before being compared in scripts/co_label.py."""
from sklearn.isotonic import IsotonicRegression


def fit_calibrator(raw_scores, labels):
    """Fit on a held-out slice, never the test set."""
    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(raw_scores, labels)
    return calibrator


def apply_calibrator(calibrator, raw_scores):
    return calibrator.predict(raw_scores)
