"""Smoke tests: scripts/load_elliptic_memgraph.py starts and runs as a program.

Only the --shards-only path runs here, so no Memgraph is needed; the full
load against a real database is in tests/integration.
"""

import csv
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent.parent / "scripts" / "load_elliptic_memgraph.py"


def _run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, timeout=60)


def _tiny_dataset(path, features):
    path.mkdir()
    (path / "elliptic_txs_classes.csv").write_text("txId,class\nT1,1\nT2,unknown\n")
    (path / "elliptic_txs_edgelist.csv").write_text("txId1,txId2\nT1,T2\n")
    (path / "elliptic_txs_features.csv").write_text(features)


def test_help_runs():
    result = _run("--help")
    assert result.returncode == 0
    assert "--shards-only" in result.stdout


def test_shards_only_writes_loadable_shards(tmp_path):
    _tiny_dataset(tmp_path / "data", "T1,1,0.5\nT2,3,0.7\n")

    result = _run("--source-dir", str(tmp_path / "data"), "--shard-dir", str(tmp_path / "shards"),
                  "--shards", "1", "--shards-only")

    assert result.returncode == 0, result.stderr
    assert "Wrote 2 transactions and 1 edges" in result.stdout
    with (tmp_path / "shards" / "nodes_0.csv").open(newline="") as f:
        assert list(csv.DictReader(f)) == [
            {"txId": "T1", "class": "illicit", "timeStep": "1"},
            {"txId": "T2", "class": "unknown", "timeStep": "3"},
        ]


def test_bad_dataset_exits_with_a_message(tmp_path):
    _tiny_dataset(tmp_path / "data", "T1,1,0.5\n")

    result = _run("--source-dir", str(tmp_path / "data"), "--shard-dir", str(tmp_path / "shards"), "--shards-only")

    assert result.returncode == 1
    assert result.stderr.startswith("ERROR: txId T2")
