"""Laundering typologies, injected into the simulated world after normal behaviour.

Each pattern instance is a small story carried out by existing customers of
the bank (mules, front companies) and outside counterparties. Laundering is
hidden inside normal behaviour on purpose:

- actors are ordinary customers who keep all their normal activity;
- every pattern transaction uses a channel, rounding habit and hour-of-day
  profile that normal customers also use;
- the defining signal of each typology is structural or temporal (several
  deposits just under a threshold, money leaving within hours of arriving,
  chains and cycles, many-to-one-to-many), not a single column.

Milestone 1 typologies: structuring, rapid pass-through, layering / cycles,
fan-in / fan-out. Every parameter is marked with its source or "assumption".
Sources for the typology shapes: FATF, "Money Laundering and Terrorist
Financing Typologies" reports, and FinCEN SAR activity reviews (structuring,
funnel accounts, rapid movement of funds).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import ids
from .amounts import apply_rounding, atm_cents
from .timeline import CH, CHANNELS, Calendar, sample_seconds
from .world import (
    CORPORATE,
    FINANCE_CENTRES,
    INDUSTRIES,
    REMIT_CORRIDORS,
    SLOT_CHECKING,
    SLOT_OPERATING,
    STREAM_PATTERNS,
    TRADE_PARTNERS,
    World,
    _weights,
    pool_country,
)

TYPOLOGIES = ("structuring", "pass_through", "layering", "fan_in_out")
# Mix by pattern count (assumption; FinCEN SAR filings are dominated by
# structuring and funnel / rapid-movement activity).
TYPOLOGY_P = np.array([0.25, 0.25, 0.20, 0.30])

CTR_THRESHOLD_CENTS = 10_000 * 100  # 31 CFR 1010.311 currency transaction report
P2P_MAX_CENTS = 2_500 * 100  # single P2P payment limit, assumption (see PatternFactory.p2p_ok)

# Destination countries for laundered money leaving the country. A mix of
# finance centres, trade partners and remittance corridors (assumption): all
# three also receive legitimate flows in normal behaviour, so country alone
# is not a label.
_DEST = {**{k: v * 1.0 for k, v in FINANCE_CENTRES.items()},
         **{k: v * 0.5 for k, v in TRADE_PARTNERS.items()},
         **{k: v * 0.4 for k, v in REMIT_CORRIDORS.items()}}


@dataclass
class Scheduler:
    """Places pattern transactions in time, respecting each channel's
    settlement days and hour-of-day profile (the same ones normal traffic uses)."""

    cal: Calendar
    next_ok: dict = field(init=False)

    def __post_init__(self) -> None:
        n = self.cal.n_days
        self.next_ok = {}
        for ch in range(len(CHANNELS)):
            ok = self.cal.allowed_days(ch)
            nxt = np.full(n + 1, n, dtype=np.int64)
            for d in range(n - 1, -1, -1):
                nxt[d] = d if ok[d] else nxt[d + 1]
            self.next_ok[ch] = nxt

    def day_of(self, ts: int) -> int:
        return int((ts - self.cal.day0_utc) // 86400)

    def on_day(self, rng: np.random.Generator, day: int, ch: int) -> int | None:
        d = int(self.next_ok[ch][min(max(day, 0), self.cal.n_days)])
        if d >= self.cal.n_days:
            return None
        return int(self.cal.to_ts(d, sample_seconds(rng, np.array([ch]))[0]))

    def after(self, rng: np.random.Generator, ts0: int, min_h: float, max_h: float, ch: int) -> int | None:
        """A time roughly `min_h`-`max_h` hours after ts0 (strictly later),
        moved to the channel's next settlement day when needed."""
        target = ts0 + int(rng.uniform(min_h, max_h) * 3600)
        day = self.day_of(target)
        for attempt in range(8):
            d = int(self.next_ok[ch][min(max(day, 0), self.cal.n_days)])
            if d >= self.cal.n_days:
                return None
            ts = int(self.cal.to_ts(d, sample_seconds(rng, np.array([ch]))[0]))
            if ts > ts0:
                return ts
            if attempt >= 2:
                day = d + 1
        return None


