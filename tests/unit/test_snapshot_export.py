"""Unit tests for the snapshot export orchestrator — mocked Memgraph driver
and a mocked/fake ArchiveStore, no real DB. Real end-to-end behavior is
exercised in tests/integration/test_neo4j_archive_integration.py.
"""

import time
from unittest.mock import MagicMock, patch

import pytest

from vigilia.infra.graph.neo4j_client import Neo4jArchiveStore
from vigilia.infra.graph.snapshot_export import (
    SnapshotDeadlineExceeded,
    _validate_row,
    diff_snapshot,
    export_snapshot,
)


class FakeArchiveStore:
    """Records what it was called with, for assertions. Also a real
    (in-memory) checkpoint store, not just a stub, so resume tests can
    exercise the actual resume path end to end.
    """

    def __init__(self, count_snapshot_returns=None):
        self.ensure_indexes_called = False
        self.written_batches = []
        self._count_snapshot_returns = count_snapshot_returns
        self._checkpoints = {}

    def ensure_indexes(self):
        self.ensure_indexes_called = True

    def write_batch(self, snapshot_id, rows):
        self.written_batches.append((snapshot_id, list(rows)))

    def count_snapshot(self, snapshot_id):
        if self._count_snapshot_returns is not None:
            return self._count_snapshot_returns
        return sum(len(rows) for sid, rows in self.written_batches if sid == snapshot_id)

    def save_checkpoint(self, snapshot_id, last_tx_id):
        self._checkpoints[snapshot_id] = last_tx_id

    def get_checkpoint(self, snapshot_id):
        return self._checkpoints.get(snapshot_id)

    def clear_checkpoint(self, snapshot_id):
        self._checkpoints.pop(snapshot_id, None)

    def stream_snapshot_txids(self, snapshot_id):
        rows = sorted(
            (r["tx_id"] for sid, batch in self.written_batches if sid == snapshot_id for r in batch)
        )
        yield from rows


def _fake_record(tx_id, tx_class):
    return {"txId": tx_id, "class": tx_class}


def test_validate_row_accepts_well_formed_record():
    row = _validate_row(_fake_record("T1", "illicit"))
    assert row == {"tx_id": "T1", "tx_class": "illicit"}


def test_validate_row_rejects_null_txid_or_class():
    assert _validate_row(_fake_record(None, "illicit")) is None
    assert _validate_row(_fake_record("T1", None)) is None


def _mock_memgraph(records, count):
    """Patch GraphDatabase so both the source-count query and the
    streaming MATCH query return sensible mocked results, keyed off the
    query text since both go through the same mocked session.
    """
    mock_gdb = MagicMock()
    mock_driver = MagicMock()
    mock_gdb.driver.return_value = mock_driver
    mock_session = mock_driver.session.return_value.__enter__.return_value

    def run_side_effect(query, *args, **kwargs):
        if "count(t)" in query:
            result = MagicMock()
            result.single.return_value = {"c": count}
            return result
        return iter(records)

    mock_session.run.side_effect = run_side_effect
    return mock_gdb


def test_export_snapshot_writes_all_rows_and_reconciles():
    records = [_fake_record(f"T{i}", "unknown") for i in range(3)]
    mock_gdb = _mock_memgraph(records, count=3)
    archive = FakeArchiveStore()

    with patch("vigilia.infra.graph.snapshot_export.GraphDatabase", mock_gdb):
        result = export_snapshot("bolt://fake", archive, deadline_seconds=5)

    assert archive.ensure_indexes_called
    assert result.rows_exported == 3
    assert result.source_count == 3
    assert result.target_count == 3
    assert result.reconciled is True
    all_rows = [r for _, rows in archive.written_batches for r in rows]
    assert {r["tx_id"] for r in all_rows} == {"T0", "T1", "T2"}
    assert all("exported_at" in r for r in all_rows)


