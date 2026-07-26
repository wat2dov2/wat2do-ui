#!/usr/bin/env python3
"""Generate daily Instagram carousel drafts for configured campus accounts."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.instagram_publishing import (  # noqa: E402
    generate_due_batches,
    refresh_expiring_tokens,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


def main() -> int:
    now = datetime.now(timezone.utc)
    refresh_stats = refresh_expiring_tokens(now)
    generation_stats = generate_due_batches(now)
    print(
        json.dumps(
            {
                "generation": generation_stats,
                "token_refresh": refresh_stats,
            },
            sort_keys=True,
        )
    )
    return 1 if refresh_stats["failed"] or generation_stats["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
