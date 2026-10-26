import os

import illicit_autoencoder as ia
import numpy as np
import pandas as pd
import pytest
import torch
from data import FEAT_COLS, RAW

# ---------------------------------------------------------------- unit tests


class _FakeCuda:
    def __init__(self, available=True, free_mb=6000, total_mb=8000):
        self.available, self.free_mb, self.total_mb = available, free_mb, total_mb
        self.fraction = None
        self.mem_get_info_calls = 0

    def is_available(self):
        return self.available

    def mem_get_info(self):
        self.mem_get_info_calls += 1
        return self.free_mb * 2**20, self.total_mb * 2**20

    def set_per_process_memory_fraction(self, fraction):
        self.fraction = fraction

    def query(self):
        return self.free_mb, self.total_mb


# allocator budget = 2*100 + 256 = 456; + 500 CUDA context = 956; + 2048 reserve = 3004


def test_select_device_uses_cpu_when_cuda_unavailable():
    fake = _FakeCuda(available=False)
    device, info = ia.select_device(100, cuda=fake, query=fake.query)
    assert device.type == "cpu"
    assert info["reason"] == "cuda unavailable"


def test_select_device_falls_back_to_cpu_when_free_vram_below_budget_plus_reserve():
    fake = _FakeCuda(free_mb=3000)
    device, info = ia.select_device(100, reserve_mb=2048, cuda=fake, query=fake.query)
    assert device.type == "cpu"
    assert fake.fraction is None  # never touched the allocator
    assert "only 3000 MiB free, need 3004" in info["reason"]


def test_select_device_uses_cuda_and_caps_allocator_at_tensor_budget():
    fake = _FakeCuda(free_mb=6000, total_mb=8000)
    device, info = ia.select_device(100, reserve_mb=2048, cuda=fake, query=fake.query)
    assert device.type == "cuda"
    assert fake.fraction == pytest.approx(456 / 8000)
    assert info["memory_fraction_cap"] == pytest.approx(456 / 8000)


def test_select_device_does_not_create_cuda_context_when_nvidia_smi_answers():
    fake = _FakeCuda(free_mb=500)
    ia.select_device(100, cuda=fake, query=fake.query)
    assert fake.mem_get_info_calls == 0


def test_select_device_falls_back_to_mem_get_info_without_nvidia_smi():
    fake = _FakeCuda(free_mb=6000)
    device, _ = ia.select_device(100, cuda=fake, query=lambda: None)
    assert fake.mem_get_info_calls == 1
    assert device.type == "cuda"


def test_select_device_force_cpu_skips_gpu_query():
    fake = _FakeCuda()
    device, info = ia.select_device(100, force_cpu=True, cuda=fake, query=fake.query)
    assert device.type == "cpu" and info["reason"] == "forced"
    assert fake.fraction is None and fake.mem_get_info_calls == 0


def test_query_free_vram_mb_parses_nvidia_smi(monkeypatch):
    class _Done:
        stdout = "1115, 8151\n"

    monkeypatch.setattr(ia.subprocess, "run", lambda *a, **k: _Done())
    assert ia.query_free_vram_mb() == (1115.0, 8151.0)


def test_query_free_vram_mb_returns_none_when_nvidia_smi_missing(monkeypatch):
    def _missing(*a, **k):
        raise FileNotFoundError("nvidia-smi")

    monkeypatch.setattr(ia.subprocess, "run", _missing)
    assert ia.query_free_vram_mb() is None


def test_estimate_vram_grows_with_training_set_and_batch():
    base = ia.estimate_vram_mb(1000, 165, 1024)
    assert ia.estimate_vram_mb(4000, 165, 1024) > base
    assert ia.estimate_vram_mb(1000, 165, 8192) > base
    assert base > 0


def test_build_masks_fit_is_illicit_only_and_disjoint_from_calib():
    time_steps = np.array([1, 10, 30, 30, 31, 34, 35, 20])
    y = np.array([1, 0, 1, -1, 1, 0, 1, 1])
    train_mask = (time_steps <= 34) & (y != -1)
    fit, calib = ia.build_masks(time_steps, y, train_mask, fit_max_step=30)
    assert fit.tolist() == [True, False, True, False, False, False, False, True]
    assert calib.tolist() == [False, False, False, False, True, True, False, False]
    assert not (fit & calib).any()


