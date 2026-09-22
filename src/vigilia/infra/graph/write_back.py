"""Cold-to-hot write-back: apply an archived Neo4j snapshot's rows back
into Memgraph.

This is the reverse of snapshot_export.py, for a deliberately exceptional
case — restoring from archive, or a compliance correction that needs to
flow back into the live store — not continuous bidirectional sync (see
ArchiveStore's docstring in domain/graph/store.py for why the archive
stays write-only/one-directional for normal operation).

Same bounded-queue backpressure and deadline pattern as the export path,
for the same reasons (see snapshot_export.py's module docstring); the
conflict guard that makes a write-back safe against a stale/out-of-order
retry lives in MemgraphStore.write_back_batch (archiveWrittenAt), not
here.
"""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass

from vigilia.infra.graph.neo4j_client import Neo4jArchiveStore

BATCH_SIZE = 5000
QUEUE_MAXSIZE = 20
DEFAULT_DEADLINE_SECONDS = 60.0


class WriteBackDeadlineExceeded(RuntimeError):
    def __init__(self, message: str, snapshot_id: str, rows_written_this_run: int):
        super().__init__(message)
        self.snapshot_id = snapshot_id
        self.rows_written_this_run = rows_written_this_run


@dataclass
class WriteBackResult:
    snapshot_id: str
    rows_written: int
    elapsed_seconds: float


def _reader_thread(archive_store: Neo4jArchiveStore, snapshot_id: str, q: queue.Queue, stop: threading.Event) -> None:
    try:
        batch = []
        for row in archive_store.stream_snapshot_rows(snapshot_id):
            if stop.is_set():
                break
            batch.append(row)
            if len(batch) >= BATCH_SIZE:
                q.put(batch)  # blocks once the queue is full -> backpressure
                batch = []
        if batch and not stop.is_set():
            q.put(batch)
    finally:
        q.put(None)  # sentinel


def write_back_snapshot(
    archive_store: Neo4jArchiveStore,
    memgraph_store,
    snapshot_id: str,
    deadline_seconds: float = DEFAULT_DEADLINE_SECONDS,
) -> WriteBackResult:
    q: queue.Queue = queue.Queue(maxsize=QUEUE_MAXSIZE)
    stop = threading.Event()
    # daemon=True, same reasoning as snapshot_export.py's reader: a stuck
    # read from the archive must not prevent the deadline from firing.
    reader = threading.Thread(
        target=_reader_thread, args=(archive_store, snapshot_id, q, stop), daemon=True
    )
    reader.start()

    t0 = time.monotonic()
    rows_written = 0
    while True:
        if time.monotonic() - t0 > deadline_seconds:
            stop.set()
            raise WriteBackDeadlineExceeded(
                f"Write-back of snapshot {snapshot_id} exceeded its {deadline_seconds}s "
                f"deadline after writing {rows_written} rows this run.",
                snapshot_id=snapshot_id,
                rows_written_this_run=rows_written,
            )
        try:
            batch = q.get(timeout=0.1)
        except queue.Empty:
            continue
        if batch is None:
            break
        memgraph_store.write_back_batch(batch)
        rows_written += len(batch)

    reader.join(timeout=2.0)
    elapsed = time.monotonic() - t0

    return WriteBackResult(snapshot_id=snapshot_id, rows_written=rows_written, elapsed_seconds=elapsed)
