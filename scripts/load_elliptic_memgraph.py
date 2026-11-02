"""Load the full Elliptic dataset into Memgraph (what start_memgraph.bat runs).

Uses the fastest path measured in docs/BENCHMARK.md: the dataset is split
into CSV shards under data/syndata/csv_shards (mounted read-only into the
container at /csv_shards, see docker-compose.yml), and Memgraph reads them
itself with concurrent LOAD CSV in IN_MEMORY_ANALYTICAL mode. The full
graph loads in a few seconds, against ~17 minutes for driver-side UNWIND.

The load REPLACES the whole graph: LOAD CSV uses CREATE (not MERGE), so
anything already in the database would be duplicated or would break the
txId uniqueness constraint. The graph is dropped first.

Graph written (the schema the graph explorer reads):
    (:Transaction {txId, class, timeStep})-[:SENT_TO]->(:Transaction)
class is illicit/licit/unknown; timeStep (1-49) is the second column of
elliptic_txs_features.csv. The 165 feature columns are not loaded: models
read them from the CSVs, and copying them onto every node would only grow
the graph's memory for no query that uses them.

Usage:
    python scripts/load_elliptic_memgraph.py
    python scripts/load_elliptic_memgraph.py --shards-only   # write shards, don't load
"""

import argparse
import csv
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from neo4j import GraphDatabase

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = ROOT / "data" / "elliptic_bitcoin_dataset"
DEFAULT_SHARD_DIR = ROOT / "data" / "syndata" / "csv_shards"
CONTAINER_SHARD_DIR = "/csv_shards"
CLASS_MAP = {"1": "illicit", "2": "licit", "unknown": "unknown"}

NODE_FIELDS = ["txId", "class", "timeStep"]
EDGE_FIELDS = ["txId1", "txId2"]

NODE_QUERY = """
LOAD CSV FROM "{path}" WITH HEADER AS row
CREATE (:Transaction {{txId: row.txId, class: row.class, timeStep: toInteger(row.timeStep)}})
"""
# Edges MATCH by txId, so the index must exist before this phase runs:
# without it every lookup is a full label scan (docs/BENCHMARK.md).
EDGE_QUERY = """
LOAD CSV FROM "{path}" WITH HEADER AS row
MATCH (a:Transaction {{txId: row.txId1}})
MATCH (b:Transaction {{txId: row.txId2}})
CREATE (a)-[:SENT_TO]->(b)
"""


def read_nodes(data_dir: Path) -> list[dict]:
    """Class rows joined with each transaction's time step from the features file."""
    time_steps = {}
    with (data_dir / "elliptic_txs_features.csv").open() as f:
        for line in f:
            tx_id, time_step, _ = line.split(",", 2)
            time_steps[tx_id] = time_step

    nodes = []
    with (data_dir / "elliptic_txs_classes.csv").open(newline="") as f:
        for row in csv.DictReader(f):
            tx_id = row["txId"]
            if tx_id not in time_steps:
                raise ValueError(f"txId {tx_id} has a class but no row in elliptic_txs_features.csv")
            nodes.append({"txId": tx_id, "class": CLASS_MAP[row["class"]], "timeStep": time_steps[tx_id]})
    return nodes


def read_edges(data_dir: Path) -> list[dict]:
    with (data_dir / "elliptic_txs_edgelist.csv").open(newline="") as f:
        return [{"txId1": row["txId1"], "txId2": row["txId2"]} for row in csv.DictReader(f)]


def write_shards(rows: list[dict], shard_dir: Path, prefix: str, fields: list[str], n_shards: int) -> list[str]:
    """Split rows round-robin into n_shards CSVs; returns the shard file names.

    Old shards with the same prefix are removed first, so a run with fewer
    shards can't leave stale files behind.
    """
    shard_dir.mkdir(parents=True, exist_ok=True)
    for old in shard_dir.glob(f"{prefix}_*.csv"):
        old.unlink()

    names = [f"{prefix}_{i}.csv" for i in range(n_shards)]
    files = [(shard_dir / name).open("w", newline="") for name in names]
    try:
        writers = [csv.DictWriter(fh, fieldnames=fields) for fh in files]
        for w in writers:
            w.writeheader()
        for i, row in enumerate(rows):
            writers[i % n_shards].writerow(row)
    finally:
        for fh in files:
            fh.close()
    return names


def wait_for_bolt(uri: str, timeout: float, interval: float = 1.0, driver_factory=GraphDatabase.driver):
    """Return a connected driver once Memgraph answers, or raise after timeout seconds."""
    start = time.monotonic()
    while True:
        driver = driver_factory(uri)
        try:
            driver.verify_connectivity()
            return driver
        except Exception as ex:
            driver.close()
            waited = time.monotonic() - start
            if waited >= timeout:
                raise RuntimeError(
                    f"Memgraph not reachable at {uri} after {timeout:.0f}s. "
                    "Start it with `docker compose up -d memgraph`."
                ) from ex
            print(f"  waiting for Memgraph at {uri} ({waited:.0f}s / {timeout:.0f}s)...", flush=True)
            time.sleep(interval)


