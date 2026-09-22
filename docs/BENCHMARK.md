# Memgraph Benchmark — Full Elliptic Dataset Load

Status: graph-DB-only benchmarking (roadmap steps 9/11). Per the roadmap's
incremental policy, no other component (Postgres, cache, MQ, GNN) is
benchmarked yet — that's step 13, after these numbers are settled.

Dataset: real Elliptic Bitcoin dataset (`data/elliptic_bitcoin_dataset/`,
gitignored) — 203,769 transaction nodes, 234,355 `SENT_TO` edges.

Memgraph: `memgraph/memgraph-mage:latest` (v3.13.1), Docker Desktop on
Windows, 20.51GiB memory limit available to the container. Idle baseline
(container up, empty graph): ~570–620 MiB.

## How to reproduce

Every run below started from a fully wiped instance:

```bash
docker compose down -v && docker compose up -d
```

Then wait for real Bolt readiness before connecting — a fixed `sleep`
isn't reliable (confirmed the hard way: a shard-count sweep below lost
6 full iterations to `sleep 6` not being enough after a fresh `up -d`,
silently producing `ServiceUnavailable` on every single one):

```bash
for i in $(seq 1 30); do
  uv run python -c "from neo4j import GraphDatabase; d=GraphDatabase.driver('bolt://localhost:7687'); d.verify_connectivity(); d.close()" \
    && break
  sleep 1
done
```

## Results

| Approach | Storage mode | Nodes | Edges | Time | Throughput | Peak RAM |
|---|---|---|---|---|---|---|
| Sequential UNWIND (1 connection) | Transactional | **stalled** at 120,000/203,769 (58.9%) | 0 | n/a — one batch measured 77.5s and still climbing when killed | n/a | not captured |
| Concurrent UNWIND (8 workers) | Analytical | 203,769 (100%) | 234,355 (100%)* | 1,032.5s (17.2 min) | 262 rows/s (nodes), 919 rows/s (edges) | 823 MiB |
| Concurrent `LOAD CSV` (8 shards) | Analytical | 203,769 (100%) | 234,355 (100%) | **1.64s** | **1,172,963 rows/s** (nodes), 811,678 rows/s (edges) | ~679 MiB |

\* Edges phase for the concurrent-UNWIND run was itself stalled near 0
progress for ~250s until a plain index was added on `:Transaction(txId)`
mid-run — see "Findings" below. The 919 rows/s edge figure is measured
*after* that index existed, not an average over the stall.

### `LOAD CSV` shard-count sweep

24 logical cores are available on this machine — does shard count matter,
and does more shards = faster? Tested 2/4/8/12/16/24 shards, each on a
freshly wiped instance, one run per count:

| Shards | Total wall time | Nodes rate | Edges rate |
|---|---|---|---|
| 2 | 2.36s | 524,880 rows/s | 243,372 rows/s |
| 4 | 1.71s | 855,901 rows/s | 523,502 rows/s |
| 8 | 1.59s | 904,247 rows/s | 755,267 rows/s |
| 12 | 1.86s | 629,890 rows/s | 698,353 rows/s |
| 16 | 1.92s | 487,512 rows/s | 778,149 rows/s |
| 24 | 1.78s | 951,029 rows/s | 639,180 rows/s |

Honest read, not a clean "more is better" curve: **2 shards is clearly
worse** (too little parallelism — real signal, consistent across the
whole run). But 4 through 24 all land in a **1.6–1.9s band with no
monotonic trend** — 8 happens to have the best total time in this run,
but at this dataset size (203,769 nodes) the *entire* load finishes in
under 2 seconds regardless of shard count once there's "enough"
parallelism, so per-shard fixed overhead (connection setup, `LOAD CSV`
statement compilation) is likely dominating any real difference between
4/8/12/16/24 — this is one run per count, not an average, and at
sub-2-second scale that's not enough to separate signal from noise.
**Not yet re-tested at a scale where shard count would plausibly matter**
(the load taking long enough that fixed per-shard overhead stops
dominating) — worth revisiting once the synthetic-data generator
(roadmap step 11, `scripts/generate_synthetic_stream.py`) produces a
dataset large enough to actually stress this.

**Headline number: `LOAD CSV` is ~4,475x faster than driver-side UNWIND
for bulk-loading this dataset** (262 → 1,172,963 rows/s), and matches
Memgraph's own published benchmark almost exactly (see Sources).

## Findings

### 1. Sequential transactional-mode writes degrade to a stall, not just "slow"

The very first attempt — one connection, batched `UNWIND ... MERGE`,
default `IN_MEMORY_TRANSACTIONAL` mode — made steady progress to 120,000
nodes, then a single 5,000-row batch measured 77.5 seconds elapsed and
still climbing (confirmed via `SHOW TRANSACTIONS`) before it was killed.
This isn't linear slowdown, it's degradation toward a full stall,
consistent with MVCC/Delta-tracking overhead compounding as the graph
grows under transactional mode.

### 2. `IN_MEMORY_ANALYTICAL` mode is real, but has real constraints of its own

Official Memgraph docs: analytical mode "imports data up to 6 times
faster... because it does not create Delta objects," and supports
genuinely parallel writes (vs. transactional mode, where concurrent
writers contend over MVCC storage access — this is what produced a
`TransientError: Cannot get read-only/shared access to the storage`
during an earlier accidental double-launch of the sequential loader, and
again during the first concurrent-UNWIND attempt).

