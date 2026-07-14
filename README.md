# Argus — AML Intelligence Platform

Real-time anti-money laundering detection using a Multi-GNN (Graph Neural Network) that classifies transactions as laundering/legitimate directly on the transaction multigraph.

**Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) (system design, diagrams, known gaps) · [API.md](API.md) (endpoint reference) · [src/database/migrations/README.md](src/database/migrations/README.md) (schema change process)

## Folder Structure

```
src/
  backend/
    api/main.py          FastAPI application (all routes, lifespan, static serving)
    core/
      serializer.py      Raw alert → frontend JSON shape
      whitelist.py        Account/bank exemption logic (rules in code, accounts in Postgres)
    models/multignn.py   Multi-GNN model (PNAConv + GINEConv, edge-level classifier)
    pipeline/detection.py Detection pipeline (graph build → score → cluster → serialize)
    utils/logging.py     Structured logging setup
    tests/               Pytest suite (pure logic only — no DB, no torch)
  database/
    service.py           PostgreSQL persistence (alerts, decisions, audit trail, whitelist, sessions)
    schemas/schema_postgres.sql   Database schema
  frontend/
    public/index.html    Dashboard HTML
    js/app.js            Vanilla JS frontend (deployed)
    css/style.css        Styles
    lib/                 Vendor libraries (Chart.js, Cytoscape)
  config.py              Central configuration (all paths, env vars, tunables)
config/
  requirements-dev.txt   CI/test dependencies (no torch)
scripts/
  train.py               Model training CLI (offline — not used by the running server)
requirements.txt         Production dependencies (used by Dockerfile and local installs)
```

## Running Locally

```bash
# 1. Create virtual environment
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac

# 2. Install dependencies
pip install -r requirements.txt

# 3. Point at a Postgres database (required — there is no SQLite fallback)
# Copy .env.example to .env (or export the vars directly) and fill in DATABASE_URL.
export DATABASE_URL=postgresql://user:pass@host:5432/dbname
# Schema/migrations run automatically on startup — no separate migrate command.

# 4. Place dataset
# HI-Medium_Trans.csv under data/archive/datasets/IBM/ (gitignored, not in repo)

# 5. Train the model (optional — app runs in degraded mode without it)
python scripts/train.py --epochs 6 --datasets data/archive/datasets/IBM/HI-Medium_Trans.csv --max-rows 1500000

# 6. Start the server (no --reload: watchfiles spawns duplicate workers
#    that fight over the port when the pipeline writes to data/ on startup)
PYTHONPATH=src python -m uvicorn backend.api.main:app --host 0.0.0.0 --port 8000
# Open http://localhost:8000
```

## Testing

```bash
PYTHONPATH=src python -m pytest src/backend/tests/ -v
```

Two kinds of tests live side by side:
- **Pure-logic tests** (`test_serializer.py`, `test_whitelist.py`) — no DB connection needed, always run.
- **Postgres-backed tests** (`test_service_postgres.py`) — cover `replace_alerts`, `record_decision`, session create/validate/expire, whitelist add/remove, live-ingest storage. These **skip automatically** unless `DATABASE_URL` points at a reachable database. They only ever touch uniquely-prefixed `TEST-PYTEST-*` rows and clean up after themselves in a `finally` block, so it's safe to point them at the same database backing the live deployment. The one genuinely destructive test (`replace_alerts`, which wipes and rebuilds the whole `alerts` table) additionally requires `ALLOW_DESTRUCTIVE_DB_TESTS=1` — do not set that against production.

## Deploying

Live deployment is Hugging Face Spaces (Docker SDK) — see `deploy-hf.ps1` for the one-command redeploy. The Dockerfile installs `requirements.txt` for the core API, then installs CPU `torch` + `torch_geometric` separately for the ML path. `DATABASE_URL` must be set as an HF Space **secret** (never committed to a file).

The model file (`data/multignn_model.pt`) and `data/pipeline_cache.json` are gitignored but force-added by `deploy-hf.ps1` so the deployed app serves alerts immediately without re-running the pipeline cold.

**Rollback:** every successful deploy is tagged locally as `hf-deploy-YYYYMMDD-HHMMSS`. Run `.\rollback-hf.ps1` with no arguments to list available tags, or `.\rollback-hf.ps1 <tag>` to redeploy that exact state through the same clean-branch process `deploy-hf.ps1` uses (so it stays LFS/binary-file compliant).

There is currently no separate staging environment — every push goes straight to the one production Space. A bad deploy is caught by noticing the Space logs/behavior, then rolling back with the command above.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | *(required)* | Postgres connection string — no local fallback |
| `PORT` | `8000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `MULTIGNN_MAX_ROWS` | `800000` | Max transactions read from the dataset at pipeline startup |
| `ARGUS_INGEST_KEY` | *(unset)* | If set, required as `X-API-Key` header on `POST /ingest` |
| `ARGUS_SECRET` | `argus-aml-2026` | Salt for password hashing |

## Key Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Health check (always 200) |
| `GET /status` | Pipeline status + alert breakdown |
| `GET /alerts` | List all alerts |
| `POST /alerts/{id}/decision` | Record analyst decision |
| `GET /decisions` | Current decisions |
| `GET /whitelist` | View whitelisted accounts |
| `GET /accounts/risky` | Top accounts by aggregate laundering-edge risk |
| `GET /account/{id}/history` | Full flagged-transaction history for one account |
| `POST /ingest` | Stream live transactions in (single, batch, or `{transactions: [...]}`) |
| `POST /predict` | Score an uploaded CSV/Excel of transactions on demand |
