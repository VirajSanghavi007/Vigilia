"""Smoke test: the graph explorer endpoints are mounted and serve one
question end to end through the real router, guard and response schema,
with the Memgraph store and Claude generator faked (the real services are
covered by tests/integration/test_graph_explorer_integration.py)."""

from fastapi.testclient import TestClient

from vigilia.api.main import app
from vigilia.domain.graph.query import GeneratedQuery, GraphNode, GraphSchema, QueryResult
from vigilia.infra.graph import get_graph_query_store
from vigilia.infra.llm import get_cypher_generator


class Store:
    def schema(self):
        return GraphSchema({"Transaction": 1}, {}, ["txId"], {"illicit": 1})

    def run_read(self, cypher):
        return QueryResult(["t"], [["Transaction a"]], [GraphNode("e1", ["Transaction"], {"txId": "a"})])


class Generator:
    def generate(self, question, schema):
        return GeneratedQuery("MATCH (t:Transaction {class: 'illicit'}) RETURN t", "illicit transactions")


def test_ask_and_query_round_trip():
    app.dependency_overrides[get_graph_query_store] = Store
    app.dependency_overrides[get_cypher_generator] = Generator
    try:
        with TestClient(app) as client:
            assert client.get("/v1/graph/schema").status_code == 200
            asked = client.post("/v1/graph/ask", json={"question": "show illicit transactions"})
            assert asked.status_code == 200
            rerun = client.post("/v1/graph/query", json={"cypher": asked.json()["cypher"]})
    finally:
        app.dependency_overrides.clear()
    assert rerun.status_code == 200
    assert rerun.json()["nodes"][0]["properties"] == {"txId": "a"}
    assert rerun.json()["cypher"].endswith("LIMIT 200")
