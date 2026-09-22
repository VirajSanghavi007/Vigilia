"""Synthetic transaction stream generator — for benchmarking ingestion
throughput (MAGE algorithm cost + hot/cold architecture design) under
data that actually resembles production, not a toy.

Two things a naive synthetic generator gets wrong, both fixed here:

1. Feature realism. Independent per-feature gaussian noise has no cluster
   structure and no inter-feature correlation — nothing a GNN could learn
   from, and nothing an "outlier" could stand out against. Instead this
   samples from a multivariate normal fitted to each class's REAL mean
   vector and covariance (scripts/synthetic/fit_feature_model.py, run
   against the actual Elliptic dataset), via a precomputed Cholesky
   factor. A small fraction of rows are deliberately generated as
   outliers (inflated deviation, or cross-class contamination) so the
   stream isn't just clean synthetic clusters either.

2. Arrival realism. A fixed rotation through a few rate presets (e.g.
   always 100/1s, then 1000/40s, repeat) is not random — it's a cycle,
   and real traffic doesn't look like that. This models arrivals as a
   Poisson process whose rate itself drifts over time (bounded random
   walk, with occasional larger jumps simulating regime changes between
   quiet and burst periods) — batch sizes and intervals come out
   genuinely irregular (e.g. 500, then 648, then 337 rows), not a
   repeating menu.

Each event is written one at a time through GraphStore.upsert_transaction
/upsert_edge, matching how a live-ingestion API endpoint will call this
same interface per incoming transaction later (roadmap step 3) — the
Sink abstraction below is the seam that endpoint will plug into.

Requires scripts/synthetic/fit_feature_model.py to have been run once
(caches data/syndata/feature_model.npz — regenerate any time from the
real dataset, it's not committed).

Usage:
    uv run python scripts/generate_synthetic_stream.py
    uv run python scripts/generate_synthetic_stream.py --duration-seconds 120
"""

from __future__ import annotations

import argparse
import random
import time
from collections import deque
from pathlib import Path
from typing import Protocol

import numpy as np

from vigilia.domain.graph.store import TxClass
from vigilia.infra.graph.memgraph_client import MemgraphStore

FEATURE_MODEL_PATH = Path(__file__).resolve().parent.parent / "data" / "syndata" / "feature_model.npz"

# Real Elliptic class proportions (see docs/BENCHMARK.md) — illicit 4545,
# licit 42019, unknown 157205 out of 203769 labeled+unlabeled rows.
CLASS_WEIGHTS: list[tuple[TxClass, float]] = [
    ("illicit", 4545 / 203769),
    ("licit", 42019 / 203769),
    ("unknown", 157205 / 203769),
]

RECENCY_WINDOW = 500  # candidate pool size for "realistic" edge targets
MAX_OUT_EDGES = 3  # real avg out-degree is ~1.15; this caps the tail

OUTLIER_PROB = 0.02
OUTLIER_INFLATION_RANGE = (3.0, 8.0)  # scale factor applied to the sampled deviation

RATE_MIN = 1.0  # rows/s — floor exploration
RATE_MAX = 5000.0  # rows/s — ceiling exploration
RATE_DRIFT_SIGMA = 0.3  # lognormal jitter applied to the rate each step
RATE_JUMP_PROB = 0.1  # probability of a large regime-change jump instead of drift
WINDOW_MIN_S, WINDOW_MAX_S = 0.5, 3.0  # batch window duration range

# Buckets for the floor/ceiling summary report (rows/s boundaries)
RATE_BUCKETS = [1, 10, 50, 100, 250, 500, 1000, 2000, 5000]


