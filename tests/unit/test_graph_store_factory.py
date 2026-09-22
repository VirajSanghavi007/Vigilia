"""Unit tests for get_graph_store() — the factory that must actually wire up
ensure_constraints(), since it was previously defined but never called
anywhere in the app (a real deployment would run fully unindexed).
"""

from unittest.mock import MagicMock, patch

from vigilia.infra.graph import get_graph_store


def test_get_graph_store_calls_ensure_constraints():
    get_graph_store.cache_clear()
    with patch("vigilia.infra.graph.MemgraphStore") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance

        store = get_graph_store()

        mock_instance.ensure_constraints.assert_called_once()
        assert store is mock_instance
    get_graph_store.cache_clear()


def test_get_graph_store_is_cached_so_constraints_run_once():
    get_graph_store.cache_clear()
    with patch("vigilia.infra.graph.MemgraphStore") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance

        get_graph_store()
        get_graph_store()

        mock_cls.assert_called_once()
        mock_instance.ensure_constraints.assert_called_once()
    get_graph_store.cache_clear()
