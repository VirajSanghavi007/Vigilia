# Illicit-trained autoencoder: how the model works

Plain-language walkthrough of [`scripts/illicit_autoencoder.py`](../../scripts/illicit_autoencoder.py). The experiment log and full result tables are in [CO_LABELING.md, section 8](CO_LABELING.md#8-illicit-trained-autoencoder-a-licit-side-vote-2026-10-26). Written 2026-10-26.

## 1. What problem it solves

Elliptic has about 157,000 unlabeled transactions. XGBoost and the GNN label them, but they disagree on many, and the current rule in `co_label.py` sends every disagreement to illicit. We wanted a third, independent opinion that works differently from both. It answers one narrow question: **does this transaction look like anything we know to be illicit?** If clearly not, that is a vote for licit.

## 2. The core idea: learn what illicit looks like

An autoencoder is a network trained to squeeze its input into a small code and rebuild it. It gets good at rebuilding the kind of data it was trained on and bad at rebuilding anything else. The rebuild error, called **reconstruction error**, measures how unfamiliar an input is.

Section 7 of CO_LABELING.md tried this the obvious way: train on licit and flag high error as suspicious. It came out backwards (AUC 0.30). Illicit transactions in this data form a **tight, uniform cluster**, while licit ones are diverse. So we flipped it:

- **Train only on illicit nodes.**
- **Low error** means it looks like known illicit.
- **High error** means it doesn't, which is the licit vote.

## 3. Architecture

```
165 features -> 64 (ReLU) -> 16 (ReLU, the "code") -> 64 (ReLU) -> 165
```

- **Input:** the 165 raw Elliptic features, the same ones the GNN sees.
- **Bottleneck of 16:** this forces the network to keep only the main structure of illicit behaviour.
- **"Sparse":** the loss adds a small penalty (weight 0.001) on how active the 16 code units are. So each input is described by a few units rather than all 16, which makes the model generalize less loosely.
- **Loss:** reconstruction MSE plus 0.001 times that sparsity penalty. Optimizer is Adam with a learning rate of 0.001.

It's deliberately small (about 22k parameters), because it only has to model about 3,000 illicit examples.

## 4. Input scaling

The features are heavy-tailed. With ordinary mean/std scaling, a few extreme values dominated the loss (section 7's first bug). So each feature is:

1. Centred on its **median** and divided by its **interquartile range**. Both are fitted on training-period nodes (steps 1-34) and are hardly moved by outliers.
2. **Clipped to ±10**, so a wildly extreme unlabeled node can't produce a meaningless error from the network extrapolating.

## 5. Data splits (time-based, no leakage)

| Split | Which nodes | Count | Used for |
|---|---|---|---|
| Fit | illicit only, steps 1-30 | 2,954 | training (90%) and picking the best epoch (10%) |
| Calibration | all labeled, steps 31-34 | 2,989 | choosing the clearance threshold |
| Test | all labeled, steps 35-49 | 16,670 | every reported number |
| Unlabeled | label unknown, all steps | 157,205 | what we actually want to label |

The model never sees a licit label during training. Licit labels appear only when choosing the threshold, and that window comes after the training window.

## 6. Training

- **Full-batch:** all ~2,660 training rows go in one step per epoch, for 2,000 epochs. That takes about 38 seconds on the GPU.
- **Best epoch kept:** after each epoch it checks error on the 10% held-out illicit nodes and keeps the weights from the best epoch. In the 2026-10-26 run that was epoch 1998, so it was still improving slightly.
- **VRAM guard:** because the GPU is shared with other work, it first asks nvidia-smi how much memory is free. This avoids grabbing GPU memory just to check. It then estimates its own need, keeps 2 GiB free for other jobs, and caps PyTorch at about 4% of the card. If memory is short, or CUDA runs out mid-run, it falls back to the CPU.

## 7. Scoring and the clearance rule

- **Every node** (labeled and unlabeled) gets a score, its reconstruction error, where higher means more licit.
- **The threshold:** on the calibration window, the script finds the lowest threshold where at least 99% of the nodes above it are licit (99.5% is also computed).
- **Clearing:** any node scoring above the threshold is cleared as licit. Everything else gets no vote from this model. It never calls anything illicit.

## 8. How it's evaluated

- **Ranking:** ROC-AUC and PR-AUC on test, plus AUC per time step, to check it's not an artefact of drift.
- **Leak:** the share of real illicit that gets wrongly cleared. In AML, that is the number that matters.
- **Leak before and after step 43:** a dark market shut down around step 43, and illicit behaviour changed afterwards.
- **Matched-coverage comparison:** every score is compared at the same share of licit cleared (25/50/70%), because leak always rises with coverage.
- **Baselines:** it's compared against simple distance-to-illicit measures (centroid and Mahalanobis), a "how unusual is this at all" measure (L2 norm), the old licit-trained autoencoder, and XGBoost and the GNN.

## 9. What it showed

- **It ranks best among the unsupervised scores:** ROC-AUC 0.873, above the GNN's 0.832. That holds in 13 of 14 test steps.
- **At matched coverage it leaks the least illicit overall:**

| Licit cleared | Leak overall | Leak after step 43 |
|---|---|---|
| 25% | 0.2% | 0% |
| 50% | 3.3% | 7.1% |
| 70% | 13.9% | 46% |

- **On the unlabeled nodes**, at the 99% threshold it clears about 37,000. 85% of those are nodes both XGBoost and the GNN already call licit, and about 5,200 are nodes where the two disagree. Those 5,200 are where it could help.

## 10. The limitation to keep in mind

The model only knows the illicit patterns from steps 1-30. Laundering that is new, like what appeared after the step-43 shutdown, doesn't look like what it learned, so it looks licit. At moderate coverage (about 50%) that stays contained. Pushed to 70%, it waves through nearly half of the new-pattern illicit.

There's a catch with the current threshold. The 99% threshold from steps 31-34 lands at **72% coverage** on test, past the safe zone. Any real use should aim at a lower coverage target.

**The right role:** a licit-side vote at moderate coverage, used together with at least one supervised model, never alone. The open question is how to pick that ~50% operating point without test labels. That's also where a rule-based engine could help later, since rules can catch new patterns this model is blind to.

## Files

| Path | What |
|---|---|
| `scripts/illicit_autoencoder.py` | Model training, baselines, evaluation, VRAM guard |
| `scripts/test_illicit_autoencoder.py` | Unit, smoke and integration tests |
| `scripts/results/illicit_autoencoder.json` | Full metrics from the last run |
| `scripts/results/illicit_autoencoder_scores.csv` | Per-node error (txId, time step, label, score) |
| `scripts/checkpoints/illicit_autoencoder.pt` | Trained weights + scaler |

Re-run on the GPU with `python illicit_autoencoder.py` from `scripts/`, using a CUDA-enabled torch environment (`--cpu` forces CPU).
