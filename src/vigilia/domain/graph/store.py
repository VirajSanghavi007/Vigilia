"""GraphStore interface — what the graph backend must support, not how.

infra/graph/ provides the concrete (Memgraph) implementation. ml/ and api/
code should depend on this Protocol, never on the driver directly.
"""

from typing import Literal, Protocol

TxClass = Literal["illicit", "licit", "unknown"]


class GraphStore(Protocol):
    def upsert_transaction(
        self, tx_id: str, tx_class: TxClass, properties: dict[str, float] | None = None
    ) -> None:
        """Create the transaction node if absent, or update its class if present.

        `properties` are extra scalar node properties (e.g. feature-vector
        components) merged onto the node alongside class. Optional — callers
        that only need txId+class (the real-data loader) pass nothing.
        """
        ...

    def upsert_edge(self, from_id: str, to_id: str) -> None:
        """Create a directed SENT_TO edge between two transactions if absent."""
        ...

    def upsert_transactions_batch(self, rows: list[dict]) -> None:
        """Batched upsert_transaction — one UNWIND/MERGE query for N rows.

        Each row: {"tx_id": str, "tx_class": TxClass, "properties": dict | None}.
        For high-throughput ingestion where N events can be accepted in one
        request instead of N separate round trips.
        """
        ...

    def upsert_edges_batch(self, rows: list[dict]) -> None:
        """Batched upsert_edge. Each row: {"from_id": str, "to_id": str}."""
        ...

    def get_neighbors(self, tx_id: str) -> list[str]:
        """Return txIds directly connected to tx_id (either direction)."""
        ...
