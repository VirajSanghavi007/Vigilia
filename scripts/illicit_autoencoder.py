"""Sparse autoencoder trained ONLY on labeled-ILLICIT nodes -- the inverse of
sparse_autoencoder.py. The licit-trained version came out inverted (test AUC
0.297; illicit reconstructed better than licit in 10 of 14 test steps), which
says illicit transactions are the more homogeneous population in raw feature
space. A one-class model wants exactly that: a tight class to learn. So here
the anomaly IS the prediction -- high reconstruction error = "doesn't look
like known illicit" = candidate licit.

Known failure mode this run is built to measure, not assume away:
reconstruction error measures distance from the training distribution, not
membership in the other class. Two consequences:
  1. Novel illicit patterns (e.g. after the dark-market shutdown at ~step 43)
     are also "unlike known illicit" and would get cleared as licit. Leakage
     is reported pre- vs post-shutdown for exactly this reason.
  2. The unlabeled population is structurally distinct from both labeled
     classes (CO_LABELING.md sections 4-6), so it may score "licit" just for
     being unfamiliar. The unlabeled breakdown checks how many cleared nodes
     XGBoost/GNN actually agree are licit.
The intended use, if it holds up, is a third vote on the licit side of
co_label.py only, never a standalone labeler.

Splits (all on top of data.temporal_split, nothing touches test labels
before evaluation):
  - fit:   illicit nodes, steps 1-30 (90/10 random split for early stopping,
           so best-epoch selection never sees a licit label)
  - calib: all labeled nodes, steps 31-34 -- out-of-sample for this model,
           used only to pick the clearance threshold for a target licit
           precision
  - test:  all labeled nodes, steps 35-49

Every score is oriented "higher = more licit" and evaluated the same way,
against these baselines:
  - licit_ae: sparse_autoencoder.py's licit-trained model, raw error (its
    error already runs higher on licit, the section 7 inversion, so +error
    is its licit score)
  - illicit_centroid / illicit_mahalanobis: distance to the illicit fit set
    (if these match the autoencoder, the network adds nothing)
  - l2_norm: distance from the overall train median, class-agnostic
    ("how unusual is this node at all") -- if this matches, the autoencoder
    is only measuring unusualness
  - xgb / gnn: supervised upper bound, from co_label.py's output CSV

GPU use is guarded (other jobs share this GPU): see select_device.
"""
import argparse
import json
import os
import subprocess
import time

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from data import get_dataset
from sklearn.covariance import LedoitWolf
from sklearn.metrics import average_precision_score, roc_auc_score
from sparse_autoencoder import SparseAutoencoder, apply_scaler, fit_scaler, sparse_loss
from sparse_autoencoder_time_diagnostic import auc_by_time_step, summarize

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
CKPT_PATH = os.path.join(CKPT_DIR, "illicit_autoencoder.pt")
LICIT_AE_CKPT_PATH = os.path.join(CKPT_DIR, "sparse_autoencoder.pt")
CO_LABEL_CSV = os.path.join(RESULTS_DIR, "co_labeled_alpha_0.5.csv")

FIT_MAX_STEP = 30
DARK_MARKET_STEP = 43
TARGET_PRECISIONS = (0.99, 0.995)
FIXED_COVERAGES = (0.25, 0.5, 0.7)
CUDA_CONTEXT_MB = 500  # what creating a CUDA context costs on its own, outside the allocator


def estimate_vram_mb(n_train, in_dim, batch_size, hidden=64, bottleneck=16):
    """Rough upper bound on what this run allocates on the GPU, excluding
    the CUDA context itself (which mem_get_info already accounts for, since
    querying it creates the context). Full-batch training keeps the fit set,
    its activations and their gradients resident; inference only ever holds
    one batch."""
    bytes_per = 4
    act_width = 2 * in_dim + 2 * hidden + bottleneck  # input, recon, 2 hidden, code
    train_data = n_train * in_dim * bytes_per
    train_acts = n_train * act_width * bytes_per * 2  # forward + backward
    n_params = 2 * (in_dim * hidden + hidden * bottleneck) + 2 * hidden + bottleneck + in_dim
    params = n_params * bytes_per * 4  # weights, grads, Adam m and v
    infer = batch_size * act_width * bytes_per
    return (train_data + train_acts + params + infer) / 2**20


