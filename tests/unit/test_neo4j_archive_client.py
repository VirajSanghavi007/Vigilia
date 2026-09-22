"""Unit tests for Neo4jArchiveStore — Cypher/params sent to the driver, no
real DB. A real Neo4j instance is exercised in
tests/integration/test_neo4j_archive_integration.py instead (gated behind
a neo4j_available fixture, same pattern as the Memgraph integration tests).
"""

from unittest.mock import MagicMock, patch

import pytest

from vigilia.infra.graph.neo4j_client import Neo4jArchiveStore


@pytest.fixture
def store():
    with patch("vigilia.infra.graph.neo4j_client.GraphDatabase") as mock_gdb:
        mock_driver = MagicMock()
        mock_gdb.driver.return_value = mock_driver
        s = Neo4jArchiveStore("bolt://localhost:7688", auth=("neo4j", "pw"))
        yield s, mock_driver


def _session_run_mock(mock_driver):
    mock_session = mock_driver.session.return_value.__enter__.return_value
    return mock_session.run


def test_ensure_indexes_creates_composite_constraint_and_awaits(store):
    s, mock_driver = store
    s.ensure_indexes()

    run = _session_run_mock(mock_driver)
    queries = [call.args[0] for call in run.call_args_list]
    assert any("CONSTRAINT" in q and "snapshotId, t.txId" in q for q in queries)
    assert any("db.awaitIndexes" in q for q in queries)


def test_write_batch_merges_on_composite_snapshot_and_txid(store):
    s, mock_driver = store
    s.write_batch(
        "snap-1",
        [{"tx_id": "T1", "tx_class": "illicit", "exported_at": 123.0}],
    )

    run = _session_run_mock(mock_driver)
    run.assert_called_once()
    (query,), kwargs = run.call_args
    assert "MERGE" in query
    assert "snapshotId: $snapshotId, txId: row.txId" in query
    assert kwargs["snapshotId"] == "snap-1"
    assert kwargs["rows"] == [{"txId": "T1", "class": "illicit", "exportedAt": 123.0}]


def test_write_batch_guards_against_stale_out_of_order_writes(store):
    s, mock_driver = store
    s.write_batch("snap-1", [{"tx_id": "T1", "tx_class": "illicit", "exported_at": 1.0}])

    run = _session_run_mock(mock_driver)
    (query,), _ = run.call_args
    assert "WHERE t.exportedAt IS NULL OR row.exportedAt >= t.exportedAt" in query


def test_count_snapshot_returns_count_for_that_snapshot_only(store):
    s, mock_driver = store
    mock_session = mock_driver.session.return_value.__enter__.return_value
    mock_session.run.return_value.single.return_value = {"c": 42}

    count = s.count_snapshot("snap-1")

    assert count == 42
    (query,), kwargs = mock_session.run.call_args
    assert "snapshotId: $snapshotId" in query
    assert kwargs == {"snapshotId": "snap-1"}


def test_close_closes_underlying_driver(store):
    s, mock_driver = store
    s.close()
    mock_driver.close.assert_called_once()


def test_save_checkpoint_merges_on_snapshot_id(store):
    s, mock_driver = store
    s.save_checkpoint("snap-1", "T42")

    run = _session_run_mock(mock_driver)
    (query,), kwargs = run.call_args
    assert "MERGE" in query
    assert "SnapshotCheckpoint" in query
    assert kwargs == {"snapshotId": "snap-1", "lastTxId": "T42"}


def test_get_checkpoint_returns_none_when_absent(store):
    s, mock_driver = store
    mock_session = mock_driver.session.return_value.__enter__.return_value
    mock_session.run.return_value.single.return_value = None

    assert s.get_checkpoint("snap-1") is None


def test_get_checkpoint_returns_last_tx_id_when_present(store):
    s, mock_driver = store
    mock_session = mock_driver.session.return_value.__enter__.return_value
    mock_session.run.return_value.single.return_value = {"lastTxId": "T42"}

    assert s.get_checkpoint("snap-1") == "T42"


def test_clear_checkpoint_deletes_checkpoint_node(store):
    s, mock_driver = store
    s.clear_checkpoint("snap-1")

    run = _session_run_mock(mock_driver)
    (query,), kwargs = run.call_args
    assert "DELETE c" in query
    assert kwargs == {"snapshotId": "snap-1"}


def test_stream_snapshot_txids_yields_sorted_ids(store):
    s, mock_driver = store
    mock_session = mock_driver.session.return_value.__enter__.return_value
    # Fewer rows than _STREAM_CHUNK_SIZE -> exactly one paginated call.
    mock_session.run.return_value = [{"txId": "T1"}, {"txId": "T2"}]

    assert list(s.stream_snapshot_txids("snap-1")) == ["T1", "T2"]
    mock_session.run.assert_called_once()
    (query,), kwargs = mock_session.run.call_args
    assert "ORDER BY t.txId LIMIT $limit" in query
    assert "WHERE" not in query  # first page has no resume filter
    assert kwargs == {"snapshotId": "snap-1", "limit": s._STREAM_CHUNK_SIZE}


def test_stream_snapshot_txids_paginates_past_one_chunk(store):
    s, mock_driver = store
    s._STREAM_CHUNK_SIZE = 2  # force pagination with a tiny test-only chunk size
    mock_session = mock_driver.session.return_value.__enter__.return_value
    pages = [
        [{"txId": "T1"}, {"txId": "T2"}],  # full chunk -> another page follows
        [{"txId": "T3"}],  # short chunk -> last page
    ]
    mock_session.run.side_effect = lambda *a, **k: pages.pop(0)

    assert list(s.stream_snapshot_txids("snap-1")) == ["T1", "T2", "T3"]
    assert mock_session.run.call_count == 2
    second_call_kwargs = mock_session.run.call_args_list[1].kwargs
    assert second_call_kwargs["lastTxId"] == "T2"  # resumes from the last id of page 1


def test_stream_snapshot_rows_yields_archive_store_contract_shape(store):
    s, mock_driver = store
    mock_session = mock_driver.session.return_value.__enter__.return_value
    mock_session.run.return_value = [{"txId": "T1", "class": "illicit", "exportedAt": 1.0}]

    rows = list(s.stream_snapshot_rows("snap-1"))
    assert rows == [{"tx_id": "T1", "tx_class": "illicit", "exported_at": 1.0}]
