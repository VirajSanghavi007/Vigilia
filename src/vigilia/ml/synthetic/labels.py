"""The investigated-label view: what a bank's AML team would actually know.

Ground truth (every illicit transaction, its typology and pattern) is for
evaluation only. Training uses this view, built the way real labels arise:

1. Simple monitoring rules raise alerts on customers.
2. Alerted customers are investigated with some probability; more customers
   are reviewed at random (periodic KYC review, law-enforcement requests)
   until about `labelled_share` of transactions carry a label.
3. An investigation uncovers each laundering pattern it touches with
   probability `discovery_prob`; missed illicit transactions get labelled licit.
4. Label noise: a `label_noise` fraction of the illicit labels is flipped to
   licit, and the same number of licit labels is flipped to illicit
   (mistaken SARs), so the noise does not change the illicit count.

Labelled transactions are those touching an investigated customer, plus
every transaction of a discovered pattern.
"""

from __future__ import annotations

import numpy as np

from . import ids
from .timeline import CH
from .world import SLOTS_PER_CUSTOMER, STREAM_LABELS, World

# Rule thresholds. Assumptions modelled on common transaction-monitoring
# scenarios (FFIEC BSA/AML Examination Manual, "Suspicious Activity Reporting").
NEAR_CTR_LOW, NEAR_CTR_HIGH = 8_000 * 100, 10_000 * 100
NEAR_CTR_MIN_COUNT = 2  # per customer per 30-day bucket
FAN_IN_MIN_SENDERS = 10  # distinct senders per customer per 7-day bucket
CROSS_BORDER_MIN_CENTS = 50_000 * 100  # per customer per 30-day bucket


def account_owner(world: World, accounts: np.ndarray) -> np.ndarray:
    """Customer index owning each account, or -1 for anything outside the bank."""
    cust = np.repeat(np.arange(world.n), SLOTS_PER_CUSTOMER)
    slot = np.tile(np.arange(SLOTS_PER_CUSTOMER), world.n)
    keys = world.account_id(cust, slot)
    order = np.argsort(keys)
    keys, cust = keys[order], cust[order]
    pos = np.clip(np.searchsorted(keys, accounts), 0, len(keys) - 1)
    return np.where(keys[pos] == accounts, cust[pos], -1)


def _bucket_flags(cust: np.ndarray, bucket: np.ndarray, value: np.ndarray, n: int, threshold: float,
                  distinct: np.ndarray | None = None) -> np.ndarray:
    """Customers whose per-bucket sum of `value` (or count of distinct
    `distinct`) reaches `threshold` in at least one bucket."""
    m = cust >= 0
    cust, bucket, value = cust[m], bucket[m], value[m]
    if not len(cust):
        return np.zeros(n, dtype=bool)
    if distinct is not None:
        trip = np.unique(np.stack([cust, bucket, distinct[m]]), axis=1)
        cust, bucket, value = trip[0], trip[1], np.ones(trip.shape[1])
    keys = cust.astype(np.int64) * 100_000 + bucket
    uk, inv = np.unique(keys, return_inverse=True)
    tot = np.bincount(inv, weights=value)
    hit = np.unique(uk[tot >= threshold] // 100_000)
    out = np.zeros(n, dtype=bool)
    out[hit] = True
    return out


def alerted_customers(world: World, tx: dict, src_c: np.ndarray, dst_c: np.ndarray) -> np.ndarray:
    day = (tx["ts"] - world.cal.day0_utc) // 86400
    ch, cents = tx["channel"], tx["cents"]
    near = (ch == CH["cash_deposit"]) & (cents >= NEAR_CTR_LOW) & (cents < NEAR_CTR_HIGH)
    a = _bucket_flags(np.where(near, dst_c, -1), day // 30, np.ones(len(day)), world.n, NEAR_CTR_MIN_COUNT)
    b = _bucket_flags(dst_c, day // 7, np.ones(len(day)), world.n, FAN_IN_MIN_SENDERS, distinct=tx["src"])
    xb = ch == CH["wire_international"]
    c_in = _bucket_flags(np.where(xb, dst_c, -1), day // 30, cents.astype(float), world.n, CROSS_BORDER_MIN_CENTS)
    c_out = _bucket_flags(np.where(xb, src_c, -1), day // 30, cents.astype(float), world.n, CROSS_BORDER_MIN_CENTS)
    return a | b | c_in | c_out


def investigated_labels(world: World, tx: dict, seed: int) -> dict:
    """tx: ts, src, dst, cents, channel, tx_id, illicit (bool), pattern (int,
    -1 for normal). Returns tx_id and label for labelled transactions, plus
    summary counts."""
    cfg = world.cfg
    rng = ids.rng_for(seed, STREAM_LABELS)
    n_tx = len(tx["ts"])
    src_c, dst_c = account_owner(world, tx["src"]), account_owner(world, tx["dst"])
    alerted = alerted_customers(world, tx, src_c, dst_c)

    investigated = alerted & (rng.random(world.n) < cfg.alert_investigate_prob)
    per_cust = np.bincount(src_c[src_c >= 0], minlength=world.n) + np.bincount(dst_c[dst_c >= 0], minlength=world.n)
    target = cfg.labelled_share * n_tx
    covered = int(per_cust[investigated].sum())
    for c in rng.permutation(np.flatnonzero(~investigated)):
        if covered >= target:
            break
        investigated[c] = True
        covered += int(per_cust[c])

    touched = (src_c >= 0) & investigated[np.maximum(src_c, 0)] | (dst_c >= 0) & investigated[np.maximum(dst_c, 0)]
    pattern = tx["pattern"]
    touched_patterns = np.unique(pattern[touched & (pattern >= 0)])
    found = touched_patterns[rng.random(len(touched_patterns)) < cfg.discovery_prob]
    in_found = np.isin(pattern, found)
    labelled = touched | in_found
    label = (tx["illicit"] & in_found).astype(np.int8)

    pos = np.flatnonzero(labelled & (label == 1))
    neg = np.flatnonzero(labelled & (label == 0))
    n_flip = min(int(round(cfg.label_noise * len(pos))), len(neg))
    if n_flip:
        label[rng.choice(pos, n_flip, replace=False)] = 0
        label[rng.choice(neg, n_flip, replace=False)] = 1

    idx = np.flatnonzero(labelled)
    stats = {
        "alerted_customers": int(alerted.sum()),
        "investigated_customers": int(investigated.sum()),
        "patterns_touched": int(len(touched_patterns)),
        "patterns_discovered": int(len(found)),
        "labelled_tx": int(len(idx)),
        "labelled_share": float(len(idx) / max(n_tx, 1)),
        "labelled_illicit": int(label[idx].sum()),
        "true_illicit_labelled_licit": int((tx["illicit"][idx] & (label[idx] == 0)).sum()),
        "noise_flips_each_way": n_flip,
    }
    return {"tx_id": tx["tx_id"][idx], "label": label[idx], "stats": stats}
