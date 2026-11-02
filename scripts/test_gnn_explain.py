import numpy as np

from gnn_explain import top_features_by_group


def test_top_features_by_group_ranks_by_absolute_shift():
    feature_names = ["a", "b", "c"]
    mean_labeled = np.array([0.1, 0.1, 0.5])
    mean_unlabeled = np.array([0.1, 0.9, 0.4])
    top = top_features_by_group(mean_labeled, mean_unlabeled, feature_names, top_k=3)
    assert top[0]["feature"] == "b"
    assert top[0]["diff"] > 0


def test_top_features_by_group_respects_top_k():
    feature_names = [f"f{i}" for i in range(10)]
    rng = np.random.default_rng(0)
    mean_labeled = rng.random(10)
    mean_unlabeled = rng.random(10)
    top = top_features_by_group(mean_labeled, mean_unlabeled, feature_names, top_k=4)
    assert len(top) == 4
