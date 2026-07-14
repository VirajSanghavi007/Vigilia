# Argus — Project Snapshot (2026-07-08)

## Status: Active Hackathon / Deployed

**Live:** Hugging Face Space `VirajSanghavi/Argus` (Docker, port 7860)  
**DB:** Supabase-hosted Postgres (`DATABASE_URL` set as HF Space secret)  
**Deploy:** `.\deploy-hf.ps1` → orphan-branch force-push to `hf` remote

---

## What This Is

Argus is an Anti-Money Laundering (AML) detection platform. A Multi-GNN model (PNAConv + GINEConv edge classifier) scores transactions from the IBM HI-Medium dataset, clusters high-risk edges into alert groups, classifies their topology (FAN_OUT, FAN_IN, CYCLE, SCATTER_GATHER, GATHER_SCATTER, BIPARTITE, RANDOM), and surfaces explainable risk indicators. Analysts review alerts, make decisions (confirm/review/dismiss), and can ingest live transactions.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI (Python), slowapi rate limiting |
| ML | PyTorch, torch-geometric, PNAConv + GINEConv |
| DB | PostgreSQL via psycopg2 connection pool (Supabase) |
| Frontend | Vanilla JS (single file `app.js` ~1900 lines), Cytoscape.js, Chart.js |
| Hosting | Hugging Face Spaces (Docker) |
| Auth | sha256+salt sessions (multi-user seeded, not bcrypt — known gap) |

---

## File Tree (key files only)

```
src/
  backend/
    api/
      main.py          # FastAPI app, all routes
      ingest_store.py  # live-ingest persistence helper
    core/
      whitelist.py     # exemption rules + DB-backed account list
      serializer.py    # raw alert dict → frontend JSON
    pipeline/
      detection.py     # graph build → GNN score → cluster → classify → risk indicators
    models/
      multignn.py      # PNAConv/GINEConv model definition + CSV resolver
    tests/
      test_serializer.py
      test_whitelist.py
      test_service_postgres.py
      conftest.py
  database/
    service.py         # ALL Postgres operations (sole DB layer)
    schemas/
      schema_postgres.sql
    migrations/        # numbered migration files; applied on startup
  frontend/
    public/
      index.html       # legacy (was app entrypoint; now redirects via SPA fallback)
      app.html         # NEW — main app shell (uncommitted)
      landing.html     # NEW — landing page at / (uncommitted)
      argus_logo.svg   # NEW — logo asset (uncommitted)
    js/app.js
    css/style.css
    lib/               # Chart.js, Cytoscape (vendored)
config.py              # DATA_DIR, MULTIGNN_MAX_ROWS=800k, paths
scripts/
  serve.py             # uvicorn launcher (no --reload)
  train.py             # offline model training
data/
  multignn_model.pt    # trained weights (Git LFS / committed for deploy)
  multignn_meta.json   # threshold + metadata
  pipeline_cache.json  # cached full-pipeline result (load at startup)
```

---

## Dataset

- **HI-Medium** (`data/archive/datasets/IBM/HI-Medium_Trans.csv`)
- `MULTIGNN_MAX_ROWS = 800_000` — first 100k rows are low-connectivity Reinvestment self-loops (zero alert clusters); 800k gives ~42 alerts
- Model trained 6 epochs (early-stopped 4): test F1=0.0073, AUC=0.76, AP=0.17 — poor precision, but percentile-based top-1% alerting still yields coherent explainable clusters
- `_resolve_csv()` checks HI-Medium first, then TransXion tx.csv (kept, not deleted, deprioritized)

---

## Startup Flow

1. `init_db()` → `run_migrations()` (applies any unapplied migration files)
2. Load `pipeline_cache.json` if valid → populate `ALERTS` in-memory dict instantly
3. If no valid cache: run full pipeline (build graph → score → cluster → classify → risk indicators → serialize → write cache)
4. Replay live-ingest alerts from `live_transactions` table (so POSTed transactions survive restarts)

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Obtain session token |
| POST | `/auth/logout` | Invalidate session |
| GET | `/alerts` | List all alerts (whitelist-filtered) |
| GET | `/alerts/{id}` | Full alert: graph, transactions, risk indicators |
| POST | `/alerts/{id}/decision` | Confirm / Review / Dismiss (append-only log) |
| GET | `/accounts/risky` | Top risky accounts (dashboard card) |
| GET | `/account/{id}/history` | All flagged txns touching this account |
| GET | `/whitelist` | List exempt accounts |
| POST | `/whitelist` | Add account to whitelist |
| DELETE | `/whitelist/{id}` | Remove from whitelist |
| POST | `/ingest` | Ingest live transactions → neighborhood rescore (background thread) |
| POST | `/predict` | Upload CSV → score on demand |
| GET | `/` | Landing page (`landing.html`) — **CURRENTLY UNCOMMITTED** |
| GET | `/app` | Main app shell (`app.html`) — **CURRENTLY UNCOMMITTED** |

