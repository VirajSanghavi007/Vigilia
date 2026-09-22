"""Benchmark: batch size, concurrency, and sustained throughput through
the live-ingestion endpoint (src/vigilia/api/v1/routers/ingest.py).

Three phases, run in order, each feeding the next:
1. Batch-size bisection — refines the coarse 1/10/50/200 sweep from the
   first run (which found a non-monotonic peak around 10) with a finer
   set around that peak.
2. Concurrency sweep at the winning batch size — tests whether
   concurrent HTTP requests actually help, or just hit the same
   transactional-mode write contention seen at the driver level
   (TransientError: "Cannot get read-only access to storage"). Not
   assumed either way — this is the whole point of testing it.
3. Sustained run at the winning (batch_size, concurrency) — a short
   burst isn't proof throughput holds; the bulk-load benchmark showed
   transactional-mode throughput can degrade as the graph grows, so
   this runs long enough to see a trend, not just a snapshot.

Requires the API server running (`uv run uvicorn vigilia.api.main:app
--port 8000`) and Memgraph up. Uses synthetic txIds namespaced
`bench-<run_id>-<n>`, same convention as generate_synthetic_stream.py.

Usage:
    uv run python scripts/benchmark_ingest_endpoint.py
"""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

BASE_URL = "http://localhost:8000"
N_ROWS_BISECT = 2000
BATCH_SIZES_TO_BISECT = [5, 8, 10, 12, 15, 20, 30]

N_ROWS_CONCURRENCY = 3000
CONCURRENCY_LEVELS = [1, 2, 4, 8, 16]

SUSTAINED_DURATION_S = 180
SUSTAINED_PROGRESS_EVERY_S = 15


def send_batch(client: httpx.Client, run_id: str, start: int, count: int) -> None:
    batch = [
        {"tx_id": f"bench-{run_id}-{i}", "tx_class": "unknown"}
        for i in range(start, start + count)
    ]
    resp = client.post(f"{BASE_URL}/v1/ingest/transaction/batch", json={"transactions": batch})
    resp.raise_for_status()


def phase1_bisect_batch_size() -> int:
    print("\n=== Phase 1: batch-size bisection ===")
    print(f"{'batch_size':>10} {'seconds':>10} {'rows/s':>12}")

    best_batch_size = None
    best_rate = 0.0

    with httpx.Client(timeout=60.0) as client:
        for batch_size in BATCH_SIZES_TO_BISECT:
            run_id = f"{int(time.time())}-p1b{batch_size}"
            t0 = time.perf_counter()
            for start in range(0, N_ROWS_BISECT, batch_size):
                count = min(batch_size, N_ROWS_BISECT - start)
                send_batch(client, run_id, start, count)
            seconds = time.perf_counter() - t0
            rate = N_ROWS_BISECT / seconds
            print(f"{batch_size:>10} {seconds:>10.2f} {rate:>12.1f}")
            if rate > best_rate:
                best_rate = rate
                best_batch_size = batch_size

    print(f"Best batch size: {best_batch_size} ({best_rate:.1f} rows/s)")
    return best_batch_size


def phase2_concurrency_sweep(batch_size: int) -> tuple[int, bool]:
    print(f"\n=== Phase 2: concurrency sweep (batch_size={batch_size}) ===")
    print(f"{'concurrency':>12} {'seconds':>10} {'rows/s':>12} {'errors':>8}")

    best_concurrency = 1
    best_rate = 0.0
    any_errors_at_best = False

    for concurrency in CONCURRENCY_LEVELS:
        run_id = f"{int(time.time())}-p2c{concurrency}"
        batches = list(range(0, N_ROWS_CONCURRENCY, batch_size))
        errors = 0

        client = httpx.Client(
            timeout=30.0,
            limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency),
        )
        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = {
                pool.submit(
                    send_batch, client, run_id, start, min(batch_size, N_ROWS_CONCURRENCY - start)
                ): start
                for start in batches
            }
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception:
                    errors += 1
        seconds = time.perf_counter() - t0
        client.close()

        rate = N_ROWS_CONCURRENCY / seconds
        print(f"{concurrency:>12} {seconds:>10.2f} {rate:>12.1f} {errors:>8}")

        if rate > best_rate and errors == 0:
            best_rate = rate
            best_concurrency = concurrency
            any_errors_at_best = False
        elif rate > best_rate and errors > 0:
            # note it but don't crown an error-producing config the winner
            pass

    print(f"Best concurrency (zero errors): {best_concurrency} ({best_rate:.1f} rows/s)")
    return best_concurrency, any_errors_at_best


def phase3_sustained_run(batch_size: int, concurrency: int) -> None:
    print(f"\n=== Phase 3: sustained run (batch_size={batch_size}, concurrency={concurrency}, "
          f"{SUSTAINED_DURATION_S}s) ===")
    print(f"{'elapsed_s':>10} {'rows_sent':>10} {'window_rate':>14} {'cum_rate':>10} {'errors':>8}")

    run_id = f"{int(time.time())}-p3"
    client = httpx.Client(
        timeout=30.0,
        limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency),
    )

    total_sent = 0
    total_errors = 0
    start_index = 0
    t_start = time.perf_counter()
    t_last_report = t_start
    rows_since_last_report = 0

    try:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            in_flight = set()

            def submit_one():
                nonlocal start_index
                fut = pool.submit(send_batch, client, run_id, start_index, batch_size)
                start_index += batch_size
                in_flight.add(fut)

            for _ in range(concurrency):
                submit_one()

            while time.perf_counter() - t_start < SUSTAINED_DURATION_S:
                done = {f for f in in_flight if f.done()}
                for f in done:
                    in_flight.discard(f)
                    try:
                        f.result()
                        total_sent += batch_size
                        rows_since_last_report += batch_size
                    except Exception:
                        total_errors += 1
                    submit_one()

                now = time.perf_counter()
                if now - t_last_report >= SUSTAINED_PROGRESS_EVERY_S:
                    window_rate = rows_since_last_report / (now - t_last_report)
                    cum_rate = total_sent / (now - t_start)
                    print(
                        f"{now - t_start:>10.1f} {total_sent:>10} {window_rate:>12.1f}/s "
                        f"{cum_rate:>8.1f}/s {total_errors:>8}"
                    )
                    t_last_report = now
                    rows_since_last_report = 0

                time.sleep(0.05)
    finally:
        client.close()

    total_seconds = time.perf_counter() - t_start
    print("\n--- Sustained run summary ---")
    print(f"Total: {total_sent} rows in {total_seconds:.1f}s = {total_sent / total_seconds:.1f} rows/s")
    print(f"Errors: {total_errors}")


def main() -> None:
    best_batch_size = phase1_bisect_batch_size()
    best_concurrency, _ = phase2_concurrency_sweep(best_batch_size)
    phase3_sustained_run(best_batch_size, best_concurrency)


if __name__ == "__main__":
    main()
