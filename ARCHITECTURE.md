# Argus — Architecture

A system overview for anyone new to the codebase. For "how do I run this," see [README.md](README.md). For endpoint-by-endpoint detail, see [API.md](API.md).

## System diagram

```
┌─────────────────────┐      ┌──────────────────────────────────────┐
│  IBM HI-Medium CSVs  │      │           Hugging Face Space          │
│  (Trans/Accounts/    │      │              (Docker, 7860)           │
│   Patterns) — offline│      │                                        │
└──────────┬───────────┘      │  ┌──────────────────────────────────┐  │
           │                  │  │        FastAPI  (main.py)         │  │
           ▼                  │  │                                    │  │
┌──────────────────────┐      │  │  lifespan startup:                │  │
│  scripts/train.py     │      │  │   1. init_db() → run_migrations() │  │
│  → multignn.py         │      │  │   2. run pipeline (or load cache) │  │
│  (offline, once)       │      │  │                                    │  │
└──────────┬───────────┘      │  │  routes:                          │  │
           │                  │  │   /auth/*     session login        │  │
           ▼                  │  │   /alerts*    list / detail /      │  │
 data/multignn_model.pt       │  │                decision            │  │
 data/multignn_meta.json      │  │   /accounts/risky, /account/{id}/  │  │
 data/pipeline_cache.json     │  │                history  (node view)│  │
 (committed via LFS/deploy)   │  │   /whitelist* exemptions           │  │
           │                  │  │   /ingest     live txn intake      │  │
           │  loaded at       │  │   /predict    on-demand CSV score  │  │
           │  container start │  └──────────────┬───────────────────┘  │
           ▼                  │                 │                       │
┌──────────────────────┐      │                 │ psycopg2 pool          │
│  pipeline/detection.py│◄─────┘                 ▼                       │
│  graph build → GNN     │      │  ┌──────────────────────────────────┐  │
│  score → cluster →      │      │  │      PostgreSQL (Supabase)        │  │
│  classify pattern →     │      │  │  alerts · decisions · users ·     │  │
│  risk indicators →      │      │  │  sessions · live_transactions ·   │  │
│  serialize               │      │  │  whitelist_accounts ·             │  │
└──────────────────────┘      │  │  schema_migrations                │  │
                                │  └──────────────────────────────────┘  │
                                │                                        │
                                │  static/  →  frontend/ (vanilla JS +   │
                                │              Cytoscape.js + Chart.js)  │
                                └──────────────────────────────────────┘
```

## The three layers

### 1. Model layer — `src/backend/models/multignn.py`

