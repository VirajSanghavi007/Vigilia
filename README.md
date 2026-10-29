# Vigilia

Graph-based anti-money-laundering (AML) detection. Transactions are stored as a graph (accounts and money flows), so laundering patterns like fan-out, fan-in and cycles can be found by looking at how money moves, not just at single rows.

Vigilia started as **Argus**, a graph neural network (GNN) with an analyst dashboard built for the **iDEA 2.0 hackathon** (Top 40+ finalist, judged by Union Bank of India). It is now being rebuilt as a platform that can take a live transaction stream at bank scale, with every design choice backed by a measured benchmark.

## Highlights

- **Found and fixed a 137x ingestion bottleneck at 1M nodes.** Live ingestion fell to **25 rows/s** on a 1,000,000-node graph. After four hypotheses were ruled out one by one (snapshots, WAL rotation, garbage collection, constraints), `PROFILE` showed every `MERGE` doing a full label scan: in Memgraph a unique constraint is not a queryable index. After the fix, the real API endpoint sustains **3,429 rows/s** on the same graph with zero errors. ([write-up](docs/BENCHMARK.md#root-cause-found-a-unique-constraint-is-not-a-queryable-index))
- **Bulk load at 1.17M rows/s.** Loaded the Elliptic Bitcoin dataset (203,769 transactions, 234,355 edges) in 1.64s with sharded `LOAD CSV`, about 4,500x faster than driver-side batching and in line with Memgraph's published number.
- **Shard count tested, not assumed.** At 15M nodes, 16 shards beat 24, even on a 24-core machine.
- **Hot/cold storage**: Memgraph in memory for recent activity, archived to Neo4j for history.

All numbers, methods and dead ends are in [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Architecture

```
transactions ──> FastAPI /v1/ingest (single + batched) ──> Memgraph (hot graph)
                                                              │
                                                              └──> Neo4j archive (cold)
                                                                       │
                       planned: rule-based detectors, GNN scoring, analyst dashboard
```

Code is a layered monolith under `src/vigilia/`: `api` (FastAPI routers and schemas), `domain` (graph store interface), `infra` (Memgraph and Neo4j clients, snapshot export, write-back), `ml` (model registry with versioned records).

## Status

| Part | State |
|---|---|
| Graph storage (Memgraph), bulk + live ingestion, Neo4j archive | Built and benchmarked |
| Postgres event log as source of truth | Planned |
| Rule-based detectors, then GNN baseline | Planned |
| Analyst dashboard | Built in v1 (see below), to be ported |

Full plan: [docs/ROADMAP.md](docs/ROADMAP.md). The rule for the rebuild: add one component at a time and benchmark before adding the next, so every slowdown can be traced to its cause.

## v1: Argus (hackathon version)

The original app is preserved at commit [`90c3000`](https://github.com/VirajSanghavi007/Vigilia/tree/90c3000): a PyTorch Geometric GNN (PNAConv) scoring transactions on the IBM AML dataset, alert clustering by topology (fan-out, fan-in, cycle), a FastAPI + Postgres backend with authentication and an audit trail, and a dashboard with Cytoscape.js network graphs and Chart.js charts. Built as a team project for the hackathon.

## Run it

Needs Docker and [uv](https://docs.astral.sh/uv/).

```bash
docker compose up -d                      # Memgraph on :7687, Memgraph Lab on :3000
uv sync --locked --group dev
uv run uvicorn vigilia.api.main:app --reload   # API on :8000, docs at /docs
```

## Tests

```bash
uv run pytest tests/unit          # fast, no database
uv run pytest tests/smoke
uv run pytest tests/integration   # needs Memgraph running
```

CI (GitHub Actions) runs lint, unit, smoke and integration tests, a security scan (bandit) and a Docker build.

## Tech

Python, FastAPI, Memgraph, Neo4j, Docker, PyTorch Geometric, pytest, GitHub Actions.
