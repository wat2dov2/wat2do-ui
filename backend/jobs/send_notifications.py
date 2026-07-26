#!/usr/bin/env python3
"""Scheduled dispatcher for active notification email types."""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

import core.logging  # noqa: F401
from core.constants import (
    NOTIFICATION_TYPE_EVENT_REMINDER,
    NOTIFICATION_TYPE_MORNING_EMAIL,
)
from services.notifications.event_reminder import dispatch_event_reminders
from services.notifications.morning_email import dispatch_morning_emails

log = logging.getLogger(__name__)


def main() -> int:
    parser = argparse.ArgumentParser(description="Dispatch scheduled notification emails")
    parser.add_argument(
        "--notification",
        choices=(
            "all",
            NOTIFICATION_TYPE_MORNING_EMAIL,
            NOTIFICATION_TYPE_EVENT_REMINDER,
        ),
        default="all",
        help="Notification type to dispatch.",
    )
    parser.add_argument(
        "--now",
        help="Optional ISO-8601 UTC timestamp for deterministic manual runs.",
    )
    args = parser.parse_args()
    now_utc = datetime.fromisoformat(args.now) if args.now else datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)

    dispatchers = {
        NOTIFICATION_TYPE_MORNING_EMAIL: dispatch_morning_emails,
        NOTIFICATION_TYPE_EVENT_REMINDER: dispatch_event_reminders,
    }
    selected = tuple(dispatchers) if args.notification == "all" else (args.notification,)
    failed = False
    for notification_type in selected:
        log.info(
            "%s tick at %s",
            notification_type,
            now_utc.astimezone(timezone.utc).isoformat(),
        )
        stats = dispatchers[notification_type](now_utc)
        log.info("%s result: %s", notification_type, stats)
        failed = failed or stats["failed"] > 0
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
