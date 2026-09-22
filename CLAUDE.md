# Vigilia — Project Charter & Working Rules

## What this project is

Vigilia is a **research-grade, production-target AML (anti-money-laundering) graph ML system**. Priority order for every decision:

1. **AI/ML correctness and rigor first** — the model, features, graph construction, and evaluation methodology are the core deliverable and must hold up to research and production scrutiny (not a toy/demo model).
2. **Production-quality engineering second** — backend, ML infra, and other stacks exist to serve the AI/ML core reliably. They matter, but they are not the point of the project.
3. Everything else (docs, tooling, polish) comes after both.

This is **not** a quick prototype and **not** a portfolio throwaway. Treat it as if it will run in production on real data, be audited, and be extended by other researchers/engineers later.

## Current state (2026-09-20 — verify before relying on it)

The codebase was deliberately wiped and restarted from a layered-architecture skeleton (previous version had real but architecturally tangled AML detection/GNN/auth/DB logic — see git history before this point if you need to reference what existed). Right now:

- Only `src/vigilia/api/main.py` (a bare `/health` endpoint) and `src/vigilia/ml/registry/` (model registry, see below) have real logic. Every other package under `src/vigilia/` is an empty layer stub with a docstring describing its purpose.
- Detection pipeline, GNN model, graph construction, auth, and the Postgres layer do **not exist yet** — they're being rebuilt deliberately inside this structure, not resurrected wholesale from memory of the old code.
- Do not assume anything beyond what's listed above is implemented. Read the relevant package before claiming it does something.

## Architecture: layered / modular monolith

```
src/vigilia/
├── api/      FastAPI only — routers, schemas, deps. No business logic.
├── domain/   Framework-agnostic business logic (alerts, whitelist, auth rules).
│             No fastapi/psycopg2/boto3/torch imports here.
├── ml/       Graph construction, model defs, training, inference, registry.
├── infra/    The only layer allowed to import psycopg2/boto3/etc. Implements
│             interfaces domain/ defines (dependency inversion).
└── shared/   Logging, exceptions. No dependency on any other layer.
```

**Dependency rule**: `api → domain/ml/infra`, `ml → domain`, `infra` implements interfaces `domain` defines. Never the reverse — `domain/` must stay importable with zero framework/infra dependencies. If you're about to import `fastapi` or `psycopg2` inside `domain/`, stop; that logic belongs in `api/` or `infra/`, or `domain/` needs a Protocol instead.

## Model registry (`src/vigilia/ml/registry/`)

Models are never referenced by filename (no `model_final_v3.pkl`). A version is a record: `{YYYYMMDD}-{git_sha}-{run_id}`, with weights + `metadata.json` (metrics, git SHA, training-data hash, feature schema) stored together, plus a separate "stage" pointer (e.g. `production`) recording which version is actually live.

- `get_registry()` is the only way to obtain a registry instance — never instantiate `LocalRegistry` directly in application code.
- **`LocalRegistry` (filesystem-backed) is the only backend right now** — no AWS account/bucket exists yet. An `S3Registry` may be added later behind the same `ModelRegistry` interface; don't build one speculatively before there's a bucket to point it at.
- Registry data lives under `data/model_registry/` (gitignored).

## Build / test / lint commands

Dependency management is [uv](https://docs.astral.sh/uv/) — `pyproject.toml` + `uv.lock` are the single source of truth. Never add a `requirements*.txt`.

```bash
uv sync --locked --group dev        # core + dev deps (pytest, ruff, bandit, httpx)
uv sync --locked --extra ml --group dev   # + torch/torch_geometric (CPU wheels)

uv run pytest tests/unit -v          # fast, no torch/DB
uv run pytest tests/smoke -v         # loads the model, one input, checks output
uv run pytest tests/integration -v   # real API via TestClient (+ Postgres on Linux CI)

uv run ruff check src tests          # lint — CI-blocking, not advisory
uv run bandit -r src --severity-level medium
```

Adding a dependency: edit `pyproject.toml` (`dependencies`, `project.optional-dependencies.ml`, or `dependency-groups.dev`), then `uv lock`, then commit `uv.lock`. Don't hand-edit `uv.lock`.

## CI/CD (`.github/workflows/ci-cd.yml`)

Two branches: `development` (default, where work happens) and `production`. Runners are **Ubuntu-only** (`ubuntu-22.04`) — Windows was dropped from CI: no Docker daemon there meant DB-backed integration tests, Docker builds, and Memgraph all had to special-case or skip on it, for no benefit given development also happens on Windows locally. On every push: lint + unit tests (both branches) and security scanning (bandit, pip-audit, CodeQL, Trivy). Smoke tests, integration tests, Docker build, and the deploy gate run **production-only**. `deploy` requires manual approval on the GitHub `production` environment — it has no real deploy target wired in yet (placeholder step).

Integration tests get real Postgres and Memgraph containers (`docker run`, started as CI steps) since CI is always Linux now — no OS-conditional skipping needed. Locally, integration tests that need a real service should fail loudly with an actionable message when that service isn't reachable (e.g. "run `docker compose up -d memgraph`"), not skip silently — a skip would let the suite report "passed" without exercising real behavior. See `tests/integration/test_memgraph_integration.py` for the pattern.

## Hard rule: no unreviewed code changes

**Every code change must be verified by the user before or as part of being made.** Concretely:

- Do not make substantive code edits unprompted or "while you're at it." Propose the change, explain it, and get confirmation, unless the user has explicitly pre-approved that specific change in the current conversation.
- **Every code change must come with an explanation of *why* it's being made** (the problem it fixes, the tradeoff it makes, or the requirement it satisfies) — not just a description of what changed. No silent/unexplained diffs.
- Exception: documentation changes and read-only lookups/exploration do **not** require this — those can be done freely without prior confirmation.

## Practical implications for future sessions

- When asked to fix or build something, state the plan and reasoning first if it's non-trivial; don't just start editing.
- Model/detection correctness decisions (thresholds, architecture, evaluation methodology) should never be silently changed without discussion, since they change results.
- When editing, call out explicitly which known gap (if any) a change addresses, or state that it's unrelated and why it's needed.
- Don't add a new top-level dependency source (a second requirements file, a vendored copy of something) — `pyproject.toml`/`uv.lock` is the only one, on purpose (past drift between a requirements file and the lockfile was a real bug here).
