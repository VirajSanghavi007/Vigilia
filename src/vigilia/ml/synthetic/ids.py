"""Seeding and identifiers.

Randomness: every independent stream (one customer, one shard, one pattern)
gets its own Generator from `SeedSequence(seed, spawn_key=path)`, so results
depend only on (seed, path), never on processing order or worker count.

Identifiers: every entity id is `mix64((namespace << 48 | index) ^ key)`,
viewed as int64. `mix64` (the splitmix64 finaliser) is a bijection on 64-bit
integers, so distinct (namespace, index) pairs can never collide, yet ids carry
no information about creation order, entity kind or label (no "illicit
accounts have high ids" shortcut).
"""

from __future__ import annotations

import numpy as np

# Namespaces (16 bits). Transaction namespaces are NS_TX_BASE + shard index.
NS_CUSTOMER = 1
NS_INTERNAL_ACCOUNT = 2
NS_CASH = 3  # branch cash pseudo-accounts (source of deposits, sink of withdrawals)
NS_MERCHANT = 10
NS_EXT_PERSON = 11
NS_EXT_BUSINESS = 12
NS_EMPLOYER = 13
NS_LANDLORD = 14
NS_UTILITY = 15
NS_ISSUER = 16  # card issuers and loan servicers
NS_PROCESSOR = 17  # card acquirers paying merchant settlements
NS_GOVERNMENT = 18
NS_PATTERN_EXT = 19  # external accounts created for laundering patterns
NS_EXT_EMPLOYEE = 20  # corporates' employees banked elsewhere
NS_TX_PATTERNS = 999
NS_TX_BASE = 1000

_STREAM_IDS = 7

_C1 = np.uint64(0x9E3779B97F4A7C15)
_C2 = np.uint64(0xBF58476D1CE4E5B9)
_C3 = np.uint64(0x94D049BB133111EB)


def rng_for(seed: int, *path: int) -> np.random.Generator:
    return np.random.default_rng(np.random.SeedSequence(seed, spawn_key=tuple(int(p) for p in path)))


def id_key(seed: int) -> np.uint64:
    return np.random.SeedSequence(seed, spawn_key=(_STREAM_IDS,)).generate_state(1, np.uint64)[0]


def mix64(x: np.ndarray) -> np.ndarray:
    z = np.asarray(x, dtype=np.uint64)
    with np.errstate(over="ignore"):
        z = z + _C1
        z = (z ^ (z >> np.uint64(30))) * _C2
        z = (z ^ (z >> np.uint64(27))) * _C3
    return z ^ (z >> np.uint64(31))


def make_ids(key: np.uint64, namespace: int, index) -> np.ndarray:
    idx = np.asarray(index, dtype=np.uint64)
    if idx.size and int(idx.max()) >= (1 << 48):
        raise ValueError("index exceeds 48 bits")
    raw = (np.uint64(namespace) << np.uint64(48)) | idx
    return mix64(raw ^ key).view(np.int64)


def unit_hash(key: np.uint64, namespace: int, index, salt: int = 0) -> np.ndarray:
    """Deterministic uniform [0, 1) per (namespace, index): attributes of
    external accounts (e.g. country) without storing a table for every pool."""
    idx = np.asarray(index, dtype=np.uint64)
    raw = (np.uint64(namespace) << np.uint64(48)) | idx
    salted = mix64(raw ^ key ^ mix64(np.uint64(salt + 0x5EED)))
    return (mix64(salted) >> np.uint64(11)).astype(np.float64) / float(1 << 53)
