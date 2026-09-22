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
