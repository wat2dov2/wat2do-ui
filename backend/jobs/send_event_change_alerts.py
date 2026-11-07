#!/usr/bin/env python3
"""Email everyone going to an event whose changes have gone quiet, once.

``wat2do-api`` runs this from the backend directory for each authenticated
``POST /webhooks/event-change-alerts`` (the Mac's ``io.wat2do.event-change-alerts``
timer, every minute). The last line printed is ``{"sent": <emails sent>}``.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIRECTORY))

from services.notifications import event_change  # noqa: E402

# Runs every minute: only problems reach the API's log.
logging.basicConfig(level=logging.WARNING, stream=sys.stderr)


def main() -> int:
    print(json.dumps({"sent": event_change.send_due_alerts()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
