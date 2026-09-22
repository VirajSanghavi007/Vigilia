"""Benchmark: Memgraph's own documented fastest bulk-load path —
concurrent `LOAD CSV`, run server-side — against the driver-based UNWIND
approach (benchmark_full_load.py, benchmark_parallel_load.py).

Memgraph's own benchmark blog post reports 1.2M inserts/sec using 10
concurrent LOAD CSV connections, each reading a separate CSV shard, in
IN_MEMORY_ANALYTICAL mode (see docs/BENCHMARK.md for the citation). That
number is fundamentally not comparable to a Python-driver UNWIND loop:
LOAD CSV has Memgraph read and parse the file itself, server-side, with
no Bolt-protocol parameter serialization or Python-side batch
construction in the loop at all — this script is the genuine equivalent
test, not another UNWIND variant.

Requires the CSV shards to be readable from *inside* the Memgraph
container (docker-compose.yml mounts ./data/syndata/csv_shards there) —
run shard_csvs() first (this script does it automatically) before
`docker compose up`, or restart the container after shards change.

Uses CREATE, not MERGE: this loads into a known-empty graph (see
docs/BENCHMARK.md's "how to reproduce" — always wipe before running),
so there's no need to pay MERGE's existence-check cost. This matches
what a real one-time historical bulk-import would do (vs. incremental
production writes, which do need MERGE's idempotency).

Usage:
    uv run python scripts/benchmark_loadcsv.py --shards 8
"""

import argparse
import csv
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from neo4j import GraphDatabase

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "elliptic_bitcoin_dataset"
SHARD_DIR = Path(__file__).resolve().parent.parent / "data" / "syndata" / "csv_shards"
CLASS_MAP = {"1": "illicit", "2": "licit", "unknown": "unknown"}


def shard_classes_csv(data_dir: Path, n_shards: int) -> int:
    with (data_dir / "elliptic_txs_classes.csv").open(newline="") as f:
        reader = csv.DictReader(f)
        rows = [{"txId": row["txId"], "class": CLASS_MAP[row["class"]]} for row in reader]

    writers = []
    files = []
    for i in range(n_shards):
        path = SHARD_DIR / f"classes_{i}.csv"
        fh = path.open("w", newline="")
        w = csv.DictWriter(fh, fieldnames=["txId", "class"])
        w.writeheader()
        writers.append(w)
        files.append(fh)

    for i, row in enumerate(rows):
        writers[i % n_shards].writerow(row)

    for fh in files:
        fh.close()

    return len(rows)


def shard_edges_csv(data_dir: Path, n_shards: int) -> int:
    with (data_dir / "elliptic_txs_edgelist.csv").open(newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    writers = []
    files = []
    for i in range(n_shards):
        path = SHARD_DIR / f"edges_{i}.csv"
        fh = path.open("w", newline="")
        w = csv.DictWriter(fh, fieldnames=["txId1", "txId2"])
        w.writeheader()
        writers.append(w)
        files.append(fh)

    for i, row in enumerate(rows):
        writers[i % n_shards].writerow(row)

    for fh in files:
        fh.close()

    return len(rows)


def load_shard(uri: str, query: str) -> None:
    driver = GraphDatabase.driver(uri)
    with driver.session() as session:
        session.run(query).consume()
    driver.close()


def run_shards_parallel(uri: str, label: str, n_shards: int, query_template: str) -> float:
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=n_shards) as pool:
        futures = [
            pool.submit(load_shard, uri, query_template.format(shard=i)) for i in range(n_shards)
        ]
        for i, future in enumerate(as_completed(futures)):
            future.result()
            print(f"  {label}: shard {i + 1}/{n_shards} done, {time.perf_counter() - t0:.1f}s elapsed")
    return time.perf_counter() - t0