def test_split_fit_val_partitions_all_indices():
    fit_idx, val_idx = ia.split_fit_val(50, val_frac=0.2, seed=1)
    assert len(val_idx) == 10
    assert sorted(np.concatenate([fit_idx, val_idx]).tolist()) == list(range(50))


def test_train_restores_best_validation_epoch():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(64, 8)).astype(np.float32)
    model, info = ia.train(X[:48], X[48:], torch.device("cpu"), epochs=30, hidden=8,
                           bottleneck=3, seed=0)
    xv = torch.tensor(X[48:])
    with torch.no_grad():
        restored_val = torch.nn.functional.mse_loss(model(xv)[0], xv).item()
    assert restored_val == pytest.approx(info["best_val_mse"], rel=1e-5)
    assert 1 <= info["best_epoch"] <= 30


def test_reconstruction_errors_batching_matches_single_pass_and_handles_numpy():
    class _HalfModel(torch.nn.Module):
        def forward(self, x):
            return x * 0.5, x

    X = np.random.default_rng(0).normal(size=(23, 5)).astype(np.float32)
    small = ia.reconstruction_errors(_HalfModel(), X, torch.device("cpu"), batch_size=4)
    full = ia.reconstruction_errors(_HalfModel(), X, torch.device("cpu"), batch_size=1000)
    assert np.allclose(small, full)
    assert np.allclose(full, ((X * 0.5) ** 2).mean(axis=1))


def test_distance_baselines_rank_far_points_higher():
    rng = np.random.default_rng(0)
    ref = rng.normal(0, 1, size=(300, 4))
    X = np.array([[0.0, 0, 0, 0], [6.0, 6, 6, 6]])
    assert ia.centroid_distance(X, ref)[1] > ia.centroid_distance(X, ref)[0]
    assert ia.mahalanobis_distance(X, ref)[1] > ia.mahalanobis_distance(X, ref)[0]


def test_licit_threshold_at_precision_picks_lowest_threshold_meeting_target():
    # sorted desc: 0.9 L, 0.8 L, 0.7 L, 0.6 I, 0.5 L, 0.4 I
    scores = np.array([0.9, 0.8, 0.7, 0.6, 0.5, 0.4])
    is_licit = np.array([1, 1, 1, 0, 1, 0], dtype=bool)
    assert ia.licit_threshold_at_precision(scores, is_licit, 1.0) == 0.7
    # precision at 0.5 is 4/5 = 0.8
    assert ia.licit_threshold_at_precision(scores, is_licit, 0.8) == 0.5


def test_licit_threshold_never_splits_a_tie_group():
    # the two 0.8s tie: one licit, one illicit -> threshold 0.8 is 2/3 pure, not 1.0
    scores = np.array([0.9, 0.8, 0.8, 0.1])
    is_licit = np.array([1, 1, 0, 1], dtype=bool)
    assert ia.licit_threshold_at_precision(scores, is_licit, 1.0) == 0.9


def test_licit_threshold_returns_none_when_unreachable():
    scores = np.array([0.9, 0.1])
    is_licit = np.array([0, 1], dtype=bool)  # most-licit-looking node is illicit
    assert ia.licit_threshold_at_precision(scores, is_licit, 0.99) is None


def test_clearance_metrics_counts_leakage():
    scores = np.array([0.9, 0.8, 0.7, 0.2, 0.1])
    is_licit = np.array([1, 0, 1, 1, 0], dtype=bool)
    m = ia.clearance_metrics(scores, is_licit, 0.7)
    assert m["n_cleared"] == 3
    assert m["licit_precision"] == pytest.approx(2 / 3)
    assert m["licit_coverage"] == pytest.approx(2 / 3)
    assert m["illicit_leakage"] == pytest.approx(1 / 2)
    assert m["n_illicit_leaked"] == 1


def test_clearance_metrics_empty_cleared_set():
    m = ia.clearance_metrics(np.array([0.1, 0.2]), np.array([1, 0], dtype=bool), 0.9)
    assert m["n_cleared"] == 0 and m["licit_precision"] is None
    assert m["illicit_leakage"] == 0.0


