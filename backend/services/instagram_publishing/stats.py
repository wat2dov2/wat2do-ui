"""Every publishing account's followers and recent posts, read once a day from the Graph API.

The daily GitHub workflow (``jobs/snapshot_instagram_accounts.py``) is the one
place outside the API that holds the token key, so it writes a follower
snapshot per account per day and replaces each account's newest posts. The
admin's social dashboard then reads every account at once from these tables
(``rust/src/api/routes/instagram_publishing/accounts.rs``).
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from core.controlbox import controlbox
from core.database import get_sb
from core.tables import (
    INSTAGRAM_ACCOUNT_MEDIA,
    INSTAGRAM_ACCOUNT_SNAPSHOTS,
    INSTAGRAM_PUBLISHING_ACCOUNTS,
)
from services.instagram_publishing.credentials import load_account_credentials
from services.instagram_publishing.meta import MetaInstagramClient

log = logging.getLogger(__name__)
_CONTROL = controlbox.instagram_publishing


def snapshot_accounts(now_utc: datetime | None = None) -> dict[str, int]:
    """Read every account that still has a working token; one failure never stops the rest."""
    now = (now_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
    rows = (
        get_sb()
        .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
        .select("account_key")
        .eq("requires_reauthorization", False)
        .order("account_key")
        .execute()
    ).data or []
    outcomes: Counter[str] = Counter()
    for row in rows:
        try:
            snapshot_account(row["account_key"], now)
            outcomes["captured"] += 1
        except Exception:
            log.exception("Instagram stats snapshot failed account_key=%s", row["account_key"])
            outcomes["failed"] += 1
    return dict(outcomes)


def snapshot_account(account_key: str, now: datetime) -> None:
    credentials = load_account_credentials(account_key, now_utc=now)
    client = MetaInstagramClient(credentials.access_token)
    profile = client.get_profile()
    if str(profile.get("id")) != credentials.instagram_user_id:
        raise RuntimeError("Instagram profile identity does not match the stored account")
    media = client.list_recent_media(_CONTROL.stats_media_limit)
    captured_on = now.astimezone(ZoneInfo(_CONTROL.generation_timezone)).date()

    sb = get_sb()
    sb.table(INSTAGRAM_ACCOUNT_SNAPSHOTS).upsert(
        {
            "account_key": account_key,
            "captured_on": captured_on.isoformat(),
            "username": profile["username"],
            "name": profile.get("name"),
            "profile_picture_url": profile.get("profile_picture_url"),
            "followers_count": int(profile.get("followers_count") or 0),
            "follows_count": int(profile.get("follows_count") or 0),
            "media_count": int(profile.get("media_count") or 0),
            "captured_at": now.isoformat(),
        },
        on_conflict="account_key,captured_on",
    ).execute()

    rows = [_media_row(account_key, item, now) for item in media]
    if rows:
        sb.table(INSTAGRAM_ACCOUNT_MEDIA).upsert(rows, on_conflict="media_id").execute()
    # Posts that fell out of the newest window, or were deleted, leave the dashboard.
    stale = sb.table(INSTAGRAM_ACCOUNT_MEDIA).delete().eq("account_key", account_key)
    if rows:
        stale = stale.not_.in_("media_id", [row["media_id"] for row in rows])
    stale.execute()


def _media_row(account_key: str, item: dict[str, Any], now: datetime) -> dict[str, Any]:
    # A video's media_url is the video itself; its thumbnail is the picture to show.
    image_url = (
        item.get("thumbnail_url") if item.get("media_type") == "VIDEO" else item.get("media_url")
    )
    return {
        "media_id": str(item["id"]),
        "account_key": account_key,
        "media_type": str(item.get("media_type") or "IMAGE"),
        "media_product_type": item.get("media_product_type"),
        "caption": item.get("caption"),
        "image_url": image_url,
        "permalink": str(item["permalink"]),
        "posted_at": str(item["timestamp"]),
        "like_count": item.get("like_count"),
        "comments_count": item.get("comments_count"),
        "refreshed_at": now.isoformat(),
    }


__all__ = ("snapshot_account", "snapshot_accounts")
