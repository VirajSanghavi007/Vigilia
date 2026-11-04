"""Unit tests for MemgraphQueryStore: driver mocked, real neo4j graph
value types (built with the driver's own hydrator) so the conversion to
nodes/edges/rows is exercised exactly as it runs against Memgraph."""

from unittest.mock import MagicMock, patch

import pytest
from neo4j import READ_ACCESS
from neo4j._codec.hydration.v1.hydration_handler import _GraphHydrator
from neo4j.exceptions import AuthError, ClientError, Neo4jError, ServiceUnavailable, SessionExpired

from vigilia.domain.graph.query import GraphUnavailable, QueryFailed
from vigilia.infra.graph import memgraph_query
from vigilia.infra.graph.memgraph_query import MAX_NODE_PROPERTIES, MemgraphQueryStore


class FakeRecord:
    def __init__(self, data):
        self._data = data

    def values(self):
        return list(self._data.values())

    def __getitem__(self, key):
        return self._data[key]


class FakeResult(list):
    def keys(self):
        return list(self[0]._data) if self else []


@pytest.fixture
def store():
    with patch.object(memgraph_query, "GraphDatabase") as gdb:
        driver = MagicMock()
        gdb.driver.return_value = driver
        s = MemgraphQueryStore("bolt://x:7687", timeout_s=3.0)
        session = driver.session.return_value.__enter__.return_value
        tx = MagicMock()
        session.execute_read.side_effect = lambda work: work(tx)
        yield s, driver, session, tx


def _graph():
    h = _GraphHydrator()
    a = h.hydrate_node(1, ["Transaction"], {"txId": "a", "class": "illicit"}, "e1")
    b = h.hydrate_node(2, ["Transaction"], {"txId": "b", "class": "licit"}, "e2")
    r = h.hydrate_relationship(9, 1, 2, "SENT_TO", {}, "r9", "e1", "e2")
    return h, a, b, r


def _rows(tx, rows):
    tx.run.return_value = FakeResult([FakeRecord(r) for r in rows])


def test_run_read_uses_a_read_session_and_passes_the_cypher(store):
    s, driver, session, tx = store
    _rows(tx, [{"x": 1}])
    result = s.run_read("RETURN 1 AS x")
    driver.session.assert_called_with(default_access_mode=READ_ACCESS)
    tx.run.assert_called_once_with("RETURN 1 AS x")
    work = session.execute_read.call_args.args[0]
    assert work.timeout == 3.0
    assert result.columns == ["x"] and result.rows == [[1]]
    assert result.nodes == [] and result.edges == []


def test_nodes_and_relationships_become_graph_and_cells(store):
    s, _, _, tx = store
    _, a, b, r = _graph()
    _rows(tx, [{"a": a, "r": r, "b": b}])
    result = s.run_read("q")
    assert result.rows == [["Transaction a", "SENT_TO", "Transaction b"]]
    assert {n.id: n.properties for n in result.nodes} == {
        "e1": {"txId": "a", "class": "illicit"},
        "e2": {"txId": "b", "class": "licit"},
    }
    assert [(e.id, e.type, e.source, e.target) for e in result.edges] == [("r9", "SENT_TO", "e1", "e2")]
    assert result.nodes[0].labels == ["Transaction"]


def test_relationship_alone_still_draws_both_endpoints(store):
    s, _, _, tx = store
    _, _, _, r = _graph()
    _rows(tx, [{"r": r}])
    result = s.run_read("q")
    assert sorted(n.id for n in result.nodes) == ["e1", "e2"]
    assert len(result.edges) == 1


def test_paths_are_flattened_and_summarised(store):
    s, _, _, tx = store
    h, a, b, r = _graph()
    path = h.hydrate_path([a, b], [r], [1, 1])
    _rows(tx, [{"p": path}])
    result = s.run_read("q")
    assert result.rows == [["path (1 hops)"]]
    assert len(result.nodes) == 2 and len(result.edges) == 1


def test_duplicate_nodes_are_merged_keeping_the_richer_copy(store):
    s, _, _, tx = store
    # Separate hydrators: one hydrator would merge both into one object.
    bare = _GraphHydrator().hydrate_node(1, ["Transaction"], {}, "e1")
    full = _GraphHydrator().hydrate_node(1, ["Transaction"], {"txId": "a"}, "e1")
    _rows(tx, [{"n": bare}, {"n": full}, {"n": bare}])
    result = s.run_read("q")
    assert [n.properties for n in result.nodes] == [{"txId": "a"}]
    assert result.rows == [["Transaction e1"], ["Transaction a"], ["Transaction e1"]]


