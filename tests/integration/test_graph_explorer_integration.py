"""Integration tests for the graph explorer against real services.

Memgraph: requires `docker compose up -d memgraph`. Claude: requires
ANTHROPIC_API_KEY in the environment (in CI, a repository secret) and makes
one small real API call. Neither skips when its service is missing: an
unreachable Memgraph or an unset key locally is almost always a forgotten
setup step, so each fails loudly with the fix instead (same reasoning as
test_memgraph_integration.py).

Seeded nodes use a unique txId prefix and only those are deleted, so the
tests can run against a Memgraph that also holds real data.
"""

import os
import uuid

import pytest
from fastapi.testclient import TestClient

from vigilia.api.main import app
from vigilia.domain.graph.query import ask_graph
from vigilia.infra.graph import get_graph_query_store
from vigilia.infra.graph.memgraph_client import MemgraphStore
from vigilia.infra.graph.memgraph_query import MemgraphQueryStore
from vigilia.infra.llm.anthropic_cypher import AnthropicCypherGenerator

MEMGRAPH_URI = "bolt://localhost:7687"


@pytest.fixture
def memgraph_available():
    store = MemgraphStore(MEMGRAPH_URI)
    try:
        with store._driver.session() as session:
            session.run("RETURN 1").consume()
        return True
    except Exception:
        return False
    finally:
        store.close()


@pytest.fixture
def seeded(memgraph_available):
    if not memgraph_available:
        pytest.fail(
            "Memgraph not reachable at bolt://localhost:7687. "
            "Start it with `docker compose up -d memgraph` before running integration tests."
        )
    prefix = f"it-{uuid.uuid4().hex[:8]}-"
    writer = MemgraphStore(MEMGRAPH_URI)
    writer.upsert_transactions_batch(
        [
            {"tx_id": f"{prefix}a", "tx_class": "illicit", "properties": {"local_1": 1.0}},
            {"tx_id": f"{prefix}b", "tx_class": "unknown"},
            {"tx_id": f"{prefix}c", "tx_class": "licit"},
        ]
    )
    writer.upsert_edges_batch(
        [{"from_id": f"{prefix}a", "to_id": f"{prefix}b"}, {"from_id": f"{prefix}b", "to_id": f"{prefix}c"}]
    )
    reader = MemgraphQueryStore(MEMGRAPH_URI)
    yield prefix, reader
    reader.close()
    with writer._driver.session() as session:
        session.run("MATCH (t:Transaction) WHERE t.txId STARTS WITH $p DETACH DELETE t", p=prefix).consume()
    writer.close()


def test_schema_reflects_seeded_graph(seeded):
    _, reader = seeded
    schema = reader.schema()
    assert schema.labels["Transaction"] >= 3
    assert schema.edge_types["SENT_TO"] >= 2
    assert {"illicit", "licit", "unknown"} <= set(schema.class_counts)
    assert "txId" in schema.property_keys


def test_path_query_returns_drawable_graph(seeded):
    prefix, reader = seeded
    result = reader.run_read(f"MATCH p=(a:Transaction {{txId: '{prefix}a'}})-[:SENT_TO*1..2]->(x) RETURN p")
    assert len(result.rows) == 2
    assert {n.properties["txId"] for n in result.nodes} == {f"{prefix}a", f"{prefix}b", f"{prefix}c"}
    ids = {n.id: n.properties["txId"] for n in result.nodes}
    assert {(ids[e.source], ids[e.target]) for e in result.edges} == {
        (f"{prefix}a", f"{prefix}b"),
        (f"{prefix}b", f"{prefix}c"),
    }


def test_api_query_endpoint_against_real_memgraph(seeded):
    prefix, reader = seeded
    app.dependency_overrides[get_graph_query_store] = lambda: reader
    try:
        resp = TestClient(app).post(
            "/v1/graph/query",
            json={"cypher": f"MATCH (t:Transaction) WHERE t.txId STARTS WITH '{prefix}' RETURN t.class AS c"},
        )
        bad = TestClient(app).post("/v1/graph/query", json={"cypher": "MATCH (t) RETURN nope(t)"})
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 200
    assert sorted(r[0] for r in resp.json()["rows"]) == ["illicit", "licit", "unknown"]
    assert bad.status_code == 400


@pytest.fixture
def claude():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        pytest.fail(
            "ANTHROPIC_API_KEY is not set. Export it in the shell running the tests "
            "(and as a CI secret) to exercise the real Claude Cypher generator."
        )
    return AnthropicCypherGenerator()


def test_claude_writes_a_guarded_query_that_runs(seeded, claude):
    prefix, reader = seeded
    generated, cypher, result = ask_graph(
        f"Which transactions did transaction {prefix}a send funds to directly? Return the relationships.",
        claude,
        reader,
    )
    assert generated.explanation
    assert "LIMIT" in cypher.upper()
    assert f"{prefix}b" in {n.properties.get("txId") for n in result.nodes}
