"""Focal loss for binary classification from logits."""
import torch
import torch.nn.functional as F


def focal_loss_with_logits(logits, targets, alpha=0.5, gamma=2.0):
    """FL(p_t) = -alpha_t * (1 - p_t)^gamma * log(p_t).

    alpha weights the positive (illicit) class; (1 - alpha) weights the
    negative class. gamma down-weights easy (already well-classified)
    examples so training focuses on hard ones.
    """
    bce = F.binary_cross_entropy_with_logits(logits, targets, reduction="none")
    p_t = torch.exp(-bce)  # p if target==1, (1-p) if target==0
    alpha_t = alpha * targets + (1 - alpha) * (1 - targets)
    loss = alpha_t * (1 - p_t) ** gamma * bce
    return loss.mean()
