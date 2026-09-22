"""Export a point-in-time snapshot of Memgraph's Transaction nodes into an
ArchiveStore (see domain/graph/store.py for why this is deliberately
write-only and one-directional).

Design decisions, each backed by a benchmark in docs/BENCHMARK.md:

- Hard deadline (default 60s): the export streams a live query while
  Memgraph keeps accepting writes, so it is NOT a true atomic snapshot —
  different rows can reflect different real-world instants (confirmed:
  ~0.7% of rows in a 100k-node benchmark reflected a write that landed
  after export start). A hard deadline bounds how stale that drift can
  get; exceeding it fails loudly (SnapshotDeadlineExceeded) rather than
  silently producing a snapshot inconsistent by an unbounded amount.
- Bounded queue between reader and writer: an unbounded queue was
  confirmed to accumulate 100,000 rows in 2 seconds when the writer
  stalls — this blocks the reader once the writer falls QUEUE_MAXSIZE
  batches behind instead of buffering without limit.
- write_batch() must be idempotent (see Neo4jArchiveStore) so a crash and
  restart mid-export doesn't duplicate rows.
- Resumable via a durable checkpoint (Neo4jArchiveStore.save_checkpoint):
  a graph large enough that a full export can't finish inside the
  deadline (measured: ~28.5k rows/s ceiling means 15M nodes needs ~8.8
  minutes, not 60s) does NOT mean the deadline is wrong — it means one
  run covers a bounded chunk, checkpointed by txId, and a caller resumes
  with the SAME snapshot_id until SnapshotResult.complete is True. The
  60s bound applies per run, not to finishing an arbitrarily large graph
  in one shot; nodes are read in txId order (via the existing index) so
  resuming from a checkpoint is a plain WHERE txId > $checkpoint, not a
  re-scan.
- Reconciliation after the transfer: a plain count comparison only
  proves something is wrong, not what — diff_snapshot() below does a
  real sorted-merge id-level diff instead, without materializing either
  side's full id set in memory.
"""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass

from neo4j import GraphDatabase

from vigilia.infra.graph.neo4j_client import Neo4jArchiveStore

BATCH_SIZE = 5000
QUEUE_MAXSIZE = 20
DEFAULT_DEADLINE_SECONDS = 60.0


class SnapshotDeadlineExceeded(RuntimeError):
    def __init__(self, message: str, snapshot_id: str, rows_exported_this_run: int):
        super().__init__(message)
        self.snapshot_id = snapshot_id
        self.rows_exported_this_run = rows_exported_this_run


@dataclass
class SnapshotResult:
    snapshot_id: str
    rows_exported: int
    source_count: int
    target_count: int
    elapsed_seconds: float
    reconciled: bool
    complete: bool


@dataclass
class DiffResult:
    missing_count: int
    extra_count: int
    missing_sample: list[str]
    extra_sample: list[str]
    diff_complete: bool


def _validate_row(record) -> dict | None:
    tx_id = record["txId"]
    tx_class = record["class"]
    if tx_id is None or tx_class is None:
        return None
    # tx_id/tx_class (snake_case), matching the ArchiveStore.write_batch
    # contract in domain/graph/store.py — NOT the txId/class shape of the
    # source Cypher record.
    return {"tx_id": tx_id, "tx_class": tx_class}


def _reader_thread(
    memgraph_uri: str,
    q: queue.Queue,
    stop: threading.Event,
    skipped: list[int],
    resume_from: str | None,
) -> None:
    driver = GraphDatabase.driver(memgraph_uri)
    try:
        with driver.session() as session:
            # ORDER BY txId (uses the existing label-property index from
            # ensure_constraints — see docs/BENCHMARK.md's root-cause
            # finding, ScanAllByLabelProperties, not a full scan) so a
            # resume is a plain WHERE txId > checkpoint, not a re-scan.
            if resume_from is None:
                query = "MATCH (t:Transaction) RETURN t.txId AS txId, t.class AS class ORDER BY t.txId"
                params = {}
            else:
                query = (
                    "MATCH (t:Transaction) WHERE t.txId > $resumeFrom "
                    "RETURN t.txId AS txId, t.class AS class ORDER BY t.txId"
                )
                params = {"resumeFrom": resume_from}
            result = session.run(query, **params)
            batch = []
            for record in result:
                if stop.is_set():
                    break
                row = _validate_row(record)
                if row is None:
                    skipped[0] += 1
                    continue
                batch.append(row)
                if len(batch) >= BATCH_SIZE:
                    q.put(batch)  # blocks once the queue is full -> backpressure
                    batch = []
            if batch and not stop.is_set():
                q.put(batch)
    finally:
        driver.close()
        q.put(None)  # sentinel: reader is done (or stopped)