def verify_analytical_mode(session) -> None:
    probe_rejected = False
    try:
        session.run("CREATE CONSTRAINT ON (x:__ModeProbe) ASSERT x.id IS UNIQUE").consume()
    except Exception as ex:
        if "analytical storage mode" not in str(ex):
            raise
        probe_rejected = True
    if not probe_rejected:
        raise RuntimeError("Storage mode switch did not take effect.")
    print("Confirmed: analytical storage mode is active.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uri", default="bolt://localhost:7687")
    parser.add_argument("--shards", type=int, default=8)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help="Directory with elliptic_txs_classes.csv/elliptic_txs_edgelist.csv "
        "(defaults to the real dataset; point at a synthetic dataset directory "
        "in the same format to benchmark at a different scale).",
    )
    args = parser.parse_args()

    SHARD_DIR.mkdir(parents=True, exist_ok=True)
    n_classes = shard_classes_csv(args.source_dir, args.shards)
    n_edges = shard_edges_csv(args.source_dir, args.shards)
    print(f"Sharded {n_classes} class rows and {n_edges} edge rows into {args.shards} files each.")
    print("NOTE: if the memgraph container was already running, restart it "
          "(docker compose restart memgraph) so the new shard files are visible inside it.")

    driver = GraphDatabase.driver(args.uri)
    with driver.session() as session:
        session.run("SET DATABASE SETTING 'storage.access_timeout_sec' TO '30'").consume()
        session.run("STORAGE MODE IN_MEMORY_ANALYTICAL").consume()
        verify_analytical_mode(session)
    driver.close()

    t_start = time.perf_counter()

    node_seconds = run_shards_parallel(
        args.uri,
        "nodes",
        args.shards,
        """
        LOAD CSV FROM "/csv_shards/classes_{shard}.csv" WITH HEADER AS row
        CREATE (:Transaction {{txId: row.txId, class: row.class}})
        """,
    )

    # Without an index on txId, the edges phase's MATCH-by-txId is a full
    # label scan per lookup — confirmed directly: an earlier run's edges
    # phase sat at ~0 progress for minutes until a plain index was added
    # mid-run, after which all remaining edges landed in under 2 seconds.
    # Uniqueness constraints aren't allowed in analytical mode, but a plain
    # index is, and that's all MATCH needs.
    driver = GraphDatabase.driver(args.uri)
    with driver.session() as session:
        session.run("CREATE INDEX ON :Transaction(txId)").consume()
    driver.close()
    print("Created index on :Transaction(txId) before edges phase.")

    edge_seconds = run_shards_parallel(
        args.uri,
        "edges",
        args.shards,
        """
        LOAD CSV FROM "/csv_shards/edges_{shard}.csv" WITH HEADER AS row
        MATCH (a:Transaction {{txId: row.txId1}})
        MATCH (b:Transaction {{txId: row.txId2}})
        CREATE (a)-[:SENT_TO]->(b)
        """,
    )

    # Switching back to transactional mode + creating the uniqueness
    # constraint requires validating uniqueness across every existing
    # node — confirmed to dominate total wall time at scale (measured
    # ~79-99s at 15M nodes vs. ~36-60s for the actual LOAD CSV phases
    # combined), so it gets its own timer rather than being silently
    # absorbed into "total wall time" with no visibility into why.
    t_finalize = time.perf_counter()
    driver = GraphDatabase.driver(args.uri)
    with driver.session() as session:
        session.run("STORAGE MODE IN_MEMORY_TRANSACTIONAL").consume()
        session.run("CREATE CONSTRAINT ON (t:Transaction) ASSERT t.txId IS UNIQUE").consume()
        node_count = session.run("MATCH (t:Transaction) RETURN count(t) AS n").single()["n"]
        edge_count = session.run("MATCH ()-[r:SENT_TO]->() RETURN count(r) AS n").single()["n"]
    driver.close()
    finalize_seconds = time.perf_counter() - t_finalize

    print("\n--- Results ---")
    print(f"Shards: {args.shards}")
    print(f"Nodes phase: {node_seconds:.2f}s ({n_classes / node_seconds:.0f} rows/s)")
    print(f"Edges phase: {edge_seconds:.2f}s ({n_edges / edge_seconds:.0f} rows/s)")
    print(f"Finalize phase (mode switch + constraint + counts): {finalize_seconds:.2f}s")
    print(f"Total wall time: {time.perf_counter() - t_start:.2f}s")
    print(f"Final counts: {node_count} nodes, {edge_count} edges")


if __name__ == "__main__":
    main()
