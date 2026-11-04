"""Unit tests for the /v1/graph endpoints: fake store and generator via
dependency_overrides, no Memgraph or Claude."""

import pytest
from fastapi.testclient import TestClient

from vigilia.api.main import app
from vigilia.domain.graph.query import (
    GeneratedQuery,
    GeneratorRefused,
    GeneratorUnavailable,
    GraphEdge,
    GraphNode,
    GraphSchema,
    GraphUnavailable,
    QueryFailed,
    QueryResult,
)
from vigilia.infra.graph import get_graph_query_store
from vigilia.infra.llm import get_cypher_generator

SCHEMA = GraphSchema({"Transaction": 2}, {"SENT_TO": 1}, ["txId", "class"], {"illicit": 1, "licit": 1})
RESULT = QueryResult(
    columns=["p"],
    rows=[["path (1 hops)"]],
    nodes=[
        GraphNode("e1", ["Transaction"], {"txId": "a", "class": "illicit"}),
        GraphNode("e2", ["Transaction"], {"txId": "b", "class": "licit"}),
    ],
    edges=[GraphEdge("r1", "SENT_TO", "e1", "e2")],
)


class FakeStore:
    def __init__(self, error=None):
        self.error = error
        self.ran = []

    def schema(self):
        if self.error:
            raise self.error
        return SCHEMA

    def run_read(self, cypher):
        if self.error:
            raise self.error
        self.ran.append(cypher)
        return RESULT


class FakeGenerator:
    def __init__(self, cypher="MATCH p=(a)-[:SENT_TO]->(b) RETURN p", error=None):
        self.cypher, self.error = cypher, error

    def generate(self, question, schema):
        if self.error:
            raise self.error
        return GeneratedQuery(self.cypher, f"answers {question}")


@pytest.fixture
def client():
    store, gen = FakeStore(), FakeGenerator()
    app.dependency_overrides[get_graph_query_store] = lambda: store
    app.dependency_overrides[get_cypher_generator] = lambda: gen
    try:
        yield TestClient(app), store, gen
    finally:
        app.dependency_overrides.clear()


def test_schema(client):
    c, _, _ = client
    resp = c.get("/v1/graph/schema")
    assert resp.status_code == 200
    assert resp.json() == {
        "labels": {"Transaction": 2},
        "edge_types": {"SENT_TO": 1},
        "property_keys": ["txId", "class"],
        "class_counts": {"illicit": 1, "licit": 1},
    }


def test_ask_returns_guarded_cypher_explanation_and_graph(client):
    c, store, _ = client
    resp = c.post("/v1/graph/ask", json={"question": "who sent to whom"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["cypher"] == "MATCH p=(a)-[:SENT_TO]->(b) RETURN p\nLIMIT 200"
    assert store.ran == [body["cypher"]]
    assert body["explanation"] == "answers who sent to whom"
    assert body["columns"] == ["p"] and body["rows"] == [["path (1 hops)"]]
    assert body["nodes"][0] == {"id": "e1", "labels": ["Transaction"], "properties": {"txId": "a", "class": "illicit"}}
    assert body["edges"] == [{"id": "r1", "type": "SENT_TO", "source": "e1", "target": "e2"}]


def test_query_runs_edited_cypher_without_explanation(client):
    c, store, _ = client
    resp = c.post("/v1/graph/query", json={"cypher": "MATCH (t) RETURN t LIMIT 3"})
    assert resp.status_code == 200
    assert resp.json()["explanation"] is None
    assert store.ran == ["MATCH (t) RETURN t LIMIT 3"]


def test_query_rejects_writes_without_touching_the_store(client):
    c, store, _ = client
    resp = c.post("/v1/graph/query", json={"cypher": "MATCH (n) DETACH DELETE n"})
    assert resp.status_code == 400
    assert "read-only" in resp.json()["detail"]
    assert store.ran == []


def test_ask_rejects_a_generated_write(client):
    c, store, gen = client
    gen.cypher = "MATCH (n) SET n.class = 'licit' RETURN n"
    resp = c.post("/v1/graph/ask", json={"question": "relabel everything"})
    assert resp.status_code == 400
    assert store.ran == []


@pytest.mark.parametrize(
    ("error", "status"),
    [(GeneratorRefused("no"), 422), (GeneratorUnavailable("down"), 502)],
)
def test_ask_generator_errors(client, error, status):
    c, _, gen = client
    gen.error = error
    resp = c.post("/v1/graph/ask", json={"question": "anything"})
    assert resp.status_code == status
    assert resp.json()["detail"] == str(error)


@pytest.mark.parametrize(
    ("error", "status"),
    [(GraphUnavailable("Memgraph is not reachable"), 503), (QueryFailed("bad syntax"), 400)],
)
@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/v1/graph/schema", None),
        ("post", "/v1/graph/ask", {"question": "anything"}),
        ("post", "/v1/graph/query", {"cypher": "RETURN 1"}),
    ],
)
def test_store_errors(client, error, status, method, path, body):
    c, store, _ = client
    store.error = error
    resp = getattr(c, method)(path, **({"json": body} if body else {}))
    assert resp.status_code == status
    assert resp.json()["detail"] == str(error)


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/v1/graph/ask", {"question": "hi"}),
        ("/v1/graph/ask", {"question": "x" * 1001}),
        ("/v1/graph/query", {"cypher": ""}),
        ("/v1/graph/query", {"cypher": "R" * 4001}),
    ],
)
def test_request_validation(client, path, body):
    c, _, _ = client
    assert c.post(path, json=body).status_code == 422