def test_evaluate_score_orientation_and_shutdown_split():
    """Score = higher for licit. Pre-shutdown illicit sit low (caught);
    post-shutdown illicit are 'novel' and score licit-high -> must show up
    as leakage only in the post-shutdown bucket."""
    rng = np.random.default_rng(0)
    rows = []
    for t in range(31, 50):
        for _ in range(20):
            rows.append((t, 0, rng.uniform(0.6, 1.0)))
        for _ in range(6):
            novel = t >= 43
            rows.append((t, 1, rng.uniform(0.7, 1.0) if novel else rng.uniform(0.0, 0.3)))
    ts, y, s = (np.array(c) for c in zip(*rows, strict=True))
    calib, test = ts <= 34, ts >= 35
    r = ia.evaluate_score(s, y, ts, calib, test, targets=(0.99,))
    c = r["clearance"]["0.99"]
    assert c["test_pre_shutdown"]["illicit_leakage"] == 0.0
    assert c["test_post_shutdown"]["illicit_leakage"] > 0.5
    assert r["per_step_summary"]["n_steps"] == 15
    assert 0.0 < r["test_roc_auc_licit"] < 1.0
    # fixed coverage is matched on test licit regardless of the calib window
    for cov in ia.FIXED_COVERAGES:
        m = r["fixed_coverage"][str(cov)]
        assert m["test"]["licit_coverage"] == pytest.approx(cov, abs=1 / 300)
        assert m["test_pre_shutdown"]["illicit_leakage"] == 0.0


def test_threshold_at_licit_coverage_ignores_illicit_and_matches_coverage():
    # licit scores 10..1, illicit interleaved above them must not count
    scores = np.array([10, 9.5, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5], dtype=float)
    is_licit = np.array([1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0], dtype=bool)
    assert ia.threshold_at_licit_coverage(scores, is_licit, 0.3) == 8.0
    assert ia.threshold_at_licit_coverage(scores, is_licit, 0.7) == 4.0
    assert ia.threshold_at_licit_coverage(scores, is_licit, 1.0) == 1.0
    m = ia.clearance_metrics(scores, is_licit, ia.threshold_at_licit_coverage(scores, is_licit, 0.5))
    assert m["licit_coverage"] == pytest.approx(0.5)
    assert m["illicit_leakage"] == pytest.approx(0.5)


def test_threshold_at_licit_coverage_rounds_up_and_handles_edges():
    scores = np.array([3.0, 2.0, 1.0])
    is_licit = np.ones(3, dtype=bool)
    assert ia.threshold_at_licit_coverage(scores, is_licit, 0.5) == 2.0  # never under-covers
    assert ia.threshold_at_licit_coverage(scores, is_licit, 0.0) is None
    assert ia.threshold_at_licit_coverage(scores, np.zeros(3, dtype=bool), 0.5) is None
    # 0.07 * 100 == 7.000000000000001 in floats: must still pick the 7th, not 8th
    hundred = np.arange(100, 0, -1, dtype=float)
    assert ia.threshold_at_licit_coverage(hundred, np.ones(100, dtype=bool), 0.07) == 94.0


def test_unlabeled_clearance_breakdown_splits_by_model_verdict():
    cleared = np.array([1, 1, 1, 1, 0, 0], dtype=bool)
    co_label = np.array([0, 0, 1, 1, 0, 1])
    flag = np.array(["", "", "*", "", "", ""])
    b = ia.unlabeled_clearance_breakdown(cleared, co_label, flag)
    assert b["n_cleared"] == 4
    assert b["cleared_and_both_models_licit"] == 2
    assert b["cleared_but_models_disagree"] == 1
    assert b["cleared_but_both_models_illicit"] == 1
    assert b["frac_of_cleared_in_three_way_agreement"] == pytest.approx(0.5)
    assert b["n_both_models_licit"] == 3


def test_load_co_labels_aligns_by_txid_and_reads_empty_flag(tmp_path):
    path = tmp_path / "co.csv"
    pd.DataFrame({"txId": [3, 1, 2], "time_step": [1, 1, 1], "co_label": [1, 0, 1],
                  "flag": ["*", "", ""], "xgb_confidence": [0.9, 0.1, 0.8],
                  "gnn_confidence": [0.2, 0.1, 0.7], "original_label": [-1, 0, 1]}
                 ).to_csv(path, index=False)
    co = ia.load_co_labels(str(path), np.array([1, 2, 3]))
    assert co["co_label"].tolist() == [0, 1, 1]
    assert co["flag"].tolist() == ["", "", "*"]


def test_load_co_labels_missing_file_returns_none_and_missing_rows_raise(tmp_path):
    assert ia.load_co_labels(str(tmp_path / "nope.csv"), np.array([1])) is None
    path = tmp_path / "co.csv"
    pd.DataFrame({"txId": [1], "co_label": [0], "flag": [""], "xgb_confidence": [0.1],
                  "gnn_confidence": [0.1]}).to_csv(path, index=False)
    with pytest.raises(ValueError, match="missing 1 nodes"):
        ia.load_co_labels(str(path), np.array([1, 2]))


