"""Smoke test — the app boots and serves a request. Grows into a real model
smoke test once ml/inference exists again."""
from fastapi.testclient import TestClient

from vigilia.api.main import app


def test_health_endpoint_returns_ok():
    with TestClient(app) as client:
        resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
