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
    run.assert_called_once()
    (query,), _ = run.call_args
    assert "CONSTRAINT" in query
    assert "txId IS UNIQUE" in query


def test_upsert_transaction_merges_with_class(store):
    s, mock_driver = store
    s.upsert_transaction("T1", "illicit")

    run = _session_run_mock(mock_driver)
    run.assert_called_once()
    (query,), kwargs = run.call_args
    assert "MERGE" in query
    assert "Transaction" in query
    assert kwargs == {"tx_id": "T1", "tx_class": "illicit"}


def test_upsert_edge_merges_both_nodes_and_relationship(store):
    s, mock_driver = store
    s.upsert_edge("T1", "T2")

    run = _session_run_mock(mock_driver)
    run.assert_called_once()
    (query,), kwargs = run.call_args
    assert query.count("MERGE") == 3  # two nodes + the relationship
    assert "SENT_TO" in query
    assert kwargs == {"from_id": "T1", "to_id": "T2"}


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
