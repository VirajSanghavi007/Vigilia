"""Unit tests for the cold-to-hot write-back orchestrator — a fake
ArchiveStore and a fake MemgraphStore, no real DB.
"""

import time

import pytest

from vigilia.infra.graph.write_back import WriteBackDeadlineExceeded, write_back_snapshot


class FakeArchiveStore:
    def __init__(self, rows, delay_per_row=0.0):
        self._rows = rows
        self._delay_per_row = delay_per_row

    def stream_snapshot_rows(self, snapshot_id):
        for row in self._rows:
            if self._delay_per_row:
                time.sleep(self._delay_per_row)
            yield row


class FakeMemgraphStore:
    def __init__(self):
        self.written_batches = []

    def write_back_batch(self, rows):
        self.written_batches.append(list(rows))


def test_write_back_snapshot_writes_all_rows():
    rows = [{"tx_id": f"T{i}", "tx_class": "unknown", "exported_at": 1.0} for i in range(5)]
    archive = FakeArchiveStore(rows)
    memgraph = FakeMemgraphStore()

    result = write_back_snapshot(archive, memgraph, "snap-1", deadline_seconds=5)

    assert result.rows_written == 5
    all_written = [r for batch in memgraph.written_batches for r in batch]
    assert {r["tx_id"] for r in all_written} == {f"T{i}" for i in range(5)}


def test_write_back_snapshot_raises_when_deadline_exceeded():
    rows = [{"tx_id": f"T{i}", "tx_class": "unknown", "exported_at": 1.0} for i in range(50)]
    archive = FakeArchiveStore(rows, delay_per_row=0.05)
    memgraph = FakeMemgraphStore()

    t0 = time.monotonic()
    with pytest.raises(WriteBackDeadlineExceeded) as exc_info:
        write_back_snapshot(archive, memgraph, "snap-1", deadline_seconds=0.1)
    elapsed = time.monotonic() - t0

    assert exc_info.value.snapshot_id == "snap-1"
    assert elapsed < 1.0, "deadline should fire promptly, not wait for the full stream to drain"
