"""
Database service — PostgreSQL only.

Requires DATABASE_URL to be set (any managed Postgres). There is
no local-file fallback: alerts, decisions, sessions, live-ingest queue, and
the whitelist all live in Postgres so they survive container restarts.

Usage:
  export DATABASE_URL=postgresql://user:pass@host:5432/argus
"""

import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
import psycopg2
import psycopg2.extras
import psycopg2.pool

logger = logging.getLogger("uvicorn.error")

import config

DATABASE_URL: str | None = os.environ.get("DATABASE_URL")
_DB_AVAILABLE: bool = bool(DATABASE_URL)
if not _DB_AVAILABLE:
    logger.warning(
        "DATABASE_URL not set — running in no-DB mode. "
        "Auth is disabled; decisions and live transactions will not persist."
    )

_pg_pool = None


def _get_pg_pool():
    global _pg_pool
    if _pg_pool is None:
        _pg_pool = psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=DATABASE_URL)
    return _pg_pool


class _PGConn:
    """Context manager — borrows a connection from the pool."""
    def __enter__(self):
        self._conn = _get_pg_pool().getconn()
        self._conn.autocommit = False
        return self._conn

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()
        _get_pg_pool().putconn(self._conn)


# ── Schema init / migrations ──────────────────────────────────────────────────
#
# Schema changes are numbered SQL files in src/database/migrations/, applied
# once each and recorded in schema_migrations. See migrations/README.md.

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def run_migrations() -> None:
    """Apply any migration file not yet recorded in schema_migrations, in order."""
    if not _DB_AVAILABLE:
        return
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version     TEXT PRIMARY KEY,
                    applied_at  TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("SELECT version FROM schema_migrations")
            applied = {r[0] for r in cur.fetchall()}

    files = sorted(MIGRATIONS_DIR.glob("*.sql")) if MIGRATIONS_DIR.exists() else []
    pending = [f for f in files if f.name not in applied]
    if not pending:
        logger.info(f"PostgreSQL schema up to date ({len(applied)} migration(s) applied)")
        return

    for f in pending:
        sql = f.read_text()
        with _PGConn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s) ON CONFLICT DO NOTHING",
                    (f.name,),
                )
        logger.info(f"Applied migration: {f.name}")


def init_db() -> None:
    """Initialize database and bring the schema up to date. Idempotent."""
    if not _DB_AVAILABLE:
        logger.info("No-DB mode — skipping database init")
        return
    run_migrations()
    logger.info(f"PostgreSQL ready -> {DATABASE_URL.split('@')[-1]}")


# ── Alerts ───────────────────────────────────────────────────────────────────

def replace_alerts(alerts: list[dict], scan_id: str = "") -> int:
    if not _DB_AVAILABLE:
        return len(alerts)
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM alerts;")
            for a in alerts:
                cur.execute(
                    "INSERT INTO alerts (id,pattern_type,severity,confidence,ml_score,"
                    "total_moved,node_count,txn_count,source,payload,scan_id) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                    "ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
                    (a["id"], a.get("patternType"), a.get("severity"), a.get("confidence"),
                     a.get("mlScore"), a.get("totalMoved"), len(a.get("nodes", [])),
                     len(a.get("transactions", [])), a.get("source", "labelled"),
                     json.dumps(a), scan_id)
                )
    logger.info(f"Persisted {len(alerts)} alerts (scan_id={scan_id or 'n/a'})")
    return len(alerts)


def upsert_alerts(alerts: list[dict], scan_id: str = "") -> int:
    """Add/update alerts without touching existing rows (unlike replace_alerts,
    which wipes the table first). Used for incremental live-ingest alerts so
    they're durable in Postgres immediately — not just held in one process's
    in-memory ALERTS dict until the next full batch scan or restart-replay."""
    if not _DB_AVAILABLE:
        return len(alerts)
    with _PGConn() as conn:
        with conn.cursor() as cur:
            for a in alerts:
                cur.execute(
                    "INSERT INTO alerts (id,pattern_type,severity,confidence,ml_score,"
                    "total_moved,node_count,txn_count,source,payload,scan_id) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                    "ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
                    (a["id"], a.get("patternType"), a.get("severity"), a.get("confidence"),
                     a.get("mlScore"), a.get("totalMoved"), len(a.get("nodes", [])),
                     len(a.get("transactions", [])), a.get("source", "live_ingest"),
                     json.dumps(a), scan_id)
                )
    return len(alerts)


