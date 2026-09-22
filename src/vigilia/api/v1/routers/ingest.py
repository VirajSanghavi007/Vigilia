"""Live transaction-ingestion endpoint.

The single-row endpoints (POST /transaction, POST /edge) match the
workload shape this endpoint actually serves in production (a
continuous stream of individually arriving transactions) — a
fundamentally different case from the one-time historical bulk-load
path (LOAD CSV + analytical mode, see docs/BENCHMARK.md). MERGE +
transactional mode is the right default here, same as
scripts/seed_memgraph.py already uses — no analytical-mode switch,
since that would break concurrent transactional reads/writes this
endpoint needs to coexist with.

The /transaction/batch, /edge/batch endpoints exist ONLY to benchmark
how much batching helps (docs/BENCHMARK.md's "sustained-rate/batching"
open question) — an upstream producer sending pre-batched events isn't
the target design (a real event-at-a-time source, e.g. a payment
processor's webhook, can't batch on your behalf), but measuring the
gap tells us whether it's worth building something that *can* batch
(e.g. a queue consumer accumulating a window of events) versus staying
one-row-at-a-time.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from vigilia.api.v1.schemas.ingest import EdgeBatchIn, EdgeIn, TransactionBatchIn, TransactionIn
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


@router.post("/transaction/batch")
def ingest_transaction_batch(
    body: TransactionBatchIn, store: GraphStore = Depends(get_graph_store)  # noqa: B008
) -> dict:
    store.upsert_transactions_batch(
        [
            {"tx_id": t.tx_id, "tx_class": t.tx_class, "properties": t.properties}
            for t in body.transactions
        ]
    )
    return {"status": "ok", "count": len(body.transactions)}


@router.post("/edge/batch")
def ingest_edge_batch(
    body: EdgeBatchIn, store: GraphStore = Depends(get_graph_store)  # noqa: B008
) -> dict:
    store.upsert_edges_batch([{"from_id": e.from_id, "to_id": e.to_id} for e in body.edges])
    return {"status": "ok", "count": len(body.edges)}
