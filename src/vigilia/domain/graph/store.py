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


class ArchiveStore(Protocol):
    """Write-only cold-storage target for a point-in-time graph snapshot.

    Deliberately write-only and one-directional (hot -> cold), not a second
    GraphStore: see docs/BENCHMARK.md's cross-store-traversal benchmark for
    why a query spanning both hot and cold live is ~4x slower per lookup and
    can fail partially — the archive is not meant to be queried as part of
    normal operation, only exported to and read back wholesale for
    compliance/audit.

    Records are append-only per snapshot_id (never overwritten across
    snapshots) so a later correction can't erase an earlier audit record;
    within a single snapshot, writes MUST be idempotent (same snapshot_id +
    tx_id retried after a crash produces no duplicates) since the exporter
    has no two-phase commit across the hot and cold stores.
    """

    def ensure_indexes(self) -> None:
        """Create whatever index/constraint this backend needs before writes."""
        ...

    def write_batch(self, snapshot_id: str, rows: list[dict]) -> None:
        """Idempotently write a batch of archived nodes for this snapshot.

        Each row: {"tx_id": str, "tx_class": TxClass}. Retrying the same
        (snapshot_id, row) pair after a partial failure must not duplicate
        or corrupt data — see docs/BENCHMARK.md's crash-restart-duplication
        benchmark for why CREATE alone is not safe here.
        """
        ...

    def count_snapshot(self, snapshot_id: str) -> int:
        """Row count for a snapshot — used for post-export reconciliation
        against the source count. A match does not prove correctness (two
        different sets of the same size can still differ), only that
        nothing obviously silently failed. See stream_snapshot_txids for
        an id-level diff instead of a count-only check.
        """
        ...

    def save_checkpoint(self, snapshot_id: str, last_tx_id: str) -> None:
        """Durable resume point, so a snapshot too large to finish inside
        its deadline resumes from here on the next call with the same
        snapshot_id — including after a full process restart, since this
        is stored on the archive side, not in exporter memory.
        """
        ...

    def get_checkpoint(self, snapshot_id: str) -> str | None:
        """None if the snapshot hasn't started or has already completed
        (see clear_checkpoint)."""
        ...

    def clear_checkpoint(self, snapshot_id: str) -> None:
        """Called once a snapshot finishes — a leftover checkpoint after
        completion would make a later same-id call silently resume from
        the wrong place instead of being a no-op/re-verify.
        """
        ...

    def stream_snapshot_txids(self, snapshot_id: str):
        """txIds for a snapshot, sorted, for a memory-bounded id-level
        diff against the source (see infra/graph/snapshot_export.py's
        diff_snapshot) instead of a count-only reconciliation check.
        """
        ...

    def stream_snapshot_rows(self, snapshot_id: str):
        """Full archived rows for a snapshot, sorted by tx_id — the read
        side of a cold-to-hot write-back.
        """
        ...
