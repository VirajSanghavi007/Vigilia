# Auth-protected. See /auth/login to obtain a session token.
import os
import threading
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ..utils.logging import setup_logging
from database import service as db
from config import DATA_DIR, LOGS_DIR, MODEL_PATH

from . import state
from .auth_deps import _AUTH_EXEMPT, _AUTH_EXEMPT_PREFIXES, _get_session, limiter
from .routers import accounts, alerts, auth, frontend, ingest, predict, system, whitelist

logger = state.logger
request_id = state.request_id


# ── FastAPI App with Async Lifespan (Issue #3, #7) ──────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and graceful shutdown logic."""
    if not os.environ.get("ARGUS_SECRET"):
        # Refuse to boot with an empty password pepper — an unset ARGUS_SECRET
        # would silently hash every password with "", making stored hashes
        # trivially crackable if the users table ever leaks.
        raise RuntimeError(
            "ARGUS_SECRET is not set. Refusing to start with an empty password pepper."
        )
    state._ensure_data_dir()
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
    pipeline_thread = threading.Thread(target=state._run_pipeline, daemon=False)
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

_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ARGUS_ALLOWED_ORIGINS", "").split(",") if o.strip()
]
if not _ALLOWED_ORIGINS:
    # Local dev only: no origins configured, so allow localhost tooling.
    _ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


@app.middleware("http")
async def require_auth(request: Request, call_next):
    path = request.url.path
    if path in _AUTH_EXEMPT or any(path.startswith(p) for p in _AUTH_EXEMPT_PREFIXES):
        return await call_next(request)
    session = _get_session(request)
    if not session:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


# ── Static assets & routers ─────────────────────────────────────────────────

frontend.register_static(app)

app.include_router(auth.router)
app.include_router(ingest.router)
app.include_router(alerts.router)
app.include_router(accounts.router)
app.include_router(whitelist.router)
app.include_router(predict.router)
app.include_router(system.router)
# frontend.router has the catch-all `/{path_name:path}` route — must be included last.
app.include_router(frontend.router)
