"""Load Elliptic dataset, build features, temporal split, edge index."""
import os

import numpy as np
import pandas as pd
import torch

RAW = os.path.join(os.path.dirname(__file__), "..", "data", "elliptic_bitcoin_dataset")

LOCAL_COLS = [f"local_{i}" for i in range(93)]
AGG_COLS = [f"agg_{i}" for i in range(72)]
FEAT_COLS = LOCAL_COLS + AGG_COLS


def load_raw():
    feats = pd.read_csv(f"{RAW}/elliptic_txs_features.csv", header=None)
    feats.columns = ["txId", "time_step"] + FEAT_COLS
    classes = pd.read_csv(f"{RAW}/elliptic_txs_classes.csv")
    edges = pd.read_csv(f"{RAW}/elliptic_txs_edgelist.csv")

    df = feats.merge(classes, on="txId", how="left")
    # 1=illicit,2=licit,unknown -> label: illicit=1, licit=0, unknown=-1
    label_map = {"1": 1, "2": 0, "unknown": -1}
    df["label"] = df["class"].astype(str).map(label_map)
    df = df.reset_index(drop=True)
    df["node_idx"] = np.arange(len(df))

    id2idx = dict(zip(df["txId"], df["node_idx"]))
    src = edges["txId1"].map(id2idx)
    dst = edges["txId2"].map(id2idx)
    valid = src.notna() & dst.notna()
    edge_index = np.vstack([src[valid].to_numpy(), dst[valid].to_numpy()]).astype(np.int64)
    return df, edge_index


def build_xgb_features(df, edge_index):
    """Raw features + 1-hop neighbor aggregation + rolling time-window mean.

    XGBoost has no way to do message passing itself, so the hand-computed
    neighbor mean/degree is its only access to graph structure, and the
    rolling window is its only access to temporal trend -- both stay
    XGBoost-only so the GNN (see build_gnn_features) isn't fed the same
    signal twice through two different channels (once pre-computed here,
    once re-derived by its own learned aggregation/time embedding).
    """
    n = len(df)
    feat = df[FEAT_COLS].to_numpy(dtype=np.float32)

    # 1-hop neighbor mean aggregation (undirected)
    src, dst = edge_index
    deg = np.zeros(n, dtype=np.float32)
    neigh_sum = np.zeros((n, feat.shape[1]), dtype=np.float32)
    np.add.at(deg, src, 1.0)
    np.add.at(deg, dst, 1.0)
    np.add.at(neigh_sum, src, feat[dst])
    np.add.at(neigh_sum, dst, feat[src])
    deg_safe = np.where(deg == 0, 1.0, deg)
    neigh_mean = neigh_sum / deg_safe[:, None]

    # rolling avg (window=3) of per-time-step mean local features, joined back per node
    ts = df["time_step"].to_numpy()
    ts_mean = df.groupby("time_step")[FEAT_COLS[:10]].mean()
    ts_roll = ts_mean.rolling(3, min_periods=1).mean()
    roll_feat = ts_roll.reindex(ts).to_numpy(dtype=np.float32)

    extra = np.concatenate([neigh_mean, deg[:, None], roll_feat], axis=1)
    return np.concatenate([feat, extra], axis=1)


def build_gnn_features(df):
    """Raw features only -- no pre-computed neighbor mean/degree, no rolling
    time window. The GNN derives neighbor structure itself through learned
    SAGE/GAT message passing over edge_index, and derives temporal signal
    through its own learned per-time-step embedding, so handing it the same
    aggregates XGBoost uses would just duplicate signal both models would
    otherwise pick up independently (defeats the point of co-labeling on
    model agreement -- see scripts/co_label.py).
    """
    return df[FEAT_COLS].to_numpy(dtype=np.float32)


def temporal_split(df):
    # standard Elliptic split: time steps 1-34 train, 35-49 test
    train_mask = df["time_step"] <= 34
    test_mask = df["time_step"] > 34
    return train_mask.to_numpy(), test_mask.to_numpy()


def get_dataset():
    """Returns (df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask).

    X_xgb and X_gnn are deliberately different feature sets (see
    build_xgb_features/build_gnn_features docstrings) so the two models used
    for co-labeling (scripts/xgb_model.py, scripts/gnn_main.py) don't share
    the same engineered-feature bias.
    """
    df, edge_index = load_raw()
    X_xgb = build_xgb_features(df, edge_index)
    X_gnn = build_gnn_features(df)
    y = df["label"].to_numpy()
    labeled = y != -1
    train_mask, test_mask = temporal_split(df)
    train_mask = train_mask & labeled
    test_mask = test_mask & labeled
    return df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask


if __name__ == "__main__":
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    print("nodes", len(df), "edges", edge_index.shape[1],
          "xgb_feat_dim", X_xgb.shape[1], "gnn_feat_dim", X_gnn.shape[1])
    print("train", train_mask.sum(), "test", test_mask.sum())
    print("train illicit rate", y[train_mask].mean(), "test illicit rate", y[test_mask].mean())
