#!/usr/bin/env python3
"""Process exact Instagram posts from a forwarded Android notification."""

from __future__ import annotations

import json
import logging
import os
import sys
import urllib.parse
from dataclasses import dataclass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

import core.logging  # noqa: F401, E402
from jobs.scrape import run  # noqa: E402
from schemas.school import validate_recipient_id  # noqa: E402
from services import school_service  # noqa: E402
from services.instagram_notifications.browser_digest import (  # noqa: E402
    BrowserDigestError,
    BrowserInstagramDigestResolver,
    digest_media_count_shortfall,
)
from services.instagram_notifications.ledger import (  # noqa: E402
    MaterializedMedia,
    MediaClaim,
    claim_next_notification_media,
    mark_media_failed,
    mark_media_succeeded,
    record_notification_media,
)

log = logging.getLogger(__name__)

_IG_ACTION_KEY = "com.instagram.android.igns.logging.ig_action"
_PUSH_CATEGORY_KEY = "com.instagram.android.igns.logging.push_category"
_PUSH_ID_KEY = "com.instagram.android.igns.logging.push_id"
_RECIPIENT_ID_KEY = "com.instagram.android.igns.logging.intended_recipient_id"
_MEDIA_QUERY_KEYS = ("media_list", "media_id")
_CACHE_ID_KEY = "cache_ent_id"
_TOTAL_MEDIA_COUNT_KEY = "total_non_mmc_media_count"
_ACTIONABLE_CATEGORIES = frozenset({"post", "subscription_daily_digest"})
_ACTIONABLE_ACTION_PATH = "clips_home"


class NotificationPayloadError(ValueError):
    """Raised when a post notification contains invalid processing metadata."""


@dataclass(frozen=True)
class ParsedNotification:
    action_path: str
    explicit_media: tuple[MaterializedMedia, ...]
    cache_ent_id: str | None
    total_media_count: int | None


