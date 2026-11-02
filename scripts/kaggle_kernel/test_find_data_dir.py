"""Unit test for the find_data_dir() helper embedded in the Kaggle notebook
(extracted here since the notebook itself isn't importable as a module)."""
import os


def find_data_dir(filename, root):
    for dirpath, _, filenames in os.walk(root):
        if filename in filenames:
            return dirpath
    raise FileNotFoundError(f"Could not locate {filename} under {root}")


def test_find_data_dir_locates_nested_file(tmp_path):
    nested = tmp_path / "elliptic-data-set" / "elliptic_bitcoin_dataset"
    nested.mkdir(parents=True)
    (nested / "elliptic_txs_features.csv").write_text("dummy")

    found = find_data_dir("elliptic_txs_features.csv", str(tmp_path))
    assert found == str(nested)


def test_find_data_dir_raises_when_missing(tmp_path):
    try:
        find_data_dir("nope.csv", str(tmp_path))
        assert False, "expected FileNotFoundError"
    except FileNotFoundError:
        pass
