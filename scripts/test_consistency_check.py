import torch

from consistency_check import enable_mc_dropout


class _ToyFunctionalDropoutModel(torch.nn.Module):
    """Mirrors UnifiedGNN: dropout applied via F.dropout(training=self.training)
    inside forward, not an nn.Dropout submodule -- enable_mc_dropout must
    drive this through model.train(), not by hunting for nn.Dropout instances."""

    def __init__(self):
        super().__init__()
        self.bn = torch.nn.BatchNorm1d(4)

    def forward(self, x):
        h = self.bn(x)
        return torch.nn.functional.dropout(h, p=0.5, training=self.training)


def test_enable_mc_dropout_activates_functional_dropout_but_freezes_batchnorm():
    model = _ToyFunctionalDropoutModel()
    enable_mc_dropout(model)
    assert model.training is True  # drives F.dropout's training=self.training
    assert model.bn.training is False  # BatchNorm explicitly frozen to eval


def test_mc_dropout_produces_stochastic_output_with_frozen_batchnorm_stats():
    torch.manual_seed(0)
    model = _ToyFunctionalDropoutModel()
    model.bn.running_mean.fill_(0.0)
    model.bn.running_var.fill_(1.0)
    x = torch.ones(1, 4) * 5.0  # single row: BatchNorm in train mode would error/misbehave
    enable_mc_dropout(model)
    with torch.no_grad():
        out1 = model(x)
        out2 = model(x)
    assert not torch.equal(out1, out2)  # dropout is genuinely stochastic across calls
