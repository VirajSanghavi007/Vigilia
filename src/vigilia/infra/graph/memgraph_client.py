"""Memgraph-backed GraphStore.

Memgraph speaks the Bolt protocol, so the standard `neo4j` Python driver
connects to it directly — no Memgraph-specific client package needed.
"""

from neo4j import Driver, GraphDatabase

from vigilia.domain.graph.store import TxClass


class MemgraphStore:
    def __init__(self, uri: str, auth: tuple[str, str] | None = None) -> None:
        self._driver: Driver = GraphDatabase.driver(uri, auth=auth)

    def close(self) -> None:
        self._driver.close()

    def ensure_constraints(self) -> None:
        with self._driver.session() as session:
            session.run(
                "CREATE CONSTRAINT ON (t:Transaction) ASSERT t.txId IS UNIQUE"
            )
            # A unique constraint enforces uniqueness but is NOT itself a
            # queryable index in Memgraph — without this, every MATCH/MERGE
            # on txId falls back to a full label scan (confirmed via
            # PROFILE: ScanAll touching every Transaction node per lookup).
            # See docs/BENCHMARK.md for the benchmark that found this.
            session.run("CREATE INDEX ON :Transaction(txId)")

    def upsert_transaction(
        self, tx_id: str, tx_class: TxClass, properties: dict[str, float] | None = None
    ) -> None:
        with self._driver.session() as session:
            session.run(
                "MERGE (t:Transaction {txId: $tx_id}) SET t.class = $tx_class, t += $properties",
                tx_id=tx_id,
                tx_class=tx_class,
                properties=properties or {},
            )

    def upsert_edge(self, from_id: str, to_id: str) -> None:
        with self._driver.session() as session:
            session.run(
                """
                MERGE (a:Transaction {txId: $from_id})
                MERGE (b:Transaction {txId: $to_id})
                MERGE (a)-[:SENT_TO]->(b)
                """,
                from_id=from_id,
                to_id=to_id,
            )

    def upsert_transactions_batch(self, rows: list[dict]) -> None:
        with self._driver.session() as session:
            session.run(
                """
                UNWIND $rows AS row
                MERGE (t:Transaction {txId: row.tx_id})
                SET t.class = row.tx_class, t += row.properties
                """,
                rows=[{**r, "properties": r.get("properties") or {}} for r in rows],
            )

    def upsert_edges_batch(self, rows: list[dict]) -> None:
        with self._driver.session() as session:
            session.run(
                """
                UNWIND $rows AS row
                MERGE (a:Transaction {txId: row.from_id})
                MERGE (b:Transaction {txId: row.to_id})
                MERGE (a)-[:SENT_TO]->(b)
                """,
                rows=rows,
            )

    def write_back_batch(self, rows: list[dict]) -> None:
        """Cold-to-hot write-back: apply archived rows (from
        Neo4jArchiveStore.stream_snapshot_rows) back into Memgraph.

        Deliberately a separate method from upsert_transactions_batch, not
        a reuse of it — the live-ingestion endpoint's hot path stays
        untouched, and this carries its own conflict guard (archiveWrittenAt,
        distinct from the live path's plain overwrite semantics), same
        pattern as Neo4jArchiveStore.write_batch's exportedAt guard: a
        stale/out-of-order write-back must not clobber a node that's since
        been updated by live ingestion or a later write-back.

        Known limitation: this only guards write-backs against each other
        and against a node that already has an archiveWrittenAt set. It
        does NOT protect against a live-ingestion write racing a
        write-back at the same instant — solving that needs the live path
        to also participate in the same guard, out of scope here since it
        would change upsert_transaction's existing behavior/contract.
        """
        prepared = [
            {
                "tx_id": r["tx_id"],
                "tx_class": r["tx_class"],
                "written_at": r["exported_at"],
            }
            for r in rows
        ]
        with self._driver.session() as session:
            session.run(
                """
                UNWIND $rows AS row
                MERGE (t:Transaction {txId: row.tx_id})
                WITH t, row
                WHERE t.archiveWrittenAt IS NULL OR row.written_at >= t.archiveWrittenAt
                SET t.class = row.tx_class, t.archiveWrittenAt = row.written_at
                """,
                rows=prepared,
            ).consume()

    def get_neighbors(self, tx_id: str) -> list[str]:
        with self._driver.session() as session:
            result = session.run(
                """
                MATCH (t:Transaction {txId: $tx_id})-[:SENT_TO]-(n:Transaction)
                RETURN n.txId AS neighbor_id
                """,
                tx_id=tx_id,
            )
            return [record["neighbor_id"] for record in result]
