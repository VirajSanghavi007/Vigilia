"""Auth/session helpers and rate limiter shared across routers."""
import os

from fastapi import HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from database import service as db

# ── Rate Limiting (Issue #1) ────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

_AUTH_EXEMPT = {"/health", "/status", "/auth/login", "/", "/ingest"}

_AUTH_EXEMPT_PREFIXES = ("/static/",)


def _get_session(request: Request) -> dict | None:
    if not db._DB_AVAILABLE:
        return {"user_id": 0, "company_id": "ARGUS", "username": "demo", "role": "admin"}
    token = request.headers.get("X-Session-Token") or request.cookies.get("session_token")
    if not token:
        return None
    return db.validate_session(token)


def require_role(*allowed_roles: str):
    """Endpoint dependency gating access by session role (Issue: `users.role` was
    stored but never enforced — every logged-in user had identical access)."""
    def _check(request: Request):
        session = _get_session(request)
        if not session:
            raise HTTPException(status_code=401, detail="Unauthorized")
        if session.get("role") not in allowed_roles:
            raise HTTPException(status_code=403, detail="Forbidden — insufficient role")
        return session
    return _check


def _check_ingest_key(request: Request) -> None:
    required = os.environ.get("ARGUS_INGEST_KEY")
    if not required:
        return
    if request.headers.get("X-API-Key") != required:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
