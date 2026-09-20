"""
Tests against a REAL Postgres connection — the coverage gap the pure-logic
tests (test_serializer, test_whitelist) can't touch: replace_alerts,
record_decision, session lifecycle, whitelist add/remove, live-ingest queue.

These are skipped automatically unless DATABASE_URL points at a reachable
Postgres (see conftest.py's `pg` fixture) — CI without a database configured
just skips this whole file rather than failing.

Safety model: every test creates only TEST-PYTEST- prefixed rows and deletes
them in a `finally` block, so running this against the SAME live database
backing the deployed HF Space is safe — nothing here truncates or mutates
pre-existing alerts/decisions/sessions/whitelist rows.

The one genuinely destructive path (replace_alerts does `DELETE FROM alerts`
before inserting) is gated behind ALLOW_DESTRUCTIVE_DB_TESTS=1 and skipped
by default — do not set that flag while pointed at production.
"""
import hashlib
import os

import pytest


# ── Whitelist ──────────────────────────────────────────────────────────────

def test_whitelist_add_list_remove_roundtrip(pg, test_id):
    pg.add_whitelist_account(test_id, reason="pytest roundtrip")
    try:
        accounts = pg.list_whitelist_accounts()
        match = next((a for a in accounts if a["account_id"] == test_id), None)
        assert match is not None
        assert match["reason"] == "pytest roundtrip"
    finally:
        pg.remove_whitelist_account(test_id)

    accounts_after = pg.list_whitelist_accounts()
    assert all(a["account_id"] != test_id for a in accounts_after)


def test_whitelist_add_is_idempotent_upsert(pg, test_id):
    pg.add_whitelist_account(test_id, reason="first reason")
    try:
        pg.add_whitelist_account(test_id, reason="updated reason")  # ON CONFLICT DO UPDATE
        accounts = pg.list_whitelist_accounts()
        match = next(a for a in accounts if a["account_id"] == test_id)
        assert match["reason"] == "updated reason"
    finally:
        pg.remove_whitelist_account(test_id)


# ── Sessions (auth) ──────────────────────────────────────────────────────────

def test_session_create_validate_delete(pg):
    # Reuse the seeded admin user rather than inserting a fake one — sessions
    # has a FK to users(id), so we need a real row, and seeding is idempotent.
    pg.seed_default_users()
    user = pg.verify_user("UBI-AML-2026", "admin", "admin123")
    assert user is not None, "seeded admin user should verify with its default password"

    token = pg.create_session(user["id"], user["company_id"], user["username"])
    try:
        session = pg.validate_session(token)
        assert session is not None
        assert session["username"] == "admin"
        assert session["company_id"] == "UBI-AML-2026"
    finally:
        pg.delete_session(token)

    assert pg.validate_session(token) is None, "session must be gone after delete_session"


def test_validate_session_rejects_unknown_token(pg):
    assert pg.validate_session("TEST-PYTEST-not-a-real-token") is None


def test_password_hash_is_deterministic_and_salted(pg):
    # _hash_password is pure (no DB) but lives in service.py — cover it directly.
    h1 = pg._hash_password("hunter2")
    h2 = pg._hash_password("hunter2")
    h3 = pg._hash_password("different")
    assert h1 == h2, "same password must hash identically (needed for login comparison)"
    assert h1 != h3
    assert len(h1) == 64, "sha256 hexdigest is 64 chars"
    assert h1 != "hunter2", "must not store the plaintext password"


# ── Decisions (append-only audit log) ────────────────────────────────────────

def test_record_decision_and_current_decisions(pg, test_id):
    pg.record_decision(test_id, "confirm", reason="pytest", analyst="pytest-suite")
    try:
        current = pg.current_decisions()
        assert test_id in current
        assert current[test_id]["decision"] == "confirm"
        assert current[test_id]["analyst"] == "pytest-suite"

        history = pg.decision_history(test_id)
        assert len(history) == 1
        assert history[0]["decision"] == "confirm"

        # Append a second decision for the same alert — current_decisions()
        # must report the LATEST one, history must report BOTH.
        pg.record_decision(test_id, "dismiss", reason="changed my mind", analyst="pytest-suite")
        current2 = pg.current_decisions()
        assert current2[test_id]["decision"] == "dismiss"
        assert len(pg.decision_history(test_id)) == 2
    finally:
        with pg._PGConn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM decisions WHERE alert_id=%s", (test_id,))


def test_decision_counts_delta(pg, test_id):
    """decision_counts() aggregates across ALL alerts, so assert the delta
    our own insert causes rather than an exact total (a shared/live DB may
    already have other real decisions in it)."""
    before = pg.decision_counts()
    pg.record_decision(test_id, "review", analyst="pytest-suite")
    try:
        after = pg.decision_counts()
        assert after["review"] == before["review"] + 1
    finally:
        with pg._PGConn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM decisions WHERE alert_id=%s", (test_id,))


# ── Live transaction ingestion ───────────────────────────────────────────────

def test_store_live_transactions_and_count(pg, test_id):
    row = {
        "Timestamp": "2026-01-01 12:00:00",
        "From Bank": "1", "From Account": test_id,
        "To Bank": "2", "To Account": f"{test_id}-dst",
        "Amount Paid": 1234.5, "Amount Received": 1234.5,
        "Payment Currency": "US Dollar", "Receiving Currency": "US Dollar",
        "Payment Format": "ACH",
    }
    before = pg.count_live_transactions()
    stored = pg.store_live_transactions([row])
    try:
        assert stored == 1
        assert pg.count_live_transactions() == before + 1
    finally:
        with pg._PGConn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM live_transactions WHERE from_account=%s", (test_id,))


def test_store_live_transactions_empty_list_is_noop(pg):
    assert pg.store_live_transactions([]) == 0


# ── Alerts (DESTRUCTIVE — opt-in only) ───────────────────────────────────────

_DESTRUCTIVE_REASON = (
    "replace_alerts() runs `DELETE FROM alerts` before inserting — running it "
    "against a shared/production database would wipe every real alert. Set "
    "ALLOW_DESTRUCTIVE_DB_TESTS=1 only when DATABASE_URL points at a "
    "disposable/scratch database."
)


@pytest.mark.skipif(
    os.environ.get("ALLOW_DESTRUCTIVE_DB_TESTS") != "1",
    reason=_DESTRUCTIVE_REASON,
)
def test_replace_alerts_and_load_alerts_roundtrip(pg, test_id):
    alert = {
        "id": test_id,
        "patternType": "fanOut",
        "severity": "high",
        "confidence": 0.9,
        "mlScore": 0.9,
        "totalMoved": "$1,000",
        "nodes": [{"id": "A1"}, {"id": "A2"}],
        "transactions": [{"from": "A1", "to": "A2"}],
        "source": "labelled",
    }
    n = pg.replace_alerts([alert], scan_id="pytest-scan")
    assert n == 1
    assert pg.has_alerts() is True

    loaded = pg.load_alerts()
    assert test_id in loaded
    assert loaded[test_id]["patternType"] == "fanOut"
