#!/usr/bin/env python3
"""Hourly batched morning-email dispatcher."""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

import core.logging  # noqa: F401
from services.notifications.morning_email import dispatch_morning_emails

log = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="Dispatch local 9 AM morning emails")
    parser.add_argument(
        "--now",
        help="Optional ISO-8601 UTC timestamp for deterministic manual runs.",
    )
    args = parser.parse_args()
    now_utc = datetime.fromisoformat(args.now) if args.now else datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)

    log.info("Morning email tick at %s", now_utc.astimezone(timezone.utc).isoformat())
    dispatch_morning_emails(now_utc)


if __name__ == "__main__":
    main()
