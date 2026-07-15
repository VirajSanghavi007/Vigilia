# History

Running log of decisions, changes, and things learned while working on Argus.
Newest entry on top.

---

## 2026-07-15 — Red-team pass fixes + argon2 password hashing

Ran `/thinking-red-team` against auth/session/ingest/rendering code. Every
finding required a concrete reproducible attack path (anti-fabrication gate)
— report had 5 real findings, all fixed same session:

1. **DB-down = universal auth bypass** (Critical) — `_get_session`/`verify_user`
   returned a fake always-valid session/login when Postgres was unreachable,
   with no distinction between local dev and prod. Fixed: gated on `SPACE_ID`
   (auto-set by HF Spaces) — fails closed (401/503) in prod, still degrades
   gracefully for local dev (no DB needed to poke around locally).
   [main.py:348-356,362-364](src/backend/api/main.py:348), [service.py](src/database/service.py)
2. **`/ingest` unauthenticated by default** (High) — now refuses to serve
   ingestion in prod unless `ARGUS_INGEST_KEY` is set. [main.py:449-456](src/backend/api/main.py:449)
3. **Login brute-forceable + seeded default creds** (Medium) — `/auth/login`
   rate-limited to 5/min; `seed_default_users()` no longer auto-runs in prod
   without explicit `ARGUS_SEED_DEMO_USERS=1` opt-in.
4. **Stored XSS via decision/whitelist `reason` fields** (High) — `app.js`
   was interpolating unescaped user text into `innerHTML` (Case Manager
   table, whitelist panel) and into `onclick="fn('...')"` attributes.
   Added `escapeHtml()` for HTML-text context and `escapeJsAttr()` for the
   inline-event-handler case (HTML-entity encoding alone doesn't protect JS
   string context inside `onclick=` — browser decodes entities *before*
   running it as JS, learned this while fixing it). Also capped `reason`
   fields server-side at 500 chars.
5. **CSV formula injection on export** (Medium) — added `csvSafe()`, prefixes
   any cell starting with `=+-@` with `'` before Excel/Sheets can interpret
   it as a formula.

**Password hashing swapped sha256(static-salt) → argon2id.** Old scheme used
one hardcoded/shared salt for every user — crack it once, brute-force every
hash with one table. Argon2 generates a random salt per password automatically
(embedded in the stored hash string, nothing extra to manage) and is
deliberately slow/memory-hard, unlike SHA-family hashes which are built for
speed (wrong property for passwords — fast hash = fast brute force).
Also added `ARGUS_SECRET` as a pepper (mixed into the hash input, lives only
in env vars, never in the DB) — a leaked/dumped `users` table alone still
isn't enough to crack passwords offline without the pepper too.

Side effect: since argon2 embeds a random salt per hash, the old
`WHERE password_hash=%s` SQL equality check can never match again — rewrote
`verify_user` to fetch by identity first, then verify the password in Python
against the stored hash. `password_hash` is still never returned in the
function's output dict (same as before) — kept the boundary that password
data doesn't leak past this one function.

Added `argon2-cffi` to `requirements.txt`, installed + sanity-tested locally
(confirmed: same password → different hash each time; correct password
verifies; wrong password rejected).

**Known gap not covered this pass:** existing users seeded under the old
sha256 scheme (if any exist in a real deployed DB) won't verify against the
new argon2 code — no migration/upgrade-on-login path was written. For this
project (hackathon-stage, seeded demo users only) that's an acceptable
trade-off; flagged here in case it matters later.

**Learned (general, not project-specific):**
- Cookie theft defense stack: `SameSite` blocks cross-site auto-attach,
  `HttpOnly` blocks same-origin JS reads (limits XSS damage, doesn't prevent
  XSS), `Secure` blocks plaintext-HTTP interception, browser same-origin
  policy blocks other sites from ever seeing the cookie at all (free, no
  code needed). None of this defends against a compromised user device.
- Escaping (HTML-entity encoding) protects HTML *text* context. It does
  **not** protect JS-string context embedded in an inline event-handler
  attribute (`onclick="fn('...')"`) — the browser HTML-decodes the attribute
  value before compiling it as JS, so an HTML-escaped `'` decodes right back
  to a real quote before the JS parser ever sees it. Needs separate
  JS-string escaping for that specific context.
- SHA-family hashes (MD5/SHA1/SHA256/SHA512) are wrong for passwords because
  they're built to be *fast* — great for checksums, terrible for password
  storage since it makes brute-forcing cheap. bcrypt/scrypt/argon2 are
  deliberately slow and tunable instead.

---

## 2026-07-15 — Fixed session cookie `secure` flag

Fixed the gap flagged earlier: `auth_login` set the session cookie without
`secure`, so it'd be sendable over plain http too. [main.py:374-384](src/backend/api/main.py:374)

```python
_IS_HF_SPACE = bool(os.environ.get("SPACE_ID"))  # HF Spaces sets this automatically

response.set_cookie(
    "session_token", token, httponly=True, samesite="lax", max_age=28800, secure=_IS_HF_SPACE
)
```

Used `SPACE_ID` (auto-set by Hugging Face Spaces at runtime) instead of a
manual prod/dev flag, so it can't drift out of sync with actual deployment.
Prod (HF, https) → `secure=True`. Local dev (`SPACE_ID` unset, plain http)
→ `secure=False`, so localhost login still works.