def test_export_snapshot_skips_malformed_rows_without_failing():
    records = [_fake_record("T1", "unknown"), _fake_record(None, "unknown"), _fake_record("T2", "unknown")]
    mock_gdb = _mock_memgraph(records, count=3)
    archive = FakeArchiveStore()

    with patch("vigilia.infra.graph.snapshot_export.GraphDatabase", mock_gdb):
        result = export_snapshot("bolt://fake", archive, deadline_seconds=5)

    assert result.rows_exported == 2


def test_export_snapshot_not_reconciled_when_target_undercounts():
    records = [_fake_record("T1", "unknown")]
    mock_gdb = _mock_memgraph(records, count=1)
    archive = FakeArchiveStore(count_snapshot_returns=0)  # simulates a silently-dropped write

    with patch("vigilia.infra.graph.snapshot_export.GraphDatabase", mock_gdb):
        result = export_snapshot("bolt://fake", archive, deadline_seconds=5)

    assert result.reconciled is False


def test_export_snapshot_row_shape_matches_real_archive_store_contract():
    """FakeArchiveStore accepts whatever shape it's handed, which let a real
    key-name mismatch (txId/class vs. the tx_id/tx_class the ArchiveStore
    Protocol documents) slip past every other test in this file — caught
    only by an end-to-end smoke test against real Memgraph+Neo4j. This
    wires export_snapshot to the REAL Neo4jArchiveStore (mocked driver, so
    still no real DB) specifically so a KeyError/shape mismatch fails here
    instead of requiring a real database to notice.
    """
    records = [_fake_record("T1", "illicit")]
    mock_gdb = _mock_memgraph(records, count=1)

    with patch("vigilia.infra.graph.neo4j_client.GraphDatabase") as mock_neo4j_gdb:
        mock_neo4j_driver = MagicMock()
        mock_neo4j_gdb.driver.return_value = mock_neo4j_driver
        archive = Neo4jArchiveStore("bolt://fake-neo4j", auth=("neo4j", "pw"))

        with patch("vigilia.infra.graph.snapshot_export.GraphDatabase", mock_gdb):
            export_snapshot("bolt://fake", archive, deadline_seconds=5)  # must not raise KeyError

        all_calls = mock_neo4j_driver.session.return_value.__enter__.return_value.run.call_args_list
        write_calls = [c for c in all_calls if "rows" in c.kwargs]
        assert len(write_calls) == 1
        assert write_calls[0].kwargs["rows"] == [
            {"txId": "T1", "class": "illicit", "exportedAt": pytest.approx(time.time(), abs=5)}
        ]


def _mock_memgraph_resumable(records, count):
    """Like _mock_memgraph, but honors a WHERE t.txId > $resumeFrom clause
    by filtering records client-side, so a resumed export_snapshot() call
    genuinely only sees what's left — exercising the real resume path,
    not just re-serving everything.
    """
    mock_gdb = MagicMock()
    mock_driver = MagicMock()
    mock_gdb.driver.return_value = mock_driver
    mock_session = mock_driver.session.return_value.__enter__.return_value

    def run_side_effect(query, *args, **kwargs):
        if "count(t)" in query:
            result = MagicMock()
            result.single.return_value = {"c": count}
            return result
        resume_from = kwargs.get("resumeFrom")
        if resume_from is not None:
            return iter([r for r in records if r["txId"] > resume_from])
        return iter(records)

    mock_session.run.side_effect = run_side_effect
    return mock_gdb


