import numpy as np

from shap_analysis import top_divergent_features


def test_top_divergent_features_ranks_by_absolute_shift():
    feature_names = ["a", "b", "c"]
    # feature 'a': same magnitude both groups (no shift)
    # feature 'b': much higher |SHAP| in unlabeled group (big positive shift)
    # feature 'c': slightly lower in unlabeled (small shift)
    shap_labeled = np.array([[0.1, 0.1, 0.5], [0.1, 0.1, 0.5]])
    shap_unlabeled = np.array([[0.1, 0.9, 0.4], [0.1, 0.9, 0.4]])

    top = top_divergent_features(shap_labeled, shap_unlabeled, feature_names, top_k=3)
    assert top[0]["feature"] == "b"  # largest |diff| ranked first
    assert top[0]["diff"] > 0


def test_top_divergent_features_respects_top_k():
    feature_names = [f"f{i}" for i in range(10)]
    rng = np.random.default_rng(0)
    shap_labeled = rng.normal(0, 1, (5, 10))
    shap_unlabeled = rng.normal(0, 1, (5, 10))
    top = top_divergent_features(shap_labeled, shap_unlabeled, feature_names, top_k=4)
    assert len(top) == 4
