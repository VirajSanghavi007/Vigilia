"""Smoke test — the model loads and produces a sane score on one input.

Not a correctness/accuracy check (that belongs in offline evaluation once
train/eval tooling exists). This only proves the checkpoint loads, the graph
builder + model + inference path run end-to-end without exceptions, and the
output is a finite probability. Requires requirements-ml.txt (torch +
torch_geometric) — deliberately kept out of the fast unit-test job.
"""
import numpy as np
import pandas as pd
import pytest

torch = pytest.importorskip("torch")

from backend.models.multignn import build_graph, load_multignn, score_transactions  # noqa: E402


def _one_transaction_df() -> pd.DataFrame:
    return pd.DataFrame([{
        "Timestamp": "2024-01-01 12:00:00",
        "From Bank": "1", "Account": "A1",
        "To Bank": "2", "Account.1": "A2",
        "Amount Received": 1000.0, "Receiving Currency": "US Dollar",
        "Amount Paid": 1000.0, "Payment Currency": "US Dollar",
        "Payment Format": "Wire", "Is Laundering": 0,
    }])


def test_model_loads():
    model, _metrics = load_multignn()
    if model is None:
        pytest.skip("No trained checkpoint present (data/multignn_model.pt) — nothing to smoke-test.")


def test_single_input_scores_finite_probability():
    model, _metrics = load_multignn()
    if model is None:
        pytest.skip("No trained checkpoint present (data/multignn_model.pt) — nothing to smoke-test.")

    bundle = build_graph(df=_one_transaction_df())
    scores = score_transactions(model, bundle)

    assert scores.shape == (1,)
    assert np.isfinite(scores).all()
    assert 0.0 <= scores[0] <= 1.0
