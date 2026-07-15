-- Auth hardening: account lockout, login audit trail, role carried on session.

ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- role denormalized onto sessions so authz checks don't need a join on every
-- request; refreshed on next login if a role ever changes.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'analyst';

CREATE TABLE IF NOT EXISTS auth_events (
    id         SERIAL PRIMARY KEY,
    company_id TEXT NOT NULL,
    username   TEXT NOT NULL,
    success    BOOLEAN NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_events_identity ON auth_events(company_id, username, created_at DESC);
