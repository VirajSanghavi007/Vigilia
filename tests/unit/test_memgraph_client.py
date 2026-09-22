"""Unit tests for MemgraphStore — Cypher/params sent to the driver, no real DB.

A real Memgraph instance is exercised in tests/integration/test_memgraph_integration.py
instead (gated behind a `memgraph_available` fixture), since CI's Windows runners
have no Docker daemon (see docs on integration-tests in the CI workflow).
"""

from unittest.mock import MagicMock, patch

import pytest

from vigilia.infra.graph.memgraph_client import MemgraphStore


@pytest.fixture
def store():
    with patch("vigilia.infra.graph.memgraph_client.GraphDatabase") as mock_gdb:
        mock_driver = MagicMock()
        mock_gdb.driver.return_value = mock_driver
        s = MemgraphStore("bolt://localhost:7687")
        yield s, mock_driver


def _session_run_mock(mock_driver):
    mock_session = mock_driver.session.return_value.__enter__.return_value
    return mock_session.run


def test_ensure_constraints_runs_unique_constraint(store):
    s, mock_driver = store
    s.ensure_constraints()

    run = _session_run_mock(mock_driver)
    queries = [call.args[0] for call in run.call_args_list]
    assert any("CONSTRAINT" in q and "txId IS UNIQUE" in q for q in queries)


def test_ensure_constraints_also_creates_queryable_index(store):
    # A unique constraint alone does NOT make txId lookups use an index in
    # Memgraph (confirmed via PROFILE against a 1M+ node graph: MATCH/MERGE
    # fell back to a full label ScanAll with only the constraint present —
    # see docs/BENCHMARK.md). This must also run CREATE INDEX, or every
    # MERGE/MATCH by txId is O(n) regardless of the constraint.
    s, mock_driver = store
    s.ensure_constraints()

    run = _session_run_mock(mock_driver)
    queries = [call.args[0] for call in run.call_args_list]
    assert any("CREATE INDEX" in q and "Transaction(txId)" in q for q in queries)


def test_upsert_transaction_merges_with_class(store):
    s, mock_driver = store
    s.upsert_transaction("T1", "illicit")

    run = _session_run_mock(mock_driver)
    run.assert_called_once()
    (query,), kwargs = run.call_args
    assert "MERGE" in query
    assert "Transaction" in query
    assert kwargs == {"tx_id": "T1", "tx_class": "illicit", "properties": {}}


def test_upsert_transaction_passes_through_extra_properties(store):
    s, mock_driver = store
    s.upsert_transaction("T1", "licit", properties={"f0": 1.5, "f1": -2.0})

    run = _session_run_mock(mock_driver)
    (_,), kwargs = run.call_args
    assert kwargs == {"tx_id": "T1", "tx_class": "licit", "properties": {"f0": 1.5, "f1": -2.0}}


def test_upsert_edge_merges_both_nodes_and_relationship(store):
    s, mock_driver = store
    s.upsert_edge("T1", "T2")

    run = _session_run_mock(mock_driver)
    run.assert_called_once()
    (query,), kwargs = run.call_args
    assert query.count("MERGE") == 3  # two nodes + the relationship
    assert "SENT_TO" in query
    assert kwargs == {"from_id": "T1", "to_id": "T2"}


def test_upsert_transactions_batch_sends_one_unwind_query(store):
    s, mock_driver = store
    s.upsert_transactions_batch(
        [
            {"tx_id": "T1", "tx_class": "illicit", "properties": None},
            {"tx_id": "T2", "tx_class": "licit", "properties": {"f0": 1.0}},
        ]
    )

    run = _session_run_mock(mock_driver)
    run.assert_called_once()
    (query,), kwargs = run.call_args
    assert "UNWIND" in query
    assert "MERGE" in query
    assert kwargs == {
        "rows": [
            {"tx_id": "T1", "tx_class": "illicit", "properties": {}},
            {"tx_id": "T2", "tx_class": "licit", "properties": {"f0": 1.0}},
        ]
    }


def test_upsert_edges_batch_sends_one_unwind_query(store):
    s, mock_driver = store
    rows = [{"from_id": "T1", "to_id": "T2"}, {"from_id": "T2", "to_id": "T3"}]
    s.upsert_edges_batch(rows)

    run = _session_run_mock(mock_driver)
    run.assert_called_once()
    (query,), kwargs = run.call_args
    assert "UNWIND" in query
    assert "SENT_TO" in query
    assert kwargs == {"rows": rows}


def test_get_neighbors_returns_txids_from_result(store):
    s, mock_driver = store
    mock_session = mock_driver.session.return_value.__enter__.return_value
    mock_session.run.return_value = [{"neighbor_id": "T2"}, {"neighbor_id": "T3"}]

    neighbors = s.get_neighbors("T1")

    assert neighbors == ["T2", "T3"]
    (query,), kwargs = mock_session.run.call_args
    assert "SENT_TO" in query
    assert kwargs == {"tx_id": "T1"}


def test_close_closes_underlying_driver(store):
    s, mock_driver = store
    s.close()
    mock_driver.close.assert_called_once()


def test_write_back_batch_merges_and_guards_against_stale_writes(store):
    s, mock_driver = store
    s.write_back_batch([{"tx_id": "T1", "tx_class": "illicit", "exported_at": 5.0}])

    run = _session_run_mock(mock_driver)
    run.assert_called_once()
    (query,), kwargs = run.call_args
    assert "MERGE" in query
    assert "WHERE t.archiveWrittenAt IS NULL OR row.written_at >= t.archiveWrittenAt" in query
    assert kwargs == {
        "rows": [{"tx_id": "T1", "tx_class": "illicit", "written_at": 5.0}]
    }