def test_node_properties_are_capped_with_identity_first(store):
    s, _, _, tx = store
    props = {f"f{i:03d}": float(i) for i in range(40)} | {"txId": "a", "class": "licit"}
    node = _GraphHydrator().hydrate_node(1, ["Transaction"], props, "e1")
    _rows(tx, [{"n": node}])
    kept = s.run_read("q").nodes[0].properties
    assert len(kept) == MAX_NODE_PROPERTIES
    assert list(kept)[:3] == ["class", "txId", "f000"]


def test_unlabelled_node_cell(store):
    s, _, _, tx = store
    _rows(tx, [{"n": _GraphHydrator().hydrate_node(1, [], {}, "e7")}])
    assert s.run_read("q").rows == [["node e7"]]


def test_scalars_lists_maps_and_other_values(store):
    s, _, _, tx = store
    _, a, _, _ = _graph()
    when = object()
    _rows(tx, [{"v": [1, 2.5, None, True, "s", {"k": a}], "o": when}])
    result = s.run_read("q")
    assert result.rows == [[[1, 2.5, None, True, "s", {"k": "Transaction a"}], str(when)]]
    assert len(result.nodes) == 1


@pytest.mark.parametrize("err", [ServiceUnavailable("down"), SessionExpired("gone"), AuthError("bad login")])
def test_unreachable_memgraph_is_graph_unavailable(store, err):
    s, _, session, _ = store
    session.execute_read.side_effect = err
    with pytest.raises(GraphUnavailable, match="not reachable"):
        s.run_read("RETURN 1")


def test_cypher_error_is_query_failed(store):
    s, _, session, _ = store
    err = ClientError("Unknown function 'nope'")
    session.execute_read.side_effect = err
    with pytest.raises(QueryFailed, match="nope"):
        s.run_read("RETURN nope()")


def test_server_error_shows_only_its_message(store):
    # Errors from Memgraph arrive hydrated with a code; the investigator
    # should see the message, not the "{code: ...} {message: ...}" wrapper.
    s, _, session, _ = store
    session.execute_read.side_effect = Neo4jError._hydrate_neo4j(
        code="Neo.ClientError.Statement.SyntaxError", message="Unknown function 'nope'"
    )
    with pytest.raises(QueryFailed) as caught:
        s.run_read("RETURN nope()")
    assert str(caught.value) == "Unknown function 'nope'"


def _schema_tx(tx):
    answers = {
        "labels": [("Transaction", 5), (None, 1)],
        "edge_types": [("SENT_TO", 4)],
        "class_counts": [("licit", 3), ("illicit", 2)],
        "property_keys": [("local_1", 0), ("txId", 0), ("class", 0)],
    }
    by_query = {q: answers[name] for name, q in memgraph_query._SCHEMA_QUERIES.items()}
    tx.run.side_effect = lambda q: [{"k": k, "c": c} for k, c in by_query[q]]


def test_schema_collects_counts_and_sorts_identity_keys_first(store):
    s, _, _, tx = store
    _schema_tx(tx)
    schema = s.schema()
    assert schema.labels == {"Transaction": 5}
    assert schema.edge_types == {"SENT_TO": 4}
    assert schema.class_counts == {"licit": 3, "illicit": 2}
    assert schema.property_keys == ["class", "txId", "local_1"]


def test_schema_is_cached_within_the_ttl_and_refreshed_after(store, monkeypatch):
    s, _, _, tx = store
    _schema_tx(tx)
    now = [100.0]
    monkeypatch.setattr(memgraph_query.time, "monotonic", lambda: now[0])
    first = s.schema()
    calls = tx.run.call_count
    now[0] += memgraph_query.SCHEMA_TTL_SECONDS - 1
    assert s.schema() is first and tx.run.call_count == calls
    now[0] += 2
    s.schema()
    assert tx.run.call_count == 2 * calls


def test_first_schema_call_queries_even_right_after_boot(store, monkeypatch):
    # time.monotonic() can be under the TTL soon after the machine starts;
    # an empty cache must still be filled, not returned as None.
    s, _, _, tx = store
    _schema_tx(tx)
    monkeypatch.setattr(memgraph_query.time, "monotonic", lambda: 1.0)
    assert s.schema().labels == {"Transaction": 5}


def test_close_closes_the_driver(store):
    s, driver, _, _ = store
    s.close()
    driver.close.assert_called_once()
