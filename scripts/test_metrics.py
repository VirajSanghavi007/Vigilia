import json
import os
import tempfile

import numpy as np

import metrics as metrics_mod
from metrics import compute_metrics, save_result


def test_compute_metrics_perfect_predictions():
    y_true = np.array([0, 0, 1, 1])
    y_prob = np.array([0.01, 0.02, 0.9, 0.95])
    m = compute_metrics(y_true, y_prob)
    assert m["roc_auc"] == 1.0
    assert m["roc_pr_auc"] == 1.0
    assert m["f1"] == 1.0


def test_compute_metrics_worst_case_inverted():
    y_true = np.array([0, 0, 1, 1])
    y_prob = np.array([0.95, 0.9, 0.02, 0.01])  # inverted -> worst ranking
    m = compute_metrics(y_true, y_prob)
    assert m["roc_auc"] == 0.0
    assert m["f1"] == 0.0


def test_save_result_writes_expected_json(monkeypatch, tmp_path):
    monkeypatch.setattr(metrics_mod, "RESULTS_DIR", str(tmp_path))
    m = {"roc_auc": 0.5, "roc_pr_auc": 0.5, "f1": 0.5, "classification_report": "x"}
    rec = save_result("unit_test_model", m, extra={"foo": "bar"}, train_seconds=1.23)
    path = tmp_path / "unit_test_model.json"
    assert path.exists()
    with open(path) as f:
        loaded = json.load(f)
    assert loaded["model"] == "unit_test_model"
    assert loaded["foo"] == "bar"
    assert loaded["train_seconds"] == 1.23
    assert rec["roc_auc"] == 0.5