def test_licit_ae_scores_are_raw_error_not_negated(tmp_path):
    # zero weights make the model output 0, so error = mean(scaled x ** 2):
    # the far row must score higher, and score must equal +error exactly
    model = ia.SparseAutoencoder(4)
    for p in model.parameters():
        torch.nn.init.zeros_(p)
    path = tmp_path / "licit_ae.pt"
    torch.save({"model_state": model.state_dict(), "center": np.zeros(4),
                "scale": np.ones(4)}, path)
    X = np.array([[0.0] * 4, [3.0] * 4])
    scores = ia.licit_ae_scores(str(path), X, torch.device("cpu"), batch_size=8)
    np.testing.assert_allclose(scores, [0.0, 9.0], atol=1e-6)
    assert ia.licit_ae_scores(str(tmp_path / "nope.pt"), X, torch.device("cpu"), 8) is None


# ---------------------------------------------------------------- smoke test


def _synthetic_dataset(n_per_step=40, seed=0):
    """Tiny Elliptic-shaped dataset: illicit drawn from a tight cluster,
    licit from a wide one, a third of nodes unlabeled."""
    rng = np.random.default_rng(seed)
    rows, labels, steps = [], [], []
    for t in range(1, 50):
        for i in range(n_per_step):
            label = 1 if i % 5 == 0 else (0 if i % 3 else -1)
            spread = 0.3 if label == 1 else 2.0
            rows.append(rng.normal(0, spread, len(FEAT_COLS)))
            labels.append(label)
            steps.append(t)
    X = np.array(rows, dtype=np.float32)
    y = np.array(labels)
    df = pd.DataFrame({"txId": np.arange(len(y)) + 1000, "time_step": steps})
    ts = df["time_step"].to_numpy()
    train_mask = (ts <= 34) & (y != -1)
    test_mask = (ts > 34) & (y != -1)
    return df, X, X, y, np.zeros((2, 0), dtype=np.int64), train_mask, test_mask


def test_smoke_run_end_to_end_on_synthetic_data():
    r = ia.run(epochs=15, dataset=_synthetic_dataset(), force_cpu=True, co_label_csv=None,
               licit_ae_ckpt=None, save=False)
    assert r["device"]["device"] == "cpu"
    assert set(r["scores"]) == {"illicit_ae", "illicit_centroid", "illicit_mahalanobis", "l2_norm"}
    for res in r["scores"].values():
        assert np.isfinite(res["test_roc_auc_licit"])
    # tight illicit vs wide licit is the easy case: the AE must find it
    assert r["scores"]["illicit_ae"]["test_roc_auc_licit"] > 0.8
    assert r["split_sizes"]["fit_illicit"] == 30 * 8


# ---------------------------------------------------------- integration test


@pytest.fixture(scope="module")
def elliptic_dataset():
    if not os.path.exists(os.path.join(RAW, "elliptic_txs_features.csv")):
        pytest.fail(f"Elliptic CSVs not found under {os.path.abspath(RAW)}: download the "
                    "Elliptic dataset (Kaggle: ellipticco/elliptic-data-set) into that folder.")
    return ia.get_dataset()


def test_integration_real_elliptic_short_run(elliptic_dataset):
    df, _, X_gnn, y, _, train_mask, test_mask = elliptic_dataset
    ts = df["time_step"].to_numpy()
    r = ia.run(epochs=5, dataset=elliptic_dataset, save=False,
               licit_ae_ckpt=None, co_label_csv=ia.CO_LABEL_CSV)
    expected_fit = int((train_mask & (y == 1) & (ts <= ia.FIT_MAX_STEP)).sum())
    assert r["split_sizes"]["fit_illicit"] == expected_fit
    assert r["split_sizes"]["test"] == int(test_mask.sum())
    assert r["split_sizes"]["unlabeled"] == int((y == -1).sum())
    assert r["device"]["device"] in ("cpu", "cuda")
    for res in r["scores"].values():
        assert 0.0 <= res["test_roc_auc_licit"] <= 1.0
    if os.path.exists(ia.CO_LABEL_CSV):
        assert {"xgb", "gnn"} <= set(r["scores"])
        breakdown = next(iter(r["illicit_ae_unlabeled"].values()))
        assert breakdown["n_unlabeled"] == int((y == -1).sum())
