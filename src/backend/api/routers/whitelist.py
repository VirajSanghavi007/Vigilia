from fastapi import APIRouter, Depends, Request

from ...core.whitelist import add_to_whitelist, load_whitelist, remove_from_whitelist
from ..auth_deps import limiter, require_role
from ..schemas import WhitelistAddBody

router = APIRouter()

# ── Whitelist endpoints ─────────────────────────────────────────────────────


@router.get("/whitelist")
@limiter.limit("50/minute")
def get_whitelist(request: Request):
    return load_whitelist()


@router.post("/whitelist/account")
@limiter.limit("20/minute")
def whitelist_add(request: Request, body: WhitelistAddBody, _session=Depends(require_role("admin"))):
    """Add account to whitelist — admin only (Issue #1: rate limited; changes
    what gets flagged system-wide, so any analyst having this was too broad)."""
    wl = add_to_whitelist(body.account_id, body.reason)
    return {"status": "added", "account_id": body.account_id, "whitelist": wl}


@router.delete("/whitelist/account/{account_id}")
@limiter.limit("20/minute")
def whitelist_remove(request: Request, account_id: str, _session=Depends(require_role("admin"))):
    """Remove account from whitelist — admin only (Issue #1: rate limited)."""
    wl = remove_from_whitelist(account_id)
    return {"status": "removed", "account_id": account_id}
