"""Graph explorer endpoints behind the dashboard's Investigations page.

POST /ask turns an investigator's question into Cypher with Claude, and
POST /query re-runs Cypher the investigator edited. Both go through the
same read-only guard (domain.graph.query.validate_read_only), so editing
the generated query by hand gets no more power than asking a question.

Domain errors map to HTTP status here so the page can say what went wrong:
400 for a query the guard or Memgraph rejected, 422 when Claude declined,
502 when Claude failed, 503 when Memgraph is down.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException

from vigilia.api.v1.schemas.graph import AskIn, QueryIn, QueryOut, SchemaOut
from vigilia.domain.graph.query import (
    CypherGenerator,
    CypherRejected,
    GeneratorRefused,
    GeneratorUnavailable,
    GraphQueryStore,
    GraphUnavailable,
    QueryFailed,
    QueryResult,
    ask_graph,
    validate_read_only,
)
from vigilia.infra.graph import get_graph_query_store
from vigilia.infra.llm import get_cypher_generator

router = APIRouter(prefix="/v1/graph", tags=["graph"])

_STATUS: dict[type[Exception], int] = {
    CypherRejected: 400,
    QueryFailed: 400,
    GeneratorRefused: 422,
    GeneratorUnavailable: 502,
    GraphUnavailable: 503,
}


def _http(exc: Exception) -> HTTPException:
    return HTTPException(status_code=_STATUS[type(exc)], detail=str(exc))


def _out(cypher: str, result: QueryResult, explanation: str | None = None) -> QueryOut:
    return QueryOut(cypher=cypher, explanation=explanation, **asdict(result))


@router.get("/schema")
def graph_schema(store: GraphQueryStore = Depends(get_graph_query_store)) -> SchemaOut:  # noqa: B008
    try:
        return SchemaOut(**asdict(store.schema()))
    except (GraphUnavailable, QueryFailed) as exc:
        raise _http(exc) from exc


@router.post("/ask")
def ask(
    body: AskIn,
    store: GraphQueryStore = Depends(get_graph_query_store),  # noqa: B008
    generator: CypherGenerator = Depends(get_cypher_generator),  # noqa: B008
) -> QueryOut:
    try:
        generated, cypher, result = ask_graph(body.question, generator, store)
    except tuple(_STATUS) as exc:
        raise _http(exc) from exc
    return _out(cypher, result, generated.explanation)


@router.post("/query")
def query(body: QueryIn, store: GraphQueryStore = Depends(get_graph_query_store)) -> QueryOut:  # noqa: B008
    try:
        cypher = validate_read_only(body.cypher)
        return _out(cypher, store.run_read(cypher))
    except (CypherRejected, QueryFailed, GraphUnavailable) as exc:
        raise _http(exc) from exc
