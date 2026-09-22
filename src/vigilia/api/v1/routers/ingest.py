"""Live transaction-ingestion endpoint.

Deliberately one-row-at-a-time (a single transaction or edge per
request), not a bulk/batch endpoint — this matches the workload shape
this endpoint actually serves (a continuous stream of individually
arriving transactions), which is a fundamentally different case from
the one-time historical bulk-load path (LOAD CSV + analytical mode, see
docs/BENCHMARK.md). MERGE + transactional mode is the right default
here, same as scripts/seed_memgraph.py already uses — no analytical-mode
switch, since that would break concurrent transactional reads/writes
this endpoint needs to coexist with.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from vigilia.api.v1.schemas.ingest import EdgeIn, TransactionIn
from vigilia.domain.graph.store import GraphStore
from vigilia.infra.graph import get_graph_store

router = APIRouter(prefix="/v1/ingest", tags=["ingest"])


@router.post("/transaction")
def ingest_transaction(
    body: TransactionIn, store: GraphStore = Depends(get_graph_store)  # noqa: B008
) -> dict:
    store.upsert_transaction(body.tx_id, body.tx_class, body.properties)
    return {"status": "ok"}


@router.post("/edge")
def ingest_edge(
    body: EdgeIn, store: GraphStore = Depends(get_graph_store)  # noqa: B008
) -> dict:
    store.upsert_edge(body.from_id, body.to_id)
    return {"status": "ok"}
