"""Checks a generated dataset before anyone trains on it.

1. Leakage gate. A dataset where one raw column separates laundering from
   normal activity teaches a model nothing about graphs. Every raw
   per-transaction attribute (amount, roundness, time, channel, account and
   customer attributes) gets its own gradient-boosted model; the gate fails
   if any single attribute reaches out-of-fold AUC above
   `max_single_feature_auc`, or a model on all of them together (still no
   graph features) above `max_tabular_auc`. Folds are grouped by pattern, so
   a model cannot score well by memorising one pattern's quirks across folds.
2. Typology fidelity. Each injected pattern is checked against what its
   typology means (structuring stays under the CTR threshold, pass-through
   money leaves within days, cycles return to the first account, ...). This
   catches generator bugs that would make the "ground truth" not what it says.
3. Distribution report. Channel mix, amount quantiles, hours, roundness,
   activity per customer and label statistics, licit vs illicit, as Markdown.

Results go to `reports/validation.json` and `reports/distribution.md`.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

from .typologies import CTR_THRESHOLD_CENTS

N_FOLDS = 3
MAX_LICIT_ROWS = 400_000  # licit subsample for the gate; enough for stable AUCs, assumption
FIDELITY_MIN_PASS = 0.95  # share of patterns that must satisfy their typology's checks
PASS_THROUGH_MAX_HOURS = 120  # 2-48h by design, plus weekend/holiday roll-forward
CATEGORICAL = ("channel", "src_type", "dst_type", "src_country", "dst_country", "src_internal", "dst_internal",
               "src_cust_type", "dst_cust_type", "src_industry", "dst_industry", "src_income", "dst_income",
               "src_risk", "dst_risk", "hour", "dow")


# ---- loading ------------------------------------------------------------------------------

def load(out_dir: str | Path) -> dict:
    out = Path(out_dir)
    tx = pq.read_table(out / "transactions").to_pandas()
    tx["channel"] = tx["channel"].astype(str)
    truth = pq.read_table(out / "truth" / "labels_truth.parquet").to_pandas()
    return {
        "manifest": json.loads((out / "manifest.json").read_text(encoding="utf-8")),
        "tx": tx,
        "truth": truth,
        "patterns": pq.read_table(out / "truth" / "patterns.parquet").to_pandas(),
        "accounts": pq.read_table(out / "accounts.parquet").to_pandas(),
        "customers": pq.read_table(out / "customers.parquet").to_pandas(),
        "labels": pq.read_table(out / "labels" / "labels_investigated.parquet").to_pandas(),
    }


def raw_features(tx: pd.DataFrame, accounts: pd.DataFrame, customers: pd.DataFrame) -> pd.DataFrame:
    """Everything a per-transaction tabular model could see, without any
    graph aggregation. Ids are excluded (they are hashes by construction)."""
    acc = accounts.set_index("account_id")
    cust = customers.set_index("customer_id")
    ts = pd.to_datetime(tx["ts"], utc=True)
    dollars = tx["amount_cents"].to_numpy() // 100
    trailing = np.zeros(len(tx), np.int8)
    for k, mod in enumerate((10, 100, 1000), start=1):
        trailing[(dollars % mod == 0) & (dollars > 0)] = k
    f = pd.DataFrame({
        "log_amount": np.log10(np.maximum(tx["amount_cents"].to_numpy(), 1)),
        "whole_dollars": (tx["amount_cents"].to_numpy() % 100 == 0).astype(np.int8),
        "round_level": trailing,
        "hour": ts.dt.hour.to_numpy(),
        "dow": ts.dt.dayofweek.to_numpy(),
        "day_of_month": ts.dt.day.to_numpy(),
        "channel": tx["channel"].to_numpy(),
    })
    t_days = ts.dt.tz_localize(None).to_numpy()
    for side, col in (("src", "src_account_id"), ("dst", "dst_account_id")):
        a = acc.reindex(tx[col].to_numpy())
        f[f"{side}_type"] = a["account_type"].to_numpy()
        f[f"{side}_country"] = a["country"].to_numpy()
        f[f"{side}_internal"] = a["is_internal"].astype(bool).to_numpy().astype(np.int8)
        opened = pd.to_datetime(a["opened_date"]).to_numpy()
        f[f"{side}_account_age_days"] = (t_days - opened) / np.timedelta64(1, "D")
        c = cust.reindex(a["customer_id"].to_numpy())
        f[f"{side}_cust_type"] = c["customer_type"].to_numpy()
        f[f"{side}_industry"] = c["industry"].astype(object).to_numpy()
        f[f"{side}_income"] = c["income_band"].to_numpy()
        f[f"{side}_risk"] = c["risk_tier"].to_numpy()
    for col in CATEGORICAL:  # missing (outside the bank) is its own category
        f[col] = pd.Categorical(f[col].astype(object).where(f[col].notna(), "<none>").astype(str))
    return f


# ---- leakage gate -------------------------------------------------------------------------

def _folds(y: np.ndarray, group: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Illicit rows: fold by pattern. Licit rows: random fold."""
    fold = rng.integers(0, N_FOLDS, size=len(y))
    ug = np.unique(group[y == 1])
    gfold = dict(zip(ug, rng.permutation(len(ug)) % N_FOLDS, strict=True))
    fold[y == 1] = [gfold[g] for g in group[y == 1]]
    return fold