def export_snapshot(
    memgraph_uri: str,
    archive_store: Neo4jArchiveStore,
    deadline_seconds: float = DEFAULT_DEADLINE_SECONDS,
    snapshot_id: str | None = None,
) -> SnapshotResult:
    """Export (or resume exporting) a snapshot.

    Pass snapshot_id=None to start a new snapshot. Pass the snapshot_id
    from a caught SnapshotDeadlineExceeded to resume it — the durable
    checkpoint (Neo4jArchiveStore.save_checkpoint) means this works even
    from a fresh process, not just a retry loop in the same one. A
    completed snapshot has its checkpoint cleared, so resuming an
    already-complete snapshot_id just re-verifies (no-op export, fresh
    reconciliation) rather than erroring.
    """
    archive_store.ensure_indexes()

    resume_from: str | None = None
    if snapshot_id is None:
        snapshot_id = f"snap-{int(time.time() * 1000)}"
    else:
        resume_from = archive_store.get_checkpoint(snapshot_id)

    driver = GraphDatabase.driver(memgraph_uri)
    with driver.session() as session:
        source_count = session.run("MATCH (t:Transaction) RETURN count(t) AS c").single()["c"]
    driver.close()

    exported_at = time.time()

    q: queue.Queue = queue.Queue(maxsize=QUEUE_MAXSIZE)
    stop = threading.Event()
    skipped = [0]
    # daemon=True: if the reader is stuck inside a blocking network call (a
    # genuinely hung query, not just idle), stop.set() cannot interrupt it —
    # it's only checked between yielded records. A daemon thread means an
    # abandoned reader doesn't block process exit or the deadline exception
    # below on its eventual (possibly delayed) completion.
    reader = threading.Thread(
        target=_reader_thread, args=(memgraph_uri, q, stop, skipped, resume_from), daemon=True
    )
    reader.start()

    t0 = time.monotonic()
    rows_exported_this_run = 0
    last_tx_id_seen = resume_from
    while True:
        if time.monotonic() - t0 > deadline_seconds:
            stop.set()
            # Deliberately do NOT join the reader here: if it's genuinely
            # stuck in a blocking network call, stop.set() can't interrupt
            # it, and waiting for it to finish would silently turn a strict
            # deadline into "deadline + however long the hang lasts" — the
            # exact failure this deadline exists to prevent. The reader is
            # a daemon thread; it exits on its own once its call returns or
            # errors, and is simply abandoned here. The checkpoint already
            # saved after the last completed batch is what makes the next
            # call with this snapshot_id resume from here, not from zero.
            raise SnapshotDeadlineExceeded(
                f"Snapshot {snapshot_id} exceeded its {deadline_seconds}s deadline "
                f"after exporting {rows_exported_this_run} rows this run "
                f"(checkpoint at txId={last_tx_id_seen}) — aborting rather than "
                f"produce a snapshot with unbounded staleness. Resume with "
                f"export_snapshot(..., snapshot_id={snapshot_id!r}).",
                snapshot_id=snapshot_id,
                rows_exported_this_run=rows_exported_this_run,
            )
        try:
            # Short poll timeout, not a blocking get(): a stalled reader
            # (slow query, network hang) must not prevent the deadline
            # check above from re-running — a plain blocking get() would
            # wait indefinitely past the deadline for the first item.
            batch = q.get(timeout=0.1)
        except queue.Empty:
            continue
        if batch is None:
            break
        for row in batch:
            row["exported_at"] = exported_at
        archive_store.write_batch(snapshot_id, batch)
        last_tx_id_seen = batch[-1]["tx_id"]  # batch is in txId order (ORDER BY above)
        archive_store.save_checkpoint(snapshot_id, last_tx_id_seen)
        rows_exported_this_run += len(batch)

    # Normal completion only: the reader already put its sentinel, so it
    # has finished or is finishing — a short bounded wait, not indefinite.
    reader.join(timeout=2.0)
    archive_store.clear_checkpoint(snapshot_id)

    target_count = archive_store.count_snapshot(snapshot_id)
    elapsed = time.monotonic() - t0

    return SnapshotResult(
        snapshot_id=snapshot_id,
        rows_exported=rows_exported_this_run,
        source_count=source_count,
        target_count=target_count,
        elapsed_seconds=elapsed,
        reconciled=(target_count == source_count),
        complete=True,
    )


