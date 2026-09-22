"""Benchmark: single-row vs. batched writes through the live-ingestion
endpoint (src/vigilia/api/v1/routers/ingest.py), at a few fixed
(non-drifting) rates, to answer docs/BENCHMARK.md's open
sustained-rate/batching question directly.

Requires the API server running (`uv run uvicorn vigilia.api.main:app
--port 8000`) and Memgraph up. Uses synthetic txIds namespaced
`bench-<run_id>-<n>`, same convention as generate_synthetic_stream.py.

Usage:
    uv run python scripts/benchmark_ingest_endpoint.py
"""

import time

import httpx

BASE_URL = "http://localhost:8000"
N_ROWS = 2000
BATCH_SIZES = [1, 10, 50, 200]  # 1 == the single-row endpoint


def run_single_row(client: httpx.Client, run_id: str, n: int) -> float:
    t0 = time.perf_counter()
    for i in range(n):
        resp = client.post(
            f"{BASE_URL}/v1/ingest/transaction",
            json={"tx_id": f"bench-{run_id}-{i}", "tx_class": "unknown"},
        )
        resp.raise_for_status()
    return time.perf_counter() - t0


def run_batched(client: httpx.Client, run_id: str, n: int, batch_size: int) -> float:
    t0 = time.perf_counter()
    for start in range(0, n, batch_size):
        batch = [
            {"tx_id": f"bench-{run_id}-{i}", "tx_class": "unknown"}
            for i in range(start, min(start + batch_size, n))
        ]
        resp = client.post(
            f"{BASE_URL}/v1/ingest/transaction/batch", json={"transactions": batch}
        )
        resp.raise_for_status()
    return time.perf_counter() - t0


def main() -> None:
    run_id = str(int(time.time()))
    print(f"Run ID: {run_id}. {N_ROWS} rows per test.")
    print(f"{'batch_size':>10} {'seconds':>10} {'rows/s':>12}")

    with httpx.Client(timeout=60.0) as client:
        for batch_size in BATCH_SIZES:
            sub_run_id = f"{run_id}-b{batch_size}"
            if batch_size == 1:
                seconds = run_single_row(client, sub_run_id, N_ROWS)
            else:
                seconds = run_batched(client, sub_run_id, N_ROWS, batch_size)
            rate = N_ROWS / seconds
            print(f"{batch_size:>10} {seconds:>10.2f} {rate:>12.1f}")


if __name__ == "__main__":
    main()
