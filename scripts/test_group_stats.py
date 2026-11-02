import numpy as np
import pytest

from group_stats import compare_groups


def test_compare_groups_detects_higher_unlabeled_variance():
    rng = np.random.default_rng(0)
    labeled_mask = np.array([True] * 500 + [False] * 500)
    variance = np.concatenate([
        rng.normal(0.05, 0.01, 500),  # labeled: low, tight variance
        rng.normal(0.30, 0.05, 500),  # unlabeled: much higher variance
    ])
    report = compare_groups(variance, labeled_mask, alternative="greater")
    assert report["unlabeled_mean"] > report["labeled_mean"]
    assert report["ratio_unlabeled_to_labeled_mean"] > 2.0
    assert report["p_value"] < 0.01  # should be a clearly significant shift


def test_compare_groups_no_shift_gives_high_p_value():
    rng = np.random.default_rng(1)
    labeled_mask = np.array([True] * 500 + [False] * 500)
    variance = rng.normal(0.1, 0.02, 1000)  # same distribution for both groups
    report = compare_groups(variance, labeled_mask, alternative="greater")
    assert report["ratio_unlabeled_to_labeled_mean"] == pytest.approx(1.0, abs=0.15)
    assert report["p_value"] > 0.05  # should NOT be significant


def test_compare_groups_two_sided_detects_lower_unlabeled_values_too():
    """two-sided must catch a shift in EITHER direction, unlike the
    'greater' alternative used for the variance-specific hypothesis."""
    rng = np.random.default_rng(2)
    labeled_mask = np.array([True] * 500 + [False] * 500)
    values = np.concatenate([
        rng.normal(5.0, 0.5, 500),   # labeled: higher
        rng.normal(1.0, 0.5, 500),   # unlabeled: lower
    ])
    report = compare_groups(values, labeled_mask, alternative="two-sided")
    assert report["unlabeled_mean"] < report["labeled_mean"]
    assert report["p_value"] < 0.01
