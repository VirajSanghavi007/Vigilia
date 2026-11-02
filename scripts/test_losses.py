import torch

from losses import focal_loss_with_logits


def test_focal_loss_matches_bce_when_gamma_zero_and_alpha_half():
    """gamma=0 removes the focusing term, alpha=0.5 makes alpha_t constant
    0.5 for both classes -- so focal loss should equal 0.5 * BCE exactly."""
    logits = torch.tensor([2.0, -1.0, 0.5, -3.0])
    targets = torch.tensor([1.0, 0.0, 1.0, 0.0])
    fl = focal_loss_with_logits(logits, targets, alpha=0.5, gamma=0.0)
    bce = torch.nn.functional.binary_cross_entropy_with_logits(logits, targets)
    assert torch.isclose(fl, 0.5 * bce, atol=1e-6)


def test_focal_loss_downweights_easy_examples():
    """A well-classified example (large-margin correct logit) should
    contribute much less to focal loss than to plain BCE, since gamma>0
    should suppress the easy-example term."""
    easy_correct_logits = torch.tensor([5.0])  # confidently correct
    target = torch.tensor([1.0])
    fl = focal_loss_with_logits(easy_correct_logits, target, alpha=0.5, gamma=2.0)
    bce = torch.nn.functional.binary_cross_entropy_with_logits(easy_correct_logits, target)
    assert fl.item() < bce.item()


def test_focal_loss_higher_alpha_increases_positive_class_loss():
    """Raising alpha should raise the loss contribution of a positive
    (illicit) example relative to a negative one, all else equal."""
    logits = torch.tensor([0.0])  # p=0.5, ambiguous, isolates the alpha weighting
    pos_target = torch.tensor([1.0])
    neg_target = torch.tensor([0.0])

    loss_pos_low_alpha = focal_loss_with_logits(logits, pos_target, alpha=0.3, gamma=2.0)
    loss_pos_high_alpha = focal_loss_with_logits(logits, pos_target, alpha=0.7, gamma=2.0)
    assert loss_pos_high_alpha > loss_pos_low_alpha

    loss_neg_low_alpha = focal_loss_with_logits(logits, neg_target, alpha=0.3, gamma=2.0)
    loss_neg_high_alpha = focal_loss_with_logits(logits, neg_target, alpha=0.7, gamma=2.0)
    assert loss_neg_high_alpha < loss_neg_low_alpha


def test_focal_loss_is_finite_for_batch():
    torch.manual_seed(0)
    logits = torch.randn(50)
    targets = (torch.rand(50) > 0.9).float()
    fl = focal_loss_with_logits(logits, targets, alpha=0.5, gamma=2.0)
    assert torch.isfinite(fl)
    assert fl.item() >= 0
