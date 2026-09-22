"""Integration test against a real Memgraph instance.

Requires `docker compose up -d memgraph` running locally (CI starts it as a
plain `docker run` in the integration-tests job — CI is Linux-only, so
Docker is always available there). No environment skips Memgraph being
unreachable: that's almost always a forgotten `docker compose up`, not a
permanent fact about the environment, so it fails loudly with an
actionable message instead — a silent skip would let this file report
"passed" without having exercised any real behavior.
"""

import pytest

from vigilia.infra.graph.memgraph_client import MemgraphStore

MEMGRAPH_URI = "bolt://localhost:7687"


@pytest.fixture
def memgraph_available():
    store = MemgraphStore(MEMGRAPH_URI)
    try:
        with store._driver.session() as session:
            session.run("RETURN 1")
        return True
    except Exception:
        return False
    finally:
        store.close()


@pytest.fixture
def store(memgraph_available):
    if not memgraph_available:
        pytest.fail(
            "Memgraph not reachable at bolt://localhost:7687. "
            "Start it with `docker compose up -d memgraph` before running integration tests."
        )

    s = MemgraphStore(MEMGRAPH_URI)
    s.ensure_constraints()
    with s._driver.session() as session:
        session.run("MATCH (t:Transaction) DETACH DELETE t")
    yield s
    with s._driver.session() as session:
        session.run("MATCH (t:Transaction) DETACH DELETE t")
    s.close()


def test_upsert_transaction_is_idempotent(store):
    store.upsert_transaction("T1", "illicit")
    store.upsert_transaction("T1", "illicit")

    with store._driver.session() as session:
        count = session.run("MATCH (t:Transaction {txId: 'T1'}) RETURN count(t) AS n").single()["n"]

    assert count == 1


def test_upsert_transaction_updates_class_on_conflict(store):
    store.upsert_transaction("T1", "unknown")
    store.upsert_transaction("T1", "illicit")

    with store._driver.session() as session:
        tx_class = session.run(
            "MATCH (t:Transaction {txId: 'T1'}) RETURN t.class AS c"
        ).single()["c"]

    assert tx_class == "illicit"


def test_upsert_edge_creates_both_nodes_and_relationship(store):
    store.upsert_edge("T1", "T2")

    with store._driver.session() as session:
        result = session.run(
            "MATCH (a:Transaction {txId: 'T1'})-[:SENT_TO]->(b:Transaction {txId: 'T2'}) RETURN count(*) AS n"
        ).single()["n"]

    assert result == 1


def test_upsert_edge_is_idempotent(store):
    store.upsert_edge("T1", "T2")
    store.upsert_edge("T1", "T2")

    with store._driver.session() as session:
        count = session.run("MATCH ()-[r:SENT_TO]->() RETURN count(r) AS n").single()["n"]

    assert count == 1


def test_get_neighbors_returns_connected_txids(store):
    store.upsert_edge("T1", "T2")
    store.upsert_edge("T3", "T2")

    neighbors = store.get_neighbors("T2")

    assert set(neighbors) == {"T1", "T3"}
