"""Synthetic bank-transaction data generator (design: docs/SYNTHETIC_DATA.md).

A simulated US bank: individuals and corporates with day-by-day normal
behaviour, plus injected money-laundering patterns hidden inside it. Output is
Parquet (customers, accounts, transactions, ground truth, investigated labels)
and a validation report (leakage gate, typology fidelity, distributions).

Layer rules: pure numpy / pandas / pyarrow (sklearn only inside validate/).
No framework or infra imports, so every piece is testable in isolation.
"""

from .config import PRESETS, GeneratorConfig, get_preset

__all__ = ["PRESETS", "GeneratorConfig", "get_preset"]
