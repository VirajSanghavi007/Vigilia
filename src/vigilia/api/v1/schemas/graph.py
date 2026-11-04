"""Request/response schemas for the graph explorer endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from vigilia.domain.graph.query import MAX_CYPHER_CHARS


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=1000)


class QueryIn(BaseModel):
    cypher: str = Field(min_length=1, max_length=MAX_CYPHER_CHARS)


class SchemaOut(BaseModel):
    labels: dict[str, int]
    edge_types: dict[str, int]
    property_keys: list[str]
    class_counts: dict[str, int]


class NodeOut(BaseModel):
    id: str
    labels: list[str]
    properties: dict[str, Any]


class EdgeOut(BaseModel):
    id: str
    type: str
    source: str
    target: str


class QueryOut(BaseModel):
    cypher: str
    explanation: str | None = None
    columns: list[str]
    rows: list[list[Any]]
    nodes: list[NodeOut]
    edges: list[EdgeOut]
