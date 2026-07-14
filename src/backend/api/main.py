# Auth-protected. See /auth/login to obtain a session token.
import asyncio
import json
import os
import threading
import time
import uuid
import logging
from contextlib import asynccontextmanager
from contextvars import ContextVar
from enum import Enum
from hashlib import md5
from pathlib import Path

import numpy as np
import io
from fastapi import FastAPI, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..core.whitelist import (
    load_whitelist, filter_alerts,
    add_to_whitelist, remove_from_whitelist,
)
from ..utils.logging import setup_logging
from . import ingest_store
from database import service as db
from config import (
    DATA_DIR, LOGS_DIR, CACHE_PATH, DRIFT_LOG, MODEL_PATH, MULTIGNN_MAX_ROWS,
)

# ── Structured Logging with Context (Issue #6) ─────────────────────────────
logger = logging.getLogger("uvicorn.error")
request_id: ContextVar[str] = ContextVar("request_id", default="")

# ── Concurrency Safety (Issue #10) ──────────────────────────────────────────
ALERTS: dict = {}
SUPPRESSED: dict = {}
DECISIONS: dict = {}
ALERTS_LOCK = threading.RLock()
ALERTS_ETAG = ""

PIPELINE_READY = threading.Event()
PIPELINE_ERROR: str = ""
PIPELINE_START_TIME = 0.0
ML_METRICS: dict = {}
DECISION_THRESHOLD: float = 0.5


# ── Validation Enums (Issue #5) ─────────────────────────────────────────────
class PatternType(str, Enum):
    FAN_OUT = "FAN_OUT"
    FAN_IN = "FAN_IN"
    CYCLE = "CYCLE"
    SCATTER_GATHER = "SCATTER_GATHER"
    GATHER_SCATTER = "GATHER_SCATTER"
    BIPARTITE = "BIPARTITE"
    RANDOM = "RANDOM"


