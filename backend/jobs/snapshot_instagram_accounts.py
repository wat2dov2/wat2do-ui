#!/usr/bin/env python3
"""Refresh expiring Instagram tokens, then read every account's followers and recent posts.

Runs daily from ``.github/workflows/instagram-account-stats.yml``, which holds the
production token encryption key; the admin social dashboard reads what it writes.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from services.instagram_publishing import refresh_expiring_tokens  # noqa: E402
from services.instagram_publishing.stats import snapshot_accounts  # noqa: E402

logging.basicConfig(level=logging.INFO)


def main() -> int:
    tokens = refresh_expiring_tokens()
    accounts = snapshot_accounts()
    print(json.dumps({"tokens": tokens, "accounts": accounts}, sort_keys=True))
    return 1 if tokens["failed"] or accounts.get("failed") else 0


if __name__ == "__main__":
    raise SystemExit(main())