Two real constraints discovered hands-on, not just from docs:

- **Constraints are rejected outright in analytical mode**
  (`"Unique constraints are not supported in analytical storage mode"`).
  Fix: create the uniqueness constraint *after* switching back to
  transactional, not before switching to analytical.
- **`SHOW STORAGE INFO`'s `global_storage_mode` field is unreliable** —
  it reported `IN_MEMORY_TRANSACTIONAL` even when analytical mode was
  confirmed active by every other signal. The only trustworthy way to
  verify the switch took effect: attempt a constraint creation and
  confirm it's rejected with the analytical-mode-specific error. (A
  Memgraph-docs research pass found no license/edition gate on this —
  it's Community-Edition-available; the stale field is a docs/behavior
  gap, not a licensing issue.)

### 3. Removing the constraint for analytical-mode compatibility also removes the index MATCH needs

Both the concurrent-UNWIND and `LOAD CSV` edge-loading phases create
edges via `MATCH (a:Transaction {txId: ...})`. Without the uniqueness
constraint (which normally also provides an index), that MATCH has no
index to use — Memgraph falls back to a full label scan per lookup. In
the concurrent-UNWIND run, the edges phase sat at ~0/234,355 for roughly
250 seconds; adding a plain index (`CREATE INDEX ON :Transaction(txId)`
— allowed in analytical mode, unlike a uniqueness constraint) mid-run
caused every already-queued edge write to complete within about 2
seconds. Fix applied to the `LOAD CSV` script: create the plain index
right after the nodes phase, before edges start, not after the whole
load finishes.

### 4. Driver-side UNWIND and native `LOAD CSV` are not comparable approaches

Memgraph's own benchmark blog claims 1.2M inserts/sec, achieved with 10
concurrent `LOAD CSV` connections in analytical mode — a number that
looked unreachable via the Python driver (262 rows/s, ~4,500x off) until
actually switching to the same approach: `LOAD CSV`, run server-side,
reading pre-sharded CSV files mounted directly into the container
filesystem (`docker-compose.yml`'s `./data/syndata/csv_shards:/csv_shards:ro`
mount), with no Python-side batch construction or Bolt-protocol parameter
serialization in the loop at all. That reproduced Memgraph's published
number almost exactly (1,172,963 rows/s vs. their claimed 1.2M/s) on this
machine's hardware, using `CREATE` (not `MERGE`, since the load target
was a known-empty graph — the correct choice for a one-time bulk import,
not for incremental production writes, which still need `MERGE`'s
idempotency).

## Implications for the hot/cold architecture (roadmap step 1) and future ingestion (step 3)

- **One-time historical backfills** (e.g. seeding the graph from an
  existing data warehouse) should use `LOAD CSV` + analytical mode, not
  the driver. ~4,000x+ throughput difference is not a rounding error.
- **Incremental/live ingestion** (the eventual FastAPI endpoint, roadmap
  step 3) is a fundamentally different workload — single-row writes
  arriving continuously, not a bulk backfill — so `MERGE` + transactional
  mode is still the right default there; `LOAD CSV` doesn't apply to a
  one-row-at-a-time API call. The synthetic variable-rate stream
  generator (`scripts/generate_synthetic_stream.py`) exists specifically
  to benchmark *that* workload shape separately from this bulk-load
  number — don't conflate the two.
- Any future bulk re-load of the hot tier (e.g. rebuilding from the cold
  tier after an eviction-policy change) should default to the `LOAD CSV`
  approach given this result.

## Scripts

- `scripts/benchmark_full_load.py` — sequential, transactional mode,
  resumable (checkpoints by counting existing nodes/edges on start).
- `scripts/benchmark_parallel_load.py` — concurrent UNWIND, analytical
  mode, `--workers N`.
- `scripts/benchmark_loadcsv.py` — concurrent `LOAD CSV`, analytical
  mode, `--shards N`. Shards the real dataset into
  `data/syndata/csv_shards/` (gitignored, regenerated each run) — the
  Memgraph container must be (re)started after `docker-compose.yml`'s
  volume mount is added/changed for shards to be visible inside it.

## Sources (Memgraph official documentation, unless noted)

- [Import best practices](https://memgraph.com/docs/data-migration/best-practices) — batch size guidance (10K–100K elements), pre-import indexing
- [Import data overview](https://memgraph.com/docs/memgraph/import-data) — `LOAD CSV` as the recommended import path
- [How to Import 1 Million Nodes and Edges per Second Into Memgraph](https://memgraph.com/blog/how-to-import-1-milllion-nodes-and-edges-per-second-to-memgraph) — the 1.2M/s benchmark this test reproduced
- [Memgraph Storage Modes Explained](https://memgraph.com/blog/memgraph-storage-modes-explained) — analytical vs. transactional tradeoffs
- [Bulk import in analytical mode](https://memgraph.com/docs/clustering/high-availability/analytical-import) — Enterprise badge scoped to HA/replicated clusters only, not the base storage-mode switch
- [Transaction errors — help center](https://memgraph.com/docs/help-center/errors/transactions) — the exact `TransientError` message encountered, confirmed as by-design MVCC contention prevention
- [Storage access](https://memgraph.com/docs/fundamentals/storage-access)
- [Indexes](https://memgraph.com/docs/fundamentals/indexes)
- [GitHub issue #2226](https://github.com/memgraph/memgraph/issues/2226) — historical (fixed) unrelated-index MERGE regression, noted for awareness