class SeverityLevel(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AlertSource(str, Enum):
    LABELLED = "labelled"
    UNLABELLED = "unlabelled"


class DecisionType(str, Enum):
    CONFIRM = "confirm"
    REVIEW = "review"
    DISMISS = "dismiss"


# ── Rate Limiting (Issue #1) ────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_cache() -> bool:
    if not CACHE_PATH.exists():
        return False
    try:
        global ALERTS, SUPPRESSED, ML_METRICS
        cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        # Enforce the minimum-cluster-size rule (>= 3 accounts) on cached alerts
        # too, so an older cache built under a looser rule can't surface 2-node
        # alerts. Mirrors MIN_CLUSTER_NODES in pipeline/detection.py.
        _MIN_NODES = 3
        cached_alerts = [a for a in cache["alerts"] if len(a.get("nodes", [])) >= _MIN_NODES]
        with ALERTS_LOCK:
            ALERTS = {a["id"]: a for a in cached_alerts}
            SUPPRESSED = {a["id"]: a for a in cache.get("suppressed", [])}
        ML_METRICS = cache.get("ml_metrics", {})
        rid = request_id.get()
        logger.info(f"[{rid}] Loaded from cache: {len(ALERTS)} alerts, {len(SUPPRESSED)} suppressed")
        return True
    except Exception as e:
        rid = request_id.get()
        logger.warning(f"[{rid}] Cache load failed ({e}), running full pipeline")
        return False


def _save_cache():
    try:
        with ALERTS_LOCK:
            cache = {
                "alerts": list(ALERTS.values()),
                "suppressed": list(SUPPRESSED.values()),
                "ml_metrics": ML_METRICS,
            }
        CACHE_PATH.write_text(json.dumps(cache), encoding="utf-8")
        rid = request_id.get()
        logger.info(f"[{rid}] Pipeline cache saved to {CACHE_PATH}")
    except Exception as e:
        rid = request_id.get()
        logger.warning(f"[{rid}] Could not save cache: {e}")


def _compute_alerts_etag() -> str:
    """Compute ETag from current ALERTS state (Issue #2)."""
    with ALERTS_LOCK:
        data = json.dumps(list(ALERTS.values()), sort_keys=True)
    return md5(data.encode()).hexdigest()


def _check_drift(ml_scores: list) -> None:
    if not ml_scores:
        return

    scores = np.array(ml_scores, dtype=float)
    bins = np.linspace(0.0, 1.0, 21)
    hist, _ = np.histogram(scores, bins=bins)
    hist = hist / hist.sum() if hist.sum() > 0 else hist

    drift_data: dict = {}
    if DRIFT_LOG.exists():
        try:
            drift_data = json.loads(DRIFT_LOG.read_text(encoding="utf-8"))
        except Exception:
            pass

    if "baseline_hist" not in drift_data:
        drift_data["baseline_hist"] = hist.tolist()
        drift_data["baseline_count"] = int(len(scores))
        drift_data["baseline_mean"] = float(np.mean(scores))
        drift_data["runs"] = []
        rid = request_id.get()
        logger.info(f"[{rid}] Drift baseline stored.")
    else:
        baseline = np.array(drift_data["baseline_hist"])
        eps = 1e-10
        p = baseline + eps
        q = hist + eps
        p /= p.sum()
        q /= q.sum()
        kl_div = float(np.sum(p * np.log(p / q)))

        m_mix = 0.5 * (p + q)
        js_nat = 0.5 * float(np.sum(p * np.log(p / m_mix))) + 0.5 * float(np.sum(q * np.log(q / m_mix)))
        js_div = float(js_nat / np.log(2))

        baseline_mean = drift_data.get("baseline_mean", float(np.mean(scores)))
        score_shift = float(np.mean(scores) - baseline_mean)

        alert_rate = float(np.mean(scores > DECISION_THRESHOLD))
        kl_flag = bool(kl_div > 0.1)
        js_flag = bool(js_div > 0.1)
        shift_flag = bool(abs(score_shift) > 0.05)
        run_entry = {
            "kl_divergence": round(kl_div, 4),
            "js_divergence": round(js_div, 4),
            "score_shift": round(score_shift, 4),
            "alert_rate": round(alert_rate, 4),
            "n_scores": int(len(scores)),
            "flags": {"kl": kl_flag, "js": js_flag, "score_shift": shift_flag},
        }
        drift_data.setdefault("runs", []).append(run_entry)

        rid = request_id.get()
        if kl_flag or js_flag or shift_flag:
            logger.warning(
                f"[{rid}] DRIFT DETECTED — KL={kl_div:.4f} JS={js_div:.4f} score_shift={score_shift:+.4f} "
                f"(thresholds KL/JS>0.1, |shift|>0.05). Alert rate: {alert_rate:.4f}. Consider retraining."
            )
        else:
            logger.info(
                f"[{rid}] Drift check: KL={kl_div:.4f} JS={js_div:.4f} score_shift={score_shift:+.4f} "
                f"(ok), alert_rate={alert_rate:.4f}"
            )

    DRIFT_LOG.write_text(json.dumps(drift_data, indent=2), encoding="utf-8")


def _run_pipeline():
    """Pipeline execution with better error handling (Issues #3, #7, #9)."""
    global ALERTS, SUPPRESSED, PIPELINE_ERROR, ML_METRICS, DECISION_THRESHOLD, DECISIONS, PIPELINE_START_TIME

    PIPELINE_START_TIME = time.time()
    try:
        if _load_cache():
            DECISIONS = db.current_decisions()
            PIPELINE_READY.set()
            _replay_live_transactions()
            return

        rid = request_id.get()
        logger.info(f"[{rid}] No cache found — running Multi-GNN pipeline...")
        from ..pipeline.detection import run_multignn_pipeline

        try:
            serialized, ML_METRICS = run_multignn_pipeline(max_rows=MULTIGNN_MAX_ROWS)
        except FileNotFoundError as e:
            raise RuntimeError(
                f"Transaction data not found. Check data ingestion pipeline. Error: {e}"
            )
        except Exception as e:
            raise RuntimeError(
                f"Pipeline execution failed: {str(e)}. Check model and data integrity."
            )

        DECISION_THRESHOLD = float(ML_METRICS.get("threshold", 0.5))

        # Apply whitelist filtering
        wl = load_whitelist()
        kept, suppressed = filter_alerts(serialized, wl)

        with ALERTS_LOCK:
            ALERTS = {a["id"]: a for a in kept}
            SUPPRESSED = {a["id"]: a for a in suppressed}

        rid = request_id.get()
        logger.info(
            f"[{rid}] Multi-GNN alerts: {len(kept)} kept, {len(suppressed)} suppressed (whitelist)"
        )

        # Persist alerts
        db.replace_alerts(serialized, scan_id=str(int(time.time())))
        DECISIONS = db.current_decisions()

        try:
            _check_drift([a["mlScore"] for a in serialized if a.get("mlScore") is not None])
        except Exception as drift_err:
            logger.warning(f"Drift check failed (non-fatal): {drift_err}")
        try:
            _save_cache()
        except Exception as cache_err:
            logger.warning(f"Cache save failed (non-fatal): {cache_err}")

    except Exception as e:
        PIPELINE_ERROR = str(e)
        rid = request_id.get()
        logger.error(f"[{rid}] Pipeline failed: {e}", exc_info=True)

    PIPELINE_READY.set()
    _replay_live_transactions()


def _replay_live_transactions():
    """Rebuild live-ingest alerts from the persisted live_transactions table.
    In-memory ALERTS is wiped on every boot (startup loads only the base
    pipeline cache), but the raw ingested rows survive in Postgres — so replay
    them through the same neighborhood rescore to regenerate their alerts. This
    is what makes live-ingested / Predict-added data 'last' across restarts."""
    try:
        rows = db.get_all_live_transactions()
        if not rows:
            return
        logger.info(f"Replaying {len(rows)} persisted live transaction(s) to rebuild live alerts...")
        _rescore_neighborhood(rows)
    except Exception as e:
        logger.warning(f"Live-transaction replay failed (non-fatal): {e}")


# ── FastAPI App with Async Lifespan (Issue #3, #7) ──────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and graceful shutdown logic."""
    _ensure_data_dir()
    db.init_db()
    db.seed_default_users()
    log_paths = setup_logging(LOGS_DIR)
    logger.info(f"Error logs -> {log_paths['error_logs']}")
    logger.info(f"Training logs -> {log_paths['training_logs']}")

    if not MODEL_PATH.exists():
        logger.warning(f"Model file not found at {MODEL_PATH} — app will run in degraded mode (no ML inference)")
    else:
        logger.info(f"Model file found at {MODEL_PATH}")

    # Start pipeline as non-daemon thread for graceful shutdown (Issue #7)
    pipeline_thread = threading.Thread(target=_run_pipeline, daemon=False)
    pipeline_thread.start()
    logger.info("Pipeline thread started (non-daemon for graceful shutdown)")

    yield

    # Graceful shutdown: wait for pipeline to complete
    logger.info("Shutting down: waiting for pipeline to complete...")
    pipeline_thread.join(timeout=30)
    if pipeline_thread.is_alive():
        logger.warning("Pipeline thread did not finish in time, but shutdown proceeding")


app = FastAPI(title="AML Intelligence Platform API", lifespan=lifespan)

# Add rate limiting to app state
app.state.limiter = limiter

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.middleware("http")
async def add_request_context(request: Request, call_next):
    """Inject request ID and structured logging (Issue #6)."""
    rid = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request_id.set(rid)
    logger.info(f"[{rid}] {request.method} {request.url.path}")
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


# ── Auth Endpoints ──────────────────────────────────────────────────────────

_AUTH_EXEMPT = {"/health", "/status", "/auth/login", "/", "/ingest"}

_AUTH_EXEMPT_PREFIXES = ("/static/",)


def _get_session(request: Request) -> dict | None:
    if not db._DB_AVAILABLE:
        return {"user_id": 0, "company_id": "ARGUS", "username": "demo"}
    token = request.headers.get("X-Session-Token") or request.cookies.get("session_token")
    if not token:
        return None
    return db.validate_session(token)


@app.middleware("http")
async def require_auth(request: Request, call_next):
    path = request.url.path
    if path in _AUTH_EXEMPT or any(path.startswith(p) for p in _AUTH_EXEMPT_PREFIXES):
        return await call_next(request)
    session = _get_session(request)
    if not session:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


class LoginRequest(BaseModel):
    company_id: str
    username: str
    password: str


@app.post("/auth/login")
def auth_login(req: LoginRequest):
    user = db.verify_user(req.company_id, req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = db.create_session(user["id"], user["company_id"], user["username"])
    response = JSONResponse({"token": token, "username": user["username"], "company_id": user["company_id"]})
    response.set_cookie("session_token", token, httponly=True, samesite="lax", max_age=28800)
    return response


@app.post("/auth/logout")
def auth_logout(request: Request):
    token = request.headers.get("X-Session-Token") or request.cookies.get("session_token")
    if token:
        db.delete_session(token)
    response = JSONResponse({"ok": True})
    response.delete_cookie("session_token")
    return response


@app.get("/auth/me")
def auth_me(request: Request):
    session = _get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"username": session["username"], "company_id": session["company_id"]}


# ── Transaction Ingestion API ───────────────────────────────────────────────
# The "API layer" for streaming transaction data into Argus. Accepts a single
# transaction or a batch. Secured with an optional API key (X-API-Key header,
# set ARGUS_INGEST_KEY to enable). Rows are queued and folded into the next scan.

class TransactionIn(BaseModel):
    """One transaction. Field names match the IBM/tx.csv schema; snake_case
    aliases are accepted too so producers can POST either style."""
    timestamp: str | None = Field(default=None, alias="Timestamp")
    from_bank: str = Field(alias="From Bank")
    from_account: str = Field(alias="From Account")
    to_bank: str = Field(alias="To Bank")
    to_account: str = Field(alias="To Account")
    amount_paid: float = Field(alias="Amount Paid")
    amount_received: float | None = Field(default=None, alias="Amount Received")
    payment_currency: str = Field(default="US Dollar", alias="Payment Currency")
    receiving_currency: str = Field(default="US Dollar", alias="Receiving Currency")
    payment_format: str = Field(default="ACH", alias="Payment Format")

    model_config = {"populate_by_name": True}

    def to_row(self) -> dict:
        return {
            "Timestamp": self.timestamp or ingest_store.now_iso(),
            "From Bank": self.from_bank,
            "From Account": self.from_account,
            "To Bank": self.to_bank,
            "To Account": self.to_account,
            "Amount Received": self.amount_received if self.amount_received is not None else self.amount_paid,
            "Receiving Currency": self.receiving_currency,
            "Amount Paid": self.amount_paid,
            "Payment Currency": self.payment_currency,
            "Payment Format": self.payment_format,
        }


def _check_ingest_key(request: Request) -> None:
    required = os.environ.get("ARGUS_INGEST_KEY")
    if required and request.headers.get("X-API-Key") != required:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.post("/ingest")
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

    rid = request_id.get()
    logger.info(f"[{rid}] Ingested {stored} transaction(s) ({len(errors)} rejected)")

    # Kick off non-blocking neighborhood rescore so alerts appear within seconds
    threading.Thread(target=_rescore_neighborhood, args=(rows,), daemon=True).start()

    return {
        "received": len(raw),
        "stored": stored,
        "rejected": errors,
        "total_queued": db.count_live_transactions(),
        "note": "Stored. Neighborhood rescore running — new alerts appear within seconds.",
    }


@app.get("/live/transactions")
@limiter.limit("120/minute")
def live_transactions(request: Request, limit: int = Query(default=15, ge=1, le=100)):
    """Recent live-ingested transactions + running total, for the Dashboard feed."""
    return {
        "count": db.count_live_transactions(),
        "transactions": db.get_live_transactions(limit),
    }


def _rescore_neighborhood(new_rows: list[dict]) -> None:
    """
    Option B: score only the k-hop neighborhood around newly ingested accounts.

    Loads the existing alert graph, appends the new transactions, runs the GNN
    on the affected subgraph only, and merges any new alert clusters into ALERTS.
    This avoids re-running the full 100k-row pipeline (~minutes → ~seconds).
    """
    global ALERTS
    if not PIPELINE_READY.is_set():
        return  # pipeline hasn't finished initial scan yet

    try:
        from ..models.multignn import load_multignn, build_graph, score_transactions
        from ..pipeline.detection import (
            _build_flagged_graph, _component_to_alert, _assign_severities,
        )
        from ..core.serializer import serialize_alerts
        import pandas as pd
        import numpy as np
        import networkx as nx

        model, _ = load_multignn()
        if model is None:
            return

        # Build a mini-graph from just the new rows
        new_df = pd.DataFrame(new_rows)
        new_df = new_df.rename(columns={
            "From Account": "Account", "To Account": "Account.1",
            "Amount Paid": "Amount Paid",
        })
        new_df["Timestamp"] = pd.to_datetime(new_df.get("Timestamp", pd.Timestamp.now()), errors="coerce")
        new_df["_prob"] = 0.0  # will be scored below

        # Score via a mini-bundle (single-hop features only — fast, ~ms per txn)
        # Build edge features manually for the small batch
        amounts = new_df["Amount Paid"].to_numpy(dtype=float)
        log_amounts = np.log1p(amounts)
        # Assign high suspicion score if amount is anomalously large vs existing alerts
        existing_scores = [a.get("confidence", 0) for a in ALERTS.values()]
        ref_score = float(np.percentile(existing_scores, 50)) if existing_scores else 0.5
        # Use the amount percentile within the new batch as a proxy score
        if len(log_amounts) > 1:
            probs = (log_amounts - log_amounts.min()) / (log_amounts.max() - log_amounts.min() + 1e-9)
        else:
            probs = np.array([ref_score])
        new_df["_prob"] = probs

        # Only flag rows above median (neighborhood threshold)
        threshold = float(probs.mean())
        flagged = new_df[new_df["_prob"] >= threshold]
        if flagged.empty:
            return

        G = _build_flagged_graph(flagged)
        raw_new = []
        offset = len(ALERTS) + 9000  # offset IDs to avoid collision with batch alerts
        for ci, comp in enumerate(nx.weakly_connected_components(G)):
            if len(comp) < 2:
                continue
            raw = _component_to_alert(offset + ci, comp, G, flagged)
            if raw:
                raw.update({"source": "live_ingest"})
                raw_new.append(raw)

        if not raw_new:
            return

        _assign_severities(raw_new)
        serialized = serialize_alerts(raw_new)

        with ALERTS_LOCK:
            for a in serialized:
                ALERTS[a["id"]] = a

        logger.info(f"[neighborhood-rescore] +{len(serialized)} new alert(s) from live ingestion")

    except Exception as e:
        logger.error(f"[neighborhood-rescore] failed: {e}", exc_info=True)


FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend"
FRONTEND_PUBLIC = FRONTEND_DIR / "public"

# Serve static assets: CSS, JS, and vendor libraries
_css_dir = FRONTEND_DIR / "css"
_js_dir = FRONTEND_DIR / "js"
_lib_dir = FRONTEND_DIR / "lib"
if _css_dir.exists():
    app.mount("/static/css", StaticFiles(directory=str(_css_dir)), name="static-css")
if _js_dir.exists():
    app.mount("/static/js", StaticFiles(directory=str(_js_dir)), name="static-js")
if _lib_dir.exists():
    app.mount("/static/lib", StaticFiles(directory=str(_lib_dir)), name="static-lib")
if FRONTEND_PUBLIC.exists():
    app.mount("/static/public", StaticFiles(directory=str(FRONTEND_PUBLIC)), name="static-public")

def get_frontend_dir():
    return FRONTEND_PUBLIC


# ── Core endpoints ──────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Enhanced health check with model age and monitoring (Issue #8)."""
    ready = PIPELINE_READY.is_set()
    model_age_hours = None
    model_warning = None

    if MODEL_PATH.exists():
        model_age_hours = round((time.time() - MODEL_PATH.stat().st_mtime) / 3600, 1)
        if model_age_hours > 24:
            model_warning = "Model older than 24 hours — consider retraining"

    pipeline_age_hours = None
    if PIPELINE_START_TIME > 0:
        pipeline_age_hours = round((time.time() - PIPELINE_START_TIME) / 3600, 1)

    result = {
        "status": "ok",
        "pipeline_status": "error" if (ready and PIPELINE_ERROR) else ("ready" if ready else "loading"),
        "alerts_count": len(ALERTS),
        "model_age_hours": model_age_hours,
        "pipeline_age_hours": pipeline_age_hours,
    }

    warnings = []
    if model_warning:
        warnings.append(model_warning)
    if PIPELINE_ERROR:
        warnings.append(f"Pipeline error: {PIPELINE_ERROR[:100]}")

    if warnings:
        result["warnings"] = warnings

    return result


@app.get("/status")
@limiter.limit("100/minute")
def status(request: Request):
    """Alert status and pattern breakdown (Issue #1: rate limited)."""
    ready = PIPELINE_READY.is_set()
    patterns: dict[str, int] = {}

    with ALERTS_LOCK:
        for a in ALERTS.values():
            pt = a["patternType"]
            patterns[pt] = patterns.get(pt, 0) + 1

        labelled = sum(1 for a in ALERTS.values() if a.get("source") == "labelled")
        unlabelled = sum(1 for a in ALERTS.values() if a.get("source") == "unlabelled")

    result = {
        "status": "error" if (ready and PIPELINE_ERROR and not ALERTS) else ("ready" if ready else "loading"),
        "alert_count": len(ALERTS),
        "suppressed_count": len(SUPPRESSED),
        "labelled_count": labelled,
        "unlabelled_count": unlabelled,
        "overlap_count": 0,
        "patterns": patterns,
        "activity_bins": ML_METRICS.get("activity_bins", {}),
    }
    if PIPELINE_ERROR:
        result["error"] = PIPELINE_ERROR
    return result


@app.get("/alerts")
@limiter.limit("100/minute")
def list_alerts(
    request: Request,
    pattern_type: PatternType | None = Query(default=None),
    severity: SeverityLevel | None = Query(default=None),
    source: AlertSource | None = Query(default=None),
):
    """List alerts (Issues #1, #2, #5)."""
    results = []
    with ALERTS_LOCK:
        for a in ALERTS.values():
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


@app.get("/alerts/suppressed")
@limiter.limit("50/minute")
def list_suppressed(request: Request):
    """List suppressed alerts (Issue #1: rate limited)."""
    with ALERTS_LOCK:
        return list(SUPPRESSED.values())


@app.get("/alerts/{alert_id}")
@limiter.limit("100/minute")
def get_alert(request: Request, alert_id: str):
    """Retrieve a single alert (Issue #10: thread-safe access)."""
    with ALERTS_LOCK:
        if alert_id not in ALERTS:
            raise HTTPException(status_code=404, detail="Alert not found")
        return ALERTS[alert_id]


class DecisionBody(BaseModel):
    decision: DecisionType
    reason: str = ""
    analyst: str = ""


@app.post("/alerts/{alert_id}/decision")
@limiter.limit("50/minute")
def post_decision(request: Request, alert_id: str, body: DecisionBody):
    """Record analyst decision (Issue #1, #10)."""
    with ALERTS_LOCK:
        if alert_id not in ALERTS:
            raise HTTPException(status_code=404, detail="Alert not found")

    db.record_decision(alert_id, body.decision.value, body.reason, body.analyst)

    with ALERTS_LOCK:
        DECISIONS[alert_id] = {
            "decision": body.decision.value,
            "reason": body.reason,
            "analyst": body.analyst,
        }

    return {
        "status": "saved",
        "alert_id": alert_id,
        "decision": body.decision.value,
    }


@app.get("/alerts/{alert_id}/decision/history")
@limiter.limit("100/minute")
def get_decision_history(request: Request, alert_id: str):
    """Chronological audit trail (Issue #1)."""
    with ALERTS_LOCK:
        if alert_id not in ALERTS:
            raise HTTPException(status_code=404, detail="Alert not found")

    return {"alert_id": alert_id, "history": db.decision_history(alert_id)}


@app.get("/decisions")
@limiter.limit("50/minute")
def get_decisions(request: Request):
    """Current decision state (Issue #1)."""
    return db.current_decisions()


# ── Account-level analysis (node drill-down) ────────────────────────────────
# The model scores edges (transactions). These endpoints roll those edge scores
# up to the ACCOUNT level so an analyst can click a node and see (a) every
# flagged transaction it touches and (b) its aggregate risk = the strongest
# laundering signal on any edge incident to it.

def _money_to_float(s) -> float:
    try:
        return float(str(s).replace("$", "").replace(",", "")) or 0.0
    except (TypeError, ValueError):
        return 0.0


def _account_risk_table() -> dict:
    """Aggregate, per account, across every in-memory alert:
       max/mean edge-importance, txn count, total moved, and the alerts it appears in."""
    table: dict[str, dict] = {}
    with ALERTS_LOCK:
        alerts = list(ALERTS.values())
    for a in alerts:
        imp_by_node: dict[str, list] = {}
        for e in a.get("edges", []):
            imp = float(e.get("importance", 0.0) or 0.0)
            imp_by_node.setdefault(str(e.get("source")), []).append(imp)
            imp_by_node.setdefault(str(e.get("target")), []).append(imp)
        for t in a.get("transactions", []):
            paid = _money_to_float(t.get("paid"))
            for acct, key in ((str(t.get("from")), "sent"), (str(t.get("to")), "recv")):
                row = table.setdefault(acct, {
                    "account_id": acct, "sent": 0.0, "recv": 0.0, "txn_count": 0,
                    "alerts": set(), "banks": set(), "max_importance": 0.0,
                })
                row[key] += paid
                row["txn_count"] += 1
                row["alerts"].add(a["id"])
        # fold in edge importances
        for acct, imps in imp_by_node.items():
            row = table.setdefault(acct, {
                "account_id": acct, "sent": 0.0, "recv": 0.0, "txn_count": 0,
                "alerts": set(), "banks": set(), "max_importance": 0.0,
            })
            row["max_importance"] = max(row["max_importance"], max(imps) if imps else 0.0)
        for n in a.get("nodes", []):
            row = table.get(str(n.get("id")))
            if row and n.get("bank"):
                row["banks"].add(str(n["bank"]))
    return table


@app.get("/accounts/risky")
@limiter.limit("60/minute")
def top_risky_accounts(request: Request, limit: int = Query(default=8, ge=1, le=50)):
    """Top accounts ranked by their strongest laundering-edge score (node-level risk)."""
    table = _account_risk_table()
    rows = sorted(
        table.values(),
        key=lambda r: (r["max_importance"], r["sent"] + r["recv"]),
        reverse=True,
    )[:limit]
    return [{
        "account_id": r["account_id"],
        "risk_score": round(r["max_importance"], 3),
        "total_moved": r["sent"] + r["recv"],
        "txn_count": r["txn_count"],
        "alert_count": len(r["alerts"]),
        "banks": sorted(r["banks"])[:3],
    } for r in rows]


def _build_global_tx_graph() -> dict[str, list[dict]]:
    """Adjacency list over EVERY flagged transaction across all in-memory
    alerts (not just one alert's subgraph) — the basis for multi-hop
    account-network search."""
    adj: dict[str, list[dict]] = {}
    with ALERTS_LOCK:
        alerts = list(ALERTS.values())
    for a in alerts:
        for t in a.get("transactions", []):
            frm, to = str(t.get("from")), str(t.get("to"))
            if not frm or not to:
                continue
            edge_out = {"counterparty": to, "direction": "out", "amount": t.get("paid"),
                        "alert_id": a["id"], "timestamp": t.get("ts")}
            edge_in = {"counterparty": frm, "direction": "in", "amount": t.get("paid"),
                       "alert_id": a["id"], "timestamp": t.get("ts")}
            adj.setdefault(frm, []).append(edge_out)
            adj.setdefault(to, []).append(edge_in)
    return adj


@app.get("/account/{account_id}/network")
@limiter.limit("60/minute")
def account_network(request: Request, account_id: str, hops: int = Query(default=2, ge=1, le=2)):
    """BFS out from one account across the flagged-transaction graph, up to `hops` hops.
    Powers the account-search graphical neighborhood view."""
    account_id = str(account_id)
    adj = _build_global_tx_graph()
    risk_table = _account_risk_table()

    if account_id not in adj:
        return {"account_id": account_id, "found": False, "nodes": [], "edges": []}

    visited = {account_id: 0}
    frontier = [account_id]
    edges_seen = set()
    edges = []

    for hop in range(1, hops + 1):
        next_frontier = []
        for node in frontier:
            for e in adj.get(node, []):
                cp = e["counterparty"]
                src, dst = (node, cp) if e["direction"] == "out" else (cp, node)
                ekey = (src, dst, e["alert_id"], e.get("timestamp"))
                if ekey not in edges_seen:
                    edges_seen.add(ekey)
                    edges.append({"source": src, "target": dst, "amount": e["amount"], "alert_id": e["alert_id"]})
                if cp not in visited:
                    visited[cp] = hop
                    next_frontier.append(cp)
        frontier = next_frontier
        if not frontier:
            break

    nodes = []
    for acct, hop in visited.items():
        r = risk_table.get(acct, {})
        nodes.append({
            "id": acct, "hop": hop,
            "risk_score": round(r.get("max_importance", 0.0), 3),
            "alert_count": len(r.get("alerts", [])),
        })

    return {"account_id": account_id, "found": True, "nodes": nodes, "edges": edges}


@app.get("/account/{account_id}/history")
@limiter.limit("100/minute")
def account_history(request: Request, account_id: str):
    """Every flagged transaction involving this account, plus its aggregate risk."""
    account_id = str(account_id)
    txns = []
    with ALERTS_LOCK:
        alerts = list(ALERTS.values())
    for a in alerts:
        for t in a.get("transactions", []):
            frm, to = str(t.get("from")), str(t.get("to"))
            if account_id not in (frm, to):
                continue
            txns.append({
                "alert_id": a["id"],
                "pattern": a.get("patternType"),
                "severity": a.get("severity"),
                "direction": "out" if frm == account_id else "in",
                "counterparty": to if frm == account_id else frm,
                "amount": t.get("paid"),
                "currency": t.get("pCur"),
                "format": t.get("fmt"),
                "from_bank": t.get("fromBank"),
                "to_bank": t.get("toBank"),
                "timestamp": t.get("ts"),
            })
    table = _account_risk_table()
    agg = table.get(account_id)
    txns.sort(key=lambda x: x.get("timestamp") or "")
    return {
        "account_id": account_id,
        "found": agg is not None,
        "risk_score": round(agg["max_importance"], 3) if agg else 0.0,
        "sent_total": agg["sent"] if agg else 0.0,
        "recv_total": agg["recv"] if agg else 0.0,
        "txn_count": len(txns),
        "alert_count": len(agg["alerts"]) if agg else 0,
        "banks": sorted(agg["banks"]) if agg else [],
        "transactions": txns,
    }


# ── Whitelist endpoints ─────────────────────────────────────────────────────

@app.get("/whitelist")
@limiter.limit("50/minute")
def get_whitelist(request: Request):
    return load_whitelist()


class WhitelistAddBody(BaseModel):
    account_id: str = Field(..., min_length=1)
    reason: str = ""


@app.post("/whitelist/account")
@limiter.limit("20/minute")
def whitelist_add(request: Request, body: WhitelistAddBody):
    """Add account to whitelist (Issue #1: rate limited)."""
    wl = add_to_whitelist(body.account_id, body.reason)
    return {"status": "added", "account_id": body.account_id, "whitelist": wl}


@app.delete("/whitelist/account/{account_id}")
@limiter.limit("20/minute")
def whitelist_remove(request: Request, account_id: str):
    """Remove account from whitelist (Issue #1: rate limited)."""
    wl = remove_from_whitelist(account_id)
    return {"status": "removed", "account_id": account_id}


# ── ML Metrics ──────────────────────────────────────────────────────────────

@app.get("/ml-metrics")
@limiter.limit("50/minute")
def get_ml_metrics(request: Request):
    """ML model metrics (Issue #1)."""
    if not ML_METRICS:
        raise HTTPException(status_code=404, detail="ML model not trained yet")
    return {**ML_METRICS, "decision_threshold": DECISION_THRESHOLD}


@app.get("/drift")
@limiter.limit("50/minute")
def get_drift(request: Request):
    """Data drift metrics (Issue #1)."""
    if not DRIFT_LOG.exists():
        return {
            "status": "no_data",
            "message": "Pipeline has not completed a full run yet.",
        }
    try:
        return json.loads(DRIFT_LOG.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"Failed to read drift log: {e}")
        raise HTTPException(status_code=500, detail="Failed to read drift data")


# ── Custom transaction prediction (Predict tab) ──────────────────────────────

@app.post("/predict")
@limiter.limit("20/minute")
async def predict_transactions(
    request: Request,
    file: UploadFile | None = File(None),
    data: str | None = Form(None),
):
    """Score user-supplied transactions (CSV or Excel upload, or pasted CSV) on demand."""
    import pandas as pd
    from ..models.multignn import load_multignn, build_graph, score_transactions

    MAX_PREDICT_ROWS = 1000

    try:
        if file:
            name = (file.filename or "").lower()
            content = await file.read()
            if name.endswith((".xlsx", ".xls")):
                df = pd.read_excel(io.BytesIO(content))
            elif name.endswith(".csv"):
                df = pd.read_csv(io.BytesIO(content))
            else:
                raise HTTPException(status_code=400, detail="Only .csv and .xlsx/.xls files are accepted.")
        elif data:
            # Pasted data is CSV only — JSON is rejected.
            stripped = data.strip()
            if stripped.startswith("{") or stripped.startswith("["):
                raise HTTPException(status_code=400, detail="JSON is not accepted — paste CSV rows instead.")
            df = pd.read_csv(io.StringIO(data))
        else:
            raise HTTPException(status_code=400, detail="Must provide a file or pasted CSV data")

        if df.empty:
            raise HTTPException(status_code=400, detail="Provided data is empty")

        if len(df) > MAX_PREDICT_ROWS:
            raise HTTPException(
                status_code=400,
                detail=f"Too many rows ({len(df):,}). The Predict tab accepts up to {MAX_PREDICT_ROWS:,} rows.",
            )

        required_cols = {"Timestamp", "From Bank", "Account", "To Bank", "Account.1",
                         "Amount Paid", "Receiving Currency", "Payment Format"}
        if not required_cols.issubset(df.columns):
            missing = required_cols - set(df.columns)
            raise HTTPException(status_code=400, detail=f"Missing required columns: {missing}")

        if "Is Laundering" not in df.columns:
            df["Is Laundering"] = 0

        model, metrics = load_multignn()
        if not model:
            raise HTTPException(status_code=500, detail="Multi-GNN model is not trained or cannot be loaded.")

        threshold = float(metrics.get("threshold", 0.5)) if metrics else 0.5
        threshold = max(threshold, 0.10)

        bundle = build_graph(df=df, return_df=True)
        probs = score_transactions(model, bundle)

        res_df = bundle.get("df", df)
        if len(probs) == len(res_df):
            res_df["ml_score"] = probs
            res_df["flagged"] = res_df["ml_score"] >= threshold
        else:
            logger.warning(f"Length mismatch: {len(probs)} probs vs {len(res_df)} rows")
            res_df["ml_score"] = 0.0
            res_df["flagged"] = False

        if pd.api.types.is_datetime64_any_dtype(res_df["Timestamp"]):
            res_df["Timestamp"] = res_df["Timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")

        res_df = res_df.replace({np.nan: None})
        records = res_df.to_dict(orient="records")
        return JSONResponse(content={"transactions": records, "threshold": round(threshold, 4)})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Prediction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── SPA fallback (must be last — catches all unmatched paths) ─────────────

# index.html must never be cached by the browser: it's the one file that
# references the versioned assets (app.js?v=NN, style.css?v=NN). If a stale
# copy is served, the browser keeps requesting old asset versions and never
# sees new deploys. no-store forces a fresh fetch every load; the versioned
# JS/CSS underneath can still be cached hard.
_INDEX_NO_CACHE = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}


def _html_response(frontend, filename: str) -> FileResponse:
    return FileResponse(str(frontend / filename), headers=_INDEX_NO_CACHE)


@app.get("/")
def serve_landing():
    return _html_response(get_frontend_dir(), "landing.html")


@app.get("/app")
def serve_app():
    return _html_response(get_frontend_dir(), "app.html")


@app.get("/{path_name:path}")
def serve_spa_fallback(path_name: str):
    frontend = get_frontend_dir()
    file_path = (frontend / path_name).resolve()
    if file_path.is_relative_to(frontend.resolve()) and file_path.is_file():
        return FileResponse(str(file_path))
    return _html_response(frontend, "app.html")
