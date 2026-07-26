#!/usr/bin/env python3
"""Compute one closed promoter payout period and emit an Interac CSV."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from services.poster_payout_service import run_period_payouts  # noqa: E402


def _parse_period(value: str) -> date:
    try:
        parsed = datetime.strptime(value, "%Y-%m")
    except ValueError as exc:
        raise argparse.ArgumentTypeError("period must use YYYY-MM") from exc
    return parsed.date().replace(day=1)


def _previous_month(now: datetime) -> date:
    first = now.date().replace(day=1)
    return (first - timedelta(days=1)).replace(day=1)


def main() -> int:
    now = datetime.now(timezone.utc)
    parser = argparse.ArgumentParser(
        description="Compute promoter poster payouts for one closed UTC month"
    )
    parser.add_argument("--period", type=_parse_period, default=_previous_month(now))
    parser.add_argument(
        "--output",
        type=Path,
        help="CSV output path. Defaults to poster-payouts-YYYY-MM.csv.",
    )
    args = parser.parse_args()
    output = args.output or Path(f"poster-payouts-{args.period:%Y-%m}.csv")
    result = run_period_payouts(args.period, output_path=output, now=now)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
