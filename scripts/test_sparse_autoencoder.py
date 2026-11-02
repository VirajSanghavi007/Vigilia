import numpy as np
import pytest
import torch

from sparse_autoencoder import (
    SparseAutoencoder,
    apply_scaler,
    fit_scaler,
    reconstruction_error,
    sparse_loss,
)


def test_sparse_autoencoder_forward_shapes():
    model = SparseAutoencoder(in_dim=10, hidden=8, bottleneck=3)
    x = torch.randn(5, 10)
    recon, code = model(x)
    assert recon.shape == (5, 10)
    assert code.shape == (5, 3)


def test_sparse_autoencoder_bottleneck_activations_are_nonnegative():
    """Bottleneck uses ReLU, so the L1 sparsity penalty (code.abs().mean())
    should equal code.mean() directly -- verifies the activations really are
    non-negative, which the sparsity penalty's correctness depends on."""
    model = SparseAutoencoder(in_dim=10, hidden=8, bottleneck=3)
    x = torch.randn(20, 10)
    _, code = model(x)
    assert (code >= 0).all()


def test_sparse_loss_penalizes_larger_bottleneck_activations_more():
    x = torch.randn(4, 6)
    recon = x.clone()  # perfect reconstruction, isolates the sparsity term
    code_small = torch.ones(4, 3) * 0.1
    code_large = torch.ones(4, 3) * 5.0
    _, _, penalty_small = sparse_loss(x, recon, code_small)
    _, _, penalty_large = sparse_loss(x, recon, code_large)
    assert penalty_large > penalty_small


def test_sparse_loss_zero_for_perfect_reconstruction_and_zero_code():
    x = torch.randn(4, 6)
    recon = x.clone()
    code = torch.zeros(4, 3)
    loss, recon_loss, penalty = sparse_loss(x, recon, code)
    assert recon_loss.item() == 0.0
    assert penalty.item() == 0.0
    assert loss.item() == 0.0


def test_reconstruction_error_is_zero_for_identity_like_model():
    class _IdentityModel(torch.nn.Module):
        def forward(self, x):
            return x, x  # perfect reconstruction

    model = _IdentityModel()
    x = torch.randn(10, 5)
    errors = reconstruction_error(model, x, batch_size=4)
    assert np.allclose(errors, 0.0, atol=1e-6)


def test_reconstruction_error_batching_matches_single_pass():
    class _NoisyModel(torch.nn.Module):
        def forward(self, x):
            return x * 0.5, x  # imperfect reconstruction, deterministic

    model = _NoisyModel()
    x = torch.randn(20, 5)
    errors_batched = reconstruction_error(model, x, batch_size=7)
    errors_full = reconstruction_error(model, x, batch_size=1000)
    assert np.allclose(errors_batched, errors_full, atol=1e-6)


def test_fit_scaler_centers_on_median_not_mean():
    """The whole point of switching to robust scaling: a few extreme
    outliers must not drag the center away from the bulk of the data the
    way a mean-based scaler would."""
    X = np.concatenate([np.full((99, 1), 1.0), np.full((1, 1), 100000.0)], axis=0)
    center, scale = fit_scaler(X)
    assert center[0, 0] == pytest.approx(1.0)  # median ignores the one huge outlier
    # a mean-based scaler would have centered near 1000, wildly off the bulk


def test_fit_scaler_handles_zero_iqr_column_without_dividing_by_zero():
    X = np.column_stack([np.ones(50), np.random.default_rng(0).normal(0, 1, 50)])
    center, scale = fit_scaler(X)
    scaled = apply_scaler(X, center, scale, clip=None)
    assert np.isfinite(scaled).all()
    assert np.allclose(scaled[:, 0], 0.0)  # constant column stays at 0 after centering


def test_apply_scaler_clips_extreme_outliers_to_bounded_range():
    """This is the actual fix for the bug found in the first run: without
    clipping, an out-of-distribution node's extreme raw feature value
    produces an unbounded scaled input, which an unbounded linear decoder
    then extrapolates wildly on -- clip must cap that at the configured
    bound."""
    X = np.array([[0.0], [1.0], [-1.0], [1_000_000.0]])
    center, scale = fit_scaler(X[:3])  # fit only on the well-behaved rows
    scaled = apply_scaler(X, center, scale, clip=10.0)
    assert scaled.max() <= 10.0
    assert scaled.min() >= -10.0


def test_apply_scaler_no_clip_leaves_outliers_unbounded():
    X = np.array([[0.0], [1.0], [-1.0], [1_000_000.0]])
    center, scale = fit_scaler(X[:3])
    scaled = apply_scaler(X, center, scale, clip=None)
    assert scaled.max() > 10.0  # confirms clip=10.0 above is actually doing something