def query_free_vram_mb():
    """(free_mb, total_mb) of GPU 0 from nvidia-smi, or None if it can't be
    queried. Deliberately not torch.cuda.mem_get_info: that creates a CUDA
    context (~300-500 MiB) just to answer, which already eats into a shared
    GPU even when the answer is "use the CPU"."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free,memory.total",
             "--format=csv,noheader,nounits", "--id=0"],
            capture_output=True, text=True, timeout=30, check=True).stdout
        free_mb, total_mb = (float(v) for v in out.strip().split(","))
        return free_mb, total_mb
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def select_device(required_mb, reserve_mb=2048, force_cpu=False, cuda=torch.cuda,
                  query=query_free_vram_mb):
    """Use the GPU only if its free memory (net of every other process on
    it) covers this run's budget plus `reserve_mb` left untouched for the
    other jobs sharing the GPU. Otherwise CPU -- this model is small enough
    that CPU is slower, not infeasible. When the GPU is chosen, the caching
    allocator is capped at the tensor budget, so an underestimate here OOMs
    this process (caught in run(), which falls back to CPU) instead of
    growing into memory other jobs need."""
    alloc_mb = required_mb * 2 + 256  # 2x safety on the estimate + allocator slack
    budget_mb = alloc_mb + CUDA_CONTEXT_MB
    info = {"required_mb_estimate": round(required_mb, 1), "budget_mb": round(budget_mb, 1),
            "reserve_mb": reserve_mb}
    if force_cpu:
        return torch.device("cpu"), {**info, "device": "cpu", "reason": "forced"}
    if not cuda.is_available():
        return torch.device("cpu"), {**info, "device": "cpu", "reason": "cuda unavailable"}
    queried = query()
    if queried is None:  # no nvidia-smi: fall back to asking CUDA (creates the context)
        free_b, total_b = cuda.mem_get_info()
        queried = (free_b / 2**20, total_b / 2**20)
    free_mb, total_mb = queried
    info.update({"free_mb": round(free_mb, 1), "total_mb": round(total_mb, 1)})
    if free_mb < budget_mb + reserve_mb:
        return torch.device("cpu"), {
            **info, "device": "cpu",
            "reason": f"only {free_mb:.0f} MiB free, need {budget_mb + reserve_mb:.0f} "
                      f"(budget {budget_mb:.0f} + reserve {reserve_mb})"}
    fraction = min(1.0, alloc_mb / total_mb)
    cuda.set_per_process_memory_fraction(fraction)
    return torch.device("cuda"), {**info, "device": "cuda", "memory_fraction_cap": fraction,
                                  "reason": "enough free VRAM"}


def build_masks(time_steps, y, train_mask, fit_max_step=FIT_MAX_STEP):
    """fit = illicit training nodes up to fit_max_step; calib = every labeled
    training node after it. train_mask already excludes unlabeled nodes and
    the test period."""
    fit = train_mask & (y == 1) & (time_steps <= fit_max_step)
    calib = train_mask & (time_steps > fit_max_step)
    return fit, calib


def split_fit_val(n, val_frac=0.1, seed=0):
    idx = np.random.default_rng(seed).permutation(n)
    n_val = max(1, int(round(n * val_frac)))
    return idx[n_val:], idx[:n_val]


def train(X_fit, X_val, device, epochs=2000, hidden=64, bottleneck=16,
          sparsity_weight=1e-3, lr=1e-3, seed=0):
    """Full-batch training; keeps the weights from the epoch with the lowest
    validation reconstruction MSE (validation = held-out illicit nodes)."""
    torch.manual_seed(seed)
    model = SparseAutoencoder(X_fit.shape[1], hidden=hidden, bottleneck=bottleneck).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    x = torch.tensor(X_fit, dtype=torch.float32, device=device)
    xv = torch.tensor(X_val, dtype=torch.float32, device=device)

    best_val, best_state, best_epoch = float("inf"), None, -1
    print_every = max(1, epochs // 20)
    t0 = time.time()
    for epoch in range(epochs):
        model.train()
        opt.zero_grad()
        recon, code = model(x)
        loss, recon_loss, sparsity_penalty = sparse_loss(x, recon, code, sparsity_weight)
        loss.backward()
        opt.step()

        model.eval()
        with torch.no_grad():
            val_mse = F.mse_loss(model(xv)[0], xv).item()
        if val_mse < best_val:
            best_val, best_epoch = val_mse, epoch
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

        if epoch % print_every == 0 or epoch == epochs - 1:
            elapsed = time.time() - t0
            eta = elapsed / (epoch + 1) * (epochs - epoch - 1)
            print(f"epoch {epoch + 1}/{epochs} ({(epoch + 1) / epochs:.0%}) - "
                  f"elapsed {elapsed:.1f}s, eta {eta:.1f}s | train_recon={recon_loss.item():.4f} "
                  f"val_recon={val_mse:.4f} best_val={best_val:.4f}@{best_epoch + 1}")

    model.load_state_dict(best_state)
    return model, {"best_epoch": best_epoch + 1, "best_val_mse": best_val,
                   "final_train_recon_mse": float(recon_loss.item())}


@torch.no_grad()
def reconstruction_errors(model, X, device, batch_size=8192):
    """Per-node reconstruction MSE. X stays in host memory; only one batch
    at a time is moved to `device`."""
    model.eval()
    errors = np.empty(X.shape[0], dtype=np.float32)
    for start in range(0, X.shape[0], batch_size):
        end = min(start + batch_size, X.shape[0])
        xb = torch.from_numpy(np.ascontiguousarray(X[start:end], dtype=np.float32)).to(device)
        recon, _ = model(xb)
        errors[start:end] = ((recon - xb) ** 2).mean(dim=1).cpu().numpy()
    return errors


def centroid_distance(X, X_ref):
    return np.linalg.norm(X - X_ref.mean(axis=0, keepdims=True), axis=1)


def mahalanobis_distance(X, X_ref):
    """Ledoit-Wolf shrinkage: 165 features from a few thousand reference
    rows makes the plain sample covariance badly conditioned."""
    return np.sqrt(LedoitWolf().fit(X_ref).mahalanobis(X))


def licit_threshold_at_precision(scores, is_licit, target):
    """Lowest threshold t such that, among nodes with score >= t, the licit
    fraction is >= target -- i.e. clear as many nodes as possible while
    meeting the purity target. Only thresholds at the end of a tie group are
    eligible (a threshold can't split tied scores). None if unreachable."""
    scores = np.asarray(scores, dtype=np.float64)
    is_licit = np.asarray(is_licit, dtype=bool)
    order = np.argsort(-scores, kind="stable")
    s = scores[order]
    precision = np.cumsum(is_licit[order]) / np.arange(1, len(s) + 1)
    end_of_tie_group = np.r_[s[1:] != s[:-1], True]
    ok = np.nonzero((precision >= target) & end_of_tie_group)[0]
    if len(ok) == 0:
        return None
    return float(s[ok.max()])


def threshold_at_licit_coverage(scores, is_licit, coverage):
    """Highest threshold t such that score >= t clears at least `coverage` of
    the licit nodes. Picked on the evaluated set itself, so it is a matched
    operating point for comparing scores, not a deployable threshold. None if
    there are no licit nodes or coverage is outside (0, 1]."""
    licit = np.sort(np.asarray(scores, dtype=np.float64)[np.asarray(is_licit, dtype=bool)])[::-1]
    if len(licit) == 0 or not 0 < coverage <= 1:
        return None
    # tolerance so e.g. 0.07 * 100 = 7.000000000000001 doesn't round up to 8
    k = int(np.ceil(coverage * len(licit) - 1e-9))
    return float(licit[k - 1])


def clearance_metrics(scores, is_licit, threshold):
    """What happens if every node with score >= threshold is cleared as
    licit: purity of the cleared set, share of licit cleared, and share of
    illicit wrongly cleared (leakage -- the number that matters in AML)."""
    scores = np.asarray(scores)
    is_licit = np.asarray(is_licit, dtype=bool)
    cleared = scores >= threshold
    n_licit, n_illicit = int(is_licit.sum()), int((~is_licit).sum())
    n_cleared = int(cleared.sum())
    leaked = int((cleared & ~is_licit).sum())
    return {
        "n_cleared": n_cleared,
        "licit_precision": float((cleared & is_licit).sum() / n_cleared) if n_cleared else None,
        "licit_coverage": float((cleared & is_licit).sum() / n_licit) if n_licit else None,
        "illicit_leakage": float(leaked / n_illicit) if n_illicit else None,
        "n_illicit_leaked": leaked,
        "n_illicit": n_illicit,
    }


def evaluate_score(scores, y, time_steps, calib_mask, test_mask,
                   targets=TARGET_PRECISIONS, shutdown_step=DARK_MARKET_STEP,
                   coverages=FIXED_COVERAGES):
    """Evaluate a "higher = more licit" score: ranking quality on test,
    clearance at thresholds chosen on the calibration window, and leakage at
    a fixed share of test licit cleared (so scores are compared at the same
    coverage, not at whatever coverage their calibrated threshold lands on)."""
    is_licit = y == 0
    st, lt = scores[test_mask], is_licit[test_mask]
    per_step = auc_by_time_step(scores, is_licit.astype(int), time_steps, test_mask)
    out = {
        "test_roc_auc_licit": float(roc_auc_score(lt, st)),
        "test_pr_auc_licit": float(average_precision_score(lt, st)),
        "test_pr_auc_illicit": float(average_precision_score(~lt, -st)),
        "per_step_auc": per_step,
        "per_step_summary": summarize(per_step),
        "clearance": {},
        "fixed_coverage": {},
    }
    pre = test_mask & (time_steps < shutdown_step)
    post = test_mask & (time_steps >= shutdown_step)
    for coverage in coverages:
        thr = threshold_at_licit_coverage(st, lt, coverage)
        out["fixed_coverage"][str(coverage)] = None if thr is None else {
            "threshold": thr,
            "test": clearance_metrics(st, lt, thr),
            "test_pre_shutdown": clearance_metrics(scores[pre], is_licit[pre], thr),
            "test_post_shutdown": clearance_metrics(scores[post], is_licit[post], thr),
        }
    for target in targets:
        thr = licit_threshold_at_precision(scores[calib_mask], is_licit[calib_mask], target)
        if thr is None:
            out["clearance"][str(target)] = None
            continue
        out["clearance"][str(target)] = {
            "threshold": thr,
            "calib": clearance_metrics(scores[calib_mask], is_licit[calib_mask], thr),
            "test": clearance_metrics(st, lt, thr),
            "test_pre_shutdown": clearance_metrics(scores[pre], is_licit[pre], thr),
            "test_post_shutdown": clearance_metrics(scores[post], is_licit[post], thr),
        }
    return out


def unlabeled_clearance_breakdown(cleared, co_label, flag):
    """For unlabeled nodes: how many this score clears as licit, and how
    that splits against co_label.py's XGBoost+GNN verdict (flag '*' =
    the two models disagreed)."""
    cleared = np.asarray(cleared, dtype=bool)
    disagree = np.asarray(flag) == "*"
    both_licit = (np.asarray(co_label) == 0) & ~disagree
    both_illicit = (np.asarray(co_label) == 1) & ~disagree
    n_cleared = int(cleared.sum())
    return {
        "n_unlabeled": int(len(cleared)),
        "n_cleared": n_cleared,
        "frac_cleared": float(n_cleared / len(cleared)) if len(cleared) else None,
        "cleared_and_both_models_licit": int((cleared & both_licit).sum()),
        "cleared_but_models_disagree": int((cleared & disagree).sum()),
        "cleared_but_both_models_illicit": int((cleared & both_illicit).sum()),
        "frac_of_cleared_in_three_way_agreement":
            float((cleared & both_licit).sum() / n_cleared) if n_cleared else None,
        "n_both_models_licit": int(both_licit.sum()),
    }


def load_co_labels(path, tx_ids):
    """co_label.py's output aligned to `tx_ids` order, or None if absent."""
    if path is None or not os.path.exists(path):
        return None
    co = pd.read_csv(path, dtype={"flag": str}, keep_default_na=False)
    aligned = pd.DataFrame({"txId": tx_ids}).merge(co, on="txId", how="left", validate="one_to_one")
    if aligned["co_label"].isna().any():
        raise ValueError(f"{path} is missing {int(aligned['co_label'].isna().sum())} nodes")
    return aligned


def licit_ae_scores(ckpt_path, X_gnn, device, batch_size):
    if ckpt_path is None or not os.path.exists(ckpt_path):
        return None
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    model = SparseAutoencoder(X_gnn.shape[1]).to(device)
    model.load_state_dict(ckpt["model_state"])
    X = apply_scaler(X_gnn, ckpt["center"], ckpt["scale"], clip=10.0)
    return reconstruction_errors(model, X, device, batch_size)


def _fit_and_score(X_scaled, fit_mask, device, args):
    X_fit_all = X_scaled[fit_mask]
    fit_idx, val_idx = split_fit_val(len(X_fit_all), args["val_frac"], args["seed"])
    model, train_info = train(X_fit_all[fit_idx], X_fit_all[val_idx], device,
                              epochs=args["epochs"], hidden=args["hidden"],
                              bottleneck=args["bottleneck"],
                              sparsity_weight=args["sparsity_weight"], lr=args["lr"],
                              seed=args["seed"])
    errors = reconstruction_errors(model, X_scaled, device, args["batch_size"])
    return model, train_info, errors


def run(epochs=2000, sparsity_weight=1e-3, hidden=64, bottleneck=16, lr=1e-3, val_frac=0.1,
        seed=0, batch_size=8192, reserve_mb=2048, force_cpu=False, co_label_csv=CO_LABEL_CSV,
        licit_ae_ckpt=LICIT_AE_CKPT_PATH, dataset=None, save=True):
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = dataset or get_dataset()
    time_steps = df["time_step"].to_numpy()
    unlabeled = y == -1
    fit_mask, calib_mask = build_masks(time_steps, y, train_mask)
    assert (y[fit_mask] == 1).all(), "fit set must be illicit-only"
    print(f"fit (illicit, steps <= {FIT_MAX_STEP}): {fit_mask.sum()} | "
          f"calib (labeled, steps {FIT_MAX_STEP + 1}-34): {calib_mask.sum()} | "
          f"test: {test_mask.sum()} | unlabeled: {unlabeled.sum()}")

    # Same scaler fit as sparse_autoencoder.py, so the training class is the
    # only thing that differs from the licit-trained run.
    center, scale = fit_scaler(X_gnn[train_mask])
    X_scaled = apply_scaler(X_gnn, center, scale, clip=10.0)

    required = estimate_vram_mb(int(fit_mask.sum()), X_gnn.shape[1], batch_size, hidden, bottleneck)
    device, device_info = select_device(required, reserve_mb=reserve_mb, force_cpu=force_cpu)
    print(f"[device] {device_info}")

    args = {"epochs": epochs, "hidden": hidden, "bottleneck": bottleneck,
            "sparsity_weight": sparsity_weight, "lr": lr, "val_frac": val_frac,
            "seed": seed, "batch_size": batch_size}
    try:
        model, train_info, errors = _fit_and_score(X_scaled, fit_mask, device, args)
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        print("[device] CUDA OOM under the memory cap, rerunning on CPU")
        device = torch.device("cpu")
        device_info = {**device_info, "device": "cpu", "reason": "cuda OOM fallback"}
        model, train_info, errors = _fit_and_score(X_scaled, fit_mask, device, args)
    if device.type == "cuda":
        device_info["peak_allocated_mb"] = round(torch.cuda.max_memory_allocated() / 2**20, 1)
    print(f"[train] {train_info}")

    X_ref = X_scaled[fit_mask]
    scores = {
        "illicit_ae": errors.astype(np.float64),
        "illicit_centroid": centroid_distance(X_scaled, X_ref),
        "illicit_mahalanobis": mahalanobis_distance(X_scaled, X_ref),
        "l2_norm": np.linalg.norm(X_scaled, axis=1),
    }
    notes = {}
    licit_ae = licit_ae_scores(licit_ae_ckpt, X_gnn, device, batch_size)
    if licit_ae is not None:
        scores["licit_ae"] = licit_ae.astype(np.float64)
        notes["licit_ae"] = "trained on licit steps 1-34: calib window is in-sample"
    co = load_co_labels(co_label_csv, df["txId"].to_numpy())
    if co is not None:
        scores["xgb"] = 1.0 - co["xgb_confidence"].to_numpy(dtype=np.float64)
        scores["gnn"] = 1.0 - co["gnn_confidence"].to_numpy(dtype=np.float64)
        notes["xgb"] = notes["gnn"] = "supervised on steps 1-34: calib window is in-sample"

    results = {"device": device_info, "train": train_info, "params": args,
               "split_sizes": {"fit_illicit": int(fit_mask.sum()), "calib": int(calib_mask.sum()),
                               "test": int(test_mask.sum()), "unlabeled": int(unlabeled.sum())},
               "notes": notes, "scores": {}}
    for name, s in scores.items():
        results["scores"][name] = evaluate_score(s, y, time_steps, calib_mask, test_mask)

    if co is not None:
        unl = {}
        for target, c in results["scores"]["illicit_ae"]["clearance"].items():
            if c is not None:
                unl[target] = unlabeled_clearance_breakdown(
                    scores["illicit_ae"][unlabeled] >= c["threshold"],
                    co["co_label"].to_numpy()[unlabeled], co["flag"].to_numpy()[unlabeled])
        results["illicit_ae_unlabeled"] = unl

    print(f"\n{'score':<22}{'ROC-AUC':>9}{'PR-AUC(ill)':>12}{'steps>0.5':>10}"
          f"{'leak@99%':>10}{'pre43':>8}{'post43':>8}{'cover':>8}")
    def fmt(v):
        return f"{v:.3f}" if v is not None else "  n/a"

    for name, r in results["scores"].items():
        c = r["clearance"].get(str(TARGET_PRECISIONS[0]))
        leak = fmt(c["test"]["illicit_leakage"]) if c else "  n/a"
        pre = fmt(c["test_pre_shutdown"]["illicit_leakage"]) if c else "  n/a"
        post = fmt(c["test_post_shutdown"]["illicit_leakage"]) if c else "  n/a"
        cover = fmt(c["test"]["licit_coverage"]) if c else "  n/a"
        frac = r["per_step_summary"]["frac_above_half"]
        print(f"{name:<22}{r['test_roc_auc_licit']:>9.4f}{r['test_pr_auc_illicit']:>12.4f}"
              f"{fmt(frac):>10}{leak:>10}{pre:>8}{post:>8}{cover:>8}")

    print("\nillicit leak at matched test licit coverage (all / pre43 / post43)")
    print(f"{'score':<22}" + "".join(f"{f'@{c:.0%}':>22}" for c in FIXED_COVERAGES))
    for name, r in results["scores"].items():
        cells = []
        for c in FIXED_COVERAGES:
            m = r["fixed_coverage"].get(str(c))
            cells.append("n/a" if m is None else " / ".join(
                fmt(m[k]["illicit_leakage"])
                for k in ("test", "test_pre_shutdown", "test_post_shutdown")))
        print(f"{name:<22}" + "".join(f"{cell:>22}" for cell in cells))
    for target, u in results.get("illicit_ae_unlabeled", {}).items():
        print(f"[unlabeled @{target}] {u}")

    if save:
        os.makedirs(CKPT_DIR, exist_ok=True)
        os.makedirs(RESULTS_DIR, exist_ok=True)
        torch.save({"model_state": model.state_dict(), "center": center, "scale": scale,
                    "params": args, "train": train_info}, CKPT_PATH)
        pd.DataFrame({"txId": df["txId"].to_numpy(), "time_step": time_steps,
                      "original_label": y, "illicit_ae_error": errors}).to_csv(
            os.path.join(RESULTS_DIR, "illicit_autoencoder_scores.csv"), index=False)
        with open(os.path.join(RESULTS_DIR, "illicit_autoencoder.json"), "w") as f:
            json.dump(results, f, indent=2)
        print(f"[saved] {CKPT_PATH}, results/illicit_autoencoder.json, "
              f"results/illicit_autoencoder_scores.csv")
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=2000)
    parser.add_argument("--sparsity-weight", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--reserve-mb", type=int, default=2048,
                        help="VRAM to leave free for other jobs on the GPU")
    parser.add_argument("--cpu", action="store_true", help="skip the GPU entirely")
    parser.add_argument("--co-label-csv", default=CO_LABEL_CSV)
    a = parser.parse_args()
    run(epochs=a.epochs, sparsity_weight=a.sparsity_weight, seed=a.seed,
        reserve_mb=a.reserve_mb, force_cpu=a.cpu, co_label_csv=a.co_label_csv)
