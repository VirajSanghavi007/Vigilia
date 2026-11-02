"""Shared labeled-vs-unlabeled group comparison, used by
consistency_check.py, structural_breakdown.py, shap_analysis.py and
gnn_explain.py so all four diagnostics report the same statistics the same
way."""
import numpy as np
from scipy.stats import mannwhitneyu


def compare_groups(values, labeled_mask, alternative="two-sided"):
    """Mann-Whitney U test comparing a per-node metric between the labeled
    and unlabeled populations. alternative='greater' tests whether the
    unlabeled group's values are stochastically larger than the labeled
    group's; 'two-sided' just tests whether the two distributions differ."""
    labeled_v = np.asarray(values)[labeled_mask]
    unlabeled_v = np.asarray(values)[~labeled_mask]
    stat, p = mannwhitneyu(unlabeled_v, labeled_v, alternative=alternative)
    labeled_mean = labeled_v.mean()
    return {
        "labeled_mean": float(labeled_mean),
        "labeled_median": float(np.median(labeled_v)),
        "unlabeled_mean": float(unlabeled_v.mean()),
        "unlabeled_median": float(np.median(unlabeled_v)),
        "ratio_unlabeled_to_labeled_mean": float(unlabeled_v.mean() / max(abs(labeled_mean), 1e-12)),
        "mannwhitney_u": float(stat),
        "p_value": float(p),
        "n_labeled": int(labeled_mask.sum()),
        "n_unlabeled": int((~labeled_mask).sum()),
    }
