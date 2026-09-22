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

### `LOAD CSV` shard-count sweep, retested at 15,000,000 nodes

The 203,769-node sweep above finished too fast (under 2s) to separate
real shard-count effects from noise. Retested against a synthetic
15,000,000-node / 17,251,512-edge dataset — same column format as the
real dataset, generated using genuine multiprocessing (24 worker
processes, ~1.49M nodes/sec generated, 10.1s total; each worker wrote
an independent chunk — no shared state, no cross-worker coordination,
so `ProcessPoolExecutor` was the correct regime for this CPU-bound
work, not threads). The generator script and its 15M-row output were
one-off tooling for this specific test and have been removed after
capturing the findings below (recoverable from git history at commit
`c83e32a` if ever needed again) — this file is the durable record.
Tested 8/12/16/20/24 shards, each on a freshly wiped instance:

| Shards | Nodes phase | Edges phase | **Load time (nodes+edges)** | Total wall time* |
|---|---|---|---|---|
| 8 | 10.84s | 25.04s | 35.88s | 115.13s |
| 12 | 10.21s | 20.89s | 31.10s | 116.20s |
| **16** | **10.23s** | **18.59s** | **28.82s** | 120.74s |
| 20 | 12.99s | 22.42s | 35.41s | 137.31s |
| 24 | 27.77s | 32.40s | 60.17s | 159.33s |

