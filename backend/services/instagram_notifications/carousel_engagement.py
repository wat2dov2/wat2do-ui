"""Queue browser engagement for the source posts on newly published carousels.

The publishing tables are the selection ledger. Draft items never authorize
engagement, and only public account identity fields leave the database here.
"""

from __future__ import annotations

import logging
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
from services.instagram_notifications.ledger import (
    acknowledge_browser_delivery,
    freeze_browser_sources,
    validate_browser_sources,
)

if TYPE_CHECKING:
    from services.instagram_notifications.browser_queue import BrowserJobQueue

_CONTROL = controlbox.instagram_browser
_ACTIVATION_SETTING = "carousel_engagement_activated_at"
_SOURCE_REGISTRATION_SETTING = "carousel_engagement_source_registered"
_ACCOUNT_COLUMNS = (
    "account_key,school_id,instagram_user_id,instagram_username,"
    f"school_record:{SCHOOLS}(slug,recipient_id)"
)
_BATCH_COLUMNS = "id,account_key,school_id,instagram_user_id,published_at,browser_delivery_sources"
_ITEM_COLUMNS = f"id,event_id,event:{EVENTS}(source_url)"
log = logging.getLogger(__name__)


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

    Cloud activation survives local queue recreation without historical backfill.
    Only batches not delivered to this queue generation cross the network.
    The timestamp/id keyset belongs to one poll, so publication that finishes
    later with an older timestamp remains eligible on the next poll.
    Frozen source selections survive interrupted enqueue, acknowledgement retries,
    and queue recreation without following later edits to their events.
    """
    until = _utc(now or datetime.now(timezone.utc))
    since = _source_activation(queue, until)
    delivery_generation = queue.delivery_generation
    stats = {"batches": 0, "posts": 0, "submitted": 0, "skipped": 0}
    accounts = None

    for batch in _published_batches(
        since=since, until=until.isoformat(), delivery_generation=delivery_generation
    ):
        stats["batches"] += 1
        completion_setting = f"carousel_engagement_batch:{batch['id']}"
        try:
            completed = queue.get_setting(completion_setting) is not None
            if completed and (
                batch.get("browser_delivery_sources") is not None
                or queue.get_setting(f"carousel_engagement_sources:{batch['id']}") is not None
            ):
                sources = _delivery_sources(queue, batch, None, stats)
                stats["skipped"] += 1
            else:
                if accounts is None:
                    accounts = _enabled_accounts()
                account = accounts.get(str(batch["account_key"]))
                sources = _enqueue_batch(queue, batch, account, stats)
                if sources is None:
                    continue
                queue.set_setting(completion_setting, str(batch["published_at"]))
        except ValueError:
            # A missing or ambiguous original selection cannot authorize changed posts.
            log.warning("Carousel %s has no faithful browser source selection", batch["id"])
            stats["skipped"] += 1
            continue
        acknowledge_browser_delivery(
            table=INSTAGRAM_PUBLISH_BATCHES,
            row_id=str(batch["id"]),
            delivery_generation=delivery_generation,
            sources=sources,
        )
    return stats


def _source_activation(queue: BrowserJobQueue, now: datetime) -> str:
    activated_at = queue.get_setting(_ACTIVATION_SETTING)
    if queue.get_setting(_SOURCE_REGISTRATION_SETTING, False):
        return _utc(datetime.fromisoformat(str(activated_at))).isoformat()
    proposed = (
        _utc(datetime.fromisoformat(str(activated_at))).isoformat()
        if activated_at is not None
        else now.isoformat()
    )
    response = (
        get_sb().rpc("ensure_instagram_browser_source", {"p_activated_at": proposed}).execute()
    )
    if not isinstance(response.data, str):
        raise RuntimeError("Instagram browser source returned no activation timestamp")
    activated_at = _utc(datetime.fromisoformat(response.data)).isoformat()
    queue.set_setting(_ACTIVATION_SETTING, activated_at)
    queue.set_setting(_SOURCE_REGISTRATION_SETTING, True)
    return activated_at


def _enqueue_batch(
    queue: BrowserJobQueue,
    batch: dict[str, Any],
    account: dict[str, Any] | None,
    stats: dict[str, int],
) -> list[dict[str, Any]] | None:
    if account is None or not _matches_publishing_account(batch, account):
        stats["skipped"] += 1
        return None
    try:
        identity = _account_identity(account)
    except ValueError:
        stats["skipped"] += 1
        return None

    sources = _delivery_sources(queue, batch, identity, stats)
    if queue.get_setting(f"carousel_engagement_batch:{batch['id']}") is not None:
        stats["skipped"] += 1
        return sources
    for source in sources:
        stats["posts"] += 1
        try:
            queue.enqueue_engagement(
                school=identity.school,
                recipient_id=identity.recipient_id,
                account_username=identity.account_username,
                post_url=source["post_url"],
                event_id=source["event_id"],
            )
        except ValueError:
            # A publishing identity can be valid for Meta but unavailable
            # to this browser. Its batch must not block other schools.
            stats["skipped"] += 1
            return None
        stats["submitted"] += 1
    return sources


def _delivery_sources(
    queue: BrowserJobQueue,
    batch: dict[str, Any],
    identity: EngagementAccount | None,
    stats: dict[str, int],
) -> list[dict[str, Any]]:
    """Freeze one selection before the first enqueue and reuse it for every replay."""
    setting = f"carousel_engagement_sources:{batch['id']}"
    local = queue.get_setting(setting)
    saved = batch.get("browser_delivery_sources")
    if saved is not None:
        sources = validate_browser_sources(saved)
    else:
        if local is not None:
            candidate = validate_browser_sources(local)
        elif queue.get_setting(f"carousel_engagement_batch:{batch['id']}") is not None:
            if identity is None:
                raise ValueError("Original carousel account identity is unavailable")
            event_ids = [item["event_id"] for item in _published_items(str(batch["id"]))]
            if not event_ids or any(type(event_id) is not int for event_id in event_ids):
                raise ValueError("Original carousel event identity is unavailable")
            candidate = queue.recorded_engagement_sources(
                recipient_id=identity.recipient_id,
                account_username=identity.account_username,
                event_ids=event_ids,
            )
        else:
            candidate = []
            for item in _published_items(str(batch["id"])):
                try:
                    post_url = canonical_post_url((item.get("event") or {}).get("source_url") or "")
                except BrowserSessionError:
                    stats["skipped"] += 1
                    continue
                candidate.append({"post_url": post_url, "event_id": item.get("event_id")})
        sources = freeze_browser_sources(batch_id=str(batch["id"]), sources=candidate)
    if local is not None and sources != validate_browser_sources(local):
        raise ValueError("Cloud and local carousel source selections disagree")
    queue.set_setting(setting, sources)
    return sources


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


def _published_batches(
    *, since: str, until: str, delivery_generation: str
) -> Iterator[dict[str, Any]]:
    after: tuple[str, str] | None = None
    delivery_filter = (
        f"browser_delivery_generation.is.null,browser_delivery_generation.neq.{delivery_generation}"
    )
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
        filters = delivery_filter
        if after is not None:
            timestamp, batch_id = after
            cursor_filter = (
                f"published_at.gt.{timestamp},and(published_at.eq.{timestamp},id.gt.{batch_id})"
            )
            filters = f"and(or({delivery_filter}),or({cursor_filter}))"
        rows = query.or_(filters).execute().data or []
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
