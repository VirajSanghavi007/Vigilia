"""Unit tests for the ingest endpoints — mocked GraphStore via FastAPI's
dependency_overrides, no real Memgraph needed."""

from fastapi.testclient import TestClient

from vigilia.api.main import app
from vigilia.infra.graph import get_graph_store


class FakeGraphStore:
    def __init__(self):
        self.transactions: list[tuple] = []
        self.edges: list[tuple] = []
        self.transaction_batches: list[list[dict]] = []
        self.edge_batches: list[list[dict]] = []

    def upsert_transaction(self, tx_id, tx_class, properties=None):
        self.transactions.append((tx_id, tx_class, properties))

    def upsert_edge(self, from_id, to_id):
        self.edges.append((from_id, to_id))

    def upsert_transactions_batch(self, rows):
        self.transaction_batches.append(rows)

    def upsert_edges_batch(self, rows):
        self.edge_batches.append(rows)

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


def test_ingest_transaction_batch_calls_store_once_with_all_rows():
    client, fake = _client_with_fake_store()
    try:
        resp = client.post(
            "/v1/ingest/transaction/batch",
            json={
                "transactions": [
                    {"tx_id": "T1", "tx_class": "illicit"},
                    {"tx_id": "T2", "tx_class": "licit", "properties": {"f0": 1.0}},
                ]
            },
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok", "count": 2}
        assert len(fake.transaction_batches) == 1
        assert fake.transaction_batches[0] == [
            {"tx_id": "T1", "tx_class": "illicit", "properties": None},
            {"tx_id": "T2", "tx_class": "licit", "properties": {"f0": 1.0}},
        ]
    finally:
        app.dependency_overrides.clear()


def test_ingest_edge_batch_calls_store_once_with_all_rows():
    client, fake = _client_with_fake_store()
    try:
        resp = client.post(
            "/v1/ingest/edge/batch",
            json={"edges": [{"from_id": "T1", "to_id": "T2"}, {"from_id": "T2", "to_id": "T3"}]},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok", "count": 2}
        assert fake.edge_batches == [
            [{"from_id": "T1", "to_id": "T2"}, {"from_id": "T2", "to_id": "T3"}]
        ]
    finally:
        app.dependency_overrides.clear()
