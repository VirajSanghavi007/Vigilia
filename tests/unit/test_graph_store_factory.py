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


def test_get_graph_query_store_uses_env_uri_and_writes_nothing(monkeypatch):
    from vigilia.infra.graph import get_graph_query_store

    get_graph_query_store.cache_clear()
    monkeypatch.setenv("MEMGRAPH_URI", "bolt://graph:7687")
    with patch("vigilia.infra.graph.MemgraphQueryStore") as mock_cls:
        store = get_graph_query_store()
        assert get_graph_query_store() is store
        mock_cls.assert_called_once_with("bolt://graph:7687")
        mock_cls.return_value.ensure_constraints.assert_not_called()
    get_graph_query_store.cache_clear()


def test_get_graph_query_store_defaults_to_localhost(monkeypatch):
    from vigilia.infra.graph import get_graph_query_store

    get_graph_query_store.cache_clear()
    monkeypatch.delenv("MEMGRAPH_URI", raising=False)
    with patch("vigilia.infra.graph.MemgraphQueryStore") as mock_cls:
        get_graph_query_store()
        mock_cls.assert_called_once_with("bolt://localhost:7687")
    get_graph_query_store.cache_clear()


def test_get_cypher_generator_is_cached():
    from vigilia.infra.llm import get_cypher_generator

    get_cypher_generator.cache_clear()
    with patch("vigilia.infra.llm.AnthropicCypherGenerator") as mock_cls:
        assert get_cypher_generator() is get_cypher_generator()
        mock_cls.assert_called_once_with()
    get_cypher_generator.cache_clear()
