import numpy as np
import torch

from gnn_main import (
    UnifiedGNN,
    best_threshold_f1,
    drop_edges,
    mask_for_steps,
    rolling_folds,
)


def test_unified_gnn_forward_shape():
    torch.manual_seed(0)
    n, in_dim = 20, 8
    x = torch.randn(n, in_dim)
    edge_index = torch.randint(0, n, (2, 40))
    time_step = torch.randint(1, 5, (n,))
    model = UnifiedGNN(in_dim, n_time_steps=5, hidden=16, num_layers=3, heads=2, dropout=0.2)
    out = model(x, edge_index, time_step)
    assert out.shape == (n,)
    assert torch.isfinite(out).all()


def test_unified_gnn_residual_toggle_changes_output():
    torch.manual_seed(0)
    n, in_dim = 15, 6
    x = torch.randn(n, in_dim)
    edge_index = torch.randint(0, n, (2, 30))
    time_step = torch.randint(1, 3, (n,))

    model = UnifiedGNN(in_dim, n_time_steps=3, hidden=8, num_layers=2, heads=2,
                        use_residual=True).eval()
    with torch.no_grad():
        out_res = model(x, edge_index, time_step)
        model.use_residual = False
        out_no_res = model(x, edge_index, time_step)
    assert not torch.allclose(out_res, out_no_res)


def test_drop_edges_keep_frac_one_returns_same_tensor():
    edge_index = torch.randint(0, 10, (2, 50))
    gen = torch.Generator().manual_seed(0)
    out = drop_edges(edge_index, 1.0, gen)
    assert torch.equal(out, edge_index)


def test_drop_edges_subsamples_expected_fraction():
    edge_index = torch.randint(0, 10, (2, 100))
    gen = torch.Generator().manual_seed(0)
    out = drop_edges(edge_index, 0.3, gen)
    assert out.shape[1] == 30
    orig_cols = set(map(tuple, edge_index.t().tolist()))
    kept_cols = set(map(tuple, out.t().tolist()))
    assert kept_cols <= orig_cols


def test_rolling_folds_are_expanding_and_forward_moving():
    ts_train = np.arange(1, 35)
    folds = rolling_folds(ts_train, n_splits=3)
    assert len(folds) == 3
    prev_val_max = -1
    for fit_steps, val_steps in folds:
        assert fit_steps.max() < val_steps.min()
        assert val_steps.min() > prev_val_max
        prev_val_max = val_steps.max()


def test_best_threshold_f1_finds_better_than_default_half():
    y_true = np.array([0] * 90 + [1] * 10)
    probs = np.array([0.1] * 90 + [0.4] * 10)
    f1_at_best, best_t = best_threshold_f1(y_true, probs)
    assert best_t <= 0.4
    assert f1_at_best > 0.9


def test_mask_for_steps_combines_time_filter_and_base_mask():
    all_time_steps = np.array([1, 1, 2, 2, 3, 3])
    base_mask = np.array([True, False, True, True, False, True])
    m = mask_for_steps(all_time_steps, base_mask, np.array([1, 3]))
    assert m.tolist() == [True, False, False, False, False, True]
