"""One-off loader: seed Memgraph with the first N Elliptic transactions.

Usage:
    uv run python scripts/seed_memgraph.py [--limit 100]

Requires Memgraph running locally (see docker-compose.yml: `docker compose up memgraph`).
"""

import argparse
import csv
from pathlib import Path

from vigilia.infra.graph.memgraph_client import MemgraphStore

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "elliptic_bitcoin_dataset"
CLASS_MAP = {"1": "illicit", "2": "licit", "unknown": "unknown"}


def load_classes(limit: int) -> dict[str, str]:
    classes: dict[str, str] = {}
    with (DATA_DIR / "elliptic_txs_classes.csv").open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if len(classes) >= limit:
                break
            classes[row["txId"]] = CLASS_MAP[row["class"]]
    return classes


def load_edges(tx_ids: set[str]) -> list[tuple[str, str]]:
    edges = []
    with (DATA_DIR / "elliptic_txs_edgelist.csv").open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["txId1"] in tx_ids and row["txId2"] in tx_ids:
                edges.append((row["txId1"], row["txId2"]))
    return edges


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--uri", default="bolt://localhost:7687")
    args = parser.parse_args()

    classes = load_classes(args.limit)
    edges = load_edges(set(classes))

    store = MemgraphStore(args.uri)
    try:
        store.ensure_constraints()
        for tx_id, tx_class in classes.items():
            store.upsert_transaction(tx_id, tx_class)
        for from_id, to_id in edges:
            store.upsert_edge(from_id, to_id)
    finally:
        store.close()

    print(f"Seeded {len(classes)} transactions and {len(edges)} edges into Memgraph.")


if __name__ == "__main__":
    main()