def _oof_auc(X: pd.DataFrame, y: np.ndarray, fold: np.ndarray, max_iter: int) -> float:
    pred = np.zeros(len(y))
    for k in range(N_FOLDS):
        tr, te = fold != k, fold == k
        if y[tr].min() == y[tr].max() or y[te].min() == y[te].max():
            return float("nan")
        m = HistGradientBoostingClassifier(max_iter=max_iter, learning_rate=0.1, categorical_features="from_dtype",
                                           early_stopping=False, random_state=0)
        m.fit(X[tr], y[tr])
        pred[te] = m.predict_proba(X[te])[:, 1]
    return float(roc_auc_score(y, pred))


def leakage_gate(data: dict, seed: int = 0, progress: Callable[[str], None] = print) -> dict:
    cfg = data["manifest"]["config"]
    tx, truth = data["tx"], data["truth"]
    y_all = tx["tx_id"].isin(truth["tx_id"]).to_numpy().astype(np.int8)
    rng = np.random.default_rng(seed)
    licit = np.flatnonzero(y_all == 0)
    if len(licit) > MAX_LICIT_ROWS:
        licit = np.sort(rng.choice(licit, MAX_LICIT_ROWS, replace=False))
    rows = np.sort(np.r_[licit, np.flatnonzero(y_all == 1)])
    sub = tx.iloc[rows].reset_index(drop=True)
    y = y_all[rows]
    pid = sub["tx_id"].map(truth.set_index("tx_id")["pattern_id"]).fillna(0).to_numpy().astype(np.int64)
    X = raw_features(sub, data["accounts"], data["customers"])
    fold = _folds(y, pid, rng)
    progress(f"leakage gate: {len(y):,} rows ({int(y.sum()):,} illicit), {X.shape[1]} raw attributes")

    single = {}
    for col in X.columns:
        single[col] = _oof_auc(X[[col]], y, fold, max_iter=50)
    tab = _oof_auc(X, y, fold, max_iter=200)
    worst = max(single, key=lambda c: np.nan_to_num(single[c]))
    passed = bool(single[worst] <= cfg["max_single_feature_auc"] and tab <= cfg["max_tabular_auc"])
    progress(f"leakage gate {'PASSED' if passed else 'FAILED'}: worst single {worst}={single[worst]:.3f} "
             f"(max {cfg['max_single_feature_auc']}), tabular={tab:.3f} (max {cfg['max_tabular_auc']})")
    return {"passed": passed, "single_feature_auc": dict(sorted(single.items(), key=lambda kv: -kv[1])),
            "tabular_auc": tab, "worst_feature": worst, "rows": int(len(y)), "illicit_rows": int(y.sum()),
            "max_single_feature_auc": cfg["max_single_feature_auc"], "max_tabular_auc": cfg["max_tabular_auc"]}


# ---- typology fidelity ----------------------------------------------------------------------