@dataclass
class _Pattern:
    typology: str
    actors: list
    rows: list = field(default_factory=list)  # (ts, src, dst, cents, channel, role)

    def add(self, ts, src, dst, cents, ch, role: str) -> None:
        if ts is not None and cents > 0:
            self.rows.append((int(ts), int(src), int(dst), int(cents), int(ch), role))


class PatternFactory:
    """Builds pattern instances one at a time from a shared, deterministic state."""

    def __init__(self, world: World, seed: int):
        self.w = world
        self.seed = seed
        self.sched = Scheduler(world.cal)
        self.key = world.key
        self.n_ext = 0
        self.ext_rows: list[tuple[int, int, str]] = []  # (ns, idx, country)
        rng = ids.rng_for(seed, STREAM_PATTERNS, 0)
        ind, corp = world.individual_index(), world.corporate_index()
        # Mules: ~3% of individuals, mildly biased to higher risk tiers
        # (assumption: KYC risk is a weak, not a sharp, predictor of misuse).
        w_ind = np.array([1.0, 1.4, 2.0])[world.risk_tier[ind]]
        self.mules = rng.choice(ind, size=max(3, int(0.03 * len(ind))), replace=False, p=w_ind / w_ind.sum())
        # Front companies: ~5% of corporates, biased to cash-intensive and
        # foreign-trading industries (assumption, FATF trade-based ML typologies).
        cash_int = np.array([x[2] for x in INDUSTRIES])[world.industry[corp]]
        w_corp = 1.0 + 1.0 * cash_int + 0.5 * (world.risk_tier[corp] == 2)
        n_front = min(len(corp), max(2, int(0.05 * len(corp))))
        self.fronts = rng.choice(corp, size=n_front, replace=False, p=w_corp / w_corp.sum()) if n_front else corp
        self.dest_codes, self.dest_p = _weights(_DEST)

    # ---- helpers --------------------------------------------------------------------

    def acct(self, cust: int) -> int:
        slot = SLOT_OPERATING if self.w.ctype[cust] == CORPORATE else SLOT_CHECKING
        return int(self.w.account_id(cust, slot))

    def fresh_ext(self, country: str = "US") -> int:
        """A new outside person account used only by patterns (a mule abroad,
        a cash courier's account at another bank)."""
        idx = self.n_ext
        self.n_ext += 1
        self.ext_rows.append((ids.NS_PATTERN_EXT, idx, country))
        return int(ids.make_ids(self.key, ids.NS_PATTERN_EXT, idx))

    def pool_person(self, rng) -> int:
        idx = int(rng.integers(0, self.w.pools.persons))
        self.ext_rows.append((ids.NS_EXT_PERSON, idx, ""))
        return int(ids.make_ids(self.key, ids.NS_EXT_PERSON, idx))

    def pool_business(self, rng, foreign: bool | None = None) -> int:
        for _ in range(50):
            idx = int(rng.integers(0, self.w.pools.businesses))
            c = pool_country(self.key, ids.NS_EXT_BUSINESS, np.array([idx]))[0]
            if foreign is None or (c != "US") == foreign:
                break
        self.ext_rows.append((ids.NS_EXT_BUSINESS, idx, ""))
        return int(ids.make_ids(self.key, ids.NS_EXT_BUSINESS, idx))

    def foreign_dest(self, rng) -> int:
        """Where money leaves the country: an outside business (shell or
        trading company) 50%, otherwise a person abroad."""
        if rng.random() < 0.5:
            return self.pool_business(rng, foreign=True)
        return self.fresh_ext(str(rng.choice(self.dest_codes, p=self.dest_p)))

    def outside_source(self, rng) -> int:
        """Money arriving from outside: pool persons (40%, assumption: some
        counterparties also transact normally), fresh persons, or businesses."""
        u = rng.random()
        if u < 0.4:
            return self.pool_person(rng)
        if u < 0.75:
            return self.fresh_ext("US")
        return self.pool_business(rng, foreign=bool(rng.random() < 0.3))

    def pick_alive(self, rng, pool: np.ndarray, span_days: int, k: int = 1) -> tuple[np.ndarray, int] | None:
        """k distinct actors from `pool` all open for a whole window of
        `span_days`, and a start day inside that window."""
        cal = self.w.cal
        for _ in range(40):
            if len(pool) < k:
                return None
            who = rng.choice(pool, size=k, replace=False)
            lo = int(np.max(np.maximum(self.w.onboard_day[who], 0)))
            hi = int(np.min(self.w.close_day[who])) - span_days
            hi = min(hi, cal.n_days - span_days)
            if hi > lo:
                return who, int(rng.integers(lo, hi))
        return None

    def monthly_flow(self, actors) -> float:
        """Typical monthly money through the smallest of `actors`, in USD:
        income / 12 for individuals, revenue for corporates. Launderers keep
        amounts plausible for the account's profile (FATF money-mule and
        trade-based ML guidance), so pattern sizes scale with it."""
        a = np.atleast_1d(np.asarray(actors, dtype=np.int64))
        size = self.w.size[a].astype(float)
        flow = np.where(self.w.ctype[a] == CORPORATE, size, size / 12)
        return float(np.clip(flow.min(), 1_500, 400_000))

    @staticmethod
    def p2p_ok(ch: int, cents: float) -> int:
        """P2P rails cap single payments at a few thousand dollars a day
        (assumption, typical Zelle-style limits); bigger ones go by ACH."""
        return CH["ach"] if ch == CH["p2p"] and cents > P2P_MAX_CENTS else ch

    def amount(self, rng, cents: float, ch: int) -> int:
        style = {CH["p2p"]: "p2p", CH["cash_deposit"]: "cash", CH["cash_withdrawal"]: "cash"}.get(ch, "invoice")
        return int(apply_rounding(rng, np.array([max(int(cents), 100)]), style)[0])

    # ---- typologies -------------------------------------------------------------------

    def structuring(self, rng) -> _Pattern | None:
        """Cash placed in several deposits each below the $10k CTR threshold,
        one per day (often at different branches), then moved on."""
        corp = rng.random() < 0.35 and len(self.fronts)
        pick = self.pick_alive(rng, self.fronts if corp else self.mules, 60)
        if pick is None:
            return None
        (actor,), start = pick
        p = _Pattern("structuring", [int(actor)])
        a = self.acct(actor)
        n_dep = int(rng.integers(3, 11))
        span = int(rng.integers(n_dep, n_dep * 3 + 1))
        days = np.sort(rng.choice(np.arange(start, start + span), size=n_dep, replace=False))
        branch = int(self.w.home_branch[actor])
        total = 0
        for d in days:
            # $3k-$9.9k, skewed toward the top of the band (assumption, FinCEN structuring advisories).
            dollars = 9_900 - 6_900 * rng.beta(1.2, 2.5)
            cents = min(self.amount(rng, dollars * 100, CH["cash_deposit"]), CTR_THRESHOLD_CENTS - 100)
            br = branch if rng.random() < 0.4 else int(rng.integers(0, self.w.pools.branches))
            ts = self.sched.on_day(rng, int(d), CH["cash_deposit"])
            p.add(ts, self.w.cash_id(br), a, cents, CH["cash_deposit"], "placement")
            total += cents if ts is not None else 0
        if not p.rows:
            return None
        last = max(r[0] for r in p.rows)
        # Then moved on in a few pieces (assumption on the split): wires abroad
        # or at home, transfers to other people.
        moved = total * rng.uniform(0.8, 0.97)
        parts = rng.dirichlet(np.full(int(rng.integers(2, 6)), 3.0)) * moved
        t = last
        for part in parts:
            ch = int(rng.choice([CH["wire_international"], CH["wire_domestic"], CH["ach"], CH["p2p"]],
                                p=[0.25, 0.2, 0.3, 0.25]))
            ch = self.p2p_ok(ch, part)
            if ch == CH["wire_international"]:
                dst = self.foreign_dest(rng)
            else:
                dst = self.acct(int(rng.choice(self.mules))) if rng.random() < 0.3 else self.outside_source(rng)
            t2 = self.sched.after(rng, t, 12, 120, ch)
            p.add(t2, a, dst, self.amount(rng, part, ch), ch, "exit")
            t = t2 or t
        return p

    def pass_through(self, rng) -> _Pattern | None:
        """Funds arrive and leave again within hours, repeatedly; the account
        keeps almost nothing (FinCEN 'funnel account' / rapid movement)."""
        corp = rng.random() < 0.3 and len(self.fronts)
        pick = self.pick_alive(rng, self.fronts if corp else self.mules, 150)
        if pick is None:
            return None
        (actor,), start = pick
        p = _Pattern("pass_through", [int(actor)])
        a = self.acct(actor)
        t_day = start
        # Each cycle moves about a third of the actor's normal monthly flow
        # in total (assumption), so it does not dwarf the account's own activity.
        median = self.monthly_flow(actor) * 0.35
        for _ in range(int(rng.integers(2, 7))):
            n_in = int(rng.integers(1, 4))
            ins_total, last_in = 0, None
            for _k in range(n_in):
                raw = median / n_in * 100 * np.exp(0.7 * rng.standard_normal())
                ch = self.p2p_ok(int(rng.choice([CH["ach"], CH["p2p"], CH["wire_domestic"]], p=[0.45, 0.35, 0.20])),
                                 raw)
                cents = self.amount(rng, raw, ch)
                ts = self.sched.on_day(rng, t_day + int(rng.integers(0, 2)), ch)
                p.add(ts, self.outside_source(rng), a, cents, ch, "in")
                if ts is not None:
                    ins_total += cents
                    last_in = ts if last_in is None else max(last_in, ts)
            if last_in is None:
                break
            out_total = ins_total * rng.uniform(0.90, 0.99)  # keeps a 1-10% cut
            parts = rng.dirichlet(np.full(int(rng.integers(1, 4)), 3.0)) * out_total
            for part in parts:
                ch = self.p2p_ok(int(rng.choice([CH["wire_domestic"], CH["wire_international"], CH["p2p"], CH["ach"]],
                                                p=[0.35, 0.25, 0.25, 0.15])), part)
                dst = self.foreign_dest(rng) if ch == CH["wire_international"] else (
                    self.acct(int(rng.choice(self.mules))) if rng.random() < 0.25 else self.outside_source(rng))
                p.add(self.sched.after(rng, last_in, 2, 48, ch), a, dst, self.amount(rng, part, ch), ch, "out")
            t_day = self.sched.day_of(last_in) + int(rng.integers(3, 21))
        return p if len(p.rows) >= 2 else None

    def layering(self, rng) -> _Pattern | None:
        """Money passed along a chain of 3-7 accounts at this bank, losing a
        little at each hop, then out (or back to the first account: a cycle)."""
        k = int(rng.integers(3, 8))
        n_corp = min(int(rng.integers(1, k + 1)), len(self.fronts))
        pool_size_ok = len(self.mules) >= k - n_corp
        if not pool_size_ok:
            return None
        rounds = int(rng.integers(1, 4))
        span = 30 * rounds + 20
        pc = self.pick_alive(rng, self.fronts, span, n_corp) if n_corp else (np.zeros(0, int), None)
        pm = self.pick_alive(rng, self.mules, span, k - n_corp) if k - n_corp else (np.zeros(0, int), None)
        if pc is None or pm is None:
            return None
        chain = np.r_[pc[0], pm[0]].astype(int)
        rng.shuffle(chain)
        cal = self.w.cal
        lo = int(np.max(np.maximum(self.w.onboard_day[chain], 0)))
        hi = min(int(np.min(self.w.close_day[chain])), cal.n_days) - span
        if hi <= lo:
            return None
        start = int(rng.integers(lo, hi))
        cycle = rng.random() < 0.4
        p = _Pattern("layering_cycle" if cycle else "layering", [int(c) for c in chain])
        accts = [self.acct(c) for c in chain]
        # Sized by the smallest account in the chain (the bottleneck), about a
        # quarter of its monthly flow per round (assumption).
        median = self.monthly_flow(chain) * 0.25
        src_foreign = bool(rng.random() < 0.4)  # funds often enter from abroad, assumption
        src = self.pool_business(rng, foreign=src_foreign)
        sink = self.foreign_dest(rng)
        day = start
        for _ in range(rounds):
            amt = median * 100 * np.exp(0.6 * rng.standard_normal())
            ch = CH["wire_international"] if src_foreign else CH["wire_domestic"]
            ts = self.sched.on_day(rng, day, ch)
            prev = self.amount(rng, amt, ch)
            p.add(ts, src, accts[0], prev, ch, "in")
            if ts is None:
                break
            hops = list(zip(accts[:-1], accts[1:], strict=True)) + ([(accts[-1], accts[0])] if cycle else [])
            for s, d in hops:
                amt *= 1 - rng.uniform(0.005, 0.03)  # fee / cut per hop, assumption
                ch = self.p2p_ok(int(rng.choice([CH["wire_domestic"], CH["ach"], CH["p2p"]], p=[0.5, 0.35, 0.15])),
                                 amt)
                t2 = self.sched.after(rng, ts, 1, 72, ch)
                # Rounding must not forward more than the account just received.
                prev = min(self.amount(rng, amt, ch), prev)
                p.add(t2, s, d, prev, ch, "hop")
                ts = t2 or ts
            # Out of the system from the last account (also after a cycle).
            last = accts[0] if cycle else accts[-1]
            amt *= 1 - rng.uniform(0.005, 0.03)
            p.add(self.sched.after(rng, ts, 2, 96, CH["wire_international"]), last, sink,
                  min(self.amount(rng, amt, CH["wire_international"]), prev), CH["wire_international"], "exit")
            day = self.sched.day_of(ts) + int(rng.integers(10, 30))
        return p if len(p.rows) >= 3 else None

    def fan_in_out(self, rng) -> _Pattern | None:
        """Many small payments from many senders into one collector account,
        then spread out again: transfers, card spending, ATM cash (funnel,
        money-mule collection)."""
        corp = rng.random() < 0.25 and len(self.fronts)
        pick = self.pick_alive(rng, self.fronts if corp else self.mules, 60)
        if pick is None:
            return None
        (actor,), start = pick
        p = _Pattern("fan_in_out", [int(actor)])
        a = self.acct(actor)
        n_send = int(rng.integers(6, 26))
        in_span = int(rng.integers(3, 15))
        senders = []
        for _ in range(n_send):
            u = rng.random()
            if u < 0.2:
                senders.append(self.acct(int(rng.choice(self.mules))))
            elif u < 0.5:
                senders.append(self.pool_person(rng))
            else:
                senders.append(self.fresh_ext("US"))
        total, last = 0, None
        for s in senders:
            for _ in range(int(rng.integers(1, 3))):
                ch = CH["p2p"] if rng.random() < 0.7 else CH["ach"]
                # Small amounts sized like ordinary P2P, median ~$250 (assumption).
                cents = self.amount(rng, 250 * 100 * np.exp(0.8 * rng.standard_normal()), ch)
                ts = self.sched.on_day(rng, start + int(rng.integers(0, in_span)), ch)
                p.add(ts, s, a, cents, ch, "in")
                if ts is not None:
                    total += cents
                    last = ts if last is None else max(last, ts)
        if last is None:
            return None
        # Out: 55% transfers to a few recipients, 25% card spending, 20% ATM cash (assumption).
        remaining = total * rng.uniform(0.85, 0.98)
        t = last
        for part in rng.dirichlet(np.full(int(rng.integers(2, 7)), 3.0)) * remaining * 0.55:
            ch = self.p2p_ok(int(rng.choice([CH["p2p"], CH["wire_domestic"], CH["wire_international"]],
                                            p=[0.6, 0.25, 0.15])), part)
            dst = self.foreign_dest(rng) if ch == CH["wire_international"] else (
                self.acct(int(rng.choice(self.mules))) if rng.random() < 0.3 else self.outside_source(rng))
            p.add(self.sched.after(rng, t, 6, 120, ch), a, dst, self.amount(rng, part, ch), ch, "out")
        card_left = remaining * 0.25
        while card_left > 2_000:
            # Everyday-sized purchases, a little above normal debit spend (assumption).
            cents = min(int(card_left), int(4_000 * np.exp(0.9 * rng.standard_normal())) + 100)
            m = int(rng.integers(0, self.w.pools.merchants))
            self.ext_rows.append((ids.NS_MERCHANT, m, ""))
            p.add(self.sched.after(rng, t, 2, 240, CH["card"]), a, int(ids.make_ids(self.key, ids.NS_MERCHANT, m)),
                  cents, CH["card"], "out")
            card_left -= cents
        cash_left = remaining * 0.20
        branch = int(self.w.home_branch[actor])
        while cash_left > 2_000:
            # Never withdraw more than is left (multiples of $20, like the ATM).
            cents = min(int(atm_cents(rng, 200, 1)[0]), int(cash_left // 2000) * 2000)
            br = branch if rng.random() < 0.5 else int(rng.integers(0, self.w.pools.branches))
            p.add(self.sched.after(rng, t, 2, 240, CH["cash_withdrawal"]), a, self.w.cash_id(br), cents,
                  CH["cash_withdrawal"], "out")
            cash_left -= cents
        return p

    def make(self, k: int) -> _Pattern | None:
        rng = ids.rng_for(self.seed, STREAM_PATTERNS, 1, k)
        typ = TYPOLOGIES[int(rng.choice(len(TYPOLOGIES), p=TYPOLOGY_P))]
        return getattr(self, typ)(rng)


def inject_patterns(world: World, seed: int, n_normal: int) -> dict:
    """Generate laundering patterns until illicit transactions reach the
    configured share of all transactions. Returns transaction columns (with
    ids, typology, pattern id and role), a pattern table and external accounts."""
    rate = world.cfg.illicit_rate
    target = int(round(rate * n_normal / (1.0 - rate)))
    fac = PatternFactory(world, seed)
    rows, pat_rows = [], []
    k, n_tx = 0, 0
    while n_tx < target and k < 50 * max(target, 1):
        p = fac.make(k)
        k += 1
        if p is None or not p.rows:
            continue
        pid = len(pat_rows)
        for r in p.rows:
            rows.append((*r, pid, p.typology))
        ts = [r[0] for r in p.rows]
        pat_rows.append({"pattern_index": pid, "typology": p.typology, "n_tx": len(p.rows),
                         "start_ts": min(ts), "end_ts": max(ts),
                         "actors": world.customer_ids(np.array(p.actors, dtype=np.int64)).tolist()})
        n_tx += len(p.rows)
    return _finish(world, fac, rows, pat_rows)


def _finish(world: World, fac: PatternFactory, rows: list, pat_rows: list) -> dict:
    key = world.key
    if rows:
        ts, src, dst, cents, ch, role, pid, typ = (np.array(c) for c in zip(*rows, strict=True))
    else:
        ts = src = dst = cents = pid = np.zeros(0, np.int64)
        ch = np.zeros(0, np.int8)
        role = typ = np.zeros(0, object)
    order = np.lexsort((np.arange(len(ts)), ts))
    pattern_ids = ids.make_ids(key, ids.NS_TX_PATTERNS, np.arange(len(pat_rows)) + (1 << 40))
    tx = {
        "ts": ts[order].astype(np.int64), "src": src[order].astype(np.int64), "dst": dst[order].astype(np.int64),
        "cents": cents[order].astype(np.int64), "channel": ch[order].astype(np.int8),
        "tx_id": ids.make_ids(key, ids.NS_TX_PATTERNS, np.arange(len(ts))),
        "pattern_id": pattern_ids[pid[order].astype(np.int64)] if len(ts) else np.zeros(0, np.int64),
        "typology": typ[order].astype(object), "role": role[order].astype(object),
    }
    patterns = pd.DataFrame(pat_rows)
    if len(patterns):
        patterns.insert(0, "pattern_id", pattern_ids)
        patterns = patterns.drop(columns="pattern_index")
    ext = _externals(key, fac.ext_rows)
    return {"tx": tx, "patterns": patterns, "externals": ext}


def _externals(key: np.uint64, ext_rows: list) -> dict:
    if not ext_rows:
        return {"account_id": np.zeros(0, np.int64), "kind": np.zeros(0, object), "country": np.zeros(0, object)}
    from .world import ext_kind

    ns = np.array([r[0] for r in ext_rows], dtype=np.int64)
    idx = np.array([r[1] for r in ext_rows], dtype=np.int64)
    country = np.array([r[2] for r in ext_rows], dtype=object)
    aid = np.empty(len(ns), dtype=np.int64)
    kind = np.empty(len(ns), dtype=object)
    for n in np.unique(ns):
        m = ns == n
        aid[m] = ids.make_ids(key, int(n), idx[m])
        kind[m] = ext_kind(int(n))
        missing = m & (country == "")
        if missing.any():
            country[missing] = pool_country(key, int(n), idx[missing])
    _, first = np.unique(aid, return_index=True)
    first.sort()
    return {"account_id": aid[first], "kind": kind[first], "country": country[first]}
