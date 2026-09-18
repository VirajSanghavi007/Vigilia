# Architecture

> Derived directly from the current code (not from prior docs) on 2026-09-18. Re-run `/explain-architecture` periodically — this file goes stale as the code changes.

## 1. Plain-English summary

Vigilia (labeled "Argus"/"AML Intelligence Platform" in code) is a web app that helps bank fraud/compliance analysts spot money laundering in transaction data. It scores transactions with a graph neural network, clusters suspicious ones into "alerts" with plain-English explanations (fan-out, cycle, etc.), and lets analysts browse, investigate, and confirm/dismiss them in a dashboard — plus upload files for one-off scoring or stream in live transactions.

## 2. Major components

**Frontend** (`src/frontend/`)
- `public/app.html` — the dashboard shell (markup only).
- `js/app.js` — thin entry point wiring feature modules to `window` for inline `onclick=` handlers.
- `js/modules/*.js` — split by feature: `auth.js`, `dashboard.js`, `investigate.js`, `accounts.js`, `cases.js`, `whitelist.js`, `predict.js`, `init.js`, `nav.js`, `theme.js`, `tour.js`, `toast.js`, `sanitize.js`, `format.js`, `state.js`, `api.js`.
- `lib/` — vendored Chart.js and Cytoscape.js (charts and account-network graph visualization).

**Backend API** (`src/backend/api/`)
- `main.py` — FastAPI app construction: lifespan startup, CORS, request-ID/logging middleware, global auth-gate middleware, router registration.
- `state.py` — module-level mutable globals (`ALERTS`, `SUPPRESSED`, `DECISIONS`), background pipeline runner, disk cache load/save, drift detection, neighborhood rescoring for live ingest.
- `auth_deps.py` — session lookup, role-check dependency, ingest API-key check, rate limiter.
- `schemas.py` — Pydantic request models.
- `routers/*.py` — one file per API surface: `auth.py`, `alerts.py`, `accounts.py`, `whitelist.py`, `predict.py`, `ingest.py`, `system.py`, `frontend.py`.

**Model / ML core**
- `src/backend/models/multignn.py` — graph construction (`build_graph`), the `MultiGNN` model class, training loop(s), inference, an optional GNNExplainer-based explainer.
- `src/backend/pipeline/detection.py` — turns per-transaction scores into alerts: percentile thresholding, connected-component clustering, topology classification (fan-out/fan-in/cycle/etc.), heuristic risk-narrative generation, severity ranking.
- `core/serializer.py`, `core/whitelist.py` — shaping alerts for the frontend and filtering against the whitelist.

**Data / storage**
- `src/database/service.py` — sole persistence layer, PostgreSQL via `psycopg2` pool. Owns migrations, alerts, decisions, live-transaction audit log, whitelist, and full auth (argon2 hashing, sessions, lockout, audit trail). No local-file fallback for real data.
- `migrations/0001_baseline.sql`, `0002_auth_hardening.sql` — versioned schema migrations.
- `data/multignn_model.pt`, `data/multignn_meta.json` — trained model checkpoint + metadata (checked in).
- `data/pipeline_cache.json` — cached alert output to avoid rerunning the full pipeline on restart.

**Infra / CI / tooling**
- `.github/workflows/ci.yml` — lint (ruff/mypy, `continue-on-error: true`, informational only) + pytest matrix (Python 3.11/3.12/3.14) against a fake `DATABASE_URL`.
- `Dockerfile`, `deploy-hf.ps1`, `rollback-hf.ps1` — containerization and Hugging Face Spaces deploy/rollback.
- `scripts/train.py` — CLI entry to retrain the model outside the API process.
- `src/backend/tests/` — pytest suite for serializer, whitelist, and Postgres service layer.

## 3. End-to-end flow

**Startup:** the lifespan hook runs migrations, seeds demo users (non-prod), then spawns a background thread so the API can serve immediately. That thread loads a cached alert set or rebuilds it: `build_graph` → GNN scoring → threshold top ~1% → cluster connected flagged edges into alerts → classify topology → generate narratives → rank severity → persist to Postgres and the local JSON cache, plus a drift check against a stored baseline.

**Serving a request:** requests pass through request-ID/logging middleware, then an auth gate (exempt paths bypass; others validate a session token). Routers mostly read/write the shared in-memory `state.ALERTS`/`state.DECISIONS` (lock-guarded) or call `database.service` directly for durable state.

**Analyst browsing:** frontend fetches `/alerts` (whitelist-filtered), renders a Cytoscape graph + Chart.js histogram, and posts decisions (`confirm`/`review`/`dismiss`) that round-trip to `db.record_decision`.

**Live ingestion:** POST `/ingest` (optionally API-key gated) validates rows, stores them durably, and triggers `state._rescore_neighborhood` — builds a small graph from the new rows, scores with the same trained model, merges any newly-flagged cluster into `state.ALERTS`. On restart, persisted live rows are replayed through the same rescore path so live alerts survive restarts even though in-memory `ALERTS` doesn't.

**Ad-hoc prediction:** `/predict` uploads a CSV/Excel file, builds a one-off graph, scores it with the same model, and returns per-row scores directly — this path never touches `state.ALERTS` or the database.

## 4. Notable / non-obvious quirks

- **"MultiGNN" is a single-relation PNAConv network**, not a heterogeneous/multi-relational GNN — the name and implementation don't match (already flagged in `CLAUDE.md`, confirmed directly in code).
- **Alert count uses actual `random.randint(155, 195)`** in production logic (`pipeline/detection.py` ~line 213) — non-deterministic alert counts across identical runs on identical data.
- **Drift baseline is set on first run and never re-baselined** — no versioning or intentional reset mechanism.
- **No-DB "demo mode" silently authenticates everyone as admin** when `DATABASE_URL` is unset and it's not an HF Space — an easy-to-miss backdoor for any non-Space deployment without `DATABASE_URL` configured.
- **Demo credentials (`admin/admin123`, `analyst1/analyst2026`, `demo/demo2026`) are seeded by default** on any non-HF-Space deployment.
- **`MULTIGNN_ROW_OFFSET = 4_350_000` is a hardcoded, dataset-specific offset** tied to one exact CSV's row ordering — the "hardcoded values that break on other machines" issue already flagged in `CLAUDE.md`.
- **`/predict` and live-rescore inject a dummy `Is Laundering = 0` column** to satisfy the graph builder's expected schema — hidden coupling between training-time and inference-time code paths.
- **Two different "explainability" paths**: the live pipeline reuses the raw sigmoid score as a stand-in for importance; a real GNNExplainer-based function exists in `multignn.py` but isn't wired into the live pipeline (appears dead/unused).
- **Risk-indicator narratives are hand-written heuristic templates**, not GNN output — the dashboard presents rule-based prose alongside the model score as if it were unified evidence.
- **`/ingest` is auth-exempt**, and without `ARGUS_INGEST_KEY` set (non-HF-Space), it's completely open to the internet with no authentication.
- **CI lint (ruff/mypy) is `continue-on-error: true`** — only the pytest job actually gates the build.
- **README.md/HISTORY.md are currently deleted** in the working tree — consistent with treating them as stale rather than authoritative.

---
Key files: `src/backend/api/main.py`, `api/state.py`, `api/auth_deps.py`, `api/routers/ingest.py`, `api/routers/predict.py`, `backend/models/multignn.py`, `backend/pipeline/detection.py`, `database/service.py`, `frontend/js/app.js`, `src/config.py`, `.github/workflows/ci.yml`.
