"""Amount sampling and rounding habits.

Rounding is a property of the payment purpose and channel, applied the same
way to licit and illicit transactions (people pay rent and send P2P money in
round numbers too; cash comes in whole dollars). A laundering transfer that
mimics a P2P payment is rounded like one, so "round amount" is not a label.

All amounts are integer cents.
"""

from __future__ import annotations

import numpy as np

# Rounding styles: (probabilities of rounding to 1000, 100, 50, 10, 1 dollar), remainder keeps cents.
# All assumptions, set from everyday experience of each payment type.
ROUNDING = {
    "cents": (0.0, 0.0, 0.0, 0.0, 0.0),  # card purchases, utility bills, invoices, salaries
    "invoice": (0.02, 0.08, 0.02, 0.03, 0.05),
    "p2p": (0.02, 0.20, 0.15, 0.25, 0.25),
    "rent": (0.0, 0.45, 0.30, 0.15, 0.10),
    "transfer": (0.10, 0.40, 0.15, 0.15, 0.15),  # own-account moves, intercompany, large wires
    "cash": (0.03, 0.30, 0.12, 0.20, 0.35),  # cash is whole dollars at least
}


def lognormal_cents(rng: np.random.Generator, median: float | np.ndarray, sigma: float, size: int) -> np.ndarray:
    dollars = np.asarray(median) * np.exp(sigma * rng.standard_normal(size))
    return np.maximum(np.round(dollars * 100), 1).astype(np.int64)


def apply_rounding(rng: np.random.Generator, cents: np.ndarray, style: str) -> np.ndarray:
    cents = np.asarray(cents, dtype=np.int64)
    probs = ROUNDING[style]
    units = np.array([100_000, 10_000, 5_000, 1_000, 100], dtype=np.int64)
    p = np.array(probs + (max(0.0, 1.0 - sum(probs)),))
    pick = rng.choice(len(p), size=len(cents), p=p / p.sum())
    out = cents.copy()
    for k, unit in enumerate(units):
        m = pick == k
        if m.any():
            out[m] = np.maximum(np.round(cents[m] / unit).astype(np.int64), 1) * unit
    if style == "cash":  # never cents
        m = pick == len(units)
        out[m] = np.maximum(np.round(cents[m] / 100).astype(np.int64), 1) * 100
    return out


def atm_cents(rng: np.random.Generator, median: float, size: int, cap: float = 800.0) -> np.ndarray:
    """ATM withdrawals: multiples of $20, capped at a typical daily ATM limit
    (assumption: $800; US banks commonly set $300-$1,000)."""
    dollars = np.clip(median * np.exp(0.6 * rng.standard_normal(size)), 20, cap)
    return (np.maximum(np.round(dollars / 20), 1) * 2000).astype(np.int64)


def split_amount(rng: np.random.Generator, total_cents: int, parts: int, concentration: float = 4.0) -> np.ndarray:
    """Split a total into `parts` positive pieces (Dirichlet shares)."""
    if parts <= 1:
        return np.array([max(int(total_cents), 1)], dtype=np.int64)
    shares = rng.dirichlet(np.full(parts, concentration))
    pieces = np.maximum(np.floor(shares * total_cents).astype(np.int64), 1)
    pieces[-1] = max(int(total_cents) - int(pieces[:-1].sum()), 1)
    return pieces
