"""Collect all results/*.json and write BENCHMARK.md with improvement deltas vs baseline."""
import os

from metrics import load_all_results

OUT = os.path.join(os.path.dirname(__file__), "..", "BENCHMARK.md")

ORDER = [
    "naive_bayes_baseline",
    "xgboost_non_tuned",
    "xgboost_optuna_tuned",
    "random_forest_non_tuned",
    "lightgbm_non_tuned",
    "catboost_non_tuned",
    "formula_ensemble_xgb_lgbm_cat_rf",
    "stacking_ensemble_linear",
    "graphsage_attention_gnn",
    "temporal_static_multignn",
    "unified_gnn_optuna_tuned",
    "unified_gnn_optuna_tuned_v2",
]

DISPLAY = {
    "naive_bayes_baseline": "Naive Bayes (baseline)",
    "xgboost_non_tuned": "XGBoost (non-tuned, balanced weights)",
    "xgboost_optuna_tuned": "XGBoost (Optuna-tuned, time-series CV)",
    "random_forest_non_tuned": "Random Forest (non-tuned, balanced weights)",
    "lightgbm_non_tuned": "LightGBM (non-tuned, balanced weights)",
    "catboost_non_tuned": "CatBoost (non-tuned, balanced weights)",
    "formula_ensemble_xgb_lgbm_cat_rf": "Formula-weighted ensemble (XGB+LGBM+CAT+RF)",
    "stacking_ensemble_linear": "Stacking ensemble (linear meta-learner)",
    "graphsage_attention_gnn": "GraphSAGE + Attention GNN (best k-hop)",
    "temporal_static_multignn": "Temporal Static MultiGNN",
    "unified_gnn_optuna_tuned": "Unified GNN v1 (SAGE+GAT+Temporal, Optuna, single split, pos_weight)",
    "unified_gnn_optuna_tuned_v2": "Unified GNN v2 (rolling CV, BatchNorm only, F1 objective)",
}


def fmt(x):
    return f"{x:.4f}" if isinstance(x, float) else str(x)