Also ran `graphify` (https://github.com/safishamsi/graphify) against the repo
— user cloned/ran it themselves, output lives in `graphify-out/` (graph.json,
GRAPH_REPORT.md, graph.html, AST cache). Report: 1186 nodes, 3135 edges, 69
communities, no import cycles. Own-code communities: `app.js` (36 nodes),
`main.py` (37), `service.py` (31), `multignn.py` (30), `detection.py` (27),
`whitelist.py` (24). Highest-cohesion own-code community is the ingest path
(`_check_ingest_key`, `ingest()`, `TransactionIn` — cohesion 0.40), matching
the earlier finding that `/ingest` is a weak point worth attention.

---

## 2026-07-15 — Auth/authz audit + session & docs Q&A

**Findings (weakest link pass):**
- `/ingest` exempt from session auth entirely; `ARGUS_INGEST_KEY` check is
  optional (unset = open write into alert pipeline). [main.py:343](src/backend/api/main.py:343), [main.py:439-442](src/backend/api/main.py:439)
- `_hash_password` falls back to hardcoded salt `"argus-aml-2026"` if
  `ARGUS_SECRET` unset. [service.py:335-337](src/database/service.py:335)
- `seed_default_users()` plants `admin/admin123`, `analyst1/analyst2026`,
  `demo/demo2026` with no forced rotation. [service.py:340-347](src/database/service.py:340)
- `users.role` column exists but is never checked — no RBAC enforced
  anywhere; every logged-in user has equal access.
- If `_DB_AVAILABLE` is False, `_get_session` returns a fake demo session
  unconditionally — DB-down fails *open*, not closed. [main.py:348-350](src/backend/api/main.py:348)
- No rate limit on `/auth/login` (brute-forceable), unlike `/live/transactions`
  which has `@limiter.limit`.
- `_rescore_neighborhood` doesn't call the actual loaded GNN — real score is
  a log-amount percentile heuristic; failures caught broadly and only
  logged. [main.py:501-579](src/backend/api/main.py:501)
- Live alert replay on boot (`_replay_live_transactions`, [main.py:273-286](src/backend/api/main.py:273))
  depends on the same weak rescoring and swallows failures as "non-fatal" —
  possible silent alert loss after restart.
- Test coverage thin: 3 files, none hit `/ingest`, rescoring, auth
  middleware, or replay.

**Decision:** user will drive fix order manually, one item at a time —
no bulk refactor pass. Scope for this pass deliberately not locked in.

**Deployment:** live site is HTTPS — hosted on Hugging Face Space
(`virajsanghavi-argus.hf.space`), HF terminates TLS. Local dev only is
`http://localhost:8000`. HF does **not** provide app-level auth — the
`/auth/login` + session-cookie system is entirely custom, HF only gives
hosting + TLS.

**Cookie gap found:** `auth_login` sets the session cookie with
`httponly=True, samesite="lax"` but no `secure` flag (defaults False).
[main.py:381](src/backend/api/main.py:381) Since prod is HTTPS-only, this
should be `secure=True` in prod (conditionally False only for local http
dev). Not yet fixed — pending user go-ahead.

**Concepts clarified:**
- `httponly` blocks JS (`document.cookie`) from reading the cookie —
  mitigates cookie theft via XSS. Unrelated to HTTP-vs-HTTPS despite the name.
- `samesite=lax` withholds the cookie on cross-site requests except
  top-level GET navigation — mitigates CSRF from forms/images/fetches on
  other origins.
- `secure` (currently unset/False) would require HTTPS-only cookie
  transmission — a real gap given prod is HTTPS.

**Sessions & scaling Q&A:**
- Multi-user sessions already work correctly: `sessions` table in Postgres
  (Supabase-hosted) is one row per login, not in-process memory — already a
  shared store across users/restarts. DB schema: [schema_postgres.sql:43-50](src/database/schemas/schema_postgres.sql:43).
- Redis was floated for prod. Verdict: not needed yet. Postgres already
  durable (Supabase) and already shared. Redis would only help with
  per-request session-lookup latency or multi-instance shared cache —
  neither is a current bottleneck. Don't add infra before fixing the
  auth gaps above.
- Concurrent analyst edits: not a real data race today. `decisions` table
  is append-only (`alert_id, decision, reason, analyst, created_at`), not a
  mutable status field — concurrent inserts don't corrupt state, latest
  `created_at` wins deterministically. Remaining risk is UX staleness only
  (analyst B doesn't see analyst A's fresh decision before submitting) —
  not urgent, no data loss. Possible future fix: optimistic-lock warning
  in UI ("someone already decided this").

**Docs inventory** (existing, not created this session):
- [README.md](README.md) — folder structure, run instructions
- [ARCHITECTURE.md](ARCHITECTURE.md) — system diagram, HF Space flow, known gaps
- [API.md](API.md) — endpoint reference, base URL (HF Space vs localhost)
- [PROJECT_SNAPSHOT_2026-07-08.md](PROJECT_SNAPSHOT_2026-07-08.md) — point-in-time status, tech stack table, already flags sha256 auth as a known gap
- [src/database/migrations/README.md](src/database/migrations/README.md) — migration rules, numbered SQL files auto-applied on boot, no Alembic

**Started this file** — going forward, log discussions/changes/learnings
here as they happen.
