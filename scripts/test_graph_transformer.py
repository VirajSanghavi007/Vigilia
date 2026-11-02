import torch

from graph_transformer import GraphTransformer


def test_graph_transformer_forward_shape():
    torch.manual_seed(0)
    n, in_dim = 20, 8
    x = torch.randn(n, in_dim)
    edge_index = torch.randint(0, n, (2, 40))
    time_step = torch.randint(1, 5, (n,))
    model = GraphTransformer(in_dim, n_time_steps=5, hidden=16, num_layers=5, heads=2, dropout=0.2)
    out = model(x, edge_index, time_step)
    assert out.shape == (n,)
    assert torch.isfinite(out).all()


def test_graph_transformer_has_k5_conv_layers_by_default():
    model = GraphTransformer(8, n_time_steps=5, hidden=16)
    assert len(model.convs) == 5


def test_graph_transformer_residual_changes_with_untrained_vs_trained_weights():
    """Sanity check that the residual/projection path actually participates
    in the output (not a dead branch) -- perturbing res_proj weights should
    change the forward output."""
    torch.manual_seed(0)
    n, in_dim = 10, 6
    x = torch.randn(n, in_dim)
    edge_index = torch.randint(0, n, (2, 20))
    time_step = torch.randint(1, 3, (n,))
    model = GraphTransformer(in_dim, n_time_steps=3, hidden=8, num_layers=2, heads=2).eval()
    with torch.no_grad():
        out_before = model(x, edge_index, time_step)
        for proj in model.res_proj:
            if isinstance(proj, torch.nn.Linear):
                proj.weight.add_(1.0)
        out_after = model(x, edge_index, time_step)
    assert not torch.allclose(out_before, out_after)
