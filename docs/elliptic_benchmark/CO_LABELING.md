# Co-Labeling Investigation: XGBoost + GNN on Unlabeled Elliptic Nodes

Goal: label the ~157k unlabeled Elliptic transactions by combining an XGBoost model and a GNN, labeling illicit only where both agree, flagging disagreements, and attaching per-model confidence. Catch as much illicit activity as possible without flooding the review board. This document is the full record of what was tried, what broke, what was found, and what is still open.

Temporal split throughout: train = time steps 1-34, test = time steps 35-49, matching `docs/elliptic_benchmark/BENCHMARK.md`.

## 1. Starting state: nothing was persisted

Neither model's weights existed anywhere in the repo or on disk. Only performance-metric JSONs (`docs/elliptic_benchmark/results/*.json`) existed; `scripts/checkpoints/` and `scripts/results/` did not exist locally. `xgb_model.py` never called `joblib.dump`; the GNN scripts never called `torch.save` for anything but the resume checkpoint. Fixed by adding explicit model persistence to both training scripts going forward.

## 2. Architectural decorrelation (before training anything)

**Problem:** XGBoost and the GNN were both trained on the same engineered feature matrix (`data.py`'s `neigh_mean`, `roll_feat`), so "model agreement" would partly just mean both models fit the same pre-computed feature, not independent corroboration.

**Changes made to [`scripts/data.py`](../../scripts/data.py):**
- `build_xgb_features()`: raw 165 cols (`local_*` + `agg_*`) + 1-hop neighbor mean + degree + 3-step rolling time-window mean (341 total). XGBoost's only access to graph/temporal structure, since it can't compute either itself.
- `build_gnn_features()`: raw 165 cols only. The GNN derives neighbor structure via its own SAGE/GAT message passing and temporal structure via its own learned time-step embedding, instead of being handed a pre-computed, non-learned version of the same signal.
- `get_dataset()` returns both `X_xgb` and `X_gnn` from one call.
- `RAW` path fixed from a stale hardcoded `C:/Storage/Downloads` to `data/elliptic_bitcoin_dataset/` (relative to the repo).

**Pruned** (superseded/redundant once the above was decided): `tree_models.py`, `ensemble_models.py`, `baseline_nb.py`, `gnn_model.py` (k-hop sweep), `temporal_multignn.py`, `gnn_unified.py` (renamed/rebuilt as `gnn_main.py`), and their test files and result JSONs. Kept `xgboost_non_tuned.json` and `unified_gnn_optuna_tuned_v2.json` as historical reference points.

**[`scripts/xgb_model.py`](../../scripts/xgb_model.py) (rewritten):**
- Switched from Optuna-tuned to **fixed, non-tuned hyperparameters** (`n_estimators=300, max_depth=6, learning_rate=0.1`). Justified by the saved benchmark: non-tuned already beat Optuna-tuned (F1 0.815 vs 0.802) in 1/60th the training time (8.4s vs 503s).
- 5-fold `TimeSeriesSplit` CV, reporting F1 per fold (a robustness check, not a hyperparameter search objective, since there's no search anymore).
- Isotonic calibration fit on a held-out tail slice of the training period.
- Saves `checkpoints/xgb_model.joblib` + `checkpoints/xgb_calibrator.joblib`.

**[`scripts/gnn_main.py`](../../scripts/gnn_main.py) (new, replaces `gnn_unified.py`):**
- Architecture and hyperparameters fixed to the best prior sweep result, `unified_gnn_optuna_tuned_v2` (hidden=256, dropout=0.14, lr=0.00445, weight_decay=6e-6, keep_frac=0.80, cache_edges=True, 3 alternating SAGE/GAT layers, 4 heads). No Optuna search.
- **Loss switched from BCE to focal loss** (new [`scripts/losses.py`](../../scripts/losses.py): `focal_loss_with_logits(alpha, gamma=2.0)`), swept over `alpha ∈ {0.3, 0.5, 0.7}` per an explicit request to trade recall against false-positive/review volume.
- Rolling (expanding-window) CV reduced from 4 folds to 3, reporting only.
- Isotonic calibration (new [`scripts/calibration.py`](../../scripts/calibration.py)) fit per alpha on the last CV fold's validation slice.
- Saves one checkpoint + calibrator per alpha: `checkpoints/gnn_main_alpha_{0.3,0.5,0.7}.pt` / `_calibrator.joblib`.

### Alpha sweep results (GPU, RTX 5050, ~40s/run)

| alpha | flagged illicit (test) | recall | precision | F1 |
|---|---|---|---|---|
| 0.3 | 3,211 | 70.1% (759/1083) | 23.6% | 0.354 |
| 0.5 | 4,891 | 79.6% (862/1083) | 17.6% | 0.289 |
| 0.7 | 5,596 | 81.1% (878/1083) | 15.7% | 0.263 |

Sharply diminishing returns: 0.3->0.5 buys +103 caught illicit for +1,680 extra reviews; 0.5->0.7 buys only +16 more for +705 extra reviews. XGBoost test F1 with the fixed non-tuned config: 0.815 (matches the historical `xgboost_non_tuned` benchmark exactly, confirming the refactor preserved behavior). 5-fold CV mean F1: 0.9313 (one fold dips to 0.83, plausibly Elliptic's known concept-drift stretch).

### `graph_transformer.py`: a third model, exploratory only

A `TransformerConv`-based GNN (K=5 layers, same time-embedding/BatchNorm/residual wrapper as `gnn_main.py`, plain BCE + pos_weight, no Optuna) was trained as a comparison point, not a co-labeling candidate. Test F1 0.327, recall 81.0%, precision 20.5% — not directly comparable to the focal-loss alpha sweep (different loss/threshold procedure).

## 3. Co-labeling flooded the review board

Running [`scripts/co_label.py`](../../scripts/co_label.py) (agree -> that label; disagree -> illicit + `*` flag, per explicit instruction that missing real illicit activity is worse than one extra review) against all three GNN alphas:

| gnn-alpha | real agreement (illicit) | disagreement (defaulted illicit) | **total flagged illicit** |
|---|---|---|---|
| 0.3 | 9,269 | 30,660 | 39,929 |
| 0.5 | 10,815 | 45,248 | 56,063 |
| 0.7 | 10,876 | 52,596 | 63,472 |

4-6x over the "don't flood the board" goal. The models disagree on 15-26% of the *entire* 203,769-node dataset — most of the flagged volume is disagreement-driven, not real corroborated signal.

(Two bugs surfaced and were fixed while diagnosing this: `torch.load` defaulting to `weights_only=True` rejected our own checkpoints' numpy scalar, fixed by passing `weights_only=False` on our own trusted files; and a `pandas.read_csv` round-trip read empty-string `flag` values back as `NaN`, making `value_counts()` silently drop the "agree" rows during analysis — not a bug in `co_label.py` itself, just a diagnostic-script footgun, fixed with `keep_default_na=False`.)

## 4. Why so much disagreement: regularization consistency

**Method** ([`scripts/consistency_check.py`](../../scripts/consistency_check.py)): run each trained model repeatedly with its own regularizer active and measure per-node prediction variance, comparing labeled vs. unlabeled nodes.
- GNN: MC-Dropout (30 stochastic forward passes, dropout active at inference).
- XGBoost: 7-model bootstrap ensemble (different random seeds/resamples, since trees have no runtime dropout equivalent).
- Statistical test: one-sided Mann-Whitney U (`scripts/group_stats.py`, shared across all diagnostics in this investigation), testing whether unlabeled variance is stochastically greater than labeled variance.

**Bug found and fixed:** `UnifiedGNN` applies dropout *functionally* (`F.dropout(x, p=self.dropout, training=self.training)`), not via an `nn.Dropout` submodule. The first version of `enable_mc_dropout()` searched for `nn.Dropout` instances and found none, so dropout never actually activated (near-zero variance, a false negative). Fixed by driving it through `model.train()` (activates the functional dropout via `self.training`) while explicitly forcing BatchNorm layers back to eval mode (so they don't also inject batch-dependent noise). A regression test (`test_consistency_check.py`) exercises the functional-dropout path specifically so this class of bug can't silently return.

**Result** (p≈0 for all three, n=29,894 labeled / 173,875 unlabeled):

| Model | labeled mean std | unlabeled mean std | ratio |
|---|---|---|---|
| GNN Main (SAGE/GAT) | 0.0244 | 0.0338 | 1.39x |
| Graph Transformer (K=5) | 0.0540 | 0.1092 | 2.02x |
| XGBoost (bootstrap) | 0.0050 | 0.0318 | **6.40x** |

XGBoost is dramatically less stable on unlabeled nodes than either message-passing model — a classic tree-model signature of extrapolating into a feature-space region it wasn't fit on. The GNN is comparatively more robust (1.39x), plausibly because message passing lets it borrow context from labeled neighbors even for an unlabeled target node.

## 5. Structural breakdown: is the unlabeled population actually different?

**Method** ([`scripts/structural_breakdown.py`](../../scripts/structural_breakdown.py)): graph-topology statistics, independent of any trained model, so the finding can't just be inherited model bias.

| Metric | Labeled | Unlabeled | p-value |
|---|---|---|---|
| Degree | 2.99 | 2.10 | 0.68 (n.s.) |
| **Neighbor unlabeled-fraction** | **37.6%** | **78.7%** | **≈0** |
| Component size | 4,837.7 | 4,731.7 | 1.2e-33 |
| Local clustering (20k-node sample) | 0.0071 | 0.0159 | 0.73 (n.s.) |

Unlabeled nodes are **topologically self-clustered**, not randomly scattered: an unlabeled node's neighbors are mostly unlabeled (79%), while a labeled node's neighbors are mostly labeled (62%). Degree and local clustering don't differ, so it's about *who* is connected to whom, not connection density. During the GNNExplainer run (section 6) some 2-hop subgraphs came back with only 1-3 nodes, confirming a meaningful share of unlabeled nodes are also near-isolated.

## 6. Explainability: SHAP (XGBoost) + GNNExplainer (GNN)

**SHAP** ([`scripts/shap_analysis.py`](../../scripts/shap_analysis.py), `TreeExplainer`, 5,000-node samples each group): overall attribution magnitude is nearly identical (19.25 labeled vs 18.92 unlabeled), but *which* features drive predictions shifts meaningfully, e.g. `local_1` gets 72% more weight on unlabeled nodes while `local_58`/`agg_31`/`local_60`/`local_52` get 40-72% less.

**GNNExplainer** ([`scripts/gnn_explain.py`](../../scripts/gnn_explain.py), 2-hop subgraphs per sampled node, 25 labeled + 25 unlabeled, 100 epochs each): same qualitative pattern with a completely different (non-overlapping) set of top features, since the GNN only ever sees the 165 raw features. Total mask magnitude is close (65.6 vs 64.0) — again a reliance *shift*, not a uniform increase/decrease in confidence.

Four independent methods (variance, topology, SHAP, GNNExplainer) all converge: the unlabeled population is a real, structurally distinct region of the graph, not the same distribution minus labels.

## 7. Sparse autoencoder: a dead end, documented honestly

**Idea** ([`scripts/sparse_autoencoder.py`](../../scripts/sparse_autoencoder.py)): train an autoencoder on labeled-licit nodes only, use reconstruction error as an unsupervised anomaly score, see where unlabeled nodes land relative to the licit/illicit error distributions.

**First run — scaler bug:** z-score standardization let heavy-tailed outlier features dominate both the fitted scaler and the MSE loss. Unlabeled reconstruction error blew up to 87.9 (100x+ either labeled group), and the sanity check (does the score separate illicit/licit on the labeled test set at all?) came back **inverted**: ROC-AUC 0.24 (worse than random; illicit reconstructed *better* than licit).

**Fix attempted:** switched to robust median/IQR scaling with clipping (`fit_scaler`/`apply_scaler`), ran 2000 epochs (up from 150). Magnitude blowup fixed (licit=1.18, illicit=0.69, unlabeled=0.84 — sane, comparable) but the **inversion persisted**: AUC 0.297.

**Diagnostic** ([`scripts/sparse_autoencoder_time_diagnostic.py`](../../scripts/sparse_autoencoder_time_diagnostic.py)): per-time-step AUC, to rule out temporal drift as a Simpson's-paradox-style confound (different baseline error per time step masking a real within-step signal). Result: **still inverted in 10 of 14 time steps** (mean AUC 0.378, median 0.340) — not a drift artifact. (Steps 44/48/49, the sparsest tail of the test period, did flip above 0.5 — a secondary, smaller effect worth noting but not large enough to change the overall conclusion.)

**Conclusion:** illicit transactions appear to be more feature-homogeneous than the more diverse legitimate population in this raw feature space, so one-class reconstruction error runs backwards here — using it to label the unlabeled population would systematically flag diverse-but-legitimate transactions as anomalous while under-flagging the tighter illicit cluster. **Abandoned as unusable for this purpose**, not forced into a positive result.

## 8. Illicit-trained autoencoder: a licit-side vote (2026-10-26)

**Idea** ([`scripts/illicit_autoencoder.py`](../../scripts/illicit_autoencoder.py)): section 7 found illicit nodes are the tighter cluster, so flip the one-class setup. Train the same sparse autoencoder (64/16, L1 on the bottleneck, robust median/IQR scaling with clip=10) on **illicit nodes only**; high reconstruction error then means "does not look like known illicit", i.e. a licit score. This is meant only as a third, licit-side vote next to XGBoost and the GNN, never as an illicit detector. A plain-language walkthrough of the whole model is in [ILLICIT_AUTOENCODER.md](ILLICIT_AUTOENCODER.md).

**Splits (no leakage into evaluation):** fit = illicit, steps 1-30 (2,954 nodes, 90/10 random split for best-epoch selection); calib = all labeled, steps 31-34 (2,989 nodes, used only to pick the clearance threshold at a target licit precision of 0.99 / 0.995); test = labeled steps 35-49 (16,670). Trained on the GPU behind a VRAM guard (free memory read via nvidia-smi, 2 GiB kept free for other jobs, allocator capped at ~4% of the card). 2000 epochs, best val MSE 0.118 at epoch 1998 (still improving slightly).

**Results on test (steps 35-49).** "Leak" = share of test illicit that falls above the threshold calibrated on steps 31-34 for 99% licit precision; "cover" = share of test licit cleared at that threshold.

| Score | ROC-AUC (licit) | PR-AUC (illicit) | Steps AUC>0.5 | Leak | Leak pre-43 | Leak post-43 | Cover |
|---|---|---|---|---|---|---|---|
| illicit_ae | **0.873** | **0.473** | 13/14 | 0.148 | 0.082 | 0.503 | 0.719 |
| illicit centroid distance | 0.845 | 0.295 | 13/14 | 0.012 | 0.011 | 0.018 | 0.322 |
| illicit Mahalanobis (Ledoit-Wolf) | 0.849 | 0.399 | 13/14 | 0.359 | 0.282 | 0.775 | 0.813 |
| L2 norm (class-agnostic) | 0.806 | 0.172 | 13/14 | 0.008 | 0.009 | 0.006 | 0.250 |
| licit-trained AE (section 7, +error, calib in-sample) | 0.703 | 0.140 | 10/14 | 0.000 | 0.000 | 0.000 | 0.006 |
| XGBoost (1 - p, calib in-sample) | 0.929 | 0.795 | 14/14 | 0.371 | 0.256 | 0.994 | 1.000 |
| GNN (1 - p, calib in-sample) | 0.832 | 0.226 | 14/14 | 0.083 | 0.059 | 0.213 | 0.526 |

(The licit-trained AE row uses its raw error as the licit score, since section 7 showed its error already runs higher on licit. A first version of the script negated it, giving a meaningless AUC of 0.297; fixed and re-run the same day.)

**Findings:**
1. The inversion from section 7 is real and usable: training on illicit gives the best unsupervised ranking (ROC-AUC 0.873, above every distance baseline and above the GNN), and it holds per step (13 of 14). Exploiting the inversion directly with the licit-trained AE is much weaker (0.703, and at 99% precision it clears only 0.6% of licit), so fitting the tight class is what matters.
2. **The predicted blind spot shows up clearly.** Before the step-43 dark-market shutdown it leaks 8% of illicit at the 99% threshold; after it, **50%**. New illicit behavior does not look like the steps 1-30 illicit the AE learned, so it gets cleared as licit. XGBoost is far worse here (99% post-43 leak), the GNN better (21%).
3. Leak and cover trade off, so the rows above are not directly comparable (the centroid's 1.8% post-43 leak comes with only 32% coverage). **Fixed-coverage comparison:** the threshold for each score is set on the test set itself so that exactly 25 / 50 / 70% of test licit is cleared (an evaluation-only operating point, not a deployable threshold), then illicit leak is read off. Cells are all / pre-43 / post-43:

   | Score | @25% | @50% | @70% |
   |---|---|---|---|
   | illicit_ae | **0.002** / 0.002 / 0.000 | **0.033** / 0.026 / 0.071 | **0.139** / 0.079 / 0.462 |
   | illicit centroid | 0.006 / 0.005 / 0.006 | 0.050 / 0.022 / 0.201 | 0.187 / 0.103 / 0.645 |
   | illicit Mahalanobis | 0.005 / 0.005 / 0.000 | 0.037 / 0.033 / 0.059 | 0.194 / 0.202 / **0.148** |
   | L2 norm | 0.008 / 0.009 / 0.006 | 0.076 / 0.042 / 0.260 | 0.242 / 0.164 / 0.663 |
   | licit-trained AE | 0.066 / 0.049 / 0.160 | 0.229 / 0.158 / 0.615 | 0.404 / 0.315 / 0.882 |
   | XGBoost* | 0.033 / 0.016 / 0.124 | 0.033 / 0.016 / 0.124 | 0.163 / 0.072 / 0.657 |
   | GNN* | 0.027 / 0.025 / 0.036 | 0.076 / 0.058 / 0.172 | 0.184 / 0.114 / 0.562 |

   \*Isotonic calibration makes XGBoost/GNN scores step functions, and a threshold cannot split a tie, so their real coverage is higher than the column: XGBoost 55% / 55% / 84% (55% of test licit share its top score), GNN 28% / 51% / 72%. Their leak is therefore overstated relative to the other rows, most of all XGBoost at 25%.

   Read at matched coverage, **illicit_ae leaks the least overall at every coverage**. The centroid's apparent safety was only its low coverage: at 70% it leaks more than the AE everywhere. Up to 50% coverage the AE is the strongest licit vote here, post-43 included (7.1%). At 70% its post-43 leak jumps to 46%, and only the Mahalanobis distance stays low post-43 (14.8%) at the cost of worse pre-43 leak. So the novel-pattern blind spot is a property of pushing coverage high, not of the AE at moderate coverage.
4. **Unlabeled nodes** (157,205): at 99% the AE clears 37,448 (23.8%). Of these, 31,947 (85.3%) are also called licit by both XGBoost and the GNN, 5,179 are cases where the two models disagree, and 322 are cases where both call illicit. At 99.5%: 30,145 cleared (19.2%), 86.7% three-way agreement, 3,782 disagreements, 215 both-illicit.

**Conclusion:** usable as a **licit-side vote at moderate coverage** (around 50% of licit, where it leaks 3.3% overall and 7.1% post-43), not as a high-coverage standalone clearer. The 99%-precision threshold calibrated on steps 31-34 lands at 72% test coverage, which is past the point where post-43 leak blows up, so a deployable threshold should be set for a coverage target, not a calibration-window precision target. A rule of the form "clear as licit only if the AE clears it *and* at least one supervised model agrees" would act on the 5,179 disagreements. Outputs: `scripts/results/illicit_autoencoder.json`, `scripts/results/illicit_autoencoder_scores.csv`, checkpoint `scripts/checkpoints/illicit_autoencoder.pt`.

## Current status / open items

**Confirmed:** the unlabeled population is genuinely structurally distinct (sections 4-6, four independent methods). **Ruled out:** one-class reconstruction-error anomaly detection as a usable signal (section 7).

**Not yet built:**
1. A revised `co_label.py` disagreement policy. Leading proposal: weight disagreement resolution by **per-node model variance/instability** (lean toward whichever model is more stable for that specific node) instead of a blanket "disagreement -> illicit" rule, informed by XGBoost being 6.4x less stable on unlabeled nodes vs. the GNN's 1.39x.
2. Bucketing near-isolated unlabeled nodes (2-hop subgraph size 1-3) as "insufficient graph context" rather than forcing a co-label on them.
3. Routing well-connected-but-uncertain unlabeled nodes into an active-learning queue for real human review, rather than pure pseudo-labeling of the full unlabeled set.
4. Deciding whether the illicit-trained AE (section 8) becomes a third vote in `co_label.py`. The fixed-coverage comparison favors it at about 50% coverage; the open question is how to pick that operating point without test labels (e.g. a coverage target on the calibration window, checked for drift).
5. A rule-based engine for crypto-specific illicit patterns (deferred by the user until after section 8).

## Scripts reference

| Script | Purpose |
|---|---|
| `data.py` | Load Elliptic, build XGB/GNN feature sets, temporal split |
| `losses.py` | Focal loss |
| `calibration.py` | Isotonic calibration wrapper |
| `group_stats.py` | Shared labeled-vs-unlabeled Mann-Whitney comparison |
| `xgb_model.py` | XGBoost: fixed hyperparameters, 5-fold CV report, calibration |
| `gnn_main.py` | GNN (Main): fixed architecture, focal loss alpha sweep, 3-fold CV report, calibration |
| `graph_transformer.py` | Graph Transformer (K=5): exploratory comparison model |
| `co_label.py` | Combines XGBoost + GNN predictions into co-labels |
| `consistency_check.py` | MC-Dropout / bootstrap-ensemble variance, labeled vs. unlabeled |
| `structural_breakdown.py` | Graph-topology comparison, labeled vs. unlabeled |
| `shap_analysis.py` | SHAP (XGBoost), labeled vs. unlabeled feature reliance |
| `gnn_explain.py` | GNNExplainer (GNN), labeled vs. unlabeled feature reliance |
| `sparse_autoencoder.py` | One-class anomaly detector (abandoned, see section 7) |
| `sparse_autoencoder_time_diagnostic.py` | Per-time-step AUC, drift-confound check |
| `illicit_autoencoder.py` | Illicit-trained one-class AE as a licit-side vote, with distance baselines and a VRAM guard (section 8) |
