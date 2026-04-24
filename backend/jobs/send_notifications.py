#!/usr/bin/env python3
"""Hourly notifications dispatcher.

Runs once an hour. For every user, asks the notification_service
whether it's digest-time *in the user's timezone* and dispatches as
appropriate. Per-user iteration is fine at v1 scale (single-school,
thousands of users at most) and simpler than a per-school batch.

Usage:
    python jobs/send_notifications.py
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

# Add backend root to path so imports work when run from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

import core.logging  # noqa: F401 — triggers basicConfig for standalone execution

from core.database import get_sb
from core.tables import USERS
from services import notification_service

log = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Hourly notifications dispatcher"
    )
    parser.add_argument(
        "--now",
        help="ISO-8601 UTC timestamp to run against (default: now). "
        "Use for testing specific firing hours without the wall clock.",
    )
    args = parser.parse_args()

    now_utc = (
        datetime.fromisoformat(args.now)
        if args.now
        else datetime.now(timezone.utc)
    )
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)

    log.info("Notifications cron tick at %s (UTC)", now_utc.isoformat())

    users = _fetch_users()
    log.info("Loaded %d users", len(users))

    sent_morning = 0
    sent_weekly = 0

    for user in users:
        try:
            local_date = notification_service.is_morning_digest_time(
                user, now_utc
            )
            if local_date:
                if notification_service.send_morning_digest(user, local_date):
                    sent_morning += 1
            week_start = notification_service.is_weekly_digest_time(
                user, now_utc
            )
            if week_start:
                if notification_service.send_weekly_digest(user, week_start):
                    sent_weekly += 1
        except Exception as e:
            # One broken user shouldn't stop the cron for everyone else.
            log.error(
                "notifications cron failed for user=%s: %s",
                user.get("id"),
                e,
                exc_info=True,
            )

    log.info(
        "Notifications cron done — morning=%d weekly=%d",
        sent_morning,
        sent_weekly,
    )


def _fetch_users() -> list[dict]:
    """Load (id, email, school) for every user with an email.

    The TZ + digest-composition pipeline filters further per user; this
    stays coarse on purpose so adding a new school is one constants.py
    edit, not a SQL change.
    """
    rows = (
        get_sb()
        .table(USERS)
        .select("id, email, school")
        .not_.is_("email", "null")
        .execute()
    ).data or []
    return rows


if __name__ == "__main__":
    main()
