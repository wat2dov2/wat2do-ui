#!/usr/bin/env python3
"""Process exact Instagram posts from a forwarded Android notification."""

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

_IG_ACTION_KEY = "com.instagram.android.igns.logging.ig_action"
_PUSH_CATEGORY_KEY = "com.instagram.android.igns.logging.push_category"
_MEDIA_QUERY_KEYS = ("media_list", "media_id")
_DIGEST_QUERY_KEYS = ("cache_ent_id", "total_non_mmc_media_count")


class NotificationPayloadError(ValueError):
    """Raised when a post notification contains invalid processing metadata."""


def get_shortcode_from_media_id(media_id: int) -> str:
    """Convert a numeric Instagram media ID to its base64 shortcode."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    shortcode = ""
    while media_id > 0:
        media_id, remainder = divmod(media_id, 64)
        shortcode = alphabet[remainder] + shortcode
    return shortcode


def _action_query(payload: dict[str, object]) -> tuple[str, dict[str, list[str]]]:
    action = payload.get(_IG_ACTION_KEY, "")
    if not isinstance(action, str):
        raise NotificationPayloadError("Notification action must be a string.")

    action_path, separator, query_string = action.partition("?")
    query = urllib.parse.parse_qs(query_string, keep_blank_values=True) if separator else {}
    return action_path, query


def _notification_targets(payload: dict[str, object]) -> tuple[str, list[str]]:
    action_path, query = _action_query(payload)
    raw_media_ids: list[str] = []
    for key in _MEDIA_QUERY_KEYS:
        for value in query.get(key, []):
            raw_media_ids.extend(value.split(","))

    if not raw_media_ids:
        has_digest_metadata = any(key in query or key in payload for key in _DIGEST_QUERY_KEYS)
        if has_digest_metadata:
            raise NotificationPayloadError(
                "Instagram digest notification did not expose materialized media IDs."
            )
        return action_path, []

    media_ids: list[int] = []
    seen: set[int] = set()
    for raw_media_id in raw_media_ids:
        base_media_id = raw_media_id.strip().split("_", 1)[0]
        if not base_media_id.isdigit() or int(base_media_id) <= 0:
            raise NotificationPayloadError("Notification contains an invalid media ID.")
        media_id = int(base_media_id)
        if media_id not in seen:
            seen.add(media_id)
            media_ids.append(media_id)

    return action_path, [
        f"https://www.instagram.com/p/{get_shortcode_from_media_id(media_id)}/"
        for media_id in media_ids
    ]


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

    if not isinstance(payload, dict):
        log.error("NOTIFICATION_JSON must contain a JSON object.")
        return 1

    try:
        action_path, targets = _notification_targets(payload)
    except NotificationPayloadError as exc:
        log.error("%s", exc)
        return 1

    if not targets:
        category = payload.get(_PUSH_CATEGORY_KEY)
        log.info(
            "Ignoring unsupported Instagram notification category=%r action=%r",
            category if isinstance(category, str) else None,
            action_path,
        )
        return 0

    cutoff_days = int(os.getenv("CUTOFF_DAYS", "1"))

    # Process all targets in a single batch
    log.info("Dispatching scrape run for %d exact post target(s)", len(targets))
    overall_status = run(
        targets=targets,
        cutoff_days=cutoff_days,
        dry_run=False,
        allow_past_events=False,
    )

    return overall_status


if __name__ == "__main__":
    sys.exit(main())
