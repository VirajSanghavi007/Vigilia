import numpy as np

from sparse_autoencoder_time_diagnostic import auc_by_time_step, summarize


def test_auc_by_time_step_detects_simpsons_paradox_confound():
    """Construct a case mirroring the real hypothesis under test: illicit is
    concentrated in an early, low-baseline-error time step and licit is
    concentrated in a later, high-baseline-error (drifted) time step. Pooled
    across steps this makes illicit values mostly LOW and licit values mostly
    HIGH -> inverted pooled AUC -- even though WITHIN each step illicit
    genuinely has higher error than licit (a real signal). auc_by_time_step
    must recover that real per-step signal that pooling hides."""
    rng = np.random.default_rng(0)
    time_steps, labels, errors = [], [], []
    # step 1 (early, low drift): illicit-heavy; step 2 (late, high drift): licit-heavy
    for t, baseline, n_illicit, n_licit in [(1, 0.0, 100, 10), (2, 5.0, 10, 100)]:
        illicit_err = rng.normal(baseline + 0.2, 0.03, n_illicit)  # always higher within-step
        licit_err = rng.normal(baseline, 0.03, n_licit)
        time_steps += [t] * (n_illicit + n_licit)
        labels += [1] * n_illicit + [0] * n_licit
        errors += list(illicit_err) + list(licit_err)

    time_steps, labels, errors = np.array(time_steps), np.array(labels), np.array(errors)
    mask = np.ones(len(labels), dtype=bool)

    from sklearn.metrics import roc_auc_score
    pooled_auc = roc_auc_score(labels, errors)
    assert pooled_auc < 0.3  # confirms the confound scenario is actually set up: clearly inverted

    per_step = auc_by_time_step(errors, labels, time_steps, mask, min_per_class=5)
    assert len(per_step) == 2
    for t, v in per_step.items():
        assert v["auc"] > 0.95  # within each step, illicit is cleanly separable and higher


def test_auc_by_time_step_skips_steps_below_min_per_class():
    time_steps = np.array([1, 1, 1, 2, 2])
    labels = np.array([0, 0, 1, 0, 0])  # step 2 has zero illicit examples
    errors = np.array([0.1, 0.2, 0.9, 0.1, 0.2])
    per_step = auc_by_time_step(errors, labels, time_steps, np.ones(5, dtype=bool), min_per_class=1)
    assert 2 not in per_step  # step 2 has no positive class, must be skipped
    assert 1 in per_step


def test_auc_by_time_step_respects_mask():
    time_steps = np.array([1, 1, 1, 1])
    labels = np.array([0, 1, 0, 1])
    errors = np.array([0.1, 0.9, 0.1, 0.9])
    mask = np.array([True, True, False, False])  # only first two rows in scope
    per_step = auc_by_time_step(errors, labels, time_steps, mask, min_per_class=1)
    assert per_step[1]["n_pos"] == 1
    assert per_step[1]["n_neg"] == 1


def test_summarize_computes_mean_median_and_fraction_above_half():
    per_step = {1: {"auc": 0.9, "n_pos": 5, "n_neg": 5},
                2: {"auc": 0.4, "n_pos": 5, "n_neg": 5},
                3: {"auc": 0.6, "n_pos": 5, "n_neg": 5}}
    summary = summarize(per_step)
    assert summary["n_steps"] == 3
    assert summary["mean_auc"] == (0.9 + 0.4 + 0.6) / 3
    assert summary["median_auc"] == 0.6
    assert summary["frac_above_half"] == 2 / 3


def test_summarize_empty_per_step_returns_none_stats():
    summary = summarize({})
    assert summary["n_steps"] == 0
    assert summary["mean_auc"] is None