---

## Postgres Tables

| Table | Purpose |
|-------|---------|
| `alerts` | Current scan output; replaced wholesale each pipeline run |
| `decisions` | Append-only audit log (confirm/review/dismiss + reason + analyst) |
| `users` | Auth users (seeded) |
| `sessions` | Active session tokens |
| `live_transactions` | Every row POSTed to `/ingest` (audit trail + startup replay) |
| `whitelist_accounts` | Dynamic exempt-account list (survives restarts, unlike old JSON file) |
| `schema_migrations` | Tracks which migration files have run |

---

## Recent Commits (HEAD = f077a32)

```
f077a32 Persist live-ingest alerts across restarts by replaying on startup
0cb1300 Docs: correct /ingest description
bfd729e Add in-app Refresh button
82b6141 Predict: infinite scroll to load all rows past the first 100
15392f1 gitignore demo CSVs so the HF deploy stops deleting them
09951f8 Auto-refresh alerts + dashboard after Add-to-system
0c4f27c Predict: drop nested table scroll
2c784b8 Serve index.html with no-store so deploys are picked up immediately
f8b6202 Remove dead data/whitelist.json (whitelist is Postgres-backed)
c3bf67e Add Live Ingestion Feed to Dashboard
```

---

## Uncommitted Changes (as of 2026-07-08)

| File | Status | Notes |
|------|--------|-------|
| `src/backend/api/main.py` | Modified | Landing page split: `/` → `landing.html`, `/app` → `app.html` |
| `src/frontend/public/app.html` | Untracked | New app shell |
| `src/frontend/public/landing.html` | Untracked | New landing page |
| `src/frontend/public/argus_logo.svg` | Untracked | Logo asset |
| `src/frontend/public/index.html` | Modified | Minor changes |
| `ARCHITECTURE.md` | Modified | Minor doc update |
| `README.md` | Modified | Minor doc update |
| `.claude/launch.json` | Modified | Dev server config |

**Key uncommitted change in `main.py`:**  
`_index_response()` renamed to `_html_response(filename)`. Route `/` now serves `landing.html` instead of `index.html`. New route `/app` serves `app.html`. SPA fallback also points to `app.html`.

---

## Known Gaps / Open Work

- **No staging environment** — one Space, one DB, deploys go straight to prod; `rollback-hf.ps1` is the safety net
- **Auth is sha256+salt**, not bcrypt; single admin-level roles (no per-analyst RBAC)
- **Live rescore is incremental** (`/ingest` rescores the neighborhood only; full re-score needs a pipeline re-run / container restart)
- **No mobile layout** — desktop-only, explicitly out of scope
- **2-hop account search** — right-click shows 1-hop mini-graph; full 2-hop search not built
- **Per-alert PDF export** — CSV export of Case Manager decisions exists; per-alert SAR-bundle PDF not built
- **Cross-alert account linking** — no UI flag when same account appears in multiple alerts

---

## How to Run Locally

```bash
# Requires real Postgres — no SQLite fallback
export DATABASE_URL=postgresql://...
pip install -r requirements.txt
PYTHONPATH=src python scripts/serve.py   # no --reload
```

**Use system Python** (`C:\Users\viraj\AppData\Local\Python\pythoncore-3.14-64\python.exe`), not the venv — venv missing `slowapi`/`psycopg2`.

Delete `data/pipeline_cache.json` to force a full re-score instead of loading from cache.

---

## CI

`.github/workflows/ci.yml` runs pytest on `src/backend/tests/` with a dummy `DATABASE_URL` env var (so `database.service` imports without a real DB). Tests cover serializer logic and whitelist rules — no DB/torch needed.
