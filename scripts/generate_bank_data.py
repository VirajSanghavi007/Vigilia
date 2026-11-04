"""Generate the synthetic bank dataset (see docs/SYNTHETIC_DATA.md).

    python scripts/generate_bank_data.py --preset dev --seed 7 --out data/synthetic/dev-7

Re-running the same command after an interruption resumes from the finished
shards. Validation (leakage gate, typology fidelity, distribution report)
runs afterwards unless --skip-validation is given; a failed leakage gate
exits with status 2.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from vigilia.ml.synthetic.config import PRESETS, get_preset  # noqa: E402
from vigilia.ml.synthetic.generate import generate  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preset", choices=sorted(PRESETS), default="dev")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--workers", type=int, default=None, help="default: min(22, shards, cores)")
    ap.add_argument("--skip-validation", action="store_true")
    args = ap.parse_args(argv)

    cfg = get_preset(args.preset)
    generate(cfg, args.seed, args.out, workers=args.workers, progress=lambda m: print(m, flush=True))
    if args.skip_validation:
        return 0
    from vigilia.ml.synthetic.validate import validate

    result = validate(args.out, progress=lambda m: print(m, flush=True))
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    sys.exit(main())
