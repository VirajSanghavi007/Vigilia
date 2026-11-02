import json
import os
import time

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    f1_score,
    roc_auc_score,
)

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(RESULTS_DIR, exist_ok=True)


def compute_metrics(y_true, y_prob, threshold=0.5):
    y_pred = (y_prob >= threshold).astype(int)
    return {
        "roc_auc": float(roc_auc_score(y_true, y_prob)),
        "roc_pr_auc": float(average_precision_score(y_true, y_prob)),
        "f1": float(f1_score(y_true, y_pred)),
        "classification_report": classification_report(y_true, y_pred, digits=4),
    }


def save_result(name, metrics, extra=None, train_seconds=None):
    rec = dict(metrics)
    rec["model"] = name
    rec["train_seconds"] = train_seconds
    if extra:
        rec.update(extra)
    path = os.path.join(RESULTS_DIR, f"{name}.json")
    with open(path, "w") as f:
        json.dump(rec, f, indent=2)
    print(f"[saved] {path}")
    return rec


def load_all_results():
    out = {}
    for fn in os.listdir(RESULTS_DIR):
        if fn.endswith(".json"):
            with open(os.path.join(RESULTS_DIR, fn)) as f:
                out[fn[:-5]] = json.load(f)
    return out


class Progress:
    def __init__(self, total, label, every=5):
        self.total = total
        self.label = label
        self.every_n = max(1, total * every // 100)
        self.start = time.time()
        self.done = 0

    def update(self, n=1):
        self.done += n
        if self.done % self.every_n == 0 or self.done == self.total:
            elapsed = time.time() - self.start
            rate = self.done / elapsed if elapsed > 0 else 0
            remaining = (self.total - self.done) / rate if rate > 0 else 0
            pct = 100 * self.done / self.total
            print(f"[{self.label}] {self.done}/{self.total} ({pct:.1f}%) "
                  f"elapsed={elapsed:.1f}s eta={remaining:.1f}s")
