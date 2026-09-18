import threading

from fastapi import APIRouter, HTTPException, Query, Request

from database import service as db
from .. import state
from ..auth_deps import _check_ingest_key, limiter
from ..schemas import TransactionIn

router = APIRouter()

# ── Transaction Ingestion API ───────────────────────────────────────────────
# The "API layer" for streaming transaction data into Argus. Accepts a single
# transaction or a batch. Secured with an optional API key (X-API-Key header,
# set ARGUS_INGEST_KEY to enable). Rows are queued and folded into the next scan.


@router.post("/ingest")
async def ingest(request: Request):
    """Accept transaction data — a single object, a bare list, or
    {"transactions": [...]}. Validates each row and queues it for the next scan."""
    _check_ingest_key(request)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body must be valid JSON")

    if isinstance(payload, dict) and "transactions" in payload:
        raw = payload["transactions"]
    elif isinstance(payload, dict):
        raw = [payload]
    elif isinstance(payload, list):
        raw = payload
    else:
        raise HTTPException(status_code=422, detail="Expected a transaction object or a list")

    rows, errors = [], []
    for i, item in enumerate(raw):
        try:
            rows.append(TransactionIn(**item).to_row())
        except Exception as e:
            errors.append({"index": i, "error": str(e)})

    if not rows:
        raise HTTPException(status_code=422, detail={"message": "No valid transactions", "errors": errors})

    stored = db.store_live_transactions(rows)

    rid = state.request_id.get()
    state.logger.info(f"[{rid}] Ingested {stored} transaction(s) ({len(errors)} rejected)")

    # Kick off non-blocking neighborhood rescore so alerts appear within seconds
    threading.Thread(target=state._rescore_neighborhood, args=(rows,), daemon=True).start()

    return {
        "received": len(raw),
        "stored": stored,
        "rejected": errors,
        "total_queued": db.count_live_transactions(),
        "note": "Stored. Neighborhood rescore running — new alerts appear within seconds.",
    }


@router.get("/live/transactions")
@limiter.limit("120/minute")
def live_transactions(request: Request, limit: int = Query(default=15, ge=1, le=100)):
    """Recent live-ingested transactions + running total, for the Dashboard feed."""
    return {
        "count": db.count_live_transactions(),
        "transactions": db.get_live_transactions(limit),
    }
