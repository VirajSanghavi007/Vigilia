"""Unit tests for scripts/load_elliptic_memgraph.py (no Memgraph needed).

scripts/ isn't an importable package under src/, so it's loaded by file path.
"""

import csv
import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parent.parent.parent / "scripts" / "load_elliptic_memgraph.py"


def _load():
    spec = importlib.util.spec_from_file_location("load_elliptic_memgraph", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["load_elliptic_memgraph"] = module
    spec.loader.exec_module(module)
    return module


def _write_dataset(data_dir, classes, edges, features):
    data_dir.mkdir(parents=True, exist_ok=True)
    with (data_dir / "elliptic_txs_classes.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["txId", "class"])
        w.writerows(classes)
    with (data_dir / "elliptic_txs_edgelist.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["txId1", "txId2"])
        w.writerows(edges)
    # The real features file has no header: txId, time step, then 165 features.
    with (data_dir / "elliptic_txs_features.csv").open("w", newline="") as f:
        csv.writer(f).writerows(features)


def _read_csv(path):
    with path.open(newline="") as f:
        return list(csv.reader(f))


class FakeResult(list):
    def consume(self):
        return None

    def single(self):
        return self[0]


class FakeSession:
    def __init__(self, log, responses=None):
        self.log = log
        self.responses = responses or {}

    def run(self, query):
        self.log.append(" ".join(query.split()))
        for prefix, rows in self.responses.items():
            if query.startswith(prefix):
                return FakeResult(rows)
        return FakeResult()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeDriver:
    def __init__(self, log, responses=None):
        self.log = log
        self.responses = responses
        self.closed = False

    def session(self):
        return FakeSession(self.log, self.responses)

    def close(self):
        self.closed = True


def test_read_nodes_maps_classes_and_joins_time_step(tmp_path):
    mod = _load()
    _write_dataset(
        tmp_path,
        classes=[["T1", "1"], ["T2", "2"], ["T3", "unknown"]],
        edges=[],
        features=[["T3", "7", "0.1", "0.2"], ["T1", "1", "0.3", "0.4"], ["T2", "49", "0.5", "0.6"]],
    )

    assert mod.read_nodes(tmp_path) == [
        {"txId": "T1", "class": "illicit", "timeStep": "1"},
        {"txId": "T2", "class": "licit", "timeStep": "49"},
        {"txId": "T3", "class": "unknown", "timeStep": "7"},
    ]


def test_read_nodes_rejects_a_class_row_without_features(tmp_path):
    mod = _load()
    _write_dataset(tmp_path, classes=[["T1", "1"], ["T2", "2"]], edges=[], features=[["T1", "1", "0.3"]])

    with pytest.raises(ValueError, match="T2"):
        mod.read_nodes(tmp_path)


def test_read_edges_returns_every_row(tmp_path):
    mod = _load()
    _write_dataset(tmp_path, classes=[], edges=[["T1", "T2"], ["T2", "T3"]], features=[])

    assert mod.read_edges(tmp_path) == [{"txId1": "T1", "txId2": "T2"}, {"txId1": "T2", "txId2": "T3"}]


def test_write_shards_splits_round_robin_with_headers(tmp_path):
    mod = _load()
    rows = [{"txId1": str(i), "txId2": str(i + 100)} for i in range(5)]

    names = mod.write_shards(rows, tmp_path, "edges", mod.EDGE_FIELDS, 2)

    assert names == ["edges_0.csv", "edges_1.csv"]
    assert _read_csv(tmp_path / "edges_0.csv") == [["txId1", "txId2"], ["0", "100"], ["2", "102"], ["4", "104"]]
    assert _read_csv(tmp_path / "edges_1.csv") == [["txId1", "txId2"], ["1", "101"], ["3", "103"]]


def test_write_shards_removes_stale_shards_of_the_same_prefix_only(tmp_path):
    mod = _load()
    (tmp_path / "edges_7.csv").write_text("stale")
    (tmp_path / "nodes_7.csv").write_text("other prefix")

    mod.write_shards([], tmp_path / "", "edges", mod.EDGE_FIELDS, 1)

    assert not (tmp_path / "edges_7.csv").exists()
    assert (tmp_path / "nodes_7.csv").exists()
    assert (tmp_path / "edges_0.csv").exists()


def test_write_shards_creates_the_shard_dir(tmp_path):
    mod = _load()

    mod.write_shards([], tmp_path / "a" / "b", "nodes", mod.NODE_FIELDS, 1)

    assert (tmp_path / "a" / "b" / "nodes_0.csv").exists()


def test_wait_for_bolt_retries_until_connected(monkeypatch):
    mod = _load()
    monkeypatch.setattr(mod.time, "sleep", lambda s: None)
    made = []

    class Driver:
        def __init__(self, ok):
            self.ok, self.closed = ok, False

        def verify_connectivity(self):
            if not self.ok:
                raise OSError("refused")

        def close(self):
            self.closed = True

    def factory(uri):
        made.append(Driver(ok=len(made) >= 2))
        return made[-1]

    driver = mod.wait_for_bolt("bolt://x", timeout=60, driver_factory=factory)

    assert driver is made[2]
    assert [d.closed for d in made] == [True, True, False]


def test_wait_for_bolt_gives_up_after_the_timeout(monkeypatch):
    mod = _load()
    clock = iter([0, 5, 10, 31])
    monkeypatch.setattr(mod.time, "monotonic", lambda: next(clock))
    sleeps = []
    monkeypatch.setattr(mod.time, "sleep", sleeps.append)

    class Down:
        def verify_connectivity(self):
            raise OSError("refused")

        def close(self):
            pass

    with pytest.raises(RuntimeError, match="docker compose up -d memgraph"):
        mod.wait_for_bolt("bolt://x", timeout=30, interval=2, driver_factory=lambda uri: Down())
    assert sleeps == [2, 2]


@pytest.mark.parametrize(
    "row, expected",
    [
        ({"constraint type": "unique", "label": "Transaction", "properties": ["txId"]},
         "DROP CONSTRAINT ON (n:Transaction) ASSERT n.txId IS UNIQUE"),
        ({"constraint type": "unique", "label": "A", "properties": ["x", "y"]},
         "DROP CONSTRAINT ON (n:A) ASSERT n.x, n.y IS UNIQUE"),
        ({"constraint type": "exists", "label": "A", "properties": "name"},
         "DROP CONSTRAINT ON (n:A) ASSERT EXISTS (n.name)"),
    ],
)
def test_drop_constraint_query(row, expected):
    assert _load().drop_constraint_query(row) == expected


def test_drop_constraint_query_refuses_unknown_kinds():
    with pytest.raises(ValueError, match="data_type"):
        _load().drop_constraint_query({"constraint type": "data_type", "label": "A", "properties": ["x"]})


def test_reset_graph_drops_constraints_before_switching_mode():
    mod = _load()
    log = []
    constraint = {"constraint type": "unique", "label": "Transaction", "properties": ["txId"]}
    session = FakeSession(log, {"SHOW CONSTRAINT INFO": [constraint]})

    mod.reset_graph(session)

    assert log == [
        "SHOW CONSTRAINT INFO",
        "DROP CONSTRAINT ON (n:Transaction) ASSERT n.txId IS UNIQUE",
        "STORAGE MODE IN_MEMORY_ANALYTICAL",
        "DROP GRAPH",
    ]


def test_finalize_restores_transactional_mode_and_returns_counts():
    mod = _load()
    log = []
    session = FakeSession(log, {"MATCH (t:Transaction)": [{"n": 3}], "MATCH ()-[r:SENT_TO]": [{"n": 2}]})

    assert mod.finalize(session) == (3, 2)
    assert log[:2] == [
        "STORAGE MODE IN_MEMORY_TRANSACTIONAL",
        "CREATE CONSTRAINT ON (t:Transaction) ASSERT t.txId IS UNIQUE",
    ]


def test_check_counts():
    mod = _load()
    mod.check_counts((3, 2), (3, 2))
    with pytest.raises(RuntimeError, match="3 nodes / 1 edges, expected 3 / 2"):
        mod.check_counts((3, 1), (3, 2))
    with pytest.raises(RuntimeError):
        mod.check_counts((2, 2), (3, 2))


def test_queries_read_from_the_container_shard_path():
    mod = _load()
    node = mod.NODE_QUERY.format(path="/csv_shards/nodes_0.csv")
    edge = mod.EDGE_QUERY.format(path="/csv_shards/edges_0.csv")

    assert 'LOAD CSV FROM "/csv_shards/nodes_0.csv"' in node
    assert "timeStep: toInteger(row.timeStep)" in node
    assert "MATCH (a:Transaction {txId: row.txId1})" in edge
    assert "CREATE (a)-[:SENT_TO]->(b)" in edge


def _fake_load(monkeypatch, mod, tmp_path, counts):
    _write_dataset(
        tmp_path / "data",
        classes=[["T1", "1"], ["T2", "2"]],
        edges=[["T1", "T2"]],
        features=[["T1", "1", "0"], ["T2", "2", "0"]],
    )
    log = []
    driver = FakeDriver(log, {"MATCH (t:Transaction)": [{"n": counts[0]}], "MATCH ()-[r:SENT_TO]": [{"n": counts[1]}]})
    monkeypatch.setattr(mod, "wait_for_bolt", lambda uri, timeout: driver)

    def run_parallel(uri, template, names, label):
        log.append(f"load {label} {names}")
        return 0.0

    monkeypatch.setattr(mod, "run_parallel", run_parallel)
    argv = ["--source-dir", str(tmp_path / "data"), "--shard-dir", str(tmp_path / "shards"), "--shards", "2"]
    return log, driver, argv


def test_main_drops_then_loads_nodes_index_edges_in_order(monkeypatch, tmp_path):
    mod = _load()
    log, driver, argv = _fake_load(monkeypatch, mod, tmp_path, counts=(2, 1))

    mod.main(argv)

    steps = [line for line in log if line.startswith(("DROP GRAPH", "load", "CREATE INDEX", "CREATE CONSTRAINT"))]
    assert steps == [
        "DROP GRAPH",
        "load nodes ['nodes_0.csv', 'nodes_1.csv']",
        "CREATE INDEX ON :Transaction(txId)",
        "load edges ['edges_0.csv', 'edges_1.csv']",
        "CREATE CONSTRAINT ON (t:Transaction) ASSERT t.txId IS UNIQUE",
    ]
    assert log[0] == "SET DATABASE SETTING 'storage.access_timeout_sec' TO '30'"
    assert driver.closed


def test_main_fails_when_the_graph_is_short(monkeypatch, tmp_path):
    mod = _load()
    _, driver, argv = _fake_load(monkeypatch, mod, tmp_path, counts=(2, 0))

    with pytest.raises(RuntimeError, match="Load incomplete"):
        mod.main(argv)
    assert driver.closed


def test_main_shards_only_never_connects(monkeypatch, tmp_path):
    mod = _load()
    log, _, argv = _fake_load(monkeypatch, mod, tmp_path, counts=(2, 1))

    mod.main([*argv, "--shards-only"])

    assert log == []
    assert sorted(p.name for p in (tmp_path / "shards").iterdir()) == [
        "edges_0.csv", "edges_1.csv", "nodes_0.csv", "nodes_1.csv"
    ]


def test_main_rejects_zero_shards():
    with pytest.raises(SystemExit):
        _load().main(["--shards", "0"])
