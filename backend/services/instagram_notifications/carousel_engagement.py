"""Queue browser engagement for the source posts on newly published carousels.

The publishing tables are the selection ledger. Draft items never authorize
engagement, and only public account identity fields leave the database here.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from uuid import UUID

from core.constants import INSTAGRAM_BATCH_PUBLISHED
from core.controlbox import controlbox
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import (
    EVENTS,
    INSTAGRAM_PUBLISH_BATCHES,
    INSTAGRAM_PUBLISH_ITEMS,
    INSTAGRAM_PUBLISHING_ACCOUNTS,
    SCHOOLS,
)
from schemas.school import validate_recipient_id
from services import school_service
from services.instagram_notifications.browser_session import (
    BrowserSessionError,
    canonical_post_url,
    validate_account_username,
)

if TYPE_CHECKING:
    from services.instagram_notifications.browser_queue import BrowserJobQueue

_CONTROL = controlbox.instagram_browser
_ACTIVATION_SETTING = "carousel_engagement_activated_at"
_ACCOUNT_COLUMNS = (
    "account_key,school_id,instagram_user_id,instagram_username,"
    f"school_record:{SCHOOLS}(slug,recipient_id)"
)
_BATCH_COLUMNS = "id,account_key,school_id,instagram_user_id,published_at"
_ITEM_COLUMNS = f"id,event_id,event:{EVENTS}(source_url)"


@dataclass(frozen=True)
class EngagementAccount:
    school: str
    recipient_id: str
    account_username: str


def get_engagement_account(school: str) -> EngagementAccount:
    """Resolve one enabled school's public browser identity, without credentials."""
    slug = school_service.normalize_school_slug(school)
    for account in _enabled_accounts().values():
        if (account.get("school_record") or {}).get("slug") == slug:
            return _account_identity(account)
    raise ValueError("School has no enabled Instagram publishing account")


def sync_published_carousels(
    queue: BrowserJobQueue,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    """Read published selections and submit their original posts to the queue.

    Activation is durable, so installation never backfills old public posts.
    Each poll rescans this bounded history using a timestamp/id keyset: publishing
    assigns ``published_at`` before the final status update, so a durable high
    watermark alone could miss a batch that finishes after a newer batch.
    Completed batch markers freeze the original selection; queue deduplication
    makes a replay safe if collection fails partway through a batch.
    """
    until = _utc(now or datetime.now(timezone.utc))
    activated_at = queue.get_setting(_ACTIVATION_SETTING)
    if activated_at is None:
        activated_at = until.isoformat()
        queue.set_setting(_ACTIVATION_SETTING, activated_at)
    since = _utc(datetime.fromisoformat(str(activated_at))).isoformat()
    stats = {"batches": 0, "posts": 0, "submitted": 0, "skipped": 0}
    accounts = _enabled_accounts()

    for batch in _published_batches(since=since, until=until.isoformat()):
        stats["batches"] += 1
        completion_setting = f"carousel_engagement_batch:{batch['id']}"
        if queue.get_setting(completion_setting) is not None:
            stats["skipped"] += 1
            continue
        account = accounts.get(str(batch["account_key"]))
        if _enqueue_batch(queue, batch, account, stats):
            queue.set_setting(completion_setting, str(batch["published_at"]))
    return stats


def _enqueue_batch(
    queue: BrowserJobQueue,
    batch: dict[str, Any],
    account: dict[str, Any] | None,
    stats: dict[str, int],
) -> bool:
    if account is None or not _matches_publishing_account(batch, account):
        stats["skipped"] += 1
        return False
    try:
        identity = _account_identity(account)
    except ValueError:
        stats["skipped"] += 1
        return False

    for item in _published_items(str(batch["id"])):
        source_url = (item.get("event") or {}).get("source_url")
        try:
            post_url = canonical_post_url(source_url or "")
        except BrowserSessionError:
            stats["skipped"] += 1
            continue
        stats["posts"] += 1
        try:
            queue.enqueue_engagement(
                school=identity.school,
                recipient_id=identity.recipient_id,
                account_username=identity.account_username,
                post_url=post_url,
                event_id=int(item["event_id"]),
            )
        except ValueError:
            # A publishing identity can be valid for Meta but unavailable
            # to this browser. Its batch must not block other schools.
            stats["skipped"] += 1
            return False
        stats["submitted"] += 1
    return True


def _account_identity(account: dict[str, Any]) -> EngagementAccount:
    school = account.get("school_record") or {}
    recipient_id = validate_recipient_id(school.get("recipient_id"))
    slug = str(school.get("slug") or "").strip()
    username = validate_account_username(account.get("instagram_username"))
    if not slug:
        raise ValueError("Instagram publishing account has incomplete browser identity")
    return EngagementAccount(school=slug, recipient_id=recipient_id, account_username=username)


def _enabled_accounts() -> dict[str, dict[str, Any]]:
    rows = fetch_all_pages(
        lambda offset, size: (
            (
                get_sb()
                .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
                .select(_ACCOUNT_COLUMNS)
                .eq("enabled", True)
                .order("account_key")
                .range(offset, offset + size - 1)
                .execute()
            ).data
            or []
        ),
        page_size=_CONTROL.source_page_size,
    )
    return {str(row["account_key"]): row for row in rows}


def _published_batches(*, since: str, until: str) -> Iterator[dict[str, Any]]:
    after: tuple[str, str] | None = None
    while True:
        query = (
            get_sb()
            .table(INSTAGRAM_PUBLISH_BATCHES)
            .select(_BATCH_COLUMNS)
            .eq("status", INSTAGRAM_BATCH_PUBLISHED)
            .gte("published_at", since)
            .lte("published_at", until)
            .order("published_at")
            .order("id")
            .limit(_CONTROL.source_page_size)
        )
        if after is not None:
            timestamp, batch_id = after
            query = query.or_(
                f"published_at.gt.{timestamp},and(published_at.eq.{timestamp},id.gt.{batch_id})"
            )
        rows = query.execute().data or []
        for row in rows:
            yield row
        if len(rows) < _CONTROL.source_page_size:
            return
        last = rows[-1]
        next_after = (
            _utc(datetime.fromisoformat(str(last["published_at"]))).isoformat(),
            str(UUID(str(last["id"]))),
        )
        if next_after == after:
            raise RuntimeError("Published carousel pagination did not advance")
        after = next_after


def _published_items(batch_id: str) -> list[dict[str, Any]]:
    return fetch_all_pages(
        lambda offset, size: (
            (
                get_sb()
                .table(INSTAGRAM_PUBLISH_ITEMS)
                .select(_ITEM_COLUMNS)
                .eq("batch_id", batch_id)
                .not_.is_("published_at", "null")
                .order("position")
                .order("id")
                .range(offset, offset + size - 1)
                .execute()
            ).data
            or []
        ),
        page_size=_CONTROL.source_page_size,
    )


def _matches_publishing_account(batch: dict[str, Any], account: dict[str, Any]) -> bool:
    return (
        batch["school_id"] == account["school_id"]
        and batch["instagram_user_id"] == account["instagram_user_id"]
    )


def _utc(value: datetime) -> datetime:
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )
