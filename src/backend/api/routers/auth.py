import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from slowapi.util import get_remote_address

from database import service as db
from ..auth_deps import _get_session, limiter
from ..schemas import ChangePasswordRequest, LoginRequest

router = APIRouter()

# ── Auth Endpoints ──────────────────────────────────────────────────────────


@router.post("/auth/login")
@limiter.limit("5/minute")
def auth_login(request: Request, req: LoginRequest):
    user = db.verify_user(req.company_id, req.username, req.password)
    db.record_auth_event(req.company_id, req.username, success=bool(user), ip_address=get_remote_address(request))
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = db.create_session(user["id"], user["company_id"], user["username"], user["role"])
    response = JSONResponse({"token": token, "username": user["username"], "company_id": user["company_id"]})
    response.set_cookie(
        "session_token", token, httponly=True, samesite="lax", max_age=28800, secure=True
    )
    return response


_PASSWORD_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{10,}$")


@router.post("/auth/change-password")
@limiter.limit("5/minute")
def auth_change_password(request: Request, body: ChangePasswordRequest):
    """Only user-facing path that creates a password, so this is where
    strength gets enforced — nothing else calls _hash_password with
    user-supplied input (Issue: no password-strength requirement existed
    anywhere because no such endpoint existed)."""
    session = _get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not _PASSWORD_RE.match(body.new_password):
        raise HTTPException(
            status_code=400,
            detail="New password must be at least 10 characters and include a letter and a digit",
        )
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="New password must differ from current password")
    ok = db.change_password(session["company_id"], session["username"], body.current_password, body.new_password)
    if not ok:
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    # Force re-login everywhere, including this device — a changed password
    # should invalidate every session that predates the change.
    db.delete_all_sessions_for_user(session["user_id"])
    response = JSONResponse({"ok": True, "message": "Password changed — please log in again"})
    response.delete_cookie("session_token")
    return response


@router.post("/auth/logout")
def auth_logout(request: Request):
    token = request.headers.get("X-Session-Token") or request.cookies.get("session_token")
    if token:
        db.delete_session(token)
    response = JSONResponse({"ok": True})
    response.delete_cookie("session_token")
    return response


@router.post("/auth/logout-all")
def auth_logout_all(request: Request):
    """Revoke every session for the current user (Issue: a leaked token was
    valid until natural expiry with no way to kill it early)."""
    session = _get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Unauthorized")
    revoked = db.delete_all_sessions_for_user(session["user_id"])
    response = JSONResponse({"ok": True, "revoked": revoked})
    response.delete_cookie("session_token")
    return response


@router.get("/auth/me")
def auth_me(request: Request):
    session = _get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"username": session["username"], "company_id": session["company_id"]}
