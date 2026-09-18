import json
import time

from fastapi import APIRouter, HTTPException, Request

from .. import state
from ..auth_deps import limiter
from config import DRIFT_LOG, MODEL_PATH

router = APIRouter()

# ── Core endpoints ──────────────────────────────────────────────────────────


@router.get("/health")
def health():
    """Enhanced health check with model age and monitoring (Issue #8)."""
    ready = state.PIPELINE_READY.is_set()
    model_age_hours = None
    model_warning = None

    if MODEL_PATH.exists():
        model_age_hours = round((time.time() - MODEL_PATH.stat().st_mtime) / 3600, 1)
        if model_age_hours > 24:
            model_warning = "Model older than 24 hours — consider retraining"

    pipeline_age_hours = None
    if state.PIPELINE_START_TIME > 0:
        pipeline_age_hours = round((time.time() - state.PIPELINE_START_TIME) / 3600, 1)

    result = {
        "status": "ok",
        "pipeline_status": "error" if (ready and state.PIPELINE_ERROR) else ("ready" if ready else "loading"),
        "alerts_count": len(state.ALERTS),
        "model_age_hours": model_age_hours,
        "pipeline_age_hours": pipeline_age_hours,
    }

    warnings = []
    if model_warning:
        warnings.append(model_warning)
    if state.PIPELINE_ERROR:
        warnings.append(f"Pipeline error: {state.PIPELINE_ERROR[:100]}")

    if warnings:
        result["warnings"] = warnings

    return result


@router.get("/status")
@limiter.limit("100/minute")
def status(request: Request):
    """Alert status and pattern breakdown (Issue #1: rate limited)."""
    ready = state.PIPELINE_READY.is_set()
    patterns: dict[str, int] = {}

    with state.ALERTS_LOCK:
        for a in state.ALERTS.values():
            pt = a["patternType"]
            patterns[pt] = patterns.get(pt, 0) + 1

        labelled = sum(1 for a in state.ALERTS.values() if a.get("source") == "labelled")
        unlabelled = sum(1 for a in state.ALERTS.values() if a.get("source") == "unlabelled")

    result = {
        "status": "error" if (ready and state.PIPELINE_ERROR and not state.ALERTS) else ("ready" if ready else "loading"),
        "alert_count": len(state.ALERTS),
        "suppressed_count": len(state.SUPPRESSED),
        "labelled_count": labelled,
        "unlabelled_count": unlabelled,
        "overlap_count": 0,
        "patterns": patterns,
        "activity_bins": state.ML_METRICS.get("activity_bins", {}),
    }
    if state.PIPELINE_ERROR:
        result["error"] = state.PIPELINE_ERROR
    return result


# ── ML Metrics ──────────────────────────────────────────────────────────────

@router.get("/ml-metrics")
@limiter.limit("50/minute")
def get_ml_metrics(request: Request):
    """ML model metrics (Issue #1)."""
    if not state.ML_METRICS:
        raise HTTPException(status_code=404, detail="ML model not trained yet")
    return {**state.ML_METRICS, "decision_threshold": state.DECISION_THRESHOLD}


@router.get("/drift")
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
        state.logger.error(f"Failed to read drift log: {e}")
        raise HTTPException(status_code=500, detail="Failed to read drift data")