def load_alerts() -> dict:
    if not _DB_AVAILABLE:
        return {}
    with _PGConn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT payload FROM alerts")
            rows = cur.fetchall()
    return {(a := json.loads(r["payload"]))["id"]: a for r in rows}


def has_alerts() -> bool:
    if not _DB_AVAILABLE:
        return False
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM alerts LIMIT 1")
            return cur.fetchone() is not None


# ── Decisions ────────────────────────────────────────────────────────────────

def record_decision(alert_id: str, decision: str, reason: str = "", analyst: str = "") -> None:
    if not _DB_AVAILABLE:
        return
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO decisions (alert_id,decision,reason,analyst) VALUES (%s,%s,%s,%s)",
                (alert_id, decision, reason, analyst)
            )


def current_decisions() -> dict:
    if not _DB_AVAILABLE:
        return {}
    sql = """
        SELECT d.alert_id, d.decision, d.reason, d.analyst, d.created_at
        FROM decisions d
        JOIN (SELECT alert_id, MAX(seq) AS mx FROM decisions GROUP BY alert_id) m
          ON d.alert_id = m.alert_id AND d.seq = m.mx
    """
    with _PGConn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            rows = cur.fetchall()
    return {
        r["alert_id"]: {
            "decision": r["decision"], "reason": r["reason"],
            "analyst": r["analyst"], "created_at": str(r["created_at"]),
        }
        for r in rows
    }


def decision_history(alert_id: str) -> list[dict]:
    if not _DB_AVAILABLE:
        return []
    sql = "SELECT decision,reason,analyst,created_at FROM decisions WHERE alert_id=%s ORDER BY seq ASC"
    with _PGConn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (alert_id,))
            rows = cur.fetchall()
    return [dict(r) for r in rows]


def decision_counts() -> dict:
    if not _DB_AVAILABLE:
        return {"confirm": 0, "review": 0, "dismiss": 0}
    sql = """
        SELECT d.decision, COUNT(*) as cnt
        FROM decisions d
        JOIN (SELECT alert_id, MAX(seq) AS mx FROM decisions GROUP BY alert_id) m
          ON d.alert_id = m.alert_id AND d.seq = m.mx
        GROUP BY d.decision
    """
    with _PGConn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            rows = cur.fetchall()
    counts = {"confirm": 0, "review": 0, "dismiss": 0}
    for r in rows:
        if r["decision"] in counts:
            counts[r["decision"]] = r["cnt"]
    return counts


# ── Live transaction ingestion ──────────────────────────────────────────────

def store_live_transactions(rows: list[dict]) -> int:
    """Store ingested transactions for audit / future neighborhood rescoring."""
    if not rows:
        return 0
    if not _DB_AVAILABLE:
        return len(rows)
    with _PGConn() as conn:
        with conn.cursor() as cur:
            for r in rows:
                cur.execute(
                    "INSERT INTO live_transactions "
                    "(timestamp,from_bank,from_account,to_bank,to_account,"
                    "amount_paid,amount_received,payment_currency,receiving_currency,payment_format) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (r.get("Timestamp"), r["From Bank"], r["From Account"],
                     r["To Bank"], r["To Account"], r["Amount Paid"],
                     r.get("Amount Received"), r.get("Payment Currency", "US Dollar"),
                     r.get("Receiving Currency", "US Dollar"), r.get("Payment Format", "ACH"))
                )
    return len(rows)


def count_live_transactions() -> int:
    if not _DB_AVAILABLE:
        return 0
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM live_transactions")
            return cur.fetchone()[0]