def drop_constraint_query(row: dict) -> str:
    """The DROP statement for one row of SHOW CONSTRAINT INFO."""
    kind, label, props = row["constraint type"], row["label"], row["properties"]
    if isinstance(props, str):
        props = [props]
    if kind == "unique":
        return f"DROP CONSTRAINT ON (n:{label}) ASSERT {', '.join(f'n.{p}' for p in props)} IS UNIQUE"
    if kind == "exists":
        return f"DROP CONSTRAINT ON (n:{label}) ASSERT EXISTS (n.{props[0]})"
    raise ValueError(f"Don't know how to drop a {kind!r} constraint on :{label}; drop it by hand first.")


def reset_graph(session) -> None:
    """Drop all data, indexes and constraints, leaving Memgraph in analytical mode.

    DROP GRAPH only runs in IN_MEMORY_ANALYTICAL mode, which is also the
    mode the bulk load needs. Memgraph won't switch to that mode while any
    constraint exists, so those are dropped first.
    """
    for row in list(session.run("SHOW CONSTRAINT INFO")):
        session.run(drop_constraint_query(dict(row))).consume()
    session.run("STORAGE MODE IN_MEMORY_ANALYTICAL").consume()
    session.run("DROP GRAPH").consume()


def run_parallel(uri: str, template: str, names: list[str], label: str) -> float:
    def load(name):
        driver = GraphDatabase.driver(uri)
        try:
            with driver.session() as session:
                session.run(template.format(path=f"{CONTAINER_SHARD_DIR}/{name}")).consume()
        finally:
            driver.close()

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=len(names)) as pool:
        for done, _ in enumerate(pool.map(load, names), 1):
            print(f"  {label}: {done}/{len(names)} shards, {time.perf_counter() - t0:.1f}s elapsed", flush=True)
    return time.perf_counter() - t0


def finalize(session) -> tuple[int, int]:
    """Back to transactional mode with the txId constraint; returns (nodes, edges).

    The constraint isn't allowed in analytical mode, so it comes last.
    """
    session.run("STORAGE MODE IN_MEMORY_TRANSACTIONAL").consume()
    session.run("CREATE CONSTRAINT ON (t:Transaction) ASSERT t.txId IS UNIQUE").consume()
    nodes = session.run("MATCH (t:Transaction) RETURN count(t) AS n").single()["n"]
    edges = session.run("MATCH ()-[r:SENT_TO]->() RETURN count(r) AS n").single()["n"]
    return nodes, edges


def check_counts(loaded: tuple[int, int], expected: tuple[int, int]) -> None:
    if loaded != expected:
        raise RuntimeError(
            f"Load incomplete: graph has {loaded[0]} nodes / {loaded[1]} edges, "
            f"expected {expected[0]} / {expected[1]} from the CSVs."
        )


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--uri", default="bolt://localhost:7687")
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--shard-dir", type=Path, default=DEFAULT_SHARD_DIR,
                        help="Host directory mounted at /csv_shards in the container.")
    parser.add_argument("--shards", type=int, default=8, help="8 tied for fastest in docs/BENCHMARK.md.")
    parser.add_argument("--wait", type=float, default=120, help="Seconds to wait for Memgraph to accept connections.")
    parser.add_argument("--shards-only", action="store_true", help="Write the shard CSVs and stop.")
    args = parser.parse_args(argv)
    if args.shards < 1:
        parser.error("--shards must be at least 1")

    t0 = time.perf_counter()
    nodes = read_nodes(args.source_dir)
    edges = read_edges(args.source_dir)
    node_shards = write_shards(nodes, args.shard_dir, "nodes", NODE_FIELDS, args.shards)
    edge_shards = write_shards(edges, args.shard_dir, "edges", EDGE_FIELDS, args.shards)
    print(f"Wrote {len(nodes)} transactions and {len(edges)} edges into {args.shards} shards each "
          f"({time.perf_counter() - t0:.1f}s).", flush=True)
    if args.shards_only:
        return

    driver = wait_for_bolt(args.uri, args.wait)
    try:
        with driver.session() as session:
            # A long-running query elsewhere would otherwise block the mode switch indefinitely.
            session.run("SET DATABASE SETTING 'storage.access_timeout_sec' TO '30'").consume()
            reset_graph(session)
            print("Dropped the existing graph.", flush=True)

        run_parallel(args.uri, NODE_QUERY, node_shards, "nodes")
        with driver.session() as session:
            session.run("CREATE INDEX ON :Transaction(txId)").consume()
        run_parallel(args.uri, EDGE_QUERY, edge_shards, "edges")

        with driver.session() as session:
            loaded = finalize(session)
    finally:
        driver.close()

    check_counts(loaded, (len(nodes), len(edges)))
    print(f"Loaded {loaded[0]} transactions and {loaded[1]} edges in {time.perf_counter() - t0:.1f}s.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as ex:
        print(f"ERROR: {ex}", file=sys.stderr)
        sys.exit(1)