class FeatureModel:
    """Loads the real-data-fitted per-class distributions and samples from them."""

    def __init__(self, path: Path) -> None:
        if not path.exists():
            raise FileNotFoundError(
                f"{path} not found. Run `uv run python scripts/synthetic/fit_feature_model.py` first."
            )
        data = np.load(path)
        self.classes = ["illicit", "licit", "unknown"]
        self.means = {cls: data[f"{cls}_mean"] for cls in self.classes}
        self.cholesky = {cls: data[f"{cls}_cholesky"] for cls in self.classes}
        self.n_features = self.means["illicit"].shape[0]

    def sample(self, tx_class: TxClass) -> dict[str, float]:
        z = np.random.standard_normal(self.n_features)

        if random.random() < OUTLIER_PROB:
            if random.random() < 0.5:
                # inflated-deviation outlier: same cluster, further from its center
                scale = random.uniform(*OUTLIER_INFLATION_RANGE)
                z = z * scale
                vec = self.means[tx_class] + self.cholesky[tx_class] @ z
            else:
                # cross-class contamination: looks like it belongs to a different cluster
                other_class = random.choice([c for c in self.classes if c != tx_class])
                vec = self.means[other_class] + self.cholesky[other_class] @ z
        else:
            vec = self.means[tx_class] + self.cholesky[tx_class] @ z

        return {f"f{i}": float(v) for i, v in enumerate(vec)}


class Sink(Protocol):
    def upsert_transaction(
        self, tx_id: str, tx_class: TxClass, properties: dict[str, float] | None = None
    ) -> None: ...

    def upsert_edge(self, from_id: str, to_id: str) -> None: ...


class MemgraphSink:
    """Wraps MemgraphStore — the sink used today."""

    def __init__(self, uri: str) -> None:
        self._store = MemgraphStore(uri)
        self._store.ensure_constraints()

    def upsert_transaction(
        self, tx_id: str, tx_class: TxClass, properties: dict[str, float] | None = None
    ) -> None:
        self._store.upsert_transaction(tx_id, tx_class, properties)

    def upsert_edge(self, from_id: str, to_id: str) -> None:
        self._store.upsert_edge(from_id, to_id)

    def close(self) -> None:
        self._store.close()


class ApiSink:
    """Placeholder for the live-ingestion API endpoint (roadmap step 3).

    Once that endpoint exists, this becomes an HTTP client posting one
    transaction event per call — same Sink shape, no caller change needed.
    """

    def __init__(self, base_url: str) -> None:
        raise NotImplementedError(
            "Live-ingestion API endpoint doesn't exist yet (roadmap step 3). "
            "Use --sink memgraph until it's built."
        )


def random_class() -> TxClass:
    r = random.random()
    cumulative = 0.0
    for cls, weight in CLASS_WEIGHTS:
        cumulative += weight
        if r <= cumulative:
            return cls
    return CLASS_WEIGHTS[-1][0]


class RateWalker:
    """A Poisson-process arrival rate that drifts over time — bounded random
    walk with occasional larger jumps (regime changes between quiet/burst)."""

    def __init__(self, start_rate: float = 50.0) -> None:
        self.rate = start_rate

    def step(self) -> float:
        if random.random() < RATE_JUMP_PROB:
            self.rate = random.uniform(RATE_MIN, RATE_MAX)
        else:
            self.rate *= random.lognormvariate(0, RATE_DRIFT_SIGMA)
        self.rate = min(max(self.rate, RATE_MIN), RATE_MAX)
        return self.rate

    def next_window(self) -> tuple[int, float]:
        """Returns (row_count, window_seconds) for the next batch — row count
        is Poisson-distributed around rate * window, giving genuinely
        irregular batch sizes rather than a fixed number."""
        rate = self.step()
        window = random.uniform(WINDOW_MIN_S, WINDOW_MAX_S)
        count = max(1, np.random.poisson(rate * window))
        return count, window


