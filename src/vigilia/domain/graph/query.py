"""Read-only graph exploration: natural-language questions to Cypher.

An external LLM writes Cypher that runs against the live transaction graph,
so its output is treated exactly like untrusted user input. The guard here
(`validate_read_only`) is the primary defense, not the prompt: a prompt
asking for read-only queries is a request, this module is the enforcement.
It is deliberately conservative (an allow-list of clause starts, a deny-list
of every write/admin keyword, one statement, a forced row cap), so an
occasional legitimate query that trips it is the accepted cost.

No driver or SDK imports here: infra/ implements GraphQueryStore and
CypherGenerator, api/ wires them together.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Protocol

MAX_ROWS = 200
MAX_CYPHER_CHARS = 4000


class CypherRejected(ValueError):
    """The query is not a single read-only statement this module allows."""


class QueryFailed(RuntimeError):
    """The graph store refused or failed to execute an allowed query."""


class GraphUnavailable(RuntimeError):
    """The graph store could not be reached at all."""


class GeneratorUnavailable(RuntimeError):
    """The LLM could not be reached, or returned something unusable."""


class GeneratorRefused(RuntimeError):
    """The LLM declined to answer the question."""


@dataclass(frozen=True)
class GraphSchema:
    labels: dict[str, int]
    edge_types: dict[str, int]
    property_keys: list[str]
    class_counts: dict[str, int]


@dataclass(frozen=True)
class GraphNode:
    id: str
    labels: list[str]
    properties: dict[str, Any]


@dataclass(frozen=True)
class GraphEdge:
    id: str
    type: str
    source: str
    target: str


@dataclass(frozen=True)
class QueryResult:
    columns: list[str]
    rows: list[list[Any]]
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)


@dataclass(frozen=True)
class GeneratedQuery:
    cypher: str
    explanation: str


class GraphQueryStore(Protocol):
    def schema(self) -> GraphSchema: ...

    def run_read(self, cypher: str) -> QueryResult: ...


class CypherGenerator(Protocol):
    def generate(self, question: str, schema: GraphSchema) -> GeneratedQuery: ...


# Every clause or command that can write, change schema, call procedures
# (which may write), or touch server/replication state. CALL is denied
# outright rather than allow-listed by procedure name: the explorer needs no
# procedures, and the schema comes from GraphQueryStore.schema() instead.
_FORBIDDEN = re.compile(
    r"\b(CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP|LOAD|FOREACH|CALL|ALTER|GRANT|REVOKE|DENY"
    r"|TRUNCATE|ANALYZE|FREE|STORAGE|INDEX|CONSTRAINT|TRIGGER|STREAM|BEGIN|COMMIT|ROLLBACK"
    r"|DUMP|SHOW|SNAPSHOT|LOCK|UNLOCK|REPLICA|REGISTER|USING|UNION|EXPLAIN|PROFILE)\b",
    re.IGNORECASE,
)
_ALLOWED_START = re.compile(r"^\s*(MATCH|OPTIONAL\s+MATCH|WITH|UNWIND|RETURN)\b", re.IGNORECASE)
_HAS_RETURN = re.compile(r"\bRETURN\b", re.IGNORECASE)
_TRAILING_LIMIT = re.compile(r"\bLIMIT\s+(\d+)\s*$", re.IGNORECASE)
# Strings, backtick identifiers and comments, so keywords inside them
# ("MATCH (t {note: 'DELETE me'})") neither trip the deny-list nor hide a
# real statement separator.
_OPAQUE = re.compile(
    r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`[^`]*`|//[^\n]*|/\*.*?\*/", re.DOTALL
)


def _mask(cypher: str) -> str:
    """Blank out opaque spans, keeping every offset identical to the input."""
    return _OPAQUE.sub(lambda m: " " * len(m.group(0)), cypher)


def validate_read_only(cypher: str, max_rows: int = MAX_ROWS) -> str:
    """Return `cypher` as a single read-only statement capped at `max_rows`.

    Raises CypherRejected with a message the analyst can act on.
    """
    text = cypher.strip()
    if not text:
        raise CypherRejected("Query is empty.")
    if len(text) > MAX_CYPHER_CHARS:
        raise CypherRejected(f"Query is longer than {MAX_CYPHER_CHARS} characters.")
    masked = _mask(text)
    if any(q in masked for q in ("'", '"', "`")) or "/*" in masked:
        raise CypherRejected("Query has an unterminated string, identifier or comment.")
    stripped = masked.rstrip().rstrip(";").rstrip()
    if ";" in stripped:
        raise CypherRejected("Only one statement can run at a time.")
    text = text[: len(stripped)]
    masked = stripped
    if m := _FORBIDDEN.search(masked):
        raise CypherRejected(f"{m.group(1).upper()} is not allowed: the explorer is read-only.")
    if not _ALLOWED_START.match(masked):
        raise CypherRejected("Query must start with MATCH, OPTIONAL MATCH, WITH, UNWIND or RETURN.")
    if not _HAS_RETURN.search(masked):
        raise CypherRejected("Query must RETURN something to show.")
    if m := _TRAILING_LIMIT.search(masked):
        if int(m.group(1)) <= max_rows:
            return text
        return f"{text[: m.start(1)]}{max_rows}{text[m.end(1):]}"
    return f"{text}\nLIMIT {max_rows}"


def build_cypher_prompt(schema: GraphSchema, max_rows: int = MAX_ROWS) -> str:
    """System prompt for the generator, grounded in the live schema."""
    labels = ", ".join(f"{k} ({v:,} nodes)" for k, v in schema.labels.items()) or "none yet"
    edges = ", ".join(f"{k} ({v:,} edges)" for k, v in schema.edge_types.items()) or "none yet"
    classes = ", ".join(f"{k}: {v:,}" for k, v in schema.class_counts.items()) or "none yet"
    keys = ", ".join(schema.property_keys) or "none yet"
    return f"""You translate an AML investigator's question into one Memgraph Cypher query over a \
transaction graph.

