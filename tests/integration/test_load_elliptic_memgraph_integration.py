"""Integration test: scripts/load_elliptic_memgraph.py against a real Memgraph.

Needs `docker compose up -d memgraph` (its /csv_shards mount is where the
shards are read from). Like test_memgraph_integration.py, an unreachable
Memgraph fails loudly instead of skipping.

This REPLACES the whole graph with a tiny dataset; run start_memgraph.bat
afterwards to get the full Elliptic graph back.
"""

import importlib.util
import sys
from pathlib import Path

import pytest
from neo4j import GraphDatabase

MEMGRAPH_URI = "bolt://localhost:7687"
SCRIPT_PATH = Path(__file__).resolve().parent.parent.parent / "scripts" / "load_elliptic_memgraph.py"


def _load():
    spec = importlib.util.spec_from_file_location("load_elliptic_memgraph", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["load_elliptic_memgraph"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def memgraph_available():
    driver = GraphDatabase.driver(MEMGRAPH_URI)
    try:
        driver.verify_connectivity()
        return True
    except Exception:
        return False
    finally:
        driver.close()


@pytest.fixture
def driver(memgraph_available):
    if not memgraph_available:
        pytest.fail(
            "Memgraph not reachable at bolt://localhost:7687. "
            "Start it with `docker compose up -d memgraph` before running integration tests."
        )
    d = GraphDatabase.driver(MEMGRAPH_URI)
    yield d
    d.close()


def _dataset(path, edges):
    path.mkdir()
    (path / "elliptic_txs_classes.csv").write_text("txId,class\nLT1,1\nLT2,2\nLT3,unknown\n")
    (path / "elliptic_txs_edgelist.csv").write_text("txId1,txId2\n" + "".join(f"{a},{b}\n" for a, b in edges))
    (path / "elliptic_txs_features.csv").write_text("LT1,1,0.1\nLT2,2,0.2\nLT3,49,0.3\n")
    return ["--source-dir", str(path), "--shards", "2", "--wait", "5"]


def _rows(driver, query):
    with driver.session() as session:
        return [dict(r) for r in session.run(query)]


def test_load_replaces_the_graph_with_the_dataset(driver, tmp_path):
    mod = _load()
    with driver.session() as session:
        session.run("CREATE (:Leftover {x: 1})").consume()
    argv = _dataset(tmp_path / "data", edges=[("LT1", "LT2"), ("LT2", "LT3")])

    mod.main(argv)
    mod.main(argv)  # a second run starts from a loaded graph with its constraint in place

    assert _rows(driver, "MATCH (n) RETURN count(n) AS n") == [{"n": 3}]
    assert _rows(driver, "MATCH (t:Transaction) RETURN t.txId AS id, t.class AS c, t.timeStep AS ts ORDER BY id") == [
        {"id": "LT1", "c": "illicit", "ts": 1},
        {"id": "LT2", "c": "licit", "ts": 2},
        {"id": "LT3", "c": "unknown", "ts": 49},
    ]
    assert _rows(driver, "MATCH (a)-[:SENT_TO]->(b) RETURN a.txId AS a, b.txId AS b ORDER BY a") == [
        {"a": "LT1", "b": "LT2"},
        {"a": "LT2", "b": "LT3"},
    ]
    constraints = _rows(driver, "SHOW CONSTRAINT INFO")
    assert [(c["constraint type"], c["label"], c["properties"]) for c in constraints] == [
        ("unique", "Transaction", ["txId"])
    ]
    assert [(i["label"], i["property"]) for i in _rows(driver, "SHOW INDEX INFO")] == [("Transaction", ["txId"])]
    with pytest.raises(Exception, match="(?i)unique"), driver.session() as session:
        session.run("CREATE (:Transaction {txId: 'LT1'})").consume()


def test_load_fails_when_an_edge_points_at_an_unknown_transaction(driver, tmp_path):
    argv = _dataset(tmp_path / "data", edges=[("LT1", "LT2"), ("LT1", "MISSING")])

    with pytest.raises(RuntimeError, match="Load incomplete"):
        _load().main(argv)
