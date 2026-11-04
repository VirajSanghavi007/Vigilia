"""End-to-end generation: world, normal shards (in parallel), patterns,
labels, and the Parquet dataset.

Output layout under `out_dir`:

    manifest.json                    config, seed, counts, label statistics
    customers.parquet                one row per customer
    accounts.parquet                 internal accounts + every referenced outside account
    transactions/YYYY-MM.parquet     all transactions (licit and illicit mixed), sorted by (ts, tx_id)
    labels/labels_investigated.parquet   tx_id, label: the training labels
    truth/labels_truth.parquet       tx_id, typology, pattern_id, role: illicit rows only, evaluation only
    truth/patterns.parquet           one row per pattern instance
    reports/                         written by validate.py

Resume: normal shards are the expensive part. Each shard is written
atomically to `_work/shards/` and skipped on a re-run with the same config
and seed; a different config or seed refuses to reuse them. `_work/` is
removed when the run completes.

Determinism: every random stream is keyed by (seed, path), shards are fixed
customer ranges, and every merge sorts by (ts, tx_id). The dataset is the same
byte for byte for any number of workers.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from collections.abc import Callable
from multiprocessing import get_context
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from . import ids
from .behaviour import ShardContext, simulate_shard
from .config import GeneratorConfig
from .labels import investigated_labels
from .timeline import CHANNELS
from .typologies import inject_patterns
from .world import World, build_world

GENERATOR_VERSION = "1.0.0"
TX_COLUMNS = ("tx_id", "ts", "src", "dst", "cents", "channel")

Progress = Callable[[str], None]


def _write_atomic(table: pa.Table, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    pq.write_table(table, tmp, compression="zstd")
    os.replace(tmp, path)


def _write_json_atomic(obj: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


class _Progress:
    """`X/Y (Z%) - elapsed Ns, eta Ns` lines at ~5% steps."""

    def __init__(self, total: int, label: str, out: Progress):
        self.total, self.label, self.out = total, label, out
        self.step = max(1, total // 20)
        self.t0 = time.monotonic()
        self.done = 0

    def tick(self) -> None:
        self.done += 1
        if self.done % self.step and self.done != self.total:
            return
        el = time.monotonic() - self.t0
        eta = el / self.done * (self.total - self.done)
        self.out(f"{self.label} {self.done}/{self.total} ({100 * self.done / self.total:.0f}%) "
                 f"- elapsed {el:.0f}s, eta {eta:.0f}s")


# ---- shard workers ------------------------------------------------------------------

_WORKER: dict = {}


def _init_worker(cfg: GeneratorConfig, seed: int) -> None:
    try:  # below-normal priority so the laptop stays usable (optional dependency)
        import psutil

        p = psutil.Process()
        p.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS if os.name == "nt" else 10)
    except Exception:  # noqa: BLE001 - priority is a nicety, never a failure
        pass
    world = build_world(cfg, seed)
    _WORKER.update(world=world, ctx=ShardContext.build(world), seed=seed)


def shard_table(world: World, shard: int, seed: int, ctx: ShardContext | None = None) -> tuple[pa.Table, pa.Table]:
    out = simulate_shard(world, shard, seed, ctx)
    tx = pa.table({k: out[k] for k in TX_COLUMNS})
    ext = out["externals"]
    ext_t = pa.table({"account_id": ext["account_id"], "kind": ext["kind"].astype(str),
                      "country": ext["country"].astype(str)})
    return tx, ext_t


def _shard_job(args: tuple[int, str]) -> tuple[int, int]:
    shard, work = args
    tx, ext = shard_table(_WORKER["world"], shard, _WORKER["seed"], _WORKER["ctx"])
    _write_atomic(ext, Path(work) / "externals" / f"part-{shard:05d}.parquet")
    _write_atomic(tx, Path(work) / "shards" / f"part-{shard:05d}.parquet")  # last: marks the shard done
    return shard, tx.num_rows


def run_shards(cfg: GeneratorConfig, seed: int, work: Path, workers: int, progress: Progress) -> None:
    todo = [s for s in range(cfg.n_shards) if not (work / "shards" / f"part-{s:05d}.parquet").exists()]
    if len(todo) < cfg.n_shards:
        progress(f"resume: {cfg.n_shards - len(todo)}/{cfg.n_shards} shards already done")
    if not todo:
        return
    bar = _Progress(len(todo), "shards", progress)
    jobs = [(s, str(work)) for s in todo]
    if workers <= 1:
        _init_worker(cfg, seed)
        for j in jobs:
            _shard_job(j)
            bar.tick()
        return
    with get_context("spawn").Pool(workers, initializer=_init_worker, initargs=(cfg, seed)) as pool:
        for _ in pool.imap_unordered(_shard_job, jobs):
            bar.tick()


# ---- finalize -----------------------------------------------------------------------------

def _check_manifest(work: Path, cfg: GeneratorConfig, seed: int) -> None:
    path = work / "run.json"
    mine = {"fingerprint": cfg.fingerprint(), "seed": seed, "version": GENERATOR_VERSION}
    if path.exists():
        prev = json.loads(path.read_text(encoding="utf-8"))
        if prev != mine:
            raise RuntimeError(f"{work} holds shards from a different run ({prev}); delete it or use another out_dir")
    else:
        _write_json_atomic(mine, path)


def _read_parts(folder: Path) -> pa.Table:
    parts = sorted(folder.glob("part-*.parquet"))
    return pa.concat_tables([pq.read_table(p) for p in parts]) if parts else None


def _ts_array(ts: np.ndarray) -> pa.Array:
    return pa.array(ts.astype("datetime64[s]"), type=pa.timestamp("s", tz="UTC"))


def generate(cfg: GeneratorConfig, seed: int, out_dir: str | Path, workers: int | None = None,
             progress: Progress = print) -> dict:
    out = Path(out_dir)
    work = out / "_work"
    work.mkdir(parents=True, exist_ok=True)
    _check_manifest(work, cfg, seed)
    workers = workers or min(22, cfg.n_shards, os.cpu_count() or 1)
    t0 = time.monotonic()
    progress(f"preset {cfg.name}: {cfg.n_customers} customers, {cfg.months} months, "
             f"{cfg.n_shards} shards, {workers} workers, seed {seed}")

    world = build_world(cfg, seed)
    run_shards(cfg, seed, work, workers, progress)

    normal = _read_parts(work / "shards")
    n_normal = normal.num_rows
    progress(f"normal transactions: {n_normal:,}; injecting patterns")
    pat = inject_patterns(world, seed, n_normal)
    ptx = pat["tx"]
    n_ill = len(ptx["ts"])

    cols = {k: np.concatenate([normal.column(k).to_numpy(), ptx[k]]) for k in TX_COLUMNS}
    illicit = np.r_[np.zeros(n_normal, bool), np.ones(n_ill, bool)]
    pattern_idx = np.r_[np.full(n_normal, -1, np.int64), _dense(ptx["pattern_id"])]
    del normal
    order = np.lexsort((cols["tx_id"], cols["ts"]))
    cols = {k: v[order] for k, v in cols.items()}
    illicit, pattern_idx = illicit[order], pattern_idx[order]

    progress("labelling (alert rules, investigations, noise)")
    lab = investigated_labels(world, {**cols, "illicit": illicit, "pattern": pattern_idx}, seed)

    progress("writing dataset")
    _write_transactions(world, cols, out / "transactions")
    _write_atomic(pa.Table.from_pandas(world.customers_frame(), preserve_index=False), out / "customers.parquet")
    _write_atomic(_accounts_table(world, work, pat["externals"], cols), out / "accounts.parquet")
    _write_atomic(pa.table({"tx_id": lab["tx_id"], "label": lab["label"]}), out / "labels" / "labels_investigated.parquet")
    _write_atomic(pa.table({"tx_id": ptx["tx_id"], "typology": ptx["typology"].astype(str),
                            "pattern_id": ptx["pattern_id"], "role": ptx["role"].astype(str)}),
                  out / "truth" / "labels_truth.parquet")
    patterns = pat["patterns"].copy()
    if len(patterns):
        patterns["start_ts"] = pd.to_datetime(patterns["start_ts"], unit="s", utc=True)
        patterns["end_ts"] = pd.to_datetime(patterns["end_ts"], unit="s", utc=True)
    _write_atomic(pa.Table.from_pandas(patterns, preserve_index=False), out / "truth" / "patterns.parquet")

    manifest = {
        "generator_version": GENERATOR_VERSION,
        "config": cfg.to_json(),
        "config_fingerprint": cfg.fingerprint(),
        "seed": seed,
        "counts": {
            "customers": world.n,
            "transactions": int(len(cols["ts"])),
            "normal_transactions": int(n_normal),
            "illicit_transactions": int(n_ill),
            "illicit_share": float(n_ill / max(len(cols["ts"]), 1)),
            "patterns": int(len(patterns)),
            "patterns_by_typology": {str(k): int(v) for k, v in
                                     (patterns["typology"].value_counts().sort_index().items() if len(patterns) else [])},
        },
        "labels": lab["stats"],
    }
    _write_json_atomic(manifest, out / "manifest.json")
    shutil.rmtree(work, ignore_errors=True)
    progress(f"done in {time.monotonic() - t0:.0f}s: {len(cols['ts']):,} transactions, {n_ill:,} illicit")
    return manifest


def _dense(pattern_ids: np.ndarray) -> np.ndarray:
    """Pattern ids -> 0..k-1, in order of first appearance."""
    if not len(pattern_ids):
        return np.zeros(0, np.int64)
    _, first, inv = np.unique(pattern_ids, return_index=True, return_inverse=True)
    rank = np.argsort(np.argsort(first))
    return rank[inv].astype(np.int64)


def _write_transactions(world: World, cols: dict, folder: Path) -> None:
    month = pd.to_datetime(cols["ts"], unit="s", utc=True).strftime("%Y-%m").to_numpy()
    bounds = np.flatnonzero(np.r_[True, month[1:] != month[:-1], True])
    for a, b in zip(bounds[:-1], bounds[1:], strict=True):
        sl = slice(a, b)
        table = pa.table({
            "tx_id": cols["tx_id"][sl],
            "ts": _ts_array(cols["ts"][sl]),
            "src_account_id": cols["src"][sl],
            "dst_account_id": cols["dst"][sl],
            "amount_cents": cols["cents"][sl],
            "currency": pa.array(["USD"] * (b - a)).dictionary_encode(),
            "channel": pa.DictionaryArray.from_arrays(pa.array(cols["channel"][sl].astype(np.int32)),
                                                      pa.array(list(CHANNELS))),
        })
        _write_atomic(table, folder / f"{month[a]}.parquet")


def _accounts_table(world: World, work: Path, pattern_ext: dict, cols: dict) -> pa.Table:
    internal = world.internal_accounts_frame()
    ext = _read_parts(work / "externals")
    ext_df = ext.to_pandas() if ext is not None else pd.DataFrame(columns=["account_id", "kind", "country"])
    pe = pd.DataFrame({"account_id": pattern_ext["account_id"], "kind": pattern_ext["kind"].astype(str),
                       "country": pattern_ext["country"].astype(str)})
    branches = np.arange(world.pools.branches)
    cash = pd.DataFrame({"account_id": world.cash_id(branches), "kind": "cash", "country": "US"})
    ext_df = pd.concat([ext_df, pe, cash], ignore_index=True).drop_duplicates("account_id", keep="first")
    used = np.union1d(cols["src"], cols["dst"])
    ext_df = ext_df[np.isin(ext_df["account_id"].to_numpy(), used)
                    & ~np.isin(ext_df["account_id"].to_numpy(), internal["account_id"].to_numpy())]
    ext_df = pd.DataFrame({
        "account_id": ext_df["account_id"].to_numpy(),
        "customer_id": pd.array([None] * len(ext_df), dtype="Int64"),
        "is_internal": False,
        "account_type": ext_df["kind"].to_numpy(),
        "country": ext_df["country"].to_numpy(),
        "opened_date": pd.NaT,
    })
    internal["customer_id"] = internal["customer_id"].astype("Int64")
    both = pd.concat([internal, ext_df], ignore_index=True).sort_values("account_id", kind="stable")
    both["opened_date"] = pd.to_datetime(both["opened_date"])
    return pa.Table.from_pandas(both, preserve_index=False)


__all__ = ["generate", "shard_table", "run_shards", "GENERATOR_VERSION", "ids"]
