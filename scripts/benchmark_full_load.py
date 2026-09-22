"""One-off benchmark: load the full Elliptic dataset into Memgraph and
measure wall-clock time. RAM is measured separately via `docker stats`
around this script's run (see docs/BENCHMARK.md for the full methodology
and results).

Unlike scripts/seed_memgraph.py (one query per node/edge — fine for a
100-node demo), this batches inserts via UNWIND, since one-row-at-a-time
for ~204k nodes + ~234k edges would mean ~438k individual round trips.
Batching is also more representative of how a real ingestion pipeline
would load data at this scale.

Resumable: on start, checks how many Transaction nodes / SENT_TO edges
already exist and skips that many rows from the front of each CSV (safe
because this script always inserts in the same deterministic CSV order,
one phase at a time — nodes fully before edges start). A background run
that gets killed by a session restart, sleep, or Ctrl+C can just be
re-invoked and it picks up roughly where it left off, instead of
redoing already-committed work.

Usage:
    uv run python scripts/benchmark_full_load.py
"""

import csv
import time
from pathlib import Path

from neo4j import GraphDatabase

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "elliptic_bitcoin_dataset"
CLASS_MAP = {"1": "illicit", "2": "licit", "unknown": "unknown"}
BATCH_SIZE = 5000
PROGRESS_EVERY = 10  # print every N batches


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


def run_batches(driver, label: str, items: list, already_done: int, query: str) -> float:
    """Runs `items[already_done:]` in batches, printing progress + ETA. Returns elapsed seconds
    for the whole phase (including whatever was already done before this call, for a stable
    total-time figure across resumed runs)."""
    total = len(items)
    remaining = items[already_done:]
    t0 = time.perf_counter()
    done = already_done

    if not remaining:
        print(f"{label}: already complete ({total}/{total}), skipping.")
        return 0.0

    print(f"{label}: resuming from {already_done}/{total}" if already_done else f"{label}: starting ({total} rows)")

    for i, batch in enumerate(batched(remaining, BATCH_SIZE)):
        with driver.session() as session:
            session.run(query, rows=batch)
        done += len(batch)

        if (i + 1) % PROGRESS_EVERY == 0 or done == total:
            elapsed = time.perf_counter() - t0
            rate = (done - already_done) / elapsed if elapsed > 0 else 0
            remaining_rows = total - done
            eta = remaining_rows / rate if rate > 0 else float("inf")
            pct = done / total * 100
            print(
                f"  {label}: {done}/{total} ({pct:.1f}%) - "
                f"{elapsed:.0f}s elapsed, eta {eta:.0f}s, {rate:.0f} rows/s"
            )

    return time.perf_counter() - t0


def main() -> None:
    driver = GraphDatabase.driver("bolt://localhost:7687")

    with driver.session() as session:
        session.run("CREATE CONSTRAINT ON (t:Transaction) ASSERT t.txId IS UNIQUE")
        existing_nodes = session.run("MATCH (t:Transaction) RETURN count(t) AS n").single()["n"]
        existing_edges = session.run("MATCH ()-[r:SENT_TO]->() RETURN count(r) AS n").single()["n"]

    classes = load_all_classes()
    edges = load_all_edges()
    print(f"CSV rows: {len(classes)} classes, {len(edges)} edges.")
    print(f"Already in DB: {existing_nodes} nodes, {existing_edges} edges.")

    t_start_wall = time.perf_counter()

    node_seconds = run_batches(
        driver,
        "nodes",
        classes,
        existing_nodes,
        """
        UNWIND $rows AS row
        MERGE (t:Transaction {txId: row.tx_id})
        SET t.class = row.tx_class
        """,
    )

    edge_seconds = run_batches(
        driver,
        "edges",
        edges,
        existing_edges,
        """
        UNWIND $rows AS row
        MATCH (a:Transaction {txId: row.from_id})
        MATCH (b:Transaction {txId: row.to_id})
        MERGE (a)-[:SENT_TO]->(b)
        """,
    )

    with driver.session() as session:
        node_count = session.run("MATCH (t:Transaction) RETURN count(t) AS n").single()["n"]
        edge_count = session.run("MATCH ()-[r:SENT_TO]->() RETURN count(r) AS n").single()["n"]

    driver.close()

    print("\n--- Results (this run) ---")
    print(f"Nodes phase: {node_seconds:.2f}s")
    print(f"Edges phase: {edge_seconds:.2f}s")
    print(f"Wall time this run: {time.perf_counter() - t_start_wall:.2f}s")
    print(f"Final counts: {node_count} nodes, {edge_count} edges")


if __name__ == "__main__":
    main()
