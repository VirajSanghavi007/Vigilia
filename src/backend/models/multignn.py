"""
Multi-GNN — edge-level money-laundering classifier for transaction graphs.

This module provides graph construction and inference only. Training has been removed.
The model is loaded from a pre-trained checkpoint (multignn_model.pt).

Multi-GNN adaptations (Egressy et al., "Provably Powerful Graph Neural Networks for Directed Multigraphs", IBM):
  - Reverse message passing: every transaction edge is mirrored with a reverse edge carrying an `is_reverse` flag
  - Port numbering: each edge records its ordinal position among source and destination edges
  - Edge-feature GINE: per-edge features during message passing
  - Edge-level head: MLP over endpoint embeddings predicts laundering probability

Inference usage:
    from multignn_model import build_graph, load_multignn, score_transactions
    bundle = build_graph(df=my_df)
    model, metrics = load_multignn()
    scores = score_transactions(model, bundle)
"""

from __future__ import annotations

import json
import logging
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

logger = logging.getLogger("uvicorn.error")

from config import DATA_DIR, MODEL_PATH, META_PATH

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch_geometric.nn import GINEConv, PNAConv
    HAS_TORCH = True
except ImportError:
    import types as _types
    nn = _types.SimpleNamespace(Module=object, Linear=None, Embedding=None,
                                Sequential=None, Dropout=None, BatchNorm1d=None,
                                ModuleList=None, ReLU=None)
    HAS_TORCH = False
    logger.warning("PyTorch / PyTorch Geometric not available — Multi-GNN disabled.")


# ── Graph construction ─────────────────────────────────────────────────────────

def build_graph(csv_path: Path | None = None, max_rows: int | None = None,
                return_df: bool = False, df: "pd.DataFrame | None" = None,
                row_offset: int = 0) -> dict:
    """
    Build the transaction multigraph as a PyG-ready bundle.

    Returns a dict with:
      x            : [N, 4]  node features (in_deg, out_deg, log recv, log sent)
      edge_index   : [2, 2E] forward + reverse edges
      edge_attr    : [2E, 14] edge features
      y            : [E]     laundering label per *forward* transaction
      label_index  : [2, E]  endpoint node pairs of the forward transactions
      t_edge       : [E]     normalized timestamp per forward transaction
      meta         : encoders + dims needed for inference
    """
    if not HAS_TORCH:
        raise RuntimeError("PyTorch not available.")

    if df is None:
        raise ValueError("df parameter is required for inference (no CSV loading)")
    else:
        logger.info(f"Multi-GNN: using provided DataFrame ({len(df)} rows)...")

    df = _normalize_columns(df)
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], format="mixed")
    df.sort_values("Timestamp", inplace=True)
    df.reset_index(drop=True, inplace=True)

    src_key = df["From Bank"].astype(str) + ":" + df["Account"].astype(str)
    dst_key = df["To Bank"].astype(str) + ":" + df["Account.1"].astype(str)

    keep = src_key.values != dst_key.values
    df, src_key, dst_key = df[keep].reset_index(drop=True), src_key[keep].reset_index(drop=True), dst_key[keep].reset_index(drop=True)

    nodes = pd.Index(pd.unique(pd.concat([src_key, dst_key])))
    node_id = {k: i for i, k in enumerate(nodes)}
    src = src_key.map(node_id).to_numpy()
    dst = dst_key.map(node_id).to_numpy()
    N   = len(nodes)
    E   = len(df)
    logger.info(f"Multi-GNN: {N:,} accounts, {E:,} transactions")

    amount   = df["Amount Paid"].to_numpy(dtype=np.float64)
    log_amt  = np.log1p(np.clip(amount, 0, None)).astype(np.float32)
    log_amt  = (log_amt - log_amt.mean()) / (log_amt.std() + 1e-6)

    ts       = df["Timestamp"].astype("int64").to_numpy()
    t_norm   = ((ts - ts.min()) / (ts.max() - ts.min() + 1)).astype(np.float32)

    hour_of_day = df["Timestamp"].dt.hour.to_numpy().astype(np.float32)
    hour_sin = np.sin(2 * np.pi * hour_of_day / 24).astype(np.float32)
    hour_cos = np.cos(2 * np.pi * hour_of_day / 24).astype(np.float32)

    day_of_week = df["Timestamp"].dt.dayofweek.to_numpy().astype(np.float32)
    dow_sin = np.sin(2 * np.pi * day_of_week / 7).astype(np.float32)
    dow_cos = np.cos(2 * np.pi * day_of_week / 7).astype(np.float32)

    is_cross_bank = (df["From Bank"].astype(str) != df["To Bank"].astype(str)).astype(np.float32).to_numpy()

    cur_codes, cur_uniq = pd.factorize(df["Receiving Currency"])
    fmt_codes, fmt_uniq = pd.factorize(df["Payment Format"])

    high_risk_cur = df["Receiving Currency"].isin(["Bitcoin", "BTC", "XRP", "ETH"]).to_numpy().astype(np.float32)
    high_risk_fmt = df["Payment Format"].isin(["Cheque", "Cash"]).to_numpy().astype(np.float32)
    cross_x_cur = (is_cross_bank * high_risk_cur).astype(np.float32)
    cross_x_fmt = (is_cross_bank * high_risk_fmt).astype(np.float32)

    out_port = _port_index(src, E)
    in_port  = _port_index(dst, E)
    out_port_n = (out_port / (out_port.max() + 1)).astype(np.float32)
    in_port_n  = (in_port / (in_port.max() + 1)).astype(np.float32)

    y = df["Is Laundering"].to_numpy(dtype=np.float32) if "Is Laundering" in df.columns else np.zeros(E, np.float32)

    fwd_attr = np.stack([
        log_amt, t_norm, out_port_n, in_port_n,
        np.zeros(E, np.float32),
        hour_sin, hour_cos, dow_sin, dow_cos, is_cross_bank,
        cross_x_cur, cross_x_fmt,
        cur_codes.astype(np.float32), fmt_codes.astype(np.float32),
    ], axis=1)

    rev_attr = fwd_attr.copy()
    rev_attr[:, 2], rev_attr[:, 3] = in_port_n, out_port_n
    rev_attr[:, 4] = 1.0

    edge_index = np.concatenate([np.stack([src, dst]), np.stack([dst, src])], axis=1)
    edge_attr  = np.concatenate([fwd_attr, rev_attr], axis=0)

    in_deg  = np.bincount(dst, minlength=N).astype(np.float32)
    out_deg = np.bincount(src, minlength=N).astype(np.float32)
    recv    = np.bincount(dst, weights=amount, minlength=N).astype(np.float32)
    sent    = np.bincount(src, weights=amount, minlength=N).astype(np.float32)
    x = np.stack([
        np.log1p(in_deg), np.log1p(out_deg),
        np.log1p(recv),   np.log1p(sent),
    ], axis=1)
    x = (x - x.mean(0)) / (x.std(0) + 1e-6)

    bundle = {
        "x":          torch.tensor(x, dtype=torch.float),
        "edge_index": torch.tensor(edge_index, dtype=torch.long),
        "edge_attr":  torch.tensor(edge_attr, dtype=torch.float),
        "y":          torch.tensor(y, dtype=torch.float),
        "label_index": torch.tensor(np.stack([src, dst]), dtype=torch.long),
        "t_edge":     torch.tensor(t_norm, dtype=torch.float),
        "deg": _compute_deg(torch.tensor(edge_index, dtype=torch.long), N),
        "meta": {
            "n_nodes": int(N), "n_edges": int(E),
            "n_currencies": int(len(cur_uniq)), "n_formats": int(len(fmt_uniq)),
            "currencies": list(map(str, cur_uniq)), "formats": list(map(str, fmt_uniq)),
            "node_dim": 4, "edge_cont_dim": 12,
        },
    }
    if return_df:
        df = df.copy()
        df["_src_idx"] = src
        df["_dst_idx"] = dst
        bundle["df"] = df
    return bundle