def generate_batch(
    sink: Sink,
    model: FeatureModel,
    run_id: str,
    start_index: int,
    count: int,
    recent_ids: deque,
) -> None:
    for i in range(count):
        tx_id = f"syn-{run_id}-{start_index + i}"
        tx_class = random_class()
        sink.upsert_transaction(tx_id, tx_class, model.sample(tx_class))

        out_edges = random.randint(0, MAX_OUT_EDGES)
        if recent_ids:
            targets = random.sample(list(recent_ids), k=min(out_edges, len(recent_ids)))
            for target in targets:
                sink.upsert_edge(tx_id, target)

        recent_ids.append(tx_id)
        if len(recent_ids) > RECENCY_WINDOW:
            recent_ids.popleft()


def bucket_for(rate: float) -> str:
    for i in range(len(RATE_BUCKETS) - 1):
        if RATE_BUCKETS[i] <= rate < RATE_BUCKETS[i + 1]:
            return f"{RATE_BUCKETS[i]}-{RATE_BUCKETS[i + 1]}/s"
    return f">={RATE_BUCKETS[-1]}/s"


def run_stream(sink: Sink, model: FeatureModel, duration_seconds: float | None) -> None:
    recent_ids: deque = deque()
    run_id = str(int(time.time()))
    total_rows = 0
    walker = RateWalker()
    bucket_stats: dict[str, dict] = {}

    print(f"Run ID: {run_id}. Poisson-process arrivals, rate drifting in [{RATE_MIN}, {RATE_MAX}] rows/s.")
    print(f"{'target_rate':>12} {'rows':>6} {'window_s':>9} {'write_s':>9} {'verdict':>10}")

    run_start = time.perf_counter()

    try:
        while duration_seconds is None or (time.perf_counter() - run_start) < duration_seconds:
            count, window = walker.next_window()

            t0 = time.perf_counter()
            generate_batch(sink, model, run_id, total_rows, count, recent_ids)
            write_seconds = time.perf_counter() - t0
            total_rows += count

            bucket = bucket_for(walker.rate)
            stats = bucket_stats.setdefault(bucket, {"batches": 0, "on_pace": 0, "behind": 0, "max_lag": 0.0})
            stats["batches"] += 1

            lag = write_seconds - window
            if lag <= 0:
                stats["on_pace"] += 1
                verdict = "on-pace"
                time.sleep(-lag)
            else:
                stats["behind"] += 1
                stats["max_lag"] = max(stats["max_lag"], lag)
                verdict = "BEHIND"

            print(
                f"{walker.rate:>10.1f}/s {count:>6} {window:>8.2f}s {write_seconds:>8.2f}s {verdict:>10}"
            )
    except KeyboardInterrupt:
        print("\nStopped by user.")

    elapsed = time.perf_counter() - run_start
    print(f"\n--- Summary ({total_rows} rows in {elapsed:.1f}s) ---")
    for bucket in sorted(bucket_stats, key=lambda b: RATE_BUCKETS.index(int(b.split("-")[0].rstrip("/s"))) if "-" in b else len(RATE_BUCKETS)):
        s = bucket_stats[bucket]
        verdict = "FLOOR (always kept up)" if s["behind"] == 0 else (
            "CEILING (always fell behind)" if s["on_pace"] == 0 else "MIXED"
        )
        print(
            f"  {bucket}: {s['on_pace']}/{s['batches']} batches on-pace, "
            f"max lag {s['max_lag']:.2f}s -> {verdict}"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sink", choices=["memgraph", "api"], default="memgraph")
    parser.add_argument("--uri", default="bolt://localhost:7687")
    parser.add_argument("--api-url", default="http://localhost:8000")
    parser.add_argument("--duration-seconds", type=float, default=None)
    args = parser.parse_args()

    model = FeatureModel(FEATURE_MODEL_PATH)

    if args.sink == "memgraph":
        sink: Sink = MemgraphSink(args.uri)
    else:
        sink = ApiSink(args.api_url)

    try:
        run_stream(sink, model, args.duration_seconds)
    finally:
        if hasattr(sink, "close"):
            sink.close()


if __name__ == "__main__":
    main()