def get_live_transactions(limit: int = 15) -> list[dict]:
    """Most recently ingested live transactions, newest first — powers the
    Dashboard live-ingestion feed."""
    if not _DB_AVAILABLE:
        return []
    with _PGConn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, timestamp, from_bank, from_account, to_bank, to_account, "
                "amount_paid, payment_format, ingested_at "
                "FROM live_transactions ORDER BY ingested_at DESC, id DESC LIMIT %s",
                (limit,),
            )
            return [dict(r) for r in cur.fetchall()]


def get_all_live_transactions() -> list[dict]:
    """Every stored live transaction, in the ingest-row shape the neighborhood
    rescore expects. Used at startup to rebuild live-ingest alerts (in-memory
    ALERTS is wiped on every boot, but these rows persist in Postgres)."""
    if not _DB_AVAILABLE:
        return []
    with _PGConn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT timestamp, from_bank, from_account, to_bank, to_account, "
                "amount_paid, amount_received, payment_currency, receiving_currency, "
                "payment_format FROM live_transactions ORDER BY ingested_at ASC, id ASC"
            )
            rows = cur.fetchall()
    return [{
        "Timestamp": r["timestamp"],
        "From Bank": r["from_bank"],
        "From Account": r["from_account"],
        "To Bank": r["to_bank"],
        "To Account": r["to_account"],
        "Amount Paid": r["amount_paid"],
        "Amount Received": r["amount_received"],
        "Payment Currency": r["payment_currency"],
        "Receiving Currency": r["receiving_currency"],
        "Payment Format": r["payment_format"],
    } for r in rows]


# ── Whitelist (exempt accounts) ─────────────────────────────────────────────

def list_whitelist_accounts() -> list[dict]:
    if not _DB_AVAILABLE:
        return []
    with _PGConn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT account_id, reason FROM whitelist_accounts ORDER BY added_at ASC")
            return [dict(r) for r in cur.fetchall()]


def add_whitelist_account(account_id: str, reason: str = "") -> None:
    if not _DB_AVAILABLE:
        return
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO whitelist_accounts (account_id, reason) VALUES (%s,%s) "
                "ON CONFLICT(account_id) DO UPDATE SET reason=EXCLUDED.reason",
                (account_id, reason)
            )


def remove_whitelist_account(account_id: str) -> None:
    if not _DB_AVAILABLE:
        return
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM whitelist_accounts WHERE account_id=%s", (account_id,))


# ── Auth ──────────────────────────────────────────────────────────────────────
# Passwords are hashed with argon2id (argon2-cffi). Argon2 generates a random
# salt per password and embeds it in the stored hash string, so — unlike the
# old shared-salt sha256 scheme — no two users ever share a salt, and there is
# nothing extra to store or manage. ARGUS_SECRET is mixed in as a pepper: a
# secret that lives only in the environment, never in the database, so a
# leaked/dumped `users` table alone still isn't enough to brute-force
# passwords offline — the attacker also needs the pepper.

_SESSION_TTL_HOURS = 8
_MAX_FAILED_ATTEMPTS = 5
_LOCKOUT_MINUTES = 15

_ph = PasswordHasher()


def _pepper() -> str:
    return os.environ.get("ARGUS_SECRET", "")


def _hash_password(password: str) -> str:
    return _ph.hash(_pepper() + password)


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        return _ph.verify(stored_hash, _pepper() + password)
    except (VerifyMismatchError, InvalidHashError, VerificationError):
        return False


def seed_default_users() -> None:
    if not _DB_AVAILABLE:
        return
    if os.environ.get("SPACE_ID") and not os.environ.get("ARGUS_SEED_DEMO_USERS"):
        # Never auto-plant known admin/admin123-style credentials in prod.
        # Set ARGUS_SEED_DEMO_USERS=1 to opt in explicitly (e.g. a demo Space).
        return
    logger.warning(
        "Seeding well-known demo credentials (admin/admin123, analyst1/analyst2026, "
        "demo/demo2026) — never leave these active on a reachable deployment."
    )
    defaults = [
        ("UBI-AML-2026", "admin", "admin123", "admin"),
        ("UBI-AML-2026", "analyst1", "analyst2026", "analyst"),
        ("UBI-AML-2026", "demo", "demo2026", "analyst"),
    ]
    with _PGConn() as conn:
        with conn.cursor() as cur:
            for company_id, username, password, role in defaults:
                cur.execute(
                    "INSERT INTO users (company_id,username,password_hash,role) VALUES (%s,%s,%s,%s) "
                    "ON CONFLICT DO NOTHING",
                    (company_id, username, _hash_password(password), role)
                )