def _port_index(endpoint: np.ndarray, E: int) -> np.ndarray:
    """Ordinal position of each edge among edges sharing the same endpoint."""
    order = np.zeros(E, dtype=np.float32)
    counter: dict = {}
    for i, v in enumerate(endpoint):
        c = counter.get(v, 0)
        order[i] = c
        counter[v] = c + 1
    return order


def _compute_deg(edge_index: "torch.Tensor", n_nodes: int) -> "torch.Tensor":
    """Degree histogram for PNAConv scalers."""
    from torch_geometric.utils import degree
    d = degree(edge_index[1], num_nodes=n_nodes, dtype=torch.long)
    max_deg = min(int(d.max().item()), 500)
    return torch.bincount(d.clamp(max=max_deg), minlength=max_deg + 1)


# ── Model ──────────────────────────────────────────────────────────────────────

class MultiGNN(nn.Module):
    """PNA backbone with edge encoder + edge head."""

    def __init__(self, node_dim=4, edge_cont_dim=12, n_currencies=16, n_formats=8,
                 hidden=64, layers=3, dropout=0.2, emb_dim=8, deg=None):
        super().__init__()
        self.cur_emb = nn.Embedding(n_currencies + 1, emb_dim)
        self.fmt_emb = nn.Embedding(n_formats + 1, emb_dim)
        edge_in = edge_cont_dim + 2 * emb_dim
        self.edge_enc = nn.Sequential(
            nn.Linear(edge_in, hidden), nn.ReLU(), nn.Linear(hidden, hidden),
        )
        self.node_enc = nn.Linear(node_dim, hidden)

        aggregators = ["mean", "max", "min", "std"]
        scalers = ["identity", "amplification", "attenuation"]
        if deg is None:
            deg = torch.ones(100, dtype=torch.long)

        self.convs = nn.ModuleList()
        self.norms = nn.ModuleList()
        for _ in range(layers):
            self.convs.append(PNAConv(
                in_channels=hidden, out_channels=hidden,
                aggregators=aggregators, scalers=scalers,
                deg=deg, edge_dim=hidden,
                towers=1, pre_layers=1, post_layers=1,
            ))
            self.norms.append(nn.BatchNorm1d(hidden))
        self.drop = nn.Dropout(dropout)

        self.edge_cont_dim = edge_cont_dim
        self.head = nn.Sequential(
            nn.Linear(4 * hidden, hidden), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(hidden, 1),
        )

    def _encode_edges(self, edge_attr):
        cont = edge_attr[:, : self.edge_cont_dim]
        cur  = self.cur_emb(edge_attr[:, 12].long().clamp(min=0))
        fmt  = self.fmt_emb(edge_attr[:, 13].long().clamp(min=0))
        return self.edge_enc(torch.cat([cont, cur, fmt], dim=-1))

    def encode_nodes(self, x, edge_index, edge_attr):
        e = self._encode_edges(edge_attr)
        h = F.relu(self.node_enc(x))
        for conv, norm in zip(self.convs, self.norms):
            h = conv(h, edge_index, e)
            h = norm(h)
            h = self.drop(F.relu(h))
        return h

    def classify_edges(self, h, label_index, edge_attr_targets):
        hs, hd = h[label_index[0]], h[label_index[1]]
        e = self._encode_edges(edge_attr_targets)
        return self.head(torch.cat([hs, hd, hs * hd, e], dim=-1)).squeeze(-1)

    def forward(self, x, edge_index, edge_attr, label_index, edge_attr_targets):
        h = self.encode_nodes(x, edge_index, edge_attr)
        return self.classify_edges(h, label_index, edge_attr_targets)


