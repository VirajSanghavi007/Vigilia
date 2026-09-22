"""Fits a per-class feature distribution from the REAL Elliptic dataset and
caches it to data/syndata/feature_model.npz.

Why fit from real data instead of inventing a distribution: independent
per-feature gaussian noise has no cluster structure and no inter-feature
correlation — nothing a GNN could learn from, and nothing an "outlier"
could stand out against. Elliptic's real features DO have per-class
structure (that's the whole point of the dataset), so the synthetic
generator samples from a multivariate normal fitted to each class's
actual mean vector and covariance matrix, via a precomputed Cholesky
factor (mean + L @ z, z ~ N(0, I)) — this reproduces the real clusters'
shape and correlations cheaply enough for a high-throughput stream.

data/syndata/ is for these small fitted-model artifacts (means,
covariances — a few MB), not for materializing millions of synthetic
rows to disk (see generate_synthetic_stream.py's streaming design).

Usage:
    uv run python scripts/synthetic/fit_feature_model.py
"""

import csv
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "elliptic_bitcoin_dataset"
OUT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "syndata"
CLASS_MAP = {"1": "illicit", "2": "licit", "unknown": "unknown"}


def load_features_by_class() -> dict[str, np.ndarray]:
    tx_class: dict[str, str] = {}
    with (DATA_DIR / "elliptic_txs_classes.csv").open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tx_class[row["txId"]] = CLASS_MAP[row["class"]]

    rows_by_class: dict[str, list[list[float]]] = {"illicit": [], "licit": [], "unknown": []}
    with (DATA_DIR / "elliptic_txs_features.csv").open(newline="") as f:
        reader = csv.reader(f)
        for row in reader:
            tx_id = row[0]
            features = [float(x) for x in row[1:]]
            cls = tx_class.get(tx_id)
            if cls is not None:
                rows_by_class[cls].append(features)

    return {cls: np.array(rows, dtype=np.float64) for cls, rows in rows_by_class.items()}


def fit_and_save() -> None:
    by_class = load_features_by_class()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    model = {}
    for cls, matrix in by_class.items():
        print(f"{cls}: fitting from {matrix.shape[0]} real rows, {matrix.shape[1]} features")
        mean = matrix.mean(axis=0)
        cov = np.cov(matrix, rowvar=False)
        # regularize — real covariance can be near-singular in low-variance
        # directions, which breaks Cholesky. A tiny diagonal ridge fixes
        # this without meaningfully changing the fitted cluster shape.
        cov += np.eye(cov.shape[0]) * 1e-6
        cholesky = np.linalg.cholesky(cov)

        model[f"{cls}_mean"] = mean
        model[f"{cls}_cholesky"] = cholesky

    np.savez(OUT_DIR / "feature_model.npz", **model)
    print(f"Saved feature model to {OUT_DIR / 'feature_model.npz'}")


if __name__ == "__main__":
    fit_and_save()