_DIFF_CHUNK_SIZE = 500_000


def _stream_memgraph_txids(memgraph_uri: str):
    """Paginated via WHERE txId > $last ... LIMIT, a fresh session/
    transaction per chunk — NOT one session streaming the whole label.
    A single long-lived transaction over 15M rows was confirmed to hit
    Memgraph's own transaction timeout mid-stream (TransientError:
    "Transaction was asked to abort because of transaction timeout") —
    a real failure at real scale, not a hypothetical. Chunking bounds
    each transaction's lifetime regardless of total graph size, same
    pattern as export_snapshot's resumable design.
    """
    driver = GraphDatabase.driver(memgraph_uri)
    try:
        last_tx_id = None
        while True:
            with driver.session() as session:
                if last_tx_id is None:
                    result = session.run(
                        "MATCH (t:Transaction) RETURN t.txId AS txId "
                        "ORDER BY t.txId LIMIT $limit",
                        limit=_DIFF_CHUNK_SIZE,
                    )
                else:
                    result = session.run(
                        "MATCH (t:Transaction) WHERE t.txId > $lastTxId "
                        "RETURN t.txId AS txId ORDER BY t.txId LIMIT $limit",
                        lastTxId=last_tx_id,
                        limit=_DIFF_CHUNK_SIZE,
                    )
                chunk = [record["txId"] for record in result]
            if not chunk:
                break
            yield from chunk
            last_tx_id = chunk[-1]
            if len(chunk) < _DIFF_CHUNK_SIZE:
                break
    finally:
        driver.close()


def diff_snapshot(memgraph_uri: str, archive_store: Neo4jArchiveStore, snapshot_id: str, sample_limit: int = 100) -> DiffResult:
    """Real id-level reconciliation: a sorted-merge diff between Memgraph's
    current txIds and the archived snapshot's txIds. O(1) memory beyond
    the sample buffers (bounded by sample_limit) — neither side's full id
    set is ever materialized, so this works at any graph size, unlike a
    naive two-set comparison.

    Compares against Memgraph's CURRENT state, not its state at export
    time, so some drift is expected if the source changed since the
    export ran — same caveat as the snapshot's own consistency model.
    This surfaces exactly which ids differ, not just that counts differ.
    """
    source_iter = _stream_memgraph_txids(memgraph_uri)
    target_iter = archive_store.stream_snapshot_txids(snapshot_id)

    missing_sample: list[str] = []
    extra_sample: list[str] = []
    missing_count = 0
    extra_count = 0

    s = next(source_iter, None)
    t = next(target_iter, None)
    while s is not None or t is not None:
        if t is None or (s is not None and s < t):
            missing_count += 1
            if len(missing_sample) < sample_limit:
                missing_sample.append(s)
            s = next(source_iter, None)
        elif s is None or t < s:
            extra_count += 1
            if len(extra_sample) < sample_limit:
                extra_sample.append(t)
            t = next(target_iter, None)
        else:  # s == t, present on both sides
            s = next(source_iter, None)
            t = next(target_iter, None)

    return DiffResult(
        missing_count=missing_count,
        extra_count=extra_count,
        missing_sample=missing_sample,
        extra_sample=extra_sample,
        diff_complete=True,
    )