def get_shortcode_from_media_id(media_id: int) -> str:
    """Convert a numeric Instagram media ID to its base64 shortcode."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    shortcode = ""
    while media_id > 0:
        media_id, remainder = divmod(media_id, 64)
        shortcode = alphabet[remainder] + shortcode
    return shortcode


def _media_target(media_id: str) -> MaterializedMedia:
    numeric_media_id = int(media_id)
    return MaterializedMedia(
        media_id=media_id,
        source_url=(
            f"https://www.instagram.com/p/{get_shortcode_from_media_id(numeric_media_id)}/"
        ),
    )


def _action_query(payload: dict[str, object]) -> tuple[str, dict[str, list[str]]]:
    action = payload.get(_IG_ACTION_KEY, "")
    if not isinstance(action, str):
        raise NotificationPayloadError("Notification action must be a string.")

    action_path, separator, query_string = action.partition("?")
    query = urllib.parse.parse_qs(query_string, keep_blank_values=True) if separator else {}
    return action_path, query


def _metadata_value(
    payload: dict[str, object],
    query: dict[str, list[str]],
    key: str,
) -> str | None:
    values: list[str] = []
    for value in query.get(key, []):
        normalized = value.strip()
        if not normalized:
            raise NotificationPayloadError(f"Notification {key} cannot be empty.")
        values.append(normalized)

    if key in payload:
        payload_value = payload[key]
        if isinstance(payload_value, bool) or not isinstance(payload_value, (str, int)):
            raise NotificationPayloadError(f"Notification {key} has an invalid type.")
        normalized = str(payload_value).strip()
        if not normalized:
            raise NotificationPayloadError(f"Notification {key} cannot be empty.")
        values.append(normalized)

    if not values:
        return None
    if any(value != values[0] for value in values[1:]):
        raise NotificationPayloadError(f"Notification {key} values conflict.")
    return values[0]


def _parse_media_id(raw_media_id: object) -> str:
    if isinstance(raw_media_id, bool) or not isinstance(raw_media_id, (str, int)):
        raise NotificationPayloadError("Notification contains an invalid media ID.")
    media_id = str(raw_media_id).strip().split("_", 1)[0]
    if not media_id.isascii() or not media_id.isdigit() or int(media_id) <= 0:
        raise NotificationPayloadError("Notification contains an invalid media ID.")
    if len(media_id) > 32 or str(int(media_id)) != media_id:
        raise NotificationPayloadError("Notification contains an invalid media ID.")
    return media_id


def _parse_notification(payload: dict[str, object]) -> ParsedNotification:
    action_path, query = _action_query(payload)
    raw_media_ids: list[str] = []
    for key in _MEDIA_QUERY_KEYS:
        for value in query.get(key, []):
            raw_media_ids.extend(value.split(","))

    explicit_media: dict[str, MaterializedMedia] = {}
    for raw_media_id in raw_media_ids:
        media_id = _parse_media_id(raw_media_id)
        explicit_media.setdefault(media_id, _media_target(media_id))

    cache_ent_id = _metadata_value(payload, query, _CACHE_ID_KEY)
    if cache_ent_id is not None and len(cache_ent_id) > 255:
        raise NotificationPayloadError("Notification cache_ent_id is invalid.")
    total_count_value = _metadata_value(payload, query, _TOTAL_MEDIA_COUNT_KEY)
    total_media_count: int | None = None
    if total_count_value is not None:
        if not total_count_value.isascii() or not total_count_value.isdigit():
            raise NotificationPayloadError("Notification total_non_mmc_media_count is invalid.")
        total_media_count = int(total_count_value)

    return ParsedNotification(
        action_path=action_path,
        explicit_media=tuple(explicit_media.values()),
        cache_ent_id=cache_ent_id,
        total_media_count=total_media_count,
    )


def _required_payload_text(
    payload: dict[str, object],
    key: str,
    label: str,
    *,
    maximum_length: int,
) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum_length:
        raise NotificationPayloadError(f"Actionable notification requires a valid {label}.")
    return value.strip()


def _resolve_recipient(payload: dict[str, object]) -> str:
    intended_recipient_id = (os.getenv("INTENDED_RECIPIENT_ID") or "").strip()
    try:
        intended_recipient_id = validate_recipient_id(intended_recipient_id)
    except ValueError:
        raise NotificationPayloadError(
            "Actionable notification requires a valid intended recipient ID."
        ) from None

    payload_recipient = payload.get(_RECIPIENT_ID_KEY)
    if payload_recipient is not None:
        if (
            not isinstance(payload_recipient, str)
            or payload_recipient.strip() != intended_recipient_id
        ):
            raise NotificationPayloadError(
                "Notification intended recipient does not match workflow routing."
            )
    return intended_recipient_id


def _is_supported_category(payload: dict[str, object]) -> bool:
    category = payload.get(_PUSH_CATEGORY_KEY)
    return isinstance(category, str) and category in _ACTIONABLE_CATEGORIES


def _validate_actionable_notification(notification: ParsedNotification) -> None:
    if notification.action_path != _ACTIONABLE_ACTION_PATH:
        raise NotificationPayloadError(
            "Actionable notification has an unsupported Instagram action."
        )
    if not notification.explicit_media and notification.cache_ent_id is None:
        raise NotificationPayloadError(
            "Actionable notification contains no Instagram media identity."
        )


def _materialize_media(
    notification: ParsedNotification,
    intended_recipient_id: str,
    *,
    resolver: BrowserInstagramDigestResolver | None = None,
) -> list[MaterializedMedia]:
    materialized = {item.media_id: item for item in notification.explicit_media}
    shortfall = digest_media_count_shortfall(
        len(materialized),
        notification.total_media_count,
    )
    if notification.cache_ent_id is not None and shortfall:
        resolution = (resolver or BrowserInstagramDigestResolver()).resolve(
            intended_recipient_id,
            notification.cache_ent_id,
        )
        for raw_media_id in resolution.media_ids:
            media_id = _parse_media_id(raw_media_id)
            materialized.setdefault(media_id, _media_target(media_id))

        shortfall = digest_media_count_shortfall(
            len(materialized),
            notification.total_media_count,
        )
        log.info(
            "Expanded Instagram digest through %s to %d exact media target(s).",
            resolution.account_username,
            len(materialized),
        )

    if shortfall:
        log.warning(
            "Instagram returned %d of %d advertised media items; processing all "
            "media available from the terminal digest page.",
            len(materialized),
            notification.total_media_count,
        )
    return list(materialized.values())


def _process_claim(claim: MediaClaim, *, cutoff_days: int) -> int:
    try:
        status = run(
            targets=[claim.source_url],
            cutoff_days=cutoff_days,
            dry_run=False,
            allow_past_events=False,
        )
    except Exception:  # noqa: BLE001 - every claim must reach a terminal ledger state
        log.error("Exact Instagram media scrape raised an unexpected error.")
        status = 1
        failure_category = "scrape_exception"
    else:
        failure_category = "scrape_error"

    try:
        finalized = (
            mark_media_succeeded(
                media_row_id=claim.media_row_id,
                claim_token=claim.claim_token,
            )
            if status == 0
            else mark_media_failed(
                media_row_id=claim.media_row_id,
                claim_token=claim.claim_token,
                failure_category=failure_category,
            )
        )
    except Exception:  # noqa: BLE001 - never leak database details
        log.error("Instagram media ledger finalization failed.")
        finalized = False

    if not finalized:
        log.error("Instagram media claim was not finalized.")
    return 0 if status == 0 and finalized else 1


def _process_pending_media(
    notification_id: str,
    *,
    cutoff_days: int,
    github_run_id: str | None,
) -> tuple[int, int]:
    overall_status = 0
    processed_count = 0
    while True:
        try:
            claim = claim_next_notification_media(
                notification_id=notification_id,
                github_run_id=github_run_id,
            )
        except Exception:  # noqa: BLE001 - database details must stay out of logs
            log.error("Instagram notification ledger claim failed.")
            return 1, processed_count
        if claim is None:
            return overall_status, processed_count

        processed_count += 1
        overall_status = max(
            overall_status,
            _process_claim(claim, cutoff_days=cutoff_days),
        )


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

    if not _is_supported_category(payload):
        log.info("Ignoring unsupported Instagram notification.")
        return 0

    try:
        notification = _parse_notification(payload)
        _validate_actionable_notification(notification)
    except NotificationPayloadError as exc:
        log.error("%s", exc)
        return 1

    try:
        intended_recipient_id = _resolve_recipient(payload)
        push_id = _required_payload_text(
            payload,
            _PUSH_ID_KEY,
            "push ID",
            maximum_length=255,
        )
        push_category = _required_payload_text(
            payload,
            _PUSH_CATEGORY_KEY,
            "push category",
            maximum_length=100,
        )
        school = school_service.get_school_by_recipient_id(intended_recipient_id)
        if school is None:
            raise NotificationPayloadError(
                "No school mapping exists for the notification recipient."
            )
    except NotificationPayloadError as exc:
        log.error("%s", exc)
        return 1
    except Exception:  # noqa: BLE001 - do not expose database or upstream internals
        log.error("Instagram notification routing failed unexpectedly.")
        return 1

    try:
        media = _materialize_media(notification, intended_recipient_id)
    except (BrowserDigestError, NotificationPayloadError) as exc:
        log.error("%s", exc)
        return 1

    try:
        cutoff_days = int(os.getenv("CUTOFF_DAYS", "1"))
    except ValueError:
        log.error("CUTOFF_DAYS must be an integer.")
        return 1

    try:
        notification_id = record_notification_media(
            school_id=school.id,
            intended_recipient_id=intended_recipient_id,
            push_id=push_id,
            push_category=push_category,
            cache_ent_id=notification.cache_ent_id,
            total_non_mmc_media_count=notification.total_media_count,
            media=media,
        )
    except Exception:  # noqa: BLE001 - database details must not enter workflow output
        log.error("Instagram notification ledger recording failed.")
        return 1

    processing_status, processed_count = _process_pending_media(
        notification_id,
        cutoff_days=cutoff_days,
        github_run_id=(os.getenv("GITHUB_RUN_ID") or "").strip() or None,
    )
    if processed_count:
        log.info("Processed %d exact Instagram media target(s).", processed_count)
    else:
        log.info("No pending Instagram media remain for this notification.")
    return processing_status


if __name__ == "__main__":
    sys.exit(main())