def record_auth_event(company_id: str, username: str, success: bool, ip_address: str | None = None) -> None:
    """Audit trail for every login attempt, success or failure (Issue: no visibility into brute-force attempts)."""
    if not _DB_AVAILABLE:
        return
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO auth_events (company_id,username,success,ip_address) VALUES (%s,%s,%s,%s)",
                (company_id, username, success, ip_address)
            )


def verify_user(company_id: str, username: str, password: str) -> dict | None:
    if not _DB_AVAILABLE:
        if os.environ.get("SPACE_ID"):
            # Fail closed in prod: a dead DB must not accept any password as valid.
            return None
        return {"id": 0, "company_id": company_id or "ARGUS", "username": username or "demo", "role": "analyst"}
    # Argon2 embeds a random salt per hash, so the match can't happen in SQL
    # (unlike the old sha256 scheme) — fetch by identity, verify in Python.
    sql = "SELECT id,company_id,username,role,password_hash,locked_until FROM users WHERE company_id=%s AND username=%s"
    with _PGConn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (company_id, username))
            row = cur.fetchone()

            if not row:
                return None
            if row["locked_until"] and row["locked_until"] > datetime.now(timezone.utc):
                return None

            if not _verify_password(password, row["password_hash"]):
                cur.execute(
                    """UPDATE users SET failed_attempts = failed_attempts + 1,
                       locked_until = CASE WHEN failed_attempts + 1 >= %s
                                            THEN NOW() + make_interval(mins => %s)
                                            ELSE locked_until END
                       WHERE id = %s""",
                    (_MAX_FAILED_ATTEMPTS, _LOCKOUT_MINUTES, row["id"])
                )
                return None

            cur.execute("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = %s", (row["id"],))
    return {"id": row["id"], "company_id": row["company_id"], "username": row["username"], "role": row["role"]}


def change_password(company_id: str, username: str, current_password: str, new_password: str) -> bool:
    """Verify current_password (reuses verify_user, so a wrong current
    password counts toward the same lockout as a failed login), then rehash
    and store new_password. Returns False if current_password is wrong."""
    if not _DB_AVAILABLE:
        return True
    user = verify_user(company_id, username, current_password)
    if not user:
        return False
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (_hash_password(new_password), user["id"]))
    return True


def create_session(user_id: int, company_id: str, username: str, role: str = "analyst") -> str:
    if not _DB_AVAILABLE:
        return secrets.token_urlsafe(32)
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=_SESSION_TTL_HOURS)
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO sessions (token,user_id,company_id,username,role,expires_at) VALUES (%s,%s,%s,%s,%s,%s)",
                (token, user_id, company_id, username, role, expires)
            )
    return token


def validate_session(token: str) -> dict | None:
    if not _DB_AVAILABLE:
        return {"user_id": 0, "company_id": "ARGUS", "username": "demo", "role": "admin"} if token else None
    with _PGConn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT user_id,company_id,username,role FROM sessions WHERE token=%s AND expires_at > NOW()",
                (token,)
            )
            row = cur.fetchone()
            return dict(row) if row else None


def delete_session(token: str) -> None:
    if not _DB_AVAILABLE:
        return
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE token=%s", (token,))


def delete_all_sessions_for_user(user_id: int) -> int:
    """Log out every device/session for this user (Issue: no way to revoke a leaked token)."""
    if not _DB_AVAILABLE:
        return 0
    with _PGConn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE user_id=%s", (user_id,))
            return cur.rowcount
