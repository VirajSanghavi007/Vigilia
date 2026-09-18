from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from database import service as db
from .. import state
from ..auth_deps import limiter
from ..schemas import AlertSource, DecisionBody, PatternType, SeverityLevel

router = APIRouter()


@router.get("/alerts")
@limiter.limit("100/minute")
def list_alerts(
    request: Request,
    pattern_type: PatternType | None = Query(default=None),
    severity: SeverityLevel | None = Query(default=None),
    source: AlertSource | None = Query(default=None),
):
    """List alerts (Issues #1, #2, #5)."""
    # Pull in any alerts persisted by other instances (e.g. a peer's
    # neighborhood-rescore) that this process's in-memory ALERTS hasn't seen
    # yet — the dict is a per-process cache, Postgres is the shared store.
    if state.PIPELINE_READY.is_set():
        try:
            db_alerts = db.load_alerts()
            missing = {k: v for k, v in db_alerts.items() if k not in state.ALERTS}
            if missing:
                with state.ALERTS_LOCK:
                    state.ALERTS.update(missing)
        except Exception as e:
            state.logger.warning(f"[alerts] DB read-through failed: {e}")

    results = []
    with state.ALERTS_LOCK:
        for a in state.ALERTS.values():
            if pattern_type and a["patternType"] != pattern_type:
                continue
            if severity and a["severity"].lower() != severity.value:
                continue
            if source and a.get("source") != source.value:
                continue
            nodes = a.get("nodes", [])
            banks = list(dict.fromkeys(n.get("bank", "") for n in nodes if n.get("bank")))
            results.append({
                "id": a["id"],
                "name": a["name"],
                "sub": a["sub"],
                "severity": a["severity"],
                "confidence": a["confidence"],
                "patternType": a["patternType"],
                "totalMoved": a["totalMoved"],
                "timeSpan": a["timeSpan"],
                "hops": a["hops"],
                "node_count": len(nodes),
                "txn_count": len(a["transactions"]),
                "source": a.get("source", "labelled"),
                "nodes": [{"bank": b} for b in banks[:3]],
            })

    return JSONResponse(content=results, headers={"Cache-Control": "no-store"})


@router.get("/alerts/suppressed")
@limiter.limit("50/minute")
def list_suppressed(request: Request):
    """List suppressed alerts (Issue #1: rate limited)."""
    with state.ALERTS_LOCK:
        return list(state.SUPPRESSED.values())


@router.get("/alerts/{alert_id}")
@limiter.limit("100/minute")
def get_alert(request: Request, alert_id: str):
    """Retrieve a single alert (Issue #10: thread-safe access)."""
    with state.ALERTS_LOCK:
        if alert_id not in state.ALERTS:
            raise HTTPException(status_code=404, detail="Alert not found")
        return state.ALERTS[alert_id]


@router.post("/alerts/{alert_id}/decision")
@limiter.limit("50/minute")
def post_decision(request: Request, alert_id: str, body: DecisionBody):
    """Record analyst decision (Issue #1, #10)."""
    with state.ALERTS_LOCK:
        if alert_id not in state.ALERTS:
            raise HTTPException(status_code=404, detail="Alert not found")

    db.record_decision(alert_id, body.decision.value, body.reason, body.analyst)

    with state.ALERTS_LOCK:
        state.DECISIONS[alert_id] = {
            "decision": body.decision.value,
            "reason": body.reason,
            "analyst": body.analyst,
        }

    return {
        "status": "saved",
        "alert_id": alert_id,
        "decision": body.decision.value,
    }


@router.get("/alerts/{alert_id}/decision/history")
@limiter.limit("100/minute")
def get_decision_history(request: Request, alert_id: str):
    """Chronological audit trail (Issue #1)."""
    with state.ALERTS_LOCK:
        if alert_id not in state.ALERTS:
            raise HTTPException(status_code=404, detail="Alert not found")

    return {"alert_id": alert_id, "history": db.decision_history(alert_id)}


@router.get("/decisions")
@limiter.limit("50/minute")
def get_decisions(request: Request):
    """Current decision state (Issue #1)."""
    return db.current_decisions()