def _check_pattern(typology: str, g: pd.DataFrame) -> dict[str, bool]:
    """g: one pattern's transactions (ts, src, dst, cents, channel, role)."""
    role = g["role"].to_numpy()
    ins = g[np.isin(role, ("in", "placement"))]
    outs = g[np.isin(role, ("out", "exit"))]
    in_sum, out_sum = ins["amount_cents"].sum(), outs["amount_cents"].sum()
    checks = {"has_in_and_out": len(ins) > 0 and len(outs) > 0,
              "out_not_above_in": out_sum <= in_sum * 1.01}  # rounding can add < 1%
    if typology == "structuring":
        checks["placements_below_ctr"] = bool((ins["amount_cents"] < CTR_THRESHOLD_CENTS).all())
        checks["placements_are_cash"] = bool((ins["channel"] == "cash_deposit").all())
        checks["several_placements"] = len(ins) >= 3
        checks["total_above_ctr"] = in_sum >= CTR_THRESHOLD_CENTS
    elif typology == "pass_through":
        first_out = outs["ts"].min() if len(outs) else None
        last_in_before = ins[ins["ts"] <= first_out]["ts"].max() if first_out is not None else None
        hours = (first_out - last_in_before).total_seconds() / 3600 if last_in_before is not None else np.inf
        checks["fast_exit"] = bool(hours <= PASS_THROUGH_MAX_HOURS)
        checks["retains_little"] = out_sum >= 0.7 * in_sum
    elif typology in ("layering", "layering_cycle"):
        hops = g[role == "hop"]
        first = set(ins["dst_account_id"])
        returns = bool(hops["dst_account_id"].isin(first).any())
        checks["has_hops"] = len(hops) >= 2
        checks["cycle_matches_type"] = returns == (typology == "layering_cycle")
        checks["hops_not_growing"] = bool(hops["amount_cents"].max() <= ins["amount_cents"].max() * 1.01) \
            if len(hops) and len(ins) else False
    elif typology == "fan_in_out":
        checks["many_senders"] = ins["src_account_id"].nunique() >= 5
    return checks


def typology_fidelity(data: dict, progress: Callable[[str], None] = print) -> dict:
    tx = data["tx"].merge(data["truth"], on="tx_id")
    per_typ: dict[str, dict] = {}
    for (typ, _pid), g in tx.sort_values("ts").groupby(["typology", "pattern_id"], sort=True):
        res = _check_pattern(typ, g)
        d = per_typ.setdefault(typ, {"patterns": 0, "checks": {}})
        d["patterns"] += 1
        for name, ok in res.items():
            d["checks"][name] = d["checks"].get(name, 0) + int(ok)
    passed = True
    for d in per_typ.values():
        d["pass_share"] = {k: v / d["patterns"] for k, v in d["checks"].items()}
        d["passed"] = all(s >= FIDELITY_MIN_PASS for s in d["pass_share"].values())
        passed &= d["passed"]
    bad = {t: {k: round(s, 3) for k, s in d["pass_share"].items() if s < FIDELITY_MIN_PASS}
           for t, d in per_typ.items() if not d["passed"]}
    progress(f"typology fidelity {'PASSED' if passed else 'FAILED'}" + (f": {bad}" if bad else ""))
    return {"passed": bool(passed), "min_pass_share": FIDELITY_MIN_PASS, "typologies": per_typ}


# ---- distribution report ------------------------------------------------------------------

def _md_table(df: pd.DataFrame) -> str:
    cols = [str(c) for c in df.columns]
    lines = ["| " + " | ".join([df.index.name or ""] + cols) + " |", "|" + "---|" * (len(cols) + 1)]
    for idx, row in df.iterrows():
        cells = [f"{v:,.3g}" if isinstance(v, float) else f"{v:,}" if isinstance(v, (int, np.integer)) else str(v)
                 for v in row.to_numpy()]
        lines.append("| " + " | ".join([str(idx)] + cells) + " |")
    return "\n".join(lines)