# ── Inference ────────────────────────────────────────────────────────────────────

_model_cache: dict = {"mtime": None, "model": None, "metrics": None}


def load_multignn():
    """Load the trained Multi-GNN. Returns (model, metrics) or (None, None)."""
    if not HAS_TORCH or not MODEL_PATH.exists():
        return None, None
    mtime = MODEL_PATH.stat().st_mtime
    if _model_cache["model"] is not None and _model_cache["mtime"] == mtime:
        return _model_cache["model"], _model_cache["metrics"]
    try:
        saved = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
        cfg = saved["config"]
        deg = saved.get("deg", torch.ones(100, dtype=torch.long))
        model = MultiGNN(cfg["node_dim"], cfg["edge_cont_dim"], cfg["n_currencies"],
                         cfg["n_formats"], hidden=cfg["hidden"], layers=cfg["layers"], deg=deg)
        model.load_state_dict(saved["state_dict"])
        model.eval()
        metrics = saved.get("metrics")
        _model_cache.update(mtime=mtime, model=model, metrics=metrics)
        logger.info(f"Multi-GNN loaded from disk and cached (mtime={mtime}).")
        return model, metrics
    except Exception as e:
        logger.warning(f"Could not load Multi-GNN ({e})")
        return None, None


def score_transactions(model, bundle: dict, batch_size: int = 8192) -> np.ndarray:
    """Return per-transaction laundering probabilities for a built graph bundle."""
    if model is None:
        return np.full(bundle["meta"]["n_edges"], 0.5, dtype=np.float32)
    E = bundle["label_index"].size(1)
    return _predict(model, bundle["x"], bundle["edge_index"], bundle["edge_attr"],
                    bundle["label_index"], bundle["edge_attr"][:E], batch_size)


def _predict(model, x, edge_index, edge_attr, label_index, edge_attr_targets, batch_size: int = 8192):
    """Full-batch node encode, then chunk the edge head to bound memory."""
    model.eval()
    with torch.no_grad():
        h = model.encode_nodes(x, edge_index, edge_attr)
        probs = []
        for s in range(0, label_index.size(1), batch_size):
            chunk = label_index[:, s:s + batch_size]
            ea    = edge_attr_targets[s:s + batch_size]
            probs.append(torch.sigmoid(model.classify_edges(h, chunk, ea)))
    return torch.cat(probs).numpy()


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Map varying CSV schemas to the canonical IBM column names."""
    if "From Account" in df.columns and "Account" not in df.columns:
        df = df.rename(columns={"From Account": "Account", "To Account": "Account.1"})
    elif "Account" in df.columns and "Account.1" not in df.columns:
        cols = list(df.columns)
        second = [i for i, c in enumerate(cols) if c == "Account"]
        if len(second) >= 2:
            cols[second[1]] = "Account.1"
            df.columns = cols
    return df
