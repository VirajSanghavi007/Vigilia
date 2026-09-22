"""Integration test for the ingest endpoints against a real Memgraph
instance — the actual API-layer-through-to-database path, not mocked.

Same fail-loud-not-skip pattern as test_memgraph_integration.py: Memgraph
being unreachable locally is almost always a forgotten `docker compose up`.
"""

import pytest
from fastapi.testclient import TestClient

from vigilia.api.main import app
from vigilia.infra.graph import get_graph_store
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
def client(memgraph_available):
    if not memgraph_available:
        pytest.fail(
            "Memgraph not reachable at bolt://localhost:7687. "
            "Start it with `docker compose up -d memgraph` before running integration tests."
        )

    store = MemgraphStore(MEMGRAPH_URI)
    store.ensure_constraints()
    with store._driver.session() as session:
        session.run("MATCH (t:Transaction) DETACH DELETE t")

    app.dependency_overrides[get_graph_store] = lambda: store
    yield TestClient(app)
    app.dependency_overrides.clear()

    with store._driver.session() as session:
        session.run("MATCH (t:Transaction) DETACH DELETE t")
    store.close()


def test_ingest_transaction_then_edge_lands_in_real_graph(client):
    resp = client.post(
        "/v1/ingest/transaction",
        json={"tx_id": "IT1", "tx_class": "illicit", "properties": {"f0": 2.0}},
    )
    assert resp.status_code == 200

    resp = client.post(
        "/v1/ingest/transaction", json={"tx_id": "IT2", "tx_class": "licit"}
    )
    assert resp.status_code == 200

    resp = client.post("/v1/ingest/edge", json={"from_id": "IT1", "to_id": "IT2"})
    assert resp.status_code == 200

    store = MemgraphStore(MEMGRAPH_URI)
    try:
        neighbors = store.get_neighbors("IT1")
    finally:
        store.close()
    assert neighbors == ["IT2"]
