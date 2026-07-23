#!/usr/bin/env python3
"""Generate daily Instagram carousel drafts for configured campus accounts."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.instagram_publishing import generate_due_batches  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Generate outside the configured local hour.",
    )
    args = parser.parse_args()
    stats = generate_due_batches(datetime.now(timezone.utc), force=args.force)
    print(json.dumps(stats, sort_keys=True))
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