def distribution_report(data: dict, gate: dict | None, fidelity: dict | None) -> str:
    tx, m = data["tx"], data["manifest"]
    illicit = tx["tx_id"].isin(data["truth"]["tx_id"]).to_numpy()
    cls = np.where(illicit, "illicit", "licit")
    dollars = tx["amount_cents"] / 100
    ts = pd.to_datetime(tx["ts"], utc=True)
    out = [f"# Synthetic dataset report: preset `{m['config']['name']}`, seed {m['seed']}", "",
           f"Config fingerprint `{m['config_fingerprint']}`, generator {m['generator_version']}.", ""]
    out += ["## Counts", "", "```", json.dumps(m["counts"], indent=1), "```", ""]

    mix = pd.crosstab(tx["channel"], cls, normalize="columns").round(4)
    mix.index.name = "channel"
    out += ["## Channel mix (share within class)", "", _md_table(mix), ""]

    q = pd.DataFrame({"class": cls, "channel": tx["channel"], "usd": dollars})
    qt = q.groupby(["channel", "class"])["usd"].quantile([0.1, 0.5, 0.9]).unstack().round(2)
    qt.index = [f"{a} / {b}" for a, b in qt.index]
    qt.index.name = "channel / class"
    qt.columns = ["p10 USD", "p50 USD", "p90 USD"]
    out += ["## Amount quantiles", "", _md_table(qt), ""]

    hours = pd.crosstab(ts.dt.hour, cls, normalize="columns").round(4)
    hours.index.name = "hour UTC"
    out += ["## Hour of day (share within class)", "", _md_table(hours), ""]

    d = tx["amount_cents"].to_numpy() // 100
    rnd = pd.DataFrame({"class": cls, "whole_dollars": tx["amount_cents"].to_numpy() % 100 == 0,
                        "mult_100": (d % 100 == 0) & (d > 0), "mult_1000": (d % 1000 == 0) & (d > 0)})
    rt = rnd.groupby("class").mean().round(4)
    rt.index.name = "class"
    out += ["## Roundness (share within class)", "", _md_table(rt), ""]

    owners = data["accounts"].set_index("account_id")["customer_id"]
    src_c = tx["src_account_id"].map(owners)
    per = src_c.dropna().value_counts()
    months = m["config"]["months"]
    out += ["## Outgoing transactions per customer per month", "",
            f"p10 {per.quantile(0.1) / months:.1f}, median {per.median() / months:.1f}, "
            f"p90 {per.quantile(0.9) / months:.1f}, max {per.max() / months:.1f}", ""]

    out += ["## Labels (investigated view)", "", "```", json.dumps(m["labels"], indent=1), "```", ""]
    if gate:
        g = pd.DataFrame({"oof AUC": gate["single_feature_auc"]})
        g.index.name = "attribute"
        out += ["## Leakage gate", "", f"**{'PASSED' if gate['passed'] else 'FAILED'}**: tabular AUC "
                f"{gate['tabular_auc']:.3f} (max {gate['max_tabular_auc']}), worst single attribute "
                f"`{gate['worst_feature']}` {gate['single_feature_auc'][gate['worst_feature']]:.3f} "
                f"(max {gate['max_single_feature_auc']}).", "", _md_table(g.round(3)), ""]
    if fidelity:
        rows = {f"{t} / {c}": {"patterns": d["patterns"], "pass share": round(s, 3)}
                for t, d in fidelity["typologies"].items() for c, s in d["pass_share"].items()}
        ft = pd.DataFrame(rows).T
        ft.index.name = "typology / check"
        out += ["## Typology fidelity", "", f"**{'PASSED' if fidelity['passed'] else 'FAILED'}** "
                f"(each check must hold for at least {FIDELITY_MIN_PASS:.0%} of patterns).", "", _md_table(ft), ""]
    return "\n".join(out)


# ---- entry point --------------------------------------------------------------------------

def validate(out_dir: str | Path, progress: Callable[[str], None] = print, run_gate: bool = True) -> dict:
    out = Path(out_dir)
    data = load(out)
    gate = leakage_gate(data, seed=data["manifest"]["seed"], progress=progress) if run_gate else None
    fid = typology_fidelity(data, progress=progress)
    report = distribution_report(data, gate, fid)
    (out / "reports").mkdir(exist_ok=True)
    (out / "reports" / "distribution.md").write_text(report, encoding="utf-8")
    result = {"passed": bool((gate is None or gate["passed"]) and fid["passed"]), "leakage": gate, "fidelity": fid}
    (out / "reports" / "validation.json").write_text(json.dumps(result, indent=2, default=float), encoding="utf-8")
    return result
