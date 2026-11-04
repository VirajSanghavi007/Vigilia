"""Generator configuration: size presets and dataset-level settings.

Behaviour parameters (rates, amount distributions) live next to the code that
uses them (behaviour.py, typologies.py), each with a comment giving its source
or saying "assumption". This module holds only what a user picks per run.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, replace
from datetime import date


@dataclass(frozen=True)
class GeneratorConfig:
    name: str
    n_customers: int
    # Share of customers that are corporates. Assumption: a retail-heavy
    # regional bank; ~10-15% business customers by count.
    corporate_share: float = 0.12
    start: date = date(2024, 1, 1)
    # 24 months (decision 2026-11-04): long enough for drift, seasonality and
    # a temporal train / validation / test split with whole years.
    months: int = 24
    # Customers per shard. Fixed per preset, never derived from the worker
    # count, so the output is identical for any number of workers.
    shard_size: int = 250
    # Ground-truth illicit share of all transactions (decision 2026-11-03:
    # 0.1% default, also to be tested at 0.05% and 0.5%).
    illicit_rate: float = 0.001
    # Investigated-label view (decision 2026-11-03).
    labelled_share: float = 0.22  # target share of transactions with a label
    discovery_prob: float = 0.6  # chance an investigation uncovers a pattern it touches
    label_noise: float = 0.03  # see labels.py for exactly what is flipped
    alert_investigate_prob: float = 0.7  # alerted customers investigated with this prob
    # Leakage gate (decision 2026-11-04, "stricter").
    max_single_feature_auc: float = 0.70
    max_tabular_auc: float = 0.85

    @property
    def n_shards(self) -> int:
        return -(-self.n_customers // self.shard_size)

    def to_json(self) -> dict:
        d = asdict(self)
        d["start"] = self.start.isoformat()
        return d

    def fingerprint(self) -> str:
        """Stable hash of every setting, so a resumed run can refuse to mix
        shards written under a different configuration."""
        blob = json.dumps(self.to_json(), sort_keys=True).encode()
        return hashlib.sha256(blob).hexdigest()[:16]


PRESETS: dict[str, GeneratorConfig] = {
    # Unit / smoke tests: a few seconds. Higher illicit rate so a tiny world
    # still contains every typology.
    "tiny": GeneratorConfig(name="tiny", n_customers=300, months=6, shard_size=60, illicit_rate=0.01),
    # Milestone 1 development dataset.
    "dev": GeneratorConfig(name="dev", n_customers=10_000),
}


def get_preset(name: str, **overrides) -> GeneratorConfig:
    if name not in PRESETS:
        raise ValueError(f"unknown preset {name!r}; choose from {sorted(PRESETS)}")
    cfg = PRESETS[name]
    return replace(cfg, **overrides) if overrides else cfg
