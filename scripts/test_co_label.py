import numpy as np

from co_label import co_label


def test_co_label_both_illicit_labels_illicit_no_flag():
    xgb_pred = np.array([1])
    gnn_pred = np.array([1])
    label, flag = co_label(xgb_pred, gnn_pred, np.array([0.9]), np.array([0.8]))
    assert label[0] == 1
    assert flag[0] == ""


def test_co_label_both_licit_labels_licit_no_flag():
    xgb_pred = np.array([0])
    gnn_pred = np.array([0])
    label, flag = co_label(xgb_pred, gnn_pred, np.array([0.1]), np.array([0.2]))
    assert label[0] == 0
    assert flag[0] == ""


def test_co_label_disagreement_defaults_to_illicit_and_flags():
    """Explicit decision: a disagreement is still flagged illicit (for
    review) rather than silently dropped to licit, since missing a true
    illicit transaction is treated as worse than one extra review."""
    xgb_pred = np.array([1, 0])
    gnn_pred = np.array([0, 1])
    label, flag = co_label(xgb_pred, gnn_pred, np.array([0.6, 0.3]), np.array([0.4, 0.7]))
    assert list(label) == [1, 1]
    assert list(flag) == ["*", "*"]


def test_co_label_mixed_batch():
    xgb_pred = np.array([1, 1, 0, 0])
    gnn_pred = np.array([1, 0, 0, 1])
    label, flag = co_label(xgb_pred, gnn_pred, np.zeros(4), np.zeros(4))
    assert list(label) == [1, 1, 0, 1]
    assert list(flag) == ["", "*", "", "*"]