def main():
    results = load_all_results()
    baseline = results.get("naive_bayes_baseline")

    lines = ["# Elliptic Fraud Detection Benchmarks\n"]
    lines.append("Temporal split: train = time steps 1-34, test = time steps 35-49. "
                  "Metric definitions: ROC-AUC, ROC-PR (average precision), F1 "
                  "(illicit=positive class), full classification report per model.\n")

    lines.append("| Model | ROC-AUC | ROC-AUC vs baseline | ROC-PR | ROC-PR vs baseline | "
                  "F1 | F1 vs baseline | Train time (s) |")
    lines.append("|---|---|---|---|---|---|---|---|")

    for key in ORDER:
        if key not in results:
            continue
        r = results[key]
        row = [DISPLAY[key], fmt(r["roc_auc"]), "", fmt(r["roc_pr_auc"]), "", fmt(r["f1"]), "",
               fmt(r.get("train_seconds"))]
        if baseline and key != "naive_bayes_baseline":
            row[2] = f"{r['roc_auc'] - baseline['roc_auc']:+.4f}"
            row[4] = f"{r['roc_pr_auc'] - baseline['roc_pr_auc']:+.4f}"
            row[6] = f"{r['f1'] - baseline['f1']:+.4f}"
        lines.append("| " + " | ".join(row) + " |")

    lines.append("\n## Classification reports\n")
    for key in ORDER:
        if key not in results:
            continue
        r = results[key]
        lines.append(f"### {DISPLAY[key]}\n")
        if "best_k_hop" in r:
            lines.append(f"Best k-hop (swept 2-8): **{r['best_k_hop']}**\n")
            lines.append("K-hop sweep (test ROC-AUC):\n")
            for k, v in sorted(r["k_hop_sweep"].items(), key=lambda kv: int(kv[0])):
                lines.append(f"- k={k}: roc_auc={v['roc_auc']:.4f}, roc_pr={v['roc_pr_auc']:.4f}, f1={v['f1']:.4f}")
            lines.append("")
        if "best_params" in r:
            lines.append(f"Best Optuna params: `{r['best_params']}`\n")
        if "weights" in r:
            lines.append(f"Formula blend weights: `{r['weights']}`\n")
            lines.append(f"Base learner train times (s): `{r.get('base_train_seconds')}`\n")
        if "meta_coef" in r:
            lines.append(f"Logistic meta-learner coefficients: `{r['meta_coef']}`\n")
            lines.append(f"Base learner train times (s): `{r.get('base_train_seconds')}`\n")
        if key == "unified_gnn_optuna_tuned":
            lines.append(f"Optuna trials: {r['n_trials']}. Best internal-validation ROC-AUC "
                          f"during tuning: {r['best_val_roc_auc']:.4f} (vs {r['roc_auc']:.4f} on "
                          f"the real test set, see pipeline notes below for why these diverge).\n")
        lines.append("```\n" + r["classification_report"] + "\n```\n")

    total_seconds = sum(results[k]["train_seconds"] or 0 for k in ORDER if k in results)
    lines.append("## Pipeline notes\n")
    lines.append(
        "- **Hardware**: RTX 5050 Laptop GPU (8GB VRAM), 24 logical cores, 25GB RAM.\n"
        "- **Graph size**: 203,769 nodes, 234,355 edges, 341 engineered features/node "
        "(165 raw local+aggregated + 165 one-hop neighbor-mean + degree + 10 rolling-average "
        "time-step features) - fits full-batch on GPU (~0.3GB), so no neighbor sampling "
        "(`NeighborLoader`/`pyg-lib`) was needed for either GNN.\n"
        "- **Parallelization**: every tree/forest model uses `n_jobs=22` internally (this "
        "machine's standing 22-24 worker guidance). The 4 ensemble base learners "
        "(XGBoost, LightGBM, CatBoost, RandomForest) are trained sequentially rather than "
        "as 4 concurrent processes - splitting 24 cores 4 ways would slow every one of them "
        "down since each already saturates the machine on its own turn; 'fully parallelised' "
        "here means full internal parallelism per model, not concurrent processes. "
        "Optuna ran 30 trials with `n_jobs=4` concurrent trials, each doing its own "
        "4-fold time-series CV.\n"
        "- **Ensembling**: the formula-weighted blend optimizes non-negative weights "
        "(summing to 1) on a held-out temporal validation slice (last 20% of train time "
        "steps) via Nelder-Mead maximizing average precision, then refits all 4 base "
        "learners on the full training set. The linear stacking ensemble generates "
        "out-of-fold base predictions via 4-fold time-series CV, trains a "
        "balanced-class-weight logistic regression meta-learner on those OOF predictions, "
        "then refits base learners on the full training set for test-time inference.\n"
        "- **Checkpoint/resume**: both GNN scripts (`gnn_model.py`, `temporal_multignn.py`) "
        "save `{epoch, model_state, opt_state, best_val, best_state}` every epoch and "
        "reload it on restart; the k-hop sweep additionally checkpoints completed k-values "
        "in `checkpoints/khop_sweep.json` so a re-run only retrains missing k's. Early "
        "stopping patience = 15 epochs on training-set ROC-AUC. Tree/ensemble models are "
        "cheap enough (seconds) that they are not checkpointed mid-fit.\n"
        f"- **Total wall-clock time** (sum of each stage's measured train time, sequential "
        f"execution across stages - no two CPU-bound or GPU-bound jobs were run concurrently "
        f"on the same resource): **{total_seconds:.1f}s (~{total_seconds/60:.1f} min)**.\n"
        "- **Best model overall by ROC-AUC/ROC-PR**: the formula-weighted ensemble "
        "(ROC-AUC 0.9455, ROC-PR 0.809, F1 0.825) - the single best F1 and ROC-PR of every "
        "model tested, and it beats every individual base learner it blends. The linear "
        "stacking ensemble edges it out on ROC-AUC alone (0.9463) but its F1 (0.687) is far "
        "worse: the logistic meta-learner's default 0.5 probability threshold is poorly "
        "calibrated for this ~11% base rate even with `class_weight='balanced'`, trading "
        "precision for recall (`0.638` vs `0.945` precision) - a threshold-tuning pass would "
        "likely close most of that gap, but wasn't done here since none of the other models "
        "were threshold-tuned either. Both GNNs continue to underperform every tree-based "
        "model, consistent with the original Elliptic paper's finding that engineered "
        "tabular features (many of which are themselves one-hop graph aggregates) carry "
        "most of the predictive signal on this dataset.\n"
        "- **Unified GNN (SAGE+GAT+Temporal, Optuna-tuned) overfit its own tuning "
        "validation split**: Optuna found a config scoring 0.9538 ROC-AUC on the internal "
        "temporal validation slice (last 20% of *train* time steps), but that same config "
        "only reaches 0.852 ROC-AUC and a collapsed F1 of 0.191 (precision 0.106, recall "
        "0.931 - it flags almost everything as illicit) on the real held-out test period "
        "(time steps 35-49). Two compounding causes: (1) the internal validation slice is "
        "the *end of the training period*, which is closer in distribution to the rest of "
        "train than the actual test period is - a config that fits that slice well doesn't "
        "necessarily generalize across the larger train/test time gap; (2) `pos_weight` "
        "combined with BatchNorm on this small, heavily imbalanced graph appears to shift "
        "the model's probability calibration, so the default 0.5 decision threshold is far "
        "from optimal even though the underlying ranking (ROC-AUC) is still reasonable. "
        "This is a genuine, reproducible finding, not a bug: it argues for validating GNN "
        "hyperparameters on a slice temporally adjacent to the *test* period (or nested "
        "temporal CV spanning more of the timeline) rather than a held-out slice of train, "
        "and for a threshold-tuning pass before trusting F1 on any pos_weight-trained model.\n"
        "- **Unified GNN v2 (rolling CV, BatchNorm only, F1 objective)**: dropped `pos_weight`, "
        "replaced the single validation slice with 4-fold expanding-window temporal CV, and "
        "made Optuna maximize F1 (at a per-fold tuned threshold) instead of ROC-AUC. Mean CV F1 "
        "reached 0.784, but the test period (steps 35-49) still gave ROC-AUC 0.830 and F1 0.250 "
        "(precision 0.148, recall 0.816). The CV-to-test gap is still very large (test ROC-AUC is "
        "even below v1): no validation scheme built only from steps 1-34 captures the "
        "distribution shift that hits the test period, so CV-optimal GNN configs do not transfer. "
        "Tree ensembles remain far ahead on this dataset.\n"
        "- **Kaggle**: the stacking ensemble notebook was pushed to Kaggle "
        "(`elliptic-data-set-stacking-roc-auc-94-33`, ROC-AUC 0.9433, F1 0.7232 on Kaggle's 4 vCPUs) "
        "and to the GitHub `Kaggle` repo under `elliptic-data-set/`."
    )

    with open(OUT, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {OUT}")
    print("\n".join(lines[:20]))


if __name__ == "__main__":
    main()