\* "Total wall time" includes an untimed finalize step (switching back
to transactional mode + creating the uniqueness constraint across all
15M nodes) that is **not shard-count-dependent** — confirmed by
re-running the 16-shard case with that step separately timed: **73.01s**,
in the same range as every other run's implied finalize cost (79-99s),
regardless of shard count. Total wall time is a **confounded metric**
here: it's dominated by a roughly-constant cost unrelated to what shard
count actually controls, so ranking shard counts by total wall time
alone would be misleading — **16 shards is the real winner** by the
metric shard count actually affects (nodes+edges load time, 28.82s vs.
8 shards' 35.88s), not 8, even though 8 happened to draw a smaller
finalize-step time and so looked best by total wall time alone.

Two genuinely clear, monotonic-enough signals at this scale (unlike the
203K-row test, which showed a flat noisy band):
- **16 shards is the sweet spot** — best on both phases, or tied for it.
- **24 shards (= this machine's full logical core count) is
  dramatically worse**, not better — nodes phase alone takes 2.6x
  longer than at 8-16 shards (27.77s vs. ~10.2-10.8s). Matching shard
  count to core count is actively counterproductive here: Memgraph's
  own internal write coordination becomes the bottleneck once enough
  concurrent connections already saturate it, and additional
  connections beyond that just add contention overhead rather than
  more throughput. 20 shards shows the same degradation starting.

A second, separate finding from the same rerun: node+edge phases (29.88s)
plus the timed finalize phase (73.01s) sums to 102.89s, but total wall
time was 118.98s — a ~16s gap attributable to the untimed
`CREATE INDEX ON :Transaction(txId)` step (needed before the edges phase
can MATCH efficiently — see Finding 3 below) also taking real time at
15M-node scale, not the "instant" it appeared to be in the smaller test.

**Practical takeaway: benchmark shard count empirically per dataset
size, don't assume more shards (or "shards = cores") is better** — the
optimal count here (16) is neither the smallest tested (8) nor the
machine's core count (24), and the *ranking* of shard counts genuinely
changes between the 203K-row and 15M-row tests (8 tied-for-best at small
scale, 16 clearly best at large scale, 24 fine at small scale but the
worst option at large scale).

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
  mode, `--shards N`, `--source-dir <path>` (defaults to the real
  dataset; point at any directory with the same
  `elliptic_txs_classes.csv`/`elliptic_txs_edgelist.csv` format —
  e.g. a synthetic dataset — to benchmark at a different scale). Shards
  the source into `data/syndata/csv_shards/` (gitignored, regenerated
  each run) — the Memgraph container must be (re)started after
  `docker-compose.yml`'s volume mount is added/changed for shards to be
  visible inside it. Prints nodes/edges/finalize phases separately —
  finalize (constraint creation) is the dominant, largely
  shard-count-independent cost at large scale (see the 15M-node sweep
  above), so don't judge shard-count performance from total wall time.

## Live-ingestion (streaming) endpoint

Bulk-load benchmarking above covers one-time historical backfills. Live
ingestion is a different workload — a continuous stream of individually
arriving transactions, not a bulk file — so a new endpoint,
`src/vigilia/api/v1/routers/ingest.py`, serves this instead:
`POST /v1/ingest/transaction` and `POST /v1/ingest/edge`, one row per
request, `MERGE` + `IN_MEMORY_TRANSACTIONAL` (no analytical-mode switch
— that would break concurrent reads/writes this endpoint needs to
coexist with).

`scripts/generate_synthetic_stream.py --sink api` posts to this endpoint
instead of writing to Memgraph directly (`--sink memgraph`), benchmarking
the endpoint's real added overhead (HTTP + FastAPI + Pydantic validation)
on top of the same underlying `GraphStore` writes.

**First real result** (15s run, Poisson-process arrival rate): even the
**lowest tested target rate (87.2 rows/s) already fell behind** — 164
rows took 4.24s to send (should have taken 1.81s at that rate). At a
higher drawn rate (2,609.8 rows/s), 5,778 rows took 73.73s against a
2.28s budget. Every row sent did land correctly (5,942 sent, 5,942
present in Memgraph afterward — no data loss under load, just latency),
but throughput is dramatically lower than direct-driver writes, as
expected: each row pays a full HTTP round-trip + Pydantic validation
individually, with no batching at all. This is the real floor/ceiling
question the generator was built to answer (see its docstring) — this
first run found the ceiling is very low for the naive one-request-per-row
design; a real throughput number (requests/sec the endpoint can sustain)
needs a longer, steadier-rate run, not yet done.

### Sustained-rate + batching, measured (`scripts/benchmark_ingest_endpoint.py`)

Sent 2,000 rows through the endpoint at a fixed rate (not Poisson-drifting
this time, to isolate the batching variable), single Python `httpx.Client`,
comparing `POST /v1/ingest/transaction` (batch size 1) against
`POST /v1/ingest/transaction/batch` at a few batch sizes:

| Batch size | Time | Throughput |
|---|---|---|
| 1 (single-row) | 9.37s | 213.4 rows/s |
| **10** | **2.41s** | **830.5 rows/s** |
| 50 | 2.63s | 761.4 rows/s |
| 200 | 3.53s | 567.3 rows/s |

**Batching helps substantially (~3.9x at the best size), but nowhere near
the ~900x a community Neo4j benchmark found for single-row vs.
`UNWIND`-batched `MERGE`** (cited in the research below) — and batch
size 10 is a **sweet spot, not "bigger is better"**: 50 and 200 are both
*worse* than 10, the same non-monotonic pattern found in the bulk-load
shard-count sweep. Likely cause (not yet confirmed): larger single
`UNWIND` transactions in `IN_MEMORY_TRANSACTIONAL` mode pay more
MVCC/WAL overhead per transaction as the transaction gets bigger, so
past some point a bigger batch trades round-trip savings for
per-transaction cost — consistent with the same mode's behavior
documented in the bulk-load findings above, but not root-caused the way
the earlier findings were (no direct evidence yet, just a plausible
mechanism). All 8,000 rows across the 4 test runs landed correctly (no
data loss at any batch size) — this is purely a throughput question, not
a correctness one.

### Batch-size bisection, concurrency sweep, and sustained run (`scripts/benchmark_ingest_endpoint.py`)

Follow-up run closing the three open questions above: a finer batch-size
sweep around the batch=10 peak, a concurrency sweep (multiple HTTP
requests in flight via `ThreadPoolExecutor`, at the winning batch size),
and a 180s sustained run at the winning `(batch_size, concurrency)`.
Single `uvicorn` process throughout (`--workers` not set — still an open
question, see below).

**Phase 1 — batch-size bisection** (2,000 rows/run, single-threaded):

| Batch size | Time | Throughput |
|---|---|---|
| 5 | 3.96s | 505.7 rows/s |
| **8** | **2.41s** | **831.0 rows/s** |
| 10 | 3.21s | 623.1 rows/s |
| 12 | 4.04s | 495.2 rows/s |
| 15 | 4.88s | 409.8 rows/s |
| 20 | 5.74s | 348.6 rows/s |
| 30 | 6.49s | 308.4 rows/s |

Confirms the non-monotonic peak, but narrows it to **8**, not 10 — the
first run's 10 (830.5 rows/s) and this run's 8 (831.0 rows/s) are
statistically indistinguishable single-sample measurements, and this
run's own batch=10 point (623.1 rows/s) is noticeably worse than its
neighbors, which the earlier run didn't show either. Read this as "the
sweet spot is a narrow batch size in the 8–10 range, exact optimum not
resolvable from single-sample runs, more likely dominated by noise near
the peak than by a precise underlying optimum" rather than "8 is
definitively better than 10."

**Phase 2 — concurrency sweep** (batch_size=8, 3,000 rows/run,
`ThreadPoolExecutor` + `httpx.Client(limits=...)`):

| Concurrency | Time | Throughput | Errors |
|---|---|---|---|
| 1 | 14.59s | 205.6 rows/s | 0 |
| 2 | 9.55s | 314.0 rows/s | 0 |
| 4 | 6.33s | 474.1 rows/s | 0 |
| 8 | 4.80s | 625.5 rows/s | 0 |
| **16** | **4.26s** | **704.0 rows/s** | 0 |

Concurrency **does help**, monotonically, up to 16 (the highest level
tested), with **zero `TransientError`s at any level** — the write
contention feared from the driver-level bulk-load benchmarks (`Cannot
get read-only/shared access to storage`) did not materialize here. Likely
explanation: each HTTP request's batch is a separate short transaction
serviced by FastAPI's own concurrency, so the actual write pattern looks
more like many small sequential transactions than truly overlapping
writes to the same rows — this wasn't isolated directly, so treat it as
plausible, not proven. 16 wasn't a ceiling, just the highest level
tested; higher concurrency is now the same kind of open question the
batch-size sweep started as.

**Phase 3 — sustained run** (batch_size=8, concurrency=16, 180s):

| Elapsed | Rows sent | Window rate | Cumulative rate | Errors |
|---|---|---|---|---|
| 15.0s | 11,488 | 765.1 rows/s | 765.1 rows/s | 0 |
| 30.0s | 21,976 | 698.4 rows/s | 731.7 rows/s | 0 |
| 45.1s | 30,664 | 578.1 rows/s | 680.5 rows/s | 0 |
| 60.1s | 38,408 | 515.0 rows/s | 639.1 rows/s | 0 |
| 75.1s | 45,768 | 490.6 rows/s | 609.4 rows/s | 0 |
| 90.1s | 52,456 | 445.8 rows/s | 582.2 rows/s | 0 |
| 105.1s | 58,656 | 413.2 rows/s | 558.0 rows/s | 0 |
| 120.2s | 64,544 | 391.4 rows/s | 537.2 rows/s | 0 |
| 135.2s | 69,984 | 361.5 rows/s | 517.6 rows/s | 0 |
| 150.2s | 75,192 | 346.3 rows/s | 500.5 rows/s | 0 |
| 165.3s | 80,192 | 332.3 rows/s | 485.2 rows/s | 0 |

**Total: 84,880 rows in 180.2s = 470.9 rows/s average, 0 errors.**

This answers the third open question decisively, and not in the
optimistic direction: throughput **does not hold** — the windowed rate
falls steadily from 765 rows/s to 332 rows/s (a ~57% decline) over three
minutes, with no sign of leveling off by the end of the run. This is the
same "transactional-mode throughput degrades as the graph grows" pattern
already documented in the bulk-load findings above, now confirmed at the
live-ingestion endpoint too — not a coincidence unique to bulk loading.
Zero errors and zero data loss throughout (every row that was sent was
accepted), so this is purely a throughput-decay finding, not a
correctness or reliability one. Practical implication: a single-run
"rows/s" number for this endpoint is optimistic for anything longer than
a couple of minutes — capacity planning should use a decaying-rate model
(or the ~470 rows/s three-minute average) rather than the ~830 rows/s
best-case burst number from Phase 1.

### Root-causing the decay — what it is NOT, and the real-scale result

Four hypotheses were tested empirically, in order, each by resetting
Memgraph to a controlled state and re-measuring the same
`batch_size=8, concurrency=16` sustained burst:

1. **Missing index/constraint.** `ensure_constraints()` (which creates a
   `txId IS UNIQUE` constraint) was discovered to never be called
   anywhere in the app — every prior benchmark ran against an unindexed
   label. Created the constraint manually and re-ran against the
   already-114K-node graph: **no change** (rate stayed ~250–270 rows/s,
   same as before). Ruled out.
2. **Snapshot stalls.** Memgraph's default `--storage-snapshot-interval-sec=300`
   is wall-clock since server start, not per-run — across ~12 minutes of
   continuous benchmarking, snapshot files on disk were found exactly 5
   minutes apart, meaning a snapshot genuinely had been firing mid-run.
   (This matches [memgraph/memgraph#2860](https://github.com/memgraph/memgraph/issues/2860),
   a real report of "linear drop in throughput over time" traced to
   snapshot creation blocking writes.) Re-ran with
   `--storage-snapshot-interval-sec=3600` on a **fresh, empty graph**
   (so no snapshot could fire during the 180s window): decay was still
   present, same shape (1451.7 rows/s at 10s down to 333.7 rows/s at
   170s, 587.1 rows/s average). Ruled out as the (sole) cause.
3. **WAL rotation.** WAL segments rotate at 20MiB; the segment never
   reached that size during any single run. Ruled out.
4. **GC cycle interval.** Re-ran the same fresh-graph 180s test with
   `--storage-gc-cycle-sec=5` (vs. the 30s default): essentially
   identical curve (351.4 rows/s at 170s, 601.4 rows/s average — within
   noise of the default-GC run). Ruled out.

With every reachable Memgraph config knob ruled out, the open question
became whether the decay flattens toward some acceptable floor as the
graph grows, or keeps collapsing — not answerable by extrapolating from
the ~100K-node runs above, so it was tested directly.

**Real-scale test: 1,000,000 pre-loaded nodes.** Bulk-loaded 1M synthetic
`Transaction` nodes via `LOAD CSV` in analytical mode (3.23s, 309,632.9
rows/s — consistent with the bulk-load benchmarks above), switched back
to `IN_MEMORY_TRANSACTIONAL`, confirmed the unique constraint was intact
post-switch, then ran the same `batch_size=8, concurrency=16` sustained
burst against it:

| Elapsed | Rows sent | Window rate | Node count |
|---|---|---|---|
| 10.0s | 128 | 12.8 rows/s | 1,000,128 |
| 20.0s | 408 | 28.0 rows/s | 1,000,408 |
| 30.1s | 760 | 35.0 rows/s | 1,000,760 |
| 40.1s | 1,016 | 25.6 rows/s | 1,001,016 |
| 60.1s | 1,528 | 25.6 rows/s | 1,001,528 |
| 80.2s | 2,040 | 25.5 rows/s | 1,002,040 |

**Total: 2,304 rows in 92.9s = 24.8 rows/s average, 2 errors.**

This is not a gradual decay at this scale — it's a **cliff**: throughput
collapses to ~25 rows/s almost immediately and flatlines there, a **~33x
drop** from the 830 rows/s small-graph baseline. The unique constraint
was verified present after the mode switch (`SHOW CONSTRAINT INFO`
confirmed it), so this isn't the same missing-index bug as hypothesis 1
above — something about `MERGE`-based lookup/write cost against a
million-node label is fundamentally more expensive than the ~100K-node
runs predicted by extrapolation.

**Conclusion: this is an unresolved, serious problem, not a tuning
question.** Every config lever available from outside Memgraph
(indexing, snapshot interval, GC cycle) has been tested and ruled out.
The live-ingestion endpoint as currently built (`UNWIND ... MERGE`
per-batch, `IN_MEMORY_TRANSACTIONAL`) is not viable for continuous
ingestion once the graph reaches real AML-scale (millions of nodes) —
25 rows/s cannot keep pace with any realistic transaction stream.

**Not yet investigated (next session, before treating this as settled):**
- `EXPLAIN`/`PROFILE` the actual `MERGE` query against the 1M-node graph
  to see what Memgraph's query planner is actually doing — confirm
  whether the constraint's underlying index is being used for the
  lookup at all, rather than assuming it because `SHOW CONSTRAINT INFO`
  lists it.
- Whether Memgraph's unique-constraint index has different scaling
  characteristics than a label-property index (`CREATE INDEX`) — try
  both and compare.
- FastAPI/uvicorn worker count (`--workers`) — still untested; unlikely
  to explain a 33x cliff that correlates with graph size, but not ruled
  out.
- Whether this is specific to `MERGE`'s existence-check semantics
  specifically (vs. a pure `CREATE`, which skips the check) — would
  narrow the cause to lookup cost vs. write cost.

### Message queue (Kafka/Redpanda) research — should one sit in front of this endpoint?

Researched whether a queue is warranted, given the concern that data
could be lost or fall further behind if ingestion can't keep pace.
Findings (see Sources for full citations):

- **Memgraph has native Kafka/Pulsar/Redpanda streaming ingestion**
  (`CREATE KAFKA STREAM ... TRANSFORM ... BOOTSTRAP_SERVERS ...`),
  available in Community edition — not Enterprise-gated. It batches
  internally (`BATCH_SIZE` default 1000, `BATCH_INTERVAL` default
  100ms) but **stays in `IN_MEMORY_TRANSACTIONAL` mode**, so it gets
  Kafka-side batching but not `LOAD CSV`'s analytical-mode speedup.
  Delivery is at-least-once (Memgraph write commits before the Kafka
  offset does), so duplicates are possible — `MERGE`-based upsert
  semantics (already how this endpoint works) handle that correctly
  regardless of which ingestion path is used.
- **A queue's real value here is durability and replay, not raw
  throughput** — this is the consistent pattern across Memgraph's own
  docs and Neo4j's Kafka Connector/CDC material (Neo4j's connector also
  batches via `MERGE`, not per-message transactions) and a real AWS
  reference architecture for graph-based fraud-ring detection: Kafka
  sits upstream of the graph DB specifically so events survive a
  DB restart or a slow consumer, and to give an audit trail independent
  of the DB — appropriate for an AML system's regulatory requirements.
  Throughput is what batching fixes, not what the queue fixes.
- **Recommendation, in order**: (1) batching the endpoint we already
  control (done above — real, if smaller-than-hoped, improvement, and
  keeps this project's Pydantic validation/domain logic intact, unlike
  pushing transform logic into a Memgraph-loaded Python module); (2) add
  a queue later, once closer to production, specifically for durability
  and audit trail, feeding our own batched consumer rather than
  Memgraph's native stream; (3) deprioritize Memgraph's native
  `CREATE STREAM` for now — moving validation/business logic into an
  infra-adjacent Memgraph module cuts against this project's layered
  architecture, and isn't clearly a throughput win over our own batched
  endpoint anyway.

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
- [Memgraph streams overview](https://memgraph.com/docs/data-streams) / [Manage streams via queries](https://memgraph.com/docs/memgraph/how-to-guides/streams/manage-streams) — native Kafka/Pulsar/Redpanda streaming ingestion, `BATCH_SIZE`/`BATCH_INTERVAL`, at-least-once delivery semantics
- [Graph stream processing with Kafka](https://memgraph.com/docs/data-streams/graph-stream-processing-with-kafka), [Kafka Connect docs](https://memgraph.com/docs/data-streams/kafka)
- [Enabling Memgraph Enterprise](https://memgraph.com/docs/database-management/enabling-memgraph-enterprise) — confirms streaming is Community-edition, Enterprise adds auth/RBAC/HA only
- [Neo4j CDC GA announcement](https://neo4j.com/blog/developer/change-data-capture-cdc-ga/), [Neo4j Kafka Connector CDC sink](https://neo4j.com/docs/kafka/current/sink/cdc/), [Confluent's Neo4j sink plugin writeup](https://www.confluent.io/blog/kafka-connect-neo4j-sink-plugin/) — comparable vendor pattern (queue upstream of the graph DB for durability/replay, connector batches via MERGE)
- [AWS reference architecture — fraud-ring detection using Neo4j and graphs](https://docs.aws.amazon.com/reference-architecture-diagrams/latest/fraud-ring-detection-using-Neo4j-and-graphs/fraud-ring-detection-using-Neo4j-and-graphs.html) — real production pattern for a comparable (fraud/AML) domain
- [Michael Hunger — 5 Tips & Tricks for Fast Batched Updates](https://medium.com/neo4j/5-tips-tricks-for-fast-batched-updates-of-graph-structures-with-neo4j-and-cypher-73c7f693c8cc) — general Cypher batching guidance (community, not Memgraph-official)
- [Alex Chantavy — loading 7M items with/without UNWIND](https://achantavy.github.io/cartography/performance/cypher/neo4j/2020/07/19/loading-7m-items-to-neo4j-with-and-without-unwind.html) — the ~900x single-row-vs-batched reference number (Neo4j, community benchmark, not Memgraph — our own measured multiplier was ~3.9x, notably smaller)
