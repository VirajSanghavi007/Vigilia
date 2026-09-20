"""Integration tests against the real FastAPI app via TestClient.

Exercises the actual ASGI app (middleware, routers, lifespan) rather than
calling handler functions directly. Runs in CI only on push to the
production branch — these hit real startup code paths (DB init, background
pipeline thread) and are slower/heavier than the unit suite.
"""
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from backend.api.main import app
    return TestClient(app)


def test_health_endpoint_reports_status():
    with _client() as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["pipeline_status"] in {"loading", "ready", "error"}


def test_unauthenticated_protected_route_is_rejected():
    with _client() as client:
        resp = client.get("/alerts")
        assert resp.status_code in (401, 403)
