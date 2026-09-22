"""Request schemas for the live transaction-ingestion endpoint."""

from __future__ import annotations

from pydantic import BaseModel

from vigilia.domain.graph.store import TxClass


class TransactionIn(BaseModel):
    tx_id: str
    tx_class: TxClass
    properties: dict[str, float] | None = None


class EdgeIn(BaseModel):
    from_id: str
    to_id: str


class TransactionBatchIn(BaseModel):
    transactions: list[TransactionIn]


class EdgeBatchIn(BaseModel):
    edges: list[EdgeIn]
