"""Memgraph-backed GraphQueryStore for the graph explorer.

Separate from MemgraphStore (the ingestion writer) on purpose: the explorer
runs arbitrary, LLM-written Cypher, so it gets its own driver, read-access
sessions and a per-query timeout, and it never shares a code path with the
write side. The read-only guarantee itself comes from
domain.graph.query.validate_read_only, which the caller applies first;
read access mode here is defense in depth, not the control.
"""

from __future__ import annotations

import time
from typing import Any

from neo4j import READ_ACCESS, Driver, GraphDatabase, unit_of_work
from neo4j.exceptions import AuthError, Neo4jError, ServiceUnavailable, SessionExpired
from neo4j.graph import Node, Path, Relationship

from vigilia.domain.graph.query import (
    GraphEdge,
    GraphNode,
    GraphSchema,
    GraphUnavailable,
    QueryFailed,
    QueryResult,
)

# Elliptic nodes carry ~166 numeric feature properties. Shipping all of them
# for every drawn node would make a 200-row path query several MB, so each
# node keeps its identifying properties plus the first few others.
MAX_NODE_PROPERTIES = 12
_PRIORITY_PROPERTIES = ("txId", "class")
SCHEMA_TTL_SECONDS = 60.0
_PROPERTY_SAMPLE = 200

_SCHEMA_QUERIES = {
    "labels": "MATCH (n) UNWIND labels(n) AS k RETURN k, count(*) AS c ORDER BY c DESC",
    "edge_types": "MATCH ()-[r]->() RETURN type(r) AS k, count(*) AS c ORDER BY c DESC",
    "class_counts": "MATCH (t:Transaction) RETURN coalesce(t.class, 'unknown') AS k, count(*) AS c ORDER BY c DESC",
    "property_keys": f"MATCH (n) WITH n LIMIT {_PROPERTY_SAMPLE} UNWIND keys(n) AS k RETURN DISTINCT k, 0 AS c",
}


class MemgraphQueryStore:
    def __init__(self, uri: str, auth: tuple[str, str] | None = None, timeout_s: float = 10.0) -> None:
        self._driver: Driver = GraphDatabase.driver(uri, auth=auth)
        self._timeout_s = timeout_s
        self._schema: GraphSchema | None = None
        self._schema_at = 0.0

    def close(self) -> None:
        self._driver.close()

    def schema(self) -> GraphSchema:
        # Every /ask needs the schema for its prompt, and the label/edge
        # counts are full scans, so they are cached briefly rather than
        # recomputed per question.
        if self._schema is not None and time.monotonic() - self._schema_at < SCHEMA_TTL_SECONDS:
            return self._schema
        found = {name: self._pairs(q) for name, q in _SCHEMA_QUERIES.items()}
        keys = sorted(found["property_keys"], key=lambda k: (k not in _PRIORITY_PROPERTIES, k))
        self._schema = GraphSchema(
            labels=found["labels"],
            edge_types=found["edge_types"],
            property_keys=keys,
            class_counts=found["class_counts"],
        )
        self._schema_at = time.monotonic()
        return self._schema

    def run_read(self, cypher: str) -> QueryResult:
        @unit_of_work(timeout=self._timeout_s)
        def work(tx: Any) -> tuple[list[str], list[Any]]:
            result = tx.run(cypher)
            return list(result.keys()), [list(record.values()) for record in result]

        columns, raw_rows = self._read(work)
        graph = _GraphCollector()
        rows = [[graph.cell(v) for v in row] for row in raw_rows]
        return QueryResult(columns=columns, rows=rows, nodes=graph.nodes(), edges=graph.edges())

    def _pairs(self, cypher: str) -> dict[str, int]:
        @unit_of_work(timeout=self._timeout_s)
        def work(tx: Any) -> list[tuple[Any, Any]]:
            return [(r["k"], r["c"]) for r in tx.run(cypher)]

        return {str(k): int(c) for k, c in self._read(work) if k is not None}

    def _read(self, work: Any) -> Any:
        try:
            with self._driver.session(default_access_mode=READ_ACCESS) as session:
                return session.execute_read(work)
        except (ServiceUnavailable, SessionExpired, AuthError) as exc:
            raise GraphUnavailable(f"Memgraph is not reachable: {exc}") from exc
        except Neo4jError as exc:
            raise QueryFailed(exc.message or str(exc)) from exc


class _GraphCollector:
    """Turns driver values into JSON-safe table cells, collecting every
    node and relationship it sees so the result can also be drawn."""

    def __init__(self) -> None:
        self._nodes: dict[str, GraphNode] = {}
        self._edges: dict[str, GraphEdge] = {}

    def nodes(self) -> list[GraphNode]:
        return list(self._nodes.values())

    def edges(self) -> list[GraphEdge]:
        return list(self._edges.values())

    def cell(self, value: Any) -> Any:
        if isinstance(value, Node):
            return self._node(value)
        if isinstance(value, Relationship):
            return self._rel(value)
        if isinstance(value, Path):
            for n in value.nodes:
                self._node(n)
            for r in value.relationships:
                self._rel(r)
            return f"path ({len(value)} hops)"
        if isinstance(value, list):
            return [self.cell(v) for v in value]
        if isinstance(value, dict):
            return {k: self.cell(v) for k, v in value.items()}
        if value is None or isinstance(value, bool | int | float | str):
            return value
        return str(value)

    def _node(self, node: Node) -> str:
        props = dict(node.items())
        # A relationship's endpoint can arrive without its properties when
        # only the relationship was returned; keep the richer copy.
        known = self._nodes.get(node.element_id)
        if known is None or len(props) > len(known.properties):
            keys = sorted(props, key=lambda k: (k not in _PRIORITY_PROPERTIES, k))
            self._nodes[node.element_id] = GraphNode(
                id=node.element_id,
                labels=sorted(node.labels),
                properties={k: props[k] for k in keys[:MAX_NODE_PROPERTIES]},
            )
        tx_id = props.get("txId")
        return f"{':'.join(sorted(node.labels)) or 'node'} {tx_id if tx_id is not None else node.element_id}"

    def _rel(self, rel: Relationship) -> str:
        start, end = rel.start_node, rel.end_node
        if start is None or end is None:  # the driver always sets both; typed Optional
            return rel.type
        self._node(start)
        self._node(end)
        self._edges[rel.element_id] = GraphEdge(
            id=rel.element_id, type=rel.type, source=start.element_id, target=end.element_id
        )
        return rel.type
