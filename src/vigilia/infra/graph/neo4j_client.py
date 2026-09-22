"""Neo4j-backed ArchiveStore — cold-storage target for point-in-time
compliance snapshots exported out of the hot Memgraph store.

Neo4j was chosen over Postgres+Apache AGE for this role after benchmarking
both: real (multiprocess, non-GIL-bound) pipelined write throughput was
~28,500 rows/s for Neo4j vs ~24,255 rows/s for Postgres+AGE — see
docs/BENCHMARK.md for the full comparison and why the naive/threaded
benchmarks misleadingly looked identical (a GIL-contention artifact, not a
real backend difference).
"""

from neo4j import Driver, GraphDatabase


class Neo4jArchiveStore:
    def __init__(self, uri: str, auth: tuple[str, str] | None = None) -> None:
        self._driver: Driver = GraphDatabase.driver(uri, auth=auth)

    def close(self) -> None:
        self._driver.close()

    def ensure_indexes(self) -> None:
        with self._driver.session() as session:
            # Composite uniqueness per (snapshotId, txId), NOT per txId alone —
            # the same txId legitimately appears once per snapshot (append-only
            # versioning, see ArchiveStore docstring), so a plain txId-unique
            # constraint would reject every snapshot after the first.
            session.run(
                "CREATE CONSTRAINT vigilia_archive_snapshot_txid IF NOT EXISTS "
                "FOR (t:ArchivedTransaction) REQUIRE (t.snapshotId, t.txId) IS UNIQUE"
            ).consume()
            # Neo4j builds indexes/constraints asynchronously — a write
            # immediately after creation can race the population and either
            # fall back to a full scan or block unpredictably. Wait explicitly.
            session.run("CALL db.awaitIndexes()").consume()

    def write_batch(self, snapshot_id: str, rows: list[dict]) -> None:
        """Idempotent per (snapshot_id, tx_id): safe to retry a batch after
        a crash with no duplicates (MERGE on the composite key), and
        defensively conflict-safe (only applies an incoming row if its
        exported_at is not older than what's already there) in case batches
        from a retried/replayed export arrive out of order — cheap
        insurance per the benchmark (~0.95x cost of a blind write, not a
        real tradeoff), even though a single exporter run doesn't strictly
        need it.
        """
        prepared = [
            {
                "txId": r["tx_id"],
                "class": r["tx_class"],
                "exportedAt": r["exported_at"],
            }
            for r in rows
        ]
        with self._driver.session() as session:
            session.run(
                """
                UNWIND $rows AS row
                MERGE (t:ArchivedTransaction {snapshotId: $snapshotId, txId: row.txId})
                WITH t, row
                WHERE t.exportedAt IS NULL OR row.exportedAt >= t.exportedAt
                SET t.class = row.class, t.exportedAt = row.exportedAt
                """,
                snapshotId=snapshot_id,
                rows=prepared,
            ).consume()

    def count_snapshot(self, snapshot_id: str) -> int:
        with self._driver.session() as session:
            result = session.run(
                "MATCH (t:ArchivedTransaction {snapshotId: $snapshotId}) RETURN count(t) AS c",
                snapshotId=snapshot_id,
            )
            return result.single()["c"]

    def save_checkpoint(self, snapshot_id: str, last_tx_id: str) -> None:
        """Durable resume point for a snapshot that hasn't finished within
        its deadline. Stored on the archive side (not in-memory in the
        exporter process) so a resume works even after a full process
        restart, not just a retry within the same run.
        """
        with self._driver.session() as session:
            session.run(
                "MERGE (c:SnapshotCheckpoint {snapshotId: $snapshotId}) "
                "SET c.lastTxId = $lastTxId, c.updatedAt = timestamp()",
                snapshotId=snapshot_id,
                lastTxId=last_tx_id,
            ).consume()

    def get_checkpoint(self, snapshot_id: str) -> str | None:
        with self._driver.session() as session:
            result = session.run(
                "MATCH (c:SnapshotCheckpoint {snapshotId: $snapshotId}) RETURN c.lastTxId AS lastTxId",
                snapshotId=snapshot_id,
            ).single()
            return result["lastTxId"] if result else None

    def clear_checkpoint(self, snapshot_id: str) -> None:
        """Called once a snapshot completes — a lingering checkpoint after
        completion would make a later same-id resume attempt (a bug
        elsewhere, but defense in depth) silently skip already-archived
        rows instead of starting fresh.
        """
        with self._driver.session() as session:
            session.run(
                "MATCH (c:SnapshotCheckpoint {snapshotId: $snapshotId}) DELETE c",
                snapshotId=snapshot_id,
            ).consume()

    _STREAM_CHUNK_SIZE = 500_000

    def stream_snapshot_txids(self, snapshot_id: str):
        """txIds for a snapshot, in sorted order (uses the composite index —
        see ensure_indexes) so it can be merge-compared against Memgraph's
        own sorted txId stream without materializing either side fully in
        memory. Used by diff_snapshot() for real reconciliation.

        Paginated via WHERE txId > $last ... LIMIT, a fresh session per
        chunk — a single session streaming millions of rows was confirmed
        (on the Memgraph side of this same diff) to hit a database-side
        transaction timeout at real scale; chunking here for the same
        reason, consistently, rather than waiting to hit an analogous
        limit on this side too.
        """
        last_tx_id = None
        while True:
            with self._driver.session() as session:
                if last_tx_id is None:
                    result = session.run(
                        "MATCH (t:ArchivedTransaction {snapshotId: $snapshotId}) "
                        "RETURN t.txId AS txId ORDER BY t.txId LIMIT $limit",
                        snapshotId=snapshot_id,
                        limit=self._STREAM_CHUNK_SIZE,
                    )
                else:
                    result = session.run(
                        "MATCH (t:ArchivedTransaction {snapshotId: $snapshotId}) "
                        "WHERE t.txId > $lastTxId "
                        "RETURN t.txId AS txId ORDER BY t.txId LIMIT $limit",
                        snapshotId=snapshot_id,
                        lastTxId=last_tx_id,
                        limit=self._STREAM_CHUNK_SIZE,
                    )
                chunk = [record["txId"] for record in result]
            if not chunk:
                break
            yield from chunk
            last_tx_id = chunk[-1]
            if len(chunk) < self._STREAM_CHUNK_SIZE:
                break

    def stream_snapshot_rows(self, snapshot_id: str):
        """Full rows for a snapshot, sorted by txId — the read side of a
        cold-to-hot write-back. Paginated the same way and for the same
        reason as stream_snapshot_txids.
        """
        last_tx_id = None
        while True:
            with self._driver.session() as session:
                if last_tx_id is None:
                    result = session.run(
                        "MATCH (t:ArchivedTransaction {snapshotId: $snapshotId}) "
                        "RETURN t.txId AS txId, t.class AS class, t.exportedAt AS exportedAt "
                        "ORDER BY t.txId LIMIT $limit",
                        snapshotId=snapshot_id,
                        limit=self._STREAM_CHUNK_SIZE,
                    )
                else:
                    result = session.run(
                        "MATCH (t:ArchivedTransaction {snapshotId: $snapshotId}) "
                        "WHERE t.txId > $lastTxId "
                        "RETURN t.txId AS txId, t.class AS class, t.exportedAt AS exportedAt "
                        "ORDER BY t.txId LIMIT $limit",
                        snapshotId=snapshot_id,
                        lastTxId=last_tx_id,
                        limit=self._STREAM_CHUNK_SIZE,
                    )
                chunk = [
                    {"tx_id": r["txId"], "tx_class": r["class"], "exported_at": r["exportedAt"]}
                    for r in result
                ]
            if not chunk:
                break
            yield from chunk
            last_tx_id = chunk[-1]["tx_id"]
            if len(chunk) < self._STREAM_CHUNK_SIZE:
                break
