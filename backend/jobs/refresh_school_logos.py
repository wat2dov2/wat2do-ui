#!/usr/bin/env python3
"""Rebuild every busy school's wat2do logo from its newest event posters.

Schools under the control box event minimum are cleared back to the standard
logo. The weekly GitHub workflow runs this; it is safe to rerun by hand.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from services.school_logo_service import refresh_school_poster_logos  # noqa: E402


def main() -> int:
    results = refresh_school_poster_logos()
    for result in results:
        print(json.dumps(asdict(result), sort_keys=True))
    # Every school is attempted; a failure still fails the run so it gets noticed.
    return 1 if any(result.outcome == "failed" for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
