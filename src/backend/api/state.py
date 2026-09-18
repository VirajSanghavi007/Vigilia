# Auth-protected. See /auth/login to obtain a session token.
"""Shared mutable pipeline state and the background-thread machinery that
owns it. Imported by routers/main as `from . import state` so that reads and
writes all hit the same module-level dict objects rather than copies."""
import json
import logging
import threading
import time
from contextvars import ContextVar
from hashlib import md5

import numpy as np

from ..core.whitelist import load_whitelist, filter_alerts
from . import ingest_store
from database import service as db
from config import (
    DATA_DIR, CACHE_PATH, DRIFT_LOG, MULTIGNN_MAX_ROWS,
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

        # Build a mini-graph from just the new rows and score it with the
        # same trained Multi-GNN the batch pipeline uses — previously this
        # scored live transactions with an amount-percentile heuristic
        # (no model at all), which produced severities that weren't
        # comparable to batch-scored alerts.
        new_df = pd.DataFrame(new_rows)
        new_df["Timestamp"] = pd.to_datetime(new_df.get("Timestamp", pd.Timestamp.now()), errors="coerce")
        new_df["Is Laundering"] = 0  # unused at inference; build_graph requires the column

        if len(new_df) < 2:
            # A single-edge graph has no neighborhood structure to speak of;
            # the model needs at least a couple of edges to build a graph.
            return

        bundle = build_graph(df=new_df.copy(), return_df=True)
        probs = score_transactions(model, bundle)

        flagged_df = bundle["df"]
        flagged_df["_prob"] = probs

        # Only flag rows above the neighborhood-local mean (same policy as before)
        threshold = float(probs.mean())
        flagged = flagged_df[flagged_df["_prob"] >= threshold]
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

        # Persist immediately so other instances behind a load balancer (and
        # this one after a restart) see the alert without waiting on the
        # next full batch scan — previously these lived only in this
        # process's ALERTS dict until then.
        db.upsert_alerts(serialized)

        logger.info(f"[neighborhood-rescore] +{len(serialized)} new alert(s) from live ingestion")

    except Exception as e:
        logger.error(f"[neighborhood-rescore] failed: {e}", exc_info=True)