A **Multi-GNN**: PNAConv (Principal Neighbourhood Aggregation) message-passing over a graph where nodes are bank accounts and edges are transactions, followed by a GINEConv-style edge classifier head. It scores every transaction with a laundering probability — this is edge-level classification, not node classification (an account itself isn't labeled; a *transfer* is).

Trained offline via `scripts/train.py` against the IBM HI-Medium dataset. The trained weights (`multignn_model.pt`) and metadata (`multignn_meta.json`, includes the chosen decision threshold) are committed as small binary artifacts — the running server never trains, only loads and scores.

### 2. Detection pipeline — `src/backend/pipeline/detection.py`

Runs once at container startup (or loads a cached result — see below):

1. **Build the graph** from the CSV — accounts as nodes, transactions as edges.
2. **Score every edge** with the loaded model.
3. **Cluster** connected high-score edges into candidate alert groups.
4. **Classify the topology** of each cluster (FAN_OUT, FAN_IN, CYCLE, SCATTER_GATHER, GATHER_SCATTER, BIPARTITE, or RANDOM).
5. **Compute risk indicators** — concrete, cited red-flags per cluster (structuring, pass-through/mule accounts, velocity, cross-currency layering, off-hours timing, round-number amounts, confluence of multiple signals). This is what answers "why is this flagged" beyond just the topology name.
6. **Serialize** into the JSON shape the frontend renders (`src/backend/core/serializer.py`).

Because a full pipeline run over the dataset takes real time, the result is cached to `data/pipeline_cache.json`. On startup, if a valid cache exists, the server loads it instantly instead of re-running the whole pipeline — this is what makes cold starts on Hugging Face fast.

### 3. API + persistence layer — `src/backend/api/main.py` + `src/database/service.py`

FastAPI serves both the JSON API and the static frontend. `database/service.py` is the **only** place that talks to Postgres — every other module (whitelist rules, the pipeline, the API routes) calls into it rather than running raw SQL itself.

**Postgres is required, no local fallback.** The schema is built from numbered files in `src/database/migrations/` (see that folder's README) rather than a single monolithic script — `service.py`'s `run_migrations()` runs on every startup and applies whatever hasn't been applied yet.

Tables: `alerts` (current scan output, replaced wholesale each pipeline run), `decisions` (append-only audit log — confirm/review/dismiss with reason + analyst), `users` / `sessions` (auth), `whitelist_accounts` (exempt accounts, survives restarts), `live_transactions` (everything POSTed to `/ingest`, kept as an audit trail), `schema_migrations` (tracks which migration files have run).

## Request flow: "an analyst investigates an alert"

```
Browser                     FastAPI                      Postgres
   │  GET /alerts               │                             │
   ├────────────────────────────►  reads in-memory ALERTS      │
   │  ◄─── list of alert cards ─┤  (populated at startup from  │
   │                             │   pipeline_cache.json)       │
   │  click an alert             │                             │
   │  GET /alerts/{id}           │                             │
   ├────────────────────────────►  full alert incl. graph,     │
   │                             │  transactions, risk          │
   │  ◄── full detail JSON ──────┤  indicators                  │
   │  (renders Cytoscape graph)  │                             │
   │                             │                             │
   │  click a node in the graph   │                             │
   │  GET /account/{id}/history   │                             │
   ├────────────────────────────►  scans in-memory alerts for   │
   │  ◄── every txn involving ───┤  txns touching this account  │
   │      this account            │                             │
   │                             │                             │
   │  Confirm / Review / Dismiss │                             │
   │  POST /alerts/{id}/decision │                             │
   ├────────────────────────────►  record_decision()  ─────────►  INSERT INTO decisions
   │  ◄── ok ─────────────────────┤                             │  (append-only)
```

## Request flow: "new data comes in live"

```
n8n / curl / your own script
   │  POST /ingest  {transactions: [...]}
   ├──────────────────────────────► validated against TransactionIn model
                                       │
                                       ├─► store_live_transactions() ──► INSERT INTO live_transactions
                                       │                                  (audit trail)
                                       └─► _rescore_neighborhood() on a
                                           background thread → scores the
                                           subgraph around the new accounts →
                                           merges any new clusters into ALERTS
```

**Note on `live_transactions`:** every ingested row is recorded as an audit trail **and** kicks off a background **neighborhood rescore** (`_rescore_neighborhood` in `main.py`): it builds a mini-graph from the new rows, scores/filters them, classifies any resulting cluster's topology, and merges new alerts into the in-memory `ALERTS` set within seconds — so live-ingested activity appears in the Dashboard Live Ingestion Feed and Investigate without waiting for a full pipeline re-run. The full-dataset re-score still only happens on a container restart or manual trigger; the neighborhood rescore is the fast, incremental path. Frontend views pull the new alerts via the in-app **Refresh** button (or the Live Feed's own polling).

## Deploy topology

- **Hosting:** Hugging Face Spaces, Docker SDK, one container (`Dockerfile` at repo root), port 7860.
- **Database:** Supabase-hosted Postgres, connected via `DATABASE_URL` set as an HF Space *secret* (never in a file).
- **Deploy mechanism:** `deploy-hf.ps1` builds a clean orphan git branch (no wheel-file history, model tracked via Git LFS, HF Space metadata injected into `README.md`) and force-pushes it to the Space's `main`. Every successful deploy is tagged locally (`hf-deploy-YYYYMMDD-HHMMSS`) so `rollback-hf.ps1 <tag>` can redeploy an older known-good state through the same clean-branch path.
- **No staging environment** — there is one Space, one database. See the "known gaps" section below for the tradeoff.

## Known gaps (honest, as of this writing)

- **No staging environment.** Every deploy goes straight to the one production Space. A bad deploy is caught by a human noticing, not by a pre-prod check. Mitigated by: `rollback-hf.ps1` makes reverting fast once noticed.
- **Live rescore is incremental, not full.** `/ingest` triggers a *neighborhood* rescore (the subgraph around new accounts), which is fast but doesn't re-evaluate the entire existing graph against the new data. A full re-score still requires a pipeline re-run. True continuous streaming is the productionization step.
- **No mobile-specific layout.** The frontend is desktop-oriented; mobile is explicitly out of scope for this project.
- **Single shared admin credentials**, not per-analyst accounts with fine-grained roles — a known gap for production deployment.
