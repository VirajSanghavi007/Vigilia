"""Unit tests for scripts/seed_memgraph.py's pure CSV-loading logic.

scripts/ isn't an importable package under src/, so it's loaded by file path.
"""

import csv
import importlib.util
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parent.parent.parent / "scripts" / "seed_memgraph.py"


def _load_seed_module():
    spec = importlib.util.spec_from_file_location("seed_memgraph", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["seed_memgraph"] = module
    spec.loader.exec_module(module)
    return module


def _write_classes_csv(path, rows):
    with path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["txId", "class"])
        writer.writerows(rows)


def _write_edgelist_csv(path, rows):
    with path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["txId1", "txId2"])
        writer.writerows(rows)


def test_load_classes_maps_numeric_and_unknown_labels(tmp_path, monkeypatch):
    seed = _load_seed_module()
    data_dir = tmp_path / "elliptic_bitcoin_dataset"
    data_dir.mkdir()
    _write_classes_csv(
        data_dir / "elliptic_txs_classes.csv",
        [["T1", "1"], ["T2", "2"], ["T3", "unknown"]],
    )
    monkeypatch.setattr(seed, "DATA_DIR", data_dir)

    classes = seed.load_classes(limit=10)

    assert classes == {"T1": "illicit", "T2": "licit", "T3": "unknown"}


def test_load_classes_respects_limit(tmp_path, monkeypatch):
    seed = _load_seed_module()
    data_dir = tmp_path / "elliptic_bitcoin_dataset"
    data_dir.mkdir()
    _write_classes_csv(
        data_dir / "elliptic_txs_classes.csv",
        [[f"T{i}", "unknown"] for i in range(10)],
    )
    monkeypatch.setattr(seed, "DATA_DIR", data_dir)

    classes = seed.load_classes(limit=3)

    assert len(classes) == 3


def test_load_edges_keeps_only_edges_within_selected_txids(tmp_path, monkeypatch):
    seed = _load_seed_module()
    data_dir = tmp_path / "elliptic_bitcoin_dataset"
    data_dir.mkdir()
    _write_edgelist_csv(
        data_dir / "elliptic_txs_edgelist.csv",
        [["T1", "T2"], ["T1", "T99"], ["T99", "T2"]],
    )
    monkeypatch.setattr(seed, "DATA_DIR", data_dir)

    edges = seed.load_edges(tx_ids={"T1", "T2"})

    assert edges == [("T1", "T2")]