The graph models the Elliptic Bitcoin dataset: each node is a transaction, and an edge \
(a:Transaction)-[:SENT_TO]->(b:Transaction) means funds flowed from a to b.

Live schema:
- Node labels: {labels}
- Relationship types: {edges}
- Transaction.class values: {classes} ("illicit", "licit", or "unknown" when unlabelled)
- Node property keys: {keys}
- txId is a string, so compare it with a quoted literal: {{txId: "230425980"}}

Rules for the query:
- Read-only. The service rejects CREATE, MERGE, SET, DELETE, REMOVE, DROP, LOAD CSV, \
FOREACH, CALL, UNION, and more than one statement.
- Start with MATCH, OPTIONAL MATCH, WITH, UNWIND or RETURN, and end with LIMIT {max_rows} or less.
- Write literals inline; query parameters are not supplied.
- Use only the labels, relationship types and properties listed above.
- The result is drawn as a graph. Whenever the question is about structure (neighbours, \
paths, flows, clusters), return the nodes and relationships or the path itself, for \
example `MATCH p=(a)-[:SENT_TO*1..3]->(b) RETURN p`, not just ids or counts.
- Bound variable-length paths (at most *1..4) so the query stays fast.

In the explanation, say in one or two plain sentences what the query returns and any \
assumption you made about the question."""


def ask_graph(
    question: str, generator: CypherGenerator, store: GraphQueryStore, max_rows: int = MAX_ROWS
) -> tuple[GeneratedQuery, str, QueryResult]:
    """Generate Cypher for `question`, guard it, run it.

    Returns the generator's output, the Cypher that actually ran (after the
    guard capped its LIMIT), and the result.
    """
    generated = generator.generate(question, store.schema())
    cypher = validate_read_only(generated.cypher, max_rows)
    return generated, cypher, store.run_read(cypher)
