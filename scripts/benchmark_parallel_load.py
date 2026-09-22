"""Benchmark: does IN_MEMORY_ANALYTICAL mode + concurrent connections
actually beat the sequential IN_MEMORY_TRANSACTIONAL baseline
(benchmark_full_load.py)?

Grounded in Memgraph's own documentation/benchmarks (see docs/BENCHMARK.md
for the research summary and citations): IN_MEMORY_TRANSACTIONAL mode
serializes conflicting concurrent writers via MVCC storage-access checks
(this is what produced the "Cannot get read-only access to the storage"
error during an earlier accidental-concurrent-run) — concurrency doesn't
help there, it just contends. IN_MEMORY_ANALYTICAL mode skips per-write
Delta/MVCC tracking and genuinely parallelizes writes across connections,
at the cost of no rollback/ACID during the load window. This script
switches to analytical mode, splits the dataset across N worker threads
each with their own session, and measures wall-clock time + throughput
against the same batch size and query shape as the sequential baseline.

Must run against a FRESH/empty Memgraph instance for a fair comparison —
this script does NOT wipe existing data itself (see docs/BENCHMARK.md's
"how to reproduce" section for the docker compose reset step).

Usage:
    uv run python scripts/benchmark_parallel_load.py --workers 8
"""

import argparse
import csv
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from neo4j import GraphDatabase

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "elliptic_bitcoin_dataset"
CLASS_MAP = {"1": "illicit", "2": "licit", "unknown": "unknown"}
BATCH_SIZE = 5000


def load_all_classes() -> list[dict]:
    rows = []
    with (DATA_DIR / "elliptic_txs_classes.csv").open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({"tx_id": row["txId"], "tx_class": CLASS_MAP[row["class"]]})
    return rows


def load_all_edges() -> list[dict]:
    rows = []
    with (DATA_DIR / "elliptic_txs_edgelist.csv").open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({"from_id": row["txId1"], "to_id": row["txId2"]})
    return rows


def batched(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def write_batch(uri: str, query: str, batch: list) -> None:
    # own driver per worker thread — driver connection pools aren't meant
    # to be shared across threads for write-heavy concurrent workloads
    driver = GraphDatabase.driver(uri)
    with driver.session() as session:
        session.run(query, rows=batch)
    driver.close()


def run_parallel(uri: str, label: str, items: list, query: str, workers: int) -> float:
    batches = list(batched(items, BATCH_SIZE))
    total = len(items)
    print(f"{label}: {total} rows in {len(batches)} batches, {workers} workers")

    t0 = time.perf_counter()
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(write_batch, uri, query, b): b for b in batches}
        for future in as_completed(futures):
            future.result()  # surface any exception now, not silently
            done += len(futures[future])
            if done % (BATCH_SIZE * 5) == 0 or done == total:
                elapsed = time.perf_counter() - t0
                rate = done / elapsed if elapsed > 0 else 0
                print(f"  {label}: {done}/{total} ({done / total * 100:.1f}%) - {elapsed:.1f}s, {rate:.0f} rows/s")

    return time.perf_counter() - t0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uri", default="bolt://localhost:7687")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    # Memgraph does not support constraints in analytical mode ("Constraints
    # are not supported in analytical storage mode. Please drop them before
    # changing storage mode to analytical or use transactional mode.") — so
    # the uniqueness constraint is created AFTER the load, once back in
    # transactional mode, not before. Elliptic's txIds are unique by
    # construction (source CSV), so MERGE without the constraint during the
    # analytical phase is safe here.
    driver = GraphDatabase.driver(args.uri)
    with driver.session() as session:
        # `SHOW STORAGE INFO`'s global_storage_mode field reflects the
        # startup-default mode, not necessarily the live runtime mode — it's
        # unreliable for confirming this switch. The only trustworthy signal
        # is behavioral: constraints are rejected in analytical mode, so
        # attempting one and expecting that specific rejection is how we
        # actually confirm the switch took effect.
        session.run("SET DATABASE SETTING 'storage.access_timeout_sec' TO '30'").consume()
        session.run("STORAGE MODE IN_MEMORY_ANALYTICAL").consume()

        probe_rejected = False
        try:
            session.run("CREATE CONSTRAINT ON (x:__ModeProbe) ASSERT x.id IS UNIQUE").consume()
        except Exception as ex:
            if "analytical storage mode" not in str(ex):
                raise
            probe_rejected = True

        if not probe_rejected:
            raise RuntimeError(
                "Storage mode switch did not take effect — constraint creation "
                "succeeded, which should be impossible in analytical mode."
            )
        print("Confirmed: analytical storage mode is active.")
    driver.close()

    classes = load_all_classes()
    edges = load_all_edges()
    print(f"CSV rows: {len(classes)} classes, {len(edges)} edges.")

    t_start = time.perf_counter()

    node_seconds = run_parallel(
        args.uri,
        "nodes",
        classes,
        """
        UNWIND $rows AS row
        MERGE (t:Transaction {txId: row.tx_id})
        SET t.class = row.tx_class
        """,
        args.workers,
    )

    edge_seconds = run_parallel(
        args.uri,
        "edges",
        edges,
        """
        UNWIND $rows AS row
        MATCH (a:Transaction {txId: row.from_id})
        MATCH (b:Transaction {txId: row.to_id})
        MERGE (a)-[:SENT_TO]->(b)
        """,
        args.workers,
    )

    driver = GraphDatabase.driver(args.uri)
    with driver.session() as session:
        # switch back to transactional for durability (writes a recovery snapshot)
        session.run("STORAGE MODE IN_MEMORY_TRANSACTIONAL")
        session.run("CREATE CONSTRAINT ON (t:Transaction) ASSERT t.txId IS UNIQUE")
        node_count = session.run("MATCH (t:Transaction) RETURN count(t) AS n").single()["n"]
        edge_count = session.run("MATCH ()-[r:SENT_TO]->() RETURN count(r) AS n").single()["n"]
    driver.close()

    print("\n--- Results ---")
    print(f"Workers: {args.workers}")
    print(f"Nodes phase: {node_seconds:.2f}s ({len(classes) / node_seconds:.0f} rows/s)")
    print(f"Edges phase: {edge_seconds:.2f}s ({len(edges) / edge_seconds:.0f} rows/s)")
    print(f"Total wall time: {time.perf_counter() - t_start:.2f}s")
    print(f"Final counts: {node_count} nodes, {edge_count} edges")


if __name__ == "__main__":
    main()