def test_export_snapshot_resumes_from_checkpoint_after_deadline_exceeded(monkeypatch):
    import vigilia.infra.graph.snapshot_export as se

    monkeypatch.setattr(se, "BATCH_SIZE", 2)  # force a checkpoint after every 2 rows

    records = [_fake_record(f"T{i}", "unknown") for i in range(6)]
    mock_gdb = _mock_memgraph_resumable(records, count=6)
    archive = FakeArchiveStore()

    def slow_run_side_effect(orig):
        def wrapped(query, *args, **kwargs):
            result = orig(query, *args, **kwargs)
            if "count(t)" not in query:
                def slow_iter():
                    for r in result:
                        time.sleep(0.03)
                        yield r
                return slow_iter()
            return result

        return wrapped

    mock_driver = mock_gdb.driver.return_value
    mock_session = mock_driver.session.return_value.__enter__.return_value
    mock_session.run.side_effect = slow_run_side_effect(mock_session.run.side_effect)

    with patch("vigilia.infra.graph.snapshot_export.GraphDatabase", mock_gdb):
        with pytest.raises(SnapshotDeadlineExceeded) as exc_info:
            export_snapshot("bolt://fake", archive, deadline_seconds=0.05)

        snapshot_id = exc_info.value.snapshot_id
        assert exc_info.value.rows_exported_this_run < 6  # deadline hit before finishing
        assert archive.get_checkpoint(snapshot_id) is not None  # a real resume point was saved

        # Resume with the SAME snapshot_id and a deadline that's now enough to finish.
        result = export_snapshot("bolt://fake", archive, deadline_seconds=5, snapshot_id=snapshot_id)

    assert result.complete is True
    assert result.target_count == 6
    assert result.reconciled is True
    assert archive.get_checkpoint(snapshot_id) is None  # cleared on completion
    all_tx_ids = [r["tx_id"] for _, rows in archive.written_batches for r in rows]
    assert sorted(set(all_tx_ids)) == [f"T{i}" for i in range(6)]


def test_diff_snapshot_finds_missing_and_extra_ids():
    source_records = [_fake_record(tx_id, "unknown") for tx_id in ["T1", "T2", "T3", "T4"]]
    mock_gdb = _mock_memgraph(source_records, count=4)

    archive = FakeArchiveStore()
    # Archive has T1, T3 (missing T2, T4 — never exported) and T9 (extra —
    # e.g. a since-deleted source row, or a stale/corrupt archive entry).
    archive.written_batches = [("snap-1", [{"tx_id": "T1"}, {"tx_id": "T3"}, {"tx_id": "T9"}])]

    with patch("vigilia.infra.graph.snapshot_export.GraphDatabase", mock_gdb):
        result = diff_snapshot("bolt://fake", archive, "snap-1")

    assert result.missing_count == 2
    assert set(result.missing_sample) == {"T2", "T4"}
    assert result.extra_count == 1
    assert result.extra_sample == ["T9"]
    assert result.diff_complete is True


def test_export_snapshot_raises_when_deadline_exceeded():
    # Reader stalls completely (no record produced at all) for much longer
    # than the deadline, simulating a hung query/network partition. This is
    # the case that actually distinguishes a polling get(timeout=...) from
    # a plain blocking get(): with a fully-stalled reader, a blocking get()
    # would wait for the whole 3s stall before ever re-checking the
    # deadline, so this must raise and return in well under that.
    def stalled_records():
        time.sleep(3.0)
        yield _fake_record("T0", "unknown")

    mock_gdb = MagicMock()
    mock_driver = MagicMock()
    mock_gdb.driver.return_value = mock_driver
    mock_session = mock_driver.session.return_value.__enter__.return_value

    def run_side_effect(query, *args, **kwargs):
        if "count(t)" in query:
            result = MagicMock()
            result.single.return_value = {"c": 1}
            return result
        return stalled_records()

    mock_session.run.side_effect = run_side_effect
    archive = FakeArchiveStore()

    t0 = time.monotonic()
    with patch("vigilia.infra.graph.snapshot_export.GraphDatabase", mock_gdb):
        with pytest.raises(SnapshotDeadlineExceeded):
            export_snapshot("bolt://fake", archive, deadline_seconds=0.05)
    elapsed = time.monotonic() - t0

    assert elapsed < 1.0, (
        f"deadline enforcement took {elapsed:.2f}s against a 0.05s deadline — "
        f"a blocking (non-polling) queue read would have waited out the full "
        f"3s reader stall instead of catching this promptly"
    )
