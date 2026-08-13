#!/usr/bin/env python3
"""Wrapper to process raw Instagram push notification dictionaries.

Extracts media IDs or usernames from the JSON payload and calls `scrape.run()`
for each extracted target.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

import core.logging  # noqa: F401, E402
from jobs.scrape import run  # noqa: E402

log = logging.getLogger(__name__)


def get_shortcode_from_media_id(media_id: int) -> str:
    """Convert a numeric Instagram media ID to its base64 shortcode."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    shortcode = ""
    while media_id > 0:
        media_id, remainder = divmod(media_id, 64)
        shortcode = alphabet[remainder] + shortcode
    return shortcode


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    payload_str = os.getenv("NOTIFICATION_JSON", "").strip()
    if not payload_str:
        log.error("NOTIFICATION_JSON environment variable is empty or not set.")
        return 1

    try:
        payload = json.loads(payload_str)
    except json.JSONDecodeError as exc:
        log.error("Failed to decode NOTIFICATION_JSON: %s", exc)
        return 1

    targets = []

    # 1. Look for media_list or media_id in ig_action
    ig_action = payload.get("com.instagram.android.igns.logging.ig_action", "")
    if ig_action:
        # Some URLs might lack a schema, parsing query params from paths can be tricky
        # if the URL is just 'clips_home?media_list=...'
        if "?" in ig_action:
            query_string = ig_action.split("?", 1)[1]
            qs = urllib.parse.parse_qs(query_string)
            media_list_str = qs.get("media_list", [None])[0]
            media_id_str = qs.get("media_id", [None])[0]

            if media_list_str:
                for m_id in media_list_str.split(","):
                    try:
                        shortcode = get_shortcode_from_media_id(int(m_id.strip()))
                        targets.append(f"https://www.instagram.com/p/{shortcode}/")
                    except ValueError:
                        log.warning("Invalid media_id in media_list: %s", m_id)
            elif media_id_str:
                try:
                    shortcode = get_shortcode_from_media_id(int(media_id_str.strip()))
                    targets.append(f"https://www.instagram.com/p/{shortcode}/")
                except ValueError:
                    log.warning("Invalid media_id: %s", media_id_str)

    if not targets:
        log.error(
            "No media IDs found in payload. Full notification payload: %s",
            json.dumps(payload),
        )
        return 1  # Error out the GitHub action


    # Deduplicate and keep order
    seen = set()
    unique_targets = []
    for t in targets:
        if t not in seen:
            seen.add(t)
            unique_targets.append(t)

    cutoff_days = int(os.getenv("CUTOFF_DAYS", "1"))

    # Process each target
    overall_status = 0
    for target in unique_targets:
        log.info("Dispatching scrape run for target: %s", target)
        status = run(
            username=target,
            cutoff_days=cutoff_days,
            dry_run=False,
            allow_past_events=False,
        )
        if status != 0:
            overall_status = status

    return overall_status


if __name__ == "__main__":
    sys.exit(main())
