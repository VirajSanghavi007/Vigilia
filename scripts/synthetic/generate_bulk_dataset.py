"""Generates a large synthetic transaction dataset (default: 15,000,000
nodes) using genuine multiprocessing across worker processes, in the
same flat-CSV format as the real Elliptic dataset — so
benchmark_loadcsv.py's existing sharding/loading logic works against it
unchanged via `--source-dir`.

Why multiprocessing.Pool (not threads, not a single vectorized numpy
pass): row generation here is one process-only real chunk each; per the
project's standing parallelization rules, no large shared state is
duplicated per worker (each worker only needs its own index range and
the tiny class-weight table), so Pool is the correct default regime
for this CPU-bound work — not ThreadPoolExecutor (which only helps
GIL-releasing I/O, not this).

Each worker independently generates and writes ONE self-contained chunk
(no cross-worker coordination): a contiguous range of node indices, and
edges only *within* that worker's own range (a recency-biased "gap"
model, not fully random pairs — see generate_synthetic_stream.py for
the same idea applied to real-time streaming). This is a deliberate
simplification from a single global recency window: cross-worker edges
would need shared state or a merge step, and for a bulk-loading-
throughput benchmark (not a graph-topology-realism benchmark), that
tradeoff is the right one — GraphStore-level feature realism (per-class
clusters, outliers) lives in generate_synthetic_stream.py, not here.

Output: <out-dir>/elliptic_txs_classes.csv, elliptic_txs_edgelist.csv —
same column names and class-code encoding ("1"/"2"/"unknown") as the
real dataset, so no changes are needed anywhere downstream.

Usage:
    uv run python scripts/synthetic/generate_bulk_dataset.py --n-nodes 15000000 --workers 24
"""

import argparse
import csv
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

OUT_DIR_DEFAULT = Path(__file__).resolve().parent.parent.parent / "data" / "syndata" / "bulk_15m"

# Real Elliptic class code proportions (not the human-readable labels —
# kept as codes so CLASS_MAP in benchmark_loadcsv.py decodes them exactly
# like the real dataset, no format drift).
CLASS_CODES = ["1", "2", "unknown"]
CLASS_WEIGHTS = [4545 / 203769, 42019 / 203769, 157205 / 203769]
EDGE_TO_NODE_RATIO = 234355 / 203769  # matches real dataset's edge density
MAX_GAP = 500  # how far back (in index terms) an edge's source can reach


def generate_chunk(chunk_id: int, start: int, count: int, out_dir: Path) -> tuple[int, int, float]:
    t0 = time.perf_counter()
    rng = np.random.default_rng(seed=chunk_id)  # per-worker independent seed, reproducible

    node_ids = [f"syn-{start + i}" for i in range(count)]
    classes = rng.choice(CLASS_CODES, size=count, p=CLASS_WEIGHTS)

    classes_path = out_dir / f"_chunk_classes_{chunk_id}.csv"
    with classes_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerows(zip(node_ids, classes, strict=True))

    n_edges = int(count * EDGE_TO_NODE_RATIO)
    if count > 1:
        # local indices within this chunk only — source at [1, count),
        # target = source - small_gap, clipped to stay in-chunk. Mirrors
        # the "transactions reference recent prior transactions" pattern.
        local_source = rng.integers(1, count, size=n_edges)
        gap = rng.integers(1, min(MAX_GAP, count - 1) + 1, size=n_edges)
        local_target = np.maximum(local_source - gap, 0)

        edge_source_ids = [f"syn-{start + i}" for i in local_source]
        edge_target_ids = [f"syn-{start + i}" for i in local_target]
    else:
        edge_source_ids, edge_target_ids = [], []
        n_edges = 0

    edges_path = out_dir / f"_chunk_edges_{chunk_id}.csv"
    with edges_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerows(zip(edge_source_ids, edge_target_ids, strict=True))

    return count, n_edges, time.perf_counter() - t0


def concat_chunks(out_dir: Path, n_chunks: int, prefix: str, header: list[str], final_name: str) -> None:
    final_path = out_dir / final_name
    with final_path.open("w", newline="") as out_f:
        writer = csv.writer(out_f)
        writer.writerow(header)
        for i in range(n_chunks):
            chunk_path = out_dir / f"{prefix}_{i}.csv"
            with chunk_path.open() as in_f:
                out_f.write(in_f.read())
            chunk_path.unlink()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-nodes", type=int, default=15_000_000)
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR_DEFAULT)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    base_chunk = args.n_nodes // args.workers
    remainder = args.n_nodes % args.workers
    chunks = []
    start = 0
    for i in range(args.workers):
        size = base_chunk + (1 if i < remainder else 0)
        chunks.append((i, start, size))
        start += size

    print(f"Generating {args.n_nodes} nodes across {args.workers} worker processes...")
    t0 = time.perf_counter()
    total_nodes = 0
    total_edges = 0
    done = 0

    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(generate_chunk, cid, s, c, args.out_dir): cid for cid, s, c in chunks
        }
        for future in as_completed(futures):
            n, e, chunk_seconds = future.result()
            total_nodes += n
            total_edges += e
            done += 1
            elapsed = time.perf_counter() - t0
            rate = total_nodes / elapsed if elapsed > 0 else 0
            eta = (args.n_nodes - total_nodes) / rate if rate > 0 else float("inf")
            print(
                f"  chunk {done}/{args.workers} done in {chunk_seconds:.1f}s - "
                f"{total_nodes}/{args.n_nodes} nodes ({total_nodes / args.n_nodes * 100:.1f}%) - "
                f"{elapsed:.1f}s elapsed, eta {eta:.1f}s"
            )

    print("Concatenating chunks into flat CSVs...")
    concat_chunks(args.out_dir, args.workers, "_chunk_classes", ["txId", "class"], "elliptic_txs_classes.csv")
    concat_chunks(args.out_dir, args.workers, "_chunk_edges", ["txId1", "txId2"], "elliptic_txs_edgelist.csv")

    total_seconds = time.perf_counter() - t0
    print("\n--- Done ---")
    print(f"Nodes: {total_nodes}, Edges: {total_edges}")
    print(f"Total time: {total_seconds:.1f}s ({total_nodes / total_seconds:.0f} nodes/s generated)")
    print(f"Output: {args.out_dir}")


if __name__ == "__main__":
    main()
