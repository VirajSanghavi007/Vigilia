"""Unit tests for the ingest endpoints — mocked GraphStore via FastAPI's
dependency_overrides, no real Memgraph needed."""

from fastapi.testclient import TestClient

from vigilia.api.main import app
from vigilia.infra.graph import get_graph_store


class FakeGraphStore:
    def __init__(self):
        self.transactions: list[tuple] = []
        self.edges: list[tuple] = []

    def upsert_transaction(self, tx_id, tx_class, properties=None):
        self.transactions.append((tx_id, tx_class, properties))

    def upsert_edge(self, from_id, to_id):
        self.edges.append((from_id, to_id))

    def get_neighbors(self, tx_id):
        return []


def _client_with_fake_store():
    fake = FakeGraphStore()
    app.dependency_overrides[get_graph_store] = lambda: fake
    client = TestClient(app)
    return client, fake


def test_ingest_transaction_calls_store_with_correct_args():
    client, fake = _client_with_fake_store()
    try:
        resp = client.post(
            "/v1/ingest/transaction",
            json={"tx_id": "T1", "tx_class": "illicit", "properties": {"f0": 1.5}},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        assert fake.transactions == [("T1", "illicit", {"f0": 1.5})]
    finally:
        app.dependency_overrides.clear()


def test_ingest_transaction_without_properties_defaults_to_none():
    client, fake = _client_with_fake_store()
    try:
        resp = client.post(
            "/v1/ingest/transaction", json={"tx_id": "T2", "tx_class": "licit"}
        )
        assert resp.status_code == 200
        assert fake.transactions == [("T2", "licit", None)]
    finally:
        app.dependency_overrides.clear()


def test_ingest_transaction_rejects_invalid_class():
    client, _fake = _client_with_fake_store()
    try:
        resp = client.post(
            "/v1/ingest/transaction", json={"tx_id": "T3", "tx_class": "not_a_real_class"}
        )
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_ingest_edge_calls_store_with_correct_args():
    client, fake = _client_with_fake_store()
    try:
        resp = client.post(
            "/v1/ingest/edge", json={"from_id": "T1", "to_id": "T2"}
        )
        assert resp.status_code == 200
        assert fake.edges == [("T1", "T2")]
    finally:
        app.dependency_overrides.clear()
