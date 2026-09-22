"""Integration test against a real Neo4j instance — same fail-loudly
pattern as tests/integration/test_memgraph_integration.py: no reachable
Neo4j means an actionable failure, not a silent skip that reports "passed"
without exercising anything.

Requires a Neo4j container reachable at NEO4J_TEST_URI (default
bolt://localhost:7688, matching the ad-hoc container used for the
docs/BENCHMARK.md benchmarks — `docker run -d --name vigilia-bench-neo4j
-p 7688:7687 -e NEO4J_AUTH=neo4j/benchmarkpass neo4j:5-community`), not
part of docker-compose.yml since Neo4j is a cold-archive target, not a
service this project runs continuously.
"""

import os

import pytest

from vigilia.infra.graph.neo4j_client import Neo4jArchiveStore

NEO4J_URI = os.environ.get("NEO4J_TEST_URI", "bolt://localhost:7688")
NEO4J_AUTH = ("neo4j", os.environ.get("NEO4J_TEST_PASSWORD", "benchmarkpass"))


@pytest.fixture
def neo4j_available():
    store = Neo4jArchiveStore(NEO4J_URI, auth=NEO4J_AUTH)
    try:
        with store._driver.session() as session:
            session.run("RETURN 1").consume()
        return True
    except Exception:
        return False
    finally:
        store.close()


@pytest.fixture
def archive_store(neo4j_available):
    if not neo4j_available:
        pytest.fail(
            f"Neo4j not reachable at {NEO4J_URI}. Start it with "
            f"`docker run -d --name vigilia-bench-neo4j -p 7688:7687 "
            f"-e NEO4J_AUTH=neo4j/benchmarkpass neo4j:5-community` before "
            f"running integration tests."
        )

    s = Neo4jArchiveStore(NEO4J_URI, auth=NEO4J_AUTH)
    s.ensure_indexes()
    with s._driver.session() as session:
        session.run("MATCH (n:ArchivedTransaction) DETACH DELETE n").consume()
    yield s
    with s._driver.session() as session:
        session.run("MATCH (n:ArchivedTransaction) DETACH DELETE n").consume()
    s.close()


def test_write_batch_is_idempotent_across_retries(archive_store):
    rows = [{"tx_id": "T1", "tx_class": "illicit", "exported_at": 1.0}]
    archive_store.write_batch("snap-A", rows)
    archive_store.write_batch("snap-A", rows)  # simulates a retried batch

    assert archive_store.count_snapshot("snap-A") == 1


def test_same_txid_across_different_snapshots_is_not_deduplicated(archive_store):
    rows = [{"tx_id": "T1", "tx_class": "unknown", "exported_at": 1.0}]
    archive_store.write_batch("snap-A", rows)
    archive_store.write_batch("snap-B", rows)

    assert archive_store.count_snapshot("snap-A") == 1
    assert archive_store.count_snapshot("snap-B") == 1


def test_stale_write_does_not_overwrite_newer_record(archive_store):
    archive_store.write_batch(
        "snap-A", [{"tx_id": "T1", "tx_class": "illicit", "exported_at": 5.0}]
    )
    # a stale/out-of-order retry with an OLDER exported_at must not clobber
    # the newer value already written
    archive_store.write_batch(
        "snap-A", [{"tx_id": "T1", "tx_class": "unknown", "exported_at": 1.0}]
    )

    with archive_store._driver.session() as session:
        result = session.run(
            "MATCH (t:ArchivedTransaction {snapshotId: 'snap-A', txId: 'T1'}) RETURN t.class AS c"
        ).single()
    assert result["c"] == "illicit"
