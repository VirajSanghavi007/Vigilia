"""FastAPI entrypoint.

Intentionally minimal for now — this is the first commit of the rebuilt
layered structure (see CLAUDE.md / ARCHITECTURE for the rebuild rationale).
Domain routers (alerts, whitelist, auth, ingest, predict) get added here as
each is rebuilt in domain/ and ml/, not resurrected wholesale from the old
codebase.
"""

from __future__ import annotations

from fastapi import FastAPI

from vigilia.shared.logging import get_logger

logger = get_logger(__name__)

app = FastAPI(title="Vigilia")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
