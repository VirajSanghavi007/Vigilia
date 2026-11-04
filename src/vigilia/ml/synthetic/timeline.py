"""Simulation calendar, business days and time-of-day profiles.

Day index d = 0 .. n_days-1 counts days from config.start. Timestamps are
seconds since the Unix epoch, UTC. The bank's local time is US Eastern taken
as a fixed UTC-5 (assumption: DST ignored, a one-hour shift for part of the
year does not matter to any model or rule here).

Every channel has one hour-of-day profile, used for licit AND illicit
transactions alike, so time of day can never separate the classes by itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import numpy as np

CHANNELS = (
    "card",
    "ach",
    "p2p",
    "wire_domestic",
    "wire_international",
    "cash_deposit",
    "cash_withdrawal",
    "check",
    "internal_transfer",
)
CH = {name: i for i, name in enumerate(CHANNELS)}
# Channels that only settle on business days (ACH, Fedwire, SWIFT and check
# clearing do not run on weekends or federal holidays). Cash deposits are
# allowed on Saturdays (branches open), handled in `allowed_days`.
BUSINESS_DAY_CHANNELS = frozenset({CH["ach"], CH["wire_domestic"], CH["wire_international"], CH["check"]})

LOCAL_UTC_OFFSET_S = 5 * 3600


def _profile(weights: dict[int, float], base: float = 0.0) -> np.ndarray:
    p = np.full(24, base)
    for h, w in weights.items():
        p[h] = w
    return p / p.sum()


# Hour-of-day weights, local time. All assumptions, shaped on ordinary
# banking practice: cards follow waking / shopping hours, ACH and cheques post
# in early-morning batch windows, wires and branch cash in business hours,
# ATMs and app transfers across the waking day.
HOUR_PROFILES = {
    CH["card"]: _profile({7: 2, 8: 3, 9: 3, 10: 4, 11: 5, 12: 7, 13: 6, 14: 5, 15: 5, 16: 6, 17: 7,
                          18: 8, 19: 7, 20: 5, 21: 3, 22: 2, 23: 1}, base=0.4),
    CH["ach"]: _profile({1: 2, 5: 3, 6: 6, 7: 4, 8: 2, 12: 2, 13: 3, 16: 2, 17: 3}),
    CH["p2p"]: _profile({8: 3, 9: 4, 10: 5, 11: 5, 12: 6, 13: 5, 14: 5, 15: 5, 16: 5, 17: 6, 18: 7,
                         19: 7, 20: 6, 21: 5, 22: 3, 23: 2}, base=0.5),
    CH["wire_domestic"]: _profile({9: 5, 10: 7, 11: 7, 12: 5, 13: 6, 14: 7, 15: 6, 16: 4, 17: 2}),
    CH["wire_international"]: _profile({8: 3, 9: 6, 10: 7, 11: 7, 12: 5, 13: 5, 14: 4, 15: 3, 16: 2}),
    CH["cash_deposit"]: _profile({9: 5, 10: 6, 11: 7, 12: 7, 13: 6, 14: 6, 15: 6, 16: 5, 17: 4, 18: 2,
                                  19: 1, 20: 1}),
    CH["cash_withdrawal"]: _profile({7: 2, 8: 3, 9: 4, 10: 4, 11: 5, 12: 6, 13: 5, 14: 4, 15: 4, 16: 5,
                                     17: 6, 18: 6, 19: 5, 20: 4, 21: 3, 22: 2, 23: 1}, base=0.3),
    CH["check"]: _profile({5: 3, 6: 6, 7: 3, 13: 1}),
    CH["internal_transfer"]: _profile({7: 2, 8: 3, 9: 4, 10: 4, 11: 4, 12: 5, 13: 4, 14: 4, 15: 4, 16: 4,
                                       17: 4, 18: 4, 19: 5, 20: 5, 21: 5, 22: 3, 23: 2}, base=0.3),
}


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def us_federal_holidays(year: int) -> set[date]:
    """Federal Reserve holiday schedule (fixed-date holidays falling on a
    Sunday move to Monday; the Fed does not observe Saturday holidays on the
    Friday). Source: federalreserve.gov holiday schedule rules."""
    fixed = [date(year, 1, 1), date(year, 6, 19), date(year, 7, 4), date(year, 11, 11), date(year, 12, 25)]
    days = {d + timedelta(days=1) if d.weekday() == 6 else d for d in fixed}
    days |= {
        _nth_weekday(year, 1, 0, 3),  # MLK Day
        _nth_weekday(year, 2, 0, 3),  # Washington's Birthday
        _last_weekday(year, 5, 0),  # Memorial Day
        _nth_weekday(year, 9, 0, 1),  # Labor Day
        _nth_weekday(year, 10, 0, 2),  # Columbus Day
        _nth_weekday(year, 11, 3, 4),  # Thanksgiving
    }
    return {d for d in days if d.weekday() < 5}


@dataclass(frozen=True)
class Calendar:
    start: date
    n_days: int
    n_months: int
    dates: tuple
    dow: np.ndarray  # 0 = Monday
    dom: np.ndarray  # day of month, 1-based
    month: np.ndarray  # month index from start, 0-based
    calendar_month: np.ndarray  # 1..12
    business: np.ndarray  # bool
    month_start: np.ndarray  # day index of each month's first day
    day0_utc: int  # epoch seconds of local midnight on day 0

    def allowed_days(self, channel: int) -> np.ndarray:
        if channel in BUSINESS_DAY_CHANNELS:
            return self.business
        if channel == CH["cash_deposit"]:
            return self.business | (self.dow == 5)
        return np.ones(self.n_days, dtype=bool)

    def roll_to_business(self, days: np.ndarray, forward: bool = True) -> np.ndarray:
        """Move each day index to the nearest business day (forward or back),
        clipped to the window. Used for scheduled payments (salaries roll back
        to the previous business day, bills forward)."""
        days = np.clip(np.asarray(days, dtype=np.int64), 0, self.n_days - 1)
        idx = np.flatnonzero(self.business)
        if forward:
            pos = np.searchsorted(idx, days, side="left")
            pos = np.clip(pos, 0, len(idx) - 1)
        else:
            pos = np.searchsorted(idx, days, side="right") - 1
            pos = np.clip(pos, 0, len(idx) - 1)
        return idx[pos]

    def to_ts(self, days: np.ndarray, seconds: np.ndarray) -> np.ndarray:
        return self.day0_utc + np.asarray(days, np.int64) * 86400 + np.asarray(seconds, np.int64)


def build_calendar(start: date, months: int) -> Calendar:
    y, m = start.year + (start.month - 1 + months) // 12, (start.month - 1 + months) % 12 + 1
    end = date(y, m, start.day)
    n_days = (end - start).days
    dates = tuple(start + timedelta(days=i) for i in range(n_days))
    holidays: set[date] = set()
    for year in range(start.year, end.year + 1):
        holidays |= us_federal_holidays(year)
    dow = np.array([d.weekday() for d in dates], dtype=np.int8)
    dom = np.array([d.day for d in dates], dtype=np.int8)
    month = np.array([(d.year - start.year) * 12 + d.month - start.month for d in dates], dtype=np.int16)
    business = np.array([d.weekday() < 5 and d not in holidays for d in dates])
    month_start = np.flatnonzero(np.r_[True, month[1:] != month[:-1]])
    day0 = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp()) + LOCAL_UTC_OFFSET_S
    return Calendar(
        start=start,
        n_days=n_days,
        n_months=months,
        dates=dates,
        dow=dow,
        dom=dom,
        month=month,
        calendar_month=np.array([d.month for d in dates], dtype=np.int8),
        business=business,
        month_start=month_start,
        day0_utc=day0,
    )


def sample_seconds(rng: np.random.Generator, channels: np.ndarray) -> np.ndarray:
    """Local seconds-of-day for each transaction, from its channel profile."""
    channels = np.asarray(channels)
    out = np.empty(len(channels), dtype=np.int64)
    for ch in np.unique(channels):
        mask = channels == ch
        n = int(mask.sum())
        hours = rng.choice(24, size=n, p=HOUR_PROFILES[int(ch)])
        out[mask] = hours * 3600 + rng.integers(0, 3600, size=n)
    return out
