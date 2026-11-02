import os

import numpy as np
import pandas as pd
import pytest

import data as data_mod
from data import FEAT_COLS, build_gnn_features, build_xgb_features, temporal_split


def _toy_df():
    n = 6
    rows = {"txId": list(range(n)), "time_step": [1, 1, 2, 2, 3, 3]}
    for c in FEAT_COLS:
        rows[c] = [0.0] * n
    rows[FEAT_COLS[0]] = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    df = pd.DataFrame(rows)
    df["class"] = ["1", "2", "unknown", "1", "2", "1"]
    label_map = {"1": 1, "2": 0, "unknown": -1}
    df["label"] = df["class"].map(label_map)
    df["node_idx"] = np.arange(n)
    return df


def test_build_xgb_features_shape_and_degree():
    df = _toy_df()
    edge_index = np.array([[0, 2, 4], [1, 3, 5]], dtype=np.int64)
    X = build_xgb_features(df, edge_index)
    assert X.shape[0] == len(df)
    # feat_dim = len(FEAT_COLS) + neigh_mean(len(FEAT_COLS)) + degree(1) + rolling(10)
    assert X.shape[1] == len(FEAT_COLS) * 2 + 1 + 10

    deg_col = len(FEAT_COLS) * 2
    degrees = X[:, deg_col]
    # each node has exactly one edge in this toy graph
    assert np.allclose(degrees, 1.0)


def test_build_xgb_features_neighbor_mean_correct():
    df = _toy_df()
    edge_index = np.array([[0], [1]], dtype=np.int64)
    X = build_xgb_features(df, edge_index)
    feat0 = df[FEAT_COLS[0]].to_numpy()
    neigh_mean_col0_start = len(FEAT_COLS)
    # node 0's neighbor is node 1 -> neighbor mean feature[0] should equal feat0[1]
    assert X[0, neigh_mean_col0_start] == pytest.approx(feat0[1])
    assert X[1, neigh_mean_col0_start] == pytest.approx(feat0[0])
    # isolated node 2 has degree 0 -> neighbor mean should be 0 (safe division)
    assert X[2, neigh_mean_col0_start] == pytest.approx(0.0)


def test_build_gnn_features_is_raw_only():
    """The GNN must not receive the XGBoost-only engineered columns
    (neigh_mean/degree/rolling window) -- see data.py docstrings for why."""
    df = _toy_df()
    X = build_gnn_features(df)
    assert X.shape == (len(df), len(FEAT_COLS))
    np.testing.assert_array_equal(X, df[FEAT_COLS].to_numpy(dtype=np.float32))


def test_temporal_split_boundary():
    df = pd.DataFrame({"time_step": [34, 35, 1, 49]})
    train_mask, test_mask = temporal_split(df)
    assert list(train_mask) == [True, False, True, False]
    assert list(test_mask) == [False, True, False, True]
    assert not np.any(train_mask & test_mask)


@pytest.mark.skipif(
    not os.path.exists(f"{data_mod.RAW}/elliptic_txs_features.csv"),
    reason="elliptic raw CSVs not available in this environment",
)
def test_get_dataset_integration():
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = data_mod.get_dataset()
    assert X_xgb.shape[0] == len(df)
    assert X_gnn.shape[0] == len(df)
    assert X_gnn.shape[1] < X_xgb.shape[1]  # GNN features are a strict subset
    assert set(np.unique(y[train_mask | test_mask])) <= {0, 1}
    assert not np.any(train_mask & test_mask)
    assert edge_index.shape[0] == 2
