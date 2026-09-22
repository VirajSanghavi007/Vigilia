"""GraphStore interface — what the graph backend must support, not how.

infra/graph/ provides the concrete (Memgraph) implementation. ml/ and api/
code should depend on this Protocol, never on the driver directly.
"""

from typing import Literal, Protocol

TxClass = Literal["illicit", "licit", "unknown"]


class GraphStore(Protocol):
    def upsert_transaction(self, tx_id: str, tx_class: TxClass) -> None:
        """Create the transaction node if absent, or update its class if present."""
        ...

    def upsert_edge(self, from_id: str, to_id: str) -> None:
        """Create a directed SENT_TO edge between two transactions if absent."""
        ...

    def get_neighbors(self, tx_id: str) -> list[str]:
        """Return txIds directly connected to tx_id (either direction)."""
        ...
