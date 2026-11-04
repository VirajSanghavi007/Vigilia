"""The simulated bank: customers, their accounts, branches and external pools.

Only attributes that more than one shard (or the pattern planner) needs live
here as global arrays. Per-customer behaviour parameters (card spend rate,
contacts, suppliers) are drawn inside the customer's own shard from the
customer's own random stream (ids.rng_for(seed, STREAM_CUSTOMER, i)).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pandas as pd

from . import ids
from .config import GeneratorConfig
from .timeline import Calendar, build_calendar

STREAM_WORLD = 1
STREAM_CUSTOMER = 2
STREAM_SHARD = 3
STREAM_PATTERNS = 4
STREAM_LABELS = 5

INDIVIDUAL, CORPORATE = 0, 1

# Account slots per customer. Individuals: checking (always), savings.
# Corporates: operating (always), payroll, reserve.
SLOT_CHECKING, SLOT_SAVINGS = 0, 1
SLOT_OPERATING, SLOT_PAYROLL, SLOT_RESERVE = 0, 1, 2
SLOTS_PER_CUSTOMER = 4
SLOT_NAMES = {INDIVIDUAL: ("checking", "savings"), CORPORATE: ("operating", "payroll", "reserve")}

# Industries: (name, weight, cash_intensive, card_share, cash_share, foreign_supplier_share).
# Weights and shares are assumptions shaped on US small-business mix (Census
# County Business Patterns puts retail, food service, construction and
# professional services among the largest establishment counts).
INDUSTRIES = (
    ("retail", 0.16, True, 0.55, 0.12, 0.10),
    ("restaurant", 0.12, True, 0.60, 0.20, 0.03),
    ("construction", 0.12, False, 0.02, 0.03, 0.03),
    ("professional_services", 0.14, False, 0.10, 0.0, 0.04),
    ("healthcare", 0.08, False, 0.15, 0.01, 0.02),
    ("manufacturing", 0.07, False, 0.0, 0.0, 0.25),
    ("wholesale_trade", 0.08, False, 0.03, 0.02, 0.40),
    ("transport", 0.06, False, 0.05, 0.02, 0.08),
    ("real_estate", 0.07, False, 0.0, 0.0, 0.02),
    ("auto_services", 0.05, True, 0.45, 0.18, 0.02),
    ("tech", 0.05, False, 0.05, 0.0, 0.15),
)
IND_NAMES = tuple(x[0] for x in INDUSTRIES)

# Monthly seasonality per industry (Jan..Dec). Assumption, shaped on Census
# Monthly Retail Trade (holiday peak) and construction's summer peak.
SEASONALITY = {
    "retail": (0.85, 0.85, 0.95, 0.95, 1.0, 1.0, 1.0, 1.05, 0.95, 1.0, 1.15, 1.40),
    "restaurant": (0.90, 0.90, 1.0, 1.0, 1.05, 1.05, 1.05, 1.05, 1.0, 1.0, 0.95, 1.05),
    "construction": (0.75, 0.75, 0.90, 1.0, 1.10, 1.15, 1.15, 1.15, 1.10, 1.05, 0.95, 0.85),
    "auto_services": (0.90, 0.95, 1.05, 1.05, 1.05, 1.0, 1.0, 1.0, 1.0, 1.0, 0.95, 1.0),
}

# Countries. Domestic is "US". Weights are assumptions loosely ordered by
# public statistics: remittance corridors by the World Bank bilateral
# remittance estimates (Mexico by far the largest US outbound corridor), trade
# partners by US Census top trading partners. "Finance centres" are where
# corporates legitimately hold treasury, holding or trading relationships.
REMIT_CORRIDORS = {"MX": 30, "IN": 12, "PH": 8, "CN": 7, "GT": 7, "SV": 6, "VN": 5, "DO": 5, "HN": 4,
                   "CO": 4, "NG": 4, "PK": 3, "JM": 2, "HT": 2, "BD": 2, "KE": 2}
TRADE_PARTNERS = {"MX": 16, "CN": 14, "CA": 14, "DE": 6, "JP": 5, "VN": 5, "KR": 4, "TW": 3, "IN": 3,
                  "GB": 4, "IT": 2, "IE": 2, "HK": 3, "SG": 3, "AE": 2, "CH": 2, "TR": 1, "PA": 1}
FINANCE_CENTRES = {"GB": 5, "HK": 4, "SG": 4, "AE": 4, "CH": 3, "CY": 2, "PA": 2, "LU": 2, "KY": 1,
                   "BS": 1, "MT": 1, "TR": 2, "LV": 1}
COUNTRIES = tuple(sorted({"US"} | set(REMIT_CORRIDORS) | set(TRADE_PARTNERS) | set(FINANCE_CENTRES)))


def _weights(d: dict[str, float]) -> tuple[np.ndarray, np.ndarray]:
    codes = np.array(list(d.keys()))
    w = np.array(list(d.values()), dtype=float)
    return codes, w / w.sum()


@dataclass(frozen=True)
class PoolSizes:
    merchants: int
    persons: int
    businesses: int
    employers: int
    landlords: int
    utilities: int
    issuers: int
    processors: int
    government: int
    branches: int


def pool_sizes(n_customers: int) -> PoolSizes:
    s = n_customers / 10_000
    return PoolSizes(
        merchants=max(200, int(4000 * s)),
        persons=max(500, int(25_000 * s)),
        businesses=max(300, int(6000 * s)),
        employers=max(50, int(1500 * s)),
        landlords=max(30, int(600 * s)),
        utilities=max(10, min(60, int(40 * s) or 10)),
        issuers=20,
        processors=4,
        government=3,
        branches=max(5, int(40 * s)),
    )


@dataclass
class World:
    cfg: GeneratorConfig
    cal: Calendar
    key: np.uint64
    pools: PoolSizes
    ctype: np.ndarray  # int8
    industry: np.ndarray  # int8, -1 for individuals
    size: np.ndarray  # individuals: annual income USD; corporates: monthly revenue USD
    onboard_day: np.ndarray  # int32, negative = before the window
    close_day: np.ndarray  # int32, n_days = still open at the end
    home_branch: np.ndarray  # int16
    slots: np.ndarray  # bool (n, SLOTS_PER_CUSTOMER): which account slots exist
    remitter: np.ndarray  # bool
    remit_country: np.ndarray  # str
    group_id: np.ndarray  # int32, -1 = not in a corporate group
    risk_tier: np.ndarray  # int8 0 low, 1 medium, 2 high

    @property
    def n(self) -> int:
        return len(self.ctype)

    def customer_ids(self, idx=None) -> np.ndarray:
        idx = np.arange(self.n) if idx is None else idx
        return ids.make_ids(self.key, ids.NS_CUSTOMER, idx)

    def account_id(self, cust, slot) -> np.ndarray:
        cust = np.asarray(cust, dtype=np.int64)
        return ids.make_ids(self.key, ids.NS_INTERNAL_ACCOUNT, cust * SLOTS_PER_CUSTOMER + np.asarray(slot))

    def cash_id(self, branch) -> np.ndarray:
        return ids.make_ids(self.key, ids.NS_CASH, branch)

    def active_range(self, i: int) -> tuple[int, int]:
        return max(int(self.onboard_day[i]), 0), int(self.close_day[i])

    def corporate_index(self) -> np.ndarray:
        return np.flatnonzero(self.ctype == CORPORATE)

    def individual_index(self) -> np.ndarray:
        return np.flatnonzero(self.ctype == INDIVIDUAL)

    # ---- tables ---------------------------------------------------------
    def customers_frame(self) -> pd.DataFrame:
        start = pd.Timestamp(self.cfg.start)
        ind = np.where(self.industry >= 0, np.array(IND_NAMES + ("",))[self.industry], "")
        return pd.DataFrame({
            "customer_id": self.customer_ids(),
            "customer_type": np.where(self.ctype == CORPORATE, "corporate", "individual"),
            "business_unit": np.where(self.ctype == CORPORATE, "Corporate", "Retail"),
            "industry": pd.array(np.where(ind == "", None, ind), dtype="string"),
            "income_band": _band(self.ctype, self.size),
            "onboard_date": start + pd.to_timedelta(self.onboard_day, unit="D"),
            "close_date": (start + pd.to_timedelta(self.close_day, unit="D")).where(
                self.close_day < self.cal.n_days),
            "home_branch": self.home_branch.astype(np.int16),
            "risk_tier": np.array(["low", "medium", "high"])[self.risk_tier],
        })

    def internal_accounts_frame(self) -> pd.DataFrame:
        cust, slot = np.nonzero(self.slots)
        start = pd.Timestamp(self.cfg.start)
        names = np.array([SLOT_NAMES[int(t)][s] for t, s in zip(self.ctype[cust], slot, strict=True)])
        return pd.DataFrame({
            "account_id": self.account_id(cust, slot),
            "customer_id": self.customer_ids(cust),
            "is_internal": True,
            "account_type": names,
            "country": "US",
            "opened_date": start + pd.to_timedelta(self.onboard_day[cust], unit="D"),
        })


def _band(ctype: np.ndarray, size: np.ndarray) -> np.ndarray:
    ind_edges, ind_names = [30_000, 60_000, 120_000], ["<30k", "30-60k", "60-120k", ">120k"]
    corp_edges, corp_names = [50_000, 250_000, 1_000_000], ["<50k/mo", "50-250k/mo", "250k-1M/mo", ">1M/mo"]
    ind = np.array(ind_names)[np.searchsorted(ind_edges, size)]
    corp = np.array(corp_names)[np.searchsorted(corp_edges, size)]
    return np.where(ctype == CORPORATE, corp, ind)


def build_world(cfg: GeneratorConfig, seed: int) -> World:
    rng = ids.rng_for(seed, STREAM_WORLD)
    cal = build_calendar(cfg.start, cfg.months)
    n, nd = cfg.n_customers, cal.n_days
    pools = pool_sizes(n)

    ctype = (rng.random(n) < cfg.corporate_share).astype(np.int8)
    is_corp = ctype == CORPORATE

    ind_w = np.array([x[1] for x in INDUSTRIES])
    industry = np.where(is_corp, rng.choice(len(INDUSTRIES), size=n, p=ind_w / ind_w.sum()), -1).astype(np.int8)

    # Individuals: annual income, lognormal median $52k, sigma 0.6. Source:
    # US Census CPS median personal earnings for full-time workers is
    # ~$55-60k (2023); median over all earners is lower. Assumption on sigma.
    income = 52_000 * np.exp(0.6 * rng.standard_normal(n))
    # Corporates: monthly revenue, lognormal median $60k, sigma 1.1 (heavy
    # tail: a few large firms). Assumption for a regional bank's SME book.
    revenue = 60_000 * np.exp(1.1 * rng.standard_normal(n))
    size = np.where(is_corp, revenue, income)

    # Onboarding: 85% were customers before the window (tenure lognormal,
    # median 6 years), 15% join during it. Assumption.
    tenure = np.exp(np.log(6 * 365) + 0.8 * rng.standard_normal(n))
    joins_inside = rng.random(n) < 0.15
    onboard = np.where(joins_inside, rng.integers(0, int(nd * 0.9), size=n), -np.maximum(tenure, 30))
    onboard = onboard.astype(np.int32)
    # Attrition: ~6% close during the window (assumption; US retail deposit
    # attrition is commonly quoted at 5-15% a year, this keeps most histories whole).
    closes = rng.random(n) < 0.06
    earliest_close = np.maximum(onboard, 0) + 90
    span = np.maximum(nd - earliest_close, 0)
    close = np.where(closes & (span > 0), earliest_close + np.floor(rng.random(n) * span), nd)
    close = np.minimum(close, nd).astype(np.int32)

    home_branch = rng.integers(0, pools.branches, size=n).astype(np.int16)

    slots = np.zeros((n, SLOTS_PER_CUSTOMER), dtype=bool)
    slots[:, 0] = True
    # 55% of individuals hold a savings account at the same bank (assumption).
    slots[:, SLOT_SAVINGS] = np.where(is_corp, rng.random(n) < 0.45 + 0.1 * (revenue > 100_000), rng.random(n) < 0.55)
    slots[:, SLOT_RESERVE] = is_corp & (rng.random(n) < 0.5)

    # ~10% of individuals send regular remittances abroad (assumption; Pew and
    # World Bank surveys put the share of US adults remitting at 5-15%).
    remitter = ~is_corp & (rng.random(n) < 0.10)
    rc, rw = _weights(REMIT_CORRIDORS)
    remit_country = np.where(remitter, rng.choice(rc, size=n, p=rw), "")

    group_id = np.full(n, -1, dtype=np.int32)
    corp_idx = np.flatnonzero(is_corp)
    grouped = corp_idx[rng.random(len(corp_idx)) < 0.15]
    rng.shuffle(grouped)
    g, pos = 0, 0
    while pos < len(grouped) - 1:
        k = int(rng.integers(2, 5))
        group_id[grouped[pos:pos + k]] = g
        g, pos = g + 1, pos + k

    # Risk tier from what KYC would see: cash-intensive industry, heavy
    # foreign trade, remittances, plus unexplained noise (analyst judgement).
    cash_int = np.array([x[2] for x in INDUSTRIES] + [False])[industry]
    foreign = np.array([x[5] for x in INDUSTRIES] + [0.0])[industry]
    score = 0.8 * cash_int + 1.5 * foreign + 0.7 * remitter + 0.6 * rng.standard_normal(n)
    risk = np.digitize(score, [0.6, 1.3]).astype(np.int8)

    return World(cfg=cfg, cal=cal, key=ids.id_key(seed), pools=pools, ctype=ctype, industry=industry,
                 size=size, onboard_day=onboard, close_day=close, home_branch=home_branch, slots=slots,
                 remitter=remitter, remit_country=remit_country, group_id=group_id, risk_tier=risk)


# ---- external accounts ---------------------------------------------------------

_EXT_KIND = {
    ids.NS_MERCHANT: "merchant", ids.NS_EXT_PERSON: "person", ids.NS_EXT_BUSINESS: "business",
    ids.NS_EMPLOYER: "employer", ids.NS_LANDLORD: "landlord", ids.NS_UTILITY: "utility",
    ids.NS_ISSUER: "issuer", ids.NS_PROCESSOR: "processor", ids.NS_GOVERNMENT: "government",
    ids.NS_PATTERN_EXT: "person", ids.NS_EXT_EMPLOYEE: "person", ids.NS_CASH: "cash",
}
# Foreign share of each pool (assumptions): online / travel merchants abroad,
# persons abroad among P2P contacts, foreign trade counterparties.
_FOREIGN_SHARE = {ids.NS_MERCHANT: 0.03, ids.NS_EXT_PERSON: 0.04, ids.NS_EXT_BUSINESS: 0.14}


def pool_country(key: np.uint64, ns: int, idx: np.ndarray) -> np.ndarray:
    """Country of a pooled external account, a pure function of its index."""
    idx = np.asarray(idx)
    out = np.full(idx.shape, "US", dtype=object)
    share = _FOREIGN_SHARE.get(ns, 0.0)
    if share == 0.0:
        return out
    u = ids.unit_hash(key, ns, idx, salt=1)
    v = ids.unit_hash(key, ns, idx, salt=2)
    table = {**TRADE_PARTNERS, **{k: w * 0.5 for k, w in FINANCE_CENTRES.items()}} if ns == ids.NS_EXT_BUSINESS \
        else TRADE_PARTNERS if ns == ids.NS_MERCHANT else REMIT_CORRIDORS
    codes, w = _weights(table)
    foreign = u < share
    out[foreign] = codes[np.minimum(np.searchsorted(np.cumsum(w), v[foreign]), len(codes) - 1)]
    return out


def ext_kind(ns: int) -> str:
    return _EXT_KIND[ns]


def zipf_choice(rng: np.random.Generator, n_items: int, size: int, a: float = 1.1) -> np.ndarray:
    """Popularity-weighted pick from a pool (heavy-tailed: a few hubs, many
    small). The rank-to-index permutation is fixed per pool by sorting, so the
    same indices are popular for every customer."""
    return rng.choice(n_items, size=size, p=_zipf_p(n_items, a))


@lru_cache(maxsize=64)
def _zipf_p(n_items: int, a: float) -> np.ndarray:
    p = np.arange(1, n_items + 1, dtype=float) ** -a
    return p / p.sum()
