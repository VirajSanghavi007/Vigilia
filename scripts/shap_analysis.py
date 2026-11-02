"""SHAP (TreeExplainer) on the saved XGBoost model: which features drive its
predictions, and do those attributions look different on unlabeled nodes
than on labeled ones? A feature whose SHAP contribution distribution shifts
between the two groups is evidence the model is leaning on that feature
differently (or that feature's value distribution itself differs) for the
population it was never trained/validated on.
"""
import argparse
import os

import joblib
import numpy as np
import shap

from data import FEAT_COLS, get_dataset
from group_stats import compare_groups

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")

XGB_FEAT_NAMES = (
    FEAT_COLS  # raw 165
    + [f"neigh_mean_{c}" for c in FEAT_COLS]  # 165
    + ["degree"]  # 1
    + [f"roll_{c}" for c in FEAT_COLS[:10]]  # 10
)


def compute_shap_values(model, X_sample):
    explainer = shap.TreeExplainer(model)
    return explainer.shap_values(X_sample)


def top_divergent_features(shap_labeled, shap_unlabeled, feature_names, top_k=15):
    """Rank features by how much their |SHAP| distribution shifts between
    groups (labeled vs unlabeled), using mean absolute SHAP as the summary
    statistic per feature per group."""
    mean_abs_labeled = np.abs(shap_labeled).mean(axis=0)
    mean_abs_unlabeled = np.abs(shap_unlabeled).mean(axis=0)
    diff = mean_abs_unlabeled - mean_abs_labeled
    order = np.argsort(-np.abs(diff))[:top_k]
    return [
        {
            "feature": feature_names[i],
            "mean_abs_shap_labeled": float(mean_abs_labeled[i]),
            "mean_abs_shap_unlabeled": float(mean_abs_unlabeled[i]),
            "diff": float(diff[i]),
        }
        for i in order
    ]


def run(sample_size=5000, seed=0):
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    labeled_mask = train_mask | test_mask
    unlabeled_idx = np.where(~labeled_mask)[0]
    labeled_idx = np.where(labeled_mask)[0]

    rng = np.random.default_rng(seed)
    sample_labeled = rng.choice(labeled_idx, size=min(sample_size, len(labeled_idx)), replace=False)
    sample_unlabeled = rng.choice(unlabeled_idx, size=min(sample_size, len(unlabeled_idx)), replace=False)

    model = joblib.load(os.path.join(CKPT_DIR, "xgb_model.joblib"))

    print(f"computing SHAP values for {len(sample_labeled)} labeled + "
          f"{len(sample_unlabeled)} unlabeled sampled nodes...")
    shap_labeled = compute_shap_values(model, X_xgb[sample_labeled])
    shap_unlabeled = compute_shap_values(model, X_xgb[sample_unlabeled])

    top = top_divergent_features(shap_labeled, shap_unlabeled, XGB_FEAT_NAMES, top_k=15)
    print("Top 15 features by |SHAP| shift (unlabeled - labeled):")
    for row in top:
        print(f"  {row['feature']:20s} labeled={row['mean_abs_shap_labeled']:.4f} "
              f"unlabeled={row['mean_abs_shap_unlabeled']:.4f} diff={row['diff']:+.4f}")

    # overall magnitude comparison: is the model relying on features more/less
    # strongly overall (sum of |SHAP| per prediction) on unlabeled nodes?
    total_abs_shap_labeled = np.abs(shap_labeled).sum(axis=1)
    total_abs_shap_unlabeled = np.abs(shap_unlabeled).sum(axis=1)
    combined = np.concatenate([total_abs_shap_labeled, total_abs_shap_unlabeled])
    combined_mask = np.array([True] * len(total_abs_shap_labeled) + [False] * len(total_abs_shap_unlabeled))
    magnitude_report = compare_groups(combined, combined_mask, alternative="two-sided")
    print(f"[total |SHAP| magnitude] labeled_mean={magnitude_report['labeled_mean']:.3f} "
          f"unlabeled_mean={magnitude_report['unlabeled_mean']:.3f} "
          f"p={magnitude_report['p_value']:.2e}")

    return {"top_divergent_features": top, "magnitude": magnitude_report}


if __name__ == "__main__":
    import json
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample-size", type=int, default=5000)
    args = parser.parse_args()
    result = run(sample_size=args.sample_size)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(os.path.join(RESULTS_DIR, "shap_analysis.json"), "w") as f:
        json.dump(result, f, indent=2)
    print(f"[saved] {os.path.join(RESULTS_DIR, 'shap_analysis.json')}")
