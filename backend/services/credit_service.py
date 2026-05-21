"""Credits and event promotions persistence.

Credit mutations (add / deduct) use PostgreSQL RPC functions that perform
the balance check and update in a single atomic statement, preventing the
TOCTOU race condition that would allow double-spending under concurrency.
"""

import logging
from datetime import datetime, timezone

from postgrest.exceptions import APIError

from core.constants import DEFAULT_CREDIT_BALANCE, DEFAULT_PROMOTION_PACKAGE, PROMOTION_PACKAGES
from core.database import get_sb
from core.errors import INSUFFICIENT_CREDITS, INSUFFICIENT_CREDITS_CODE, INVALID_PROMOTION_PACKAGE
from core.exceptions import ServiceError, ValidationError
from core.tables import EVENT_PROMOTIONS
from schemas.credit import PromotionResponse

log = logging.getLogger(__name__)

# Sentinel returned by the adjust_credits DB function when funds are insufficient.
_INSUFFICIENT_FUNDS_SENTINEL = -1


def _is_insufficient_credits(error: APIError) -> bool:
    """Return True if the APIError indicates insufficient credits.

    The promote_event RPC raises a PostgreSQL exception whose message
    contains "insufficient_credits" when the user's balance is too low.
    Centralised here so the detection policy lives in one place.
    """
    return "insufficient_credits" in str(error)


def get_balance(user_id: str) -> int:
    """Return the user's credit balance, creating the row if needed."""
    r = (
        get_sb()
        .rpc(
            "ensure_user_credits",
            {"p_user_id": user_id, "p_default_balance": DEFAULT_CREDIT_BALANCE},
        )
        .execute()
    )
    return r.data


def add_credits(user_id: str, amount: int) -> int:
    """Atomically add credits to a user's balance. Returns the new balance."""
    r = (
        get_sb()
        .rpc(
            "adjust_credits",
            {
                "p_user_id": user_id,
                "p_amount": amount,
                "p_default_balance": DEFAULT_CREDIT_BALANCE,
            },
        )
        .execute()
    )
    return r.data


def deduct_credits(user_id: str, amount: int) -> int:
    """Atomically deduct credits. Raises 400 if insufficient funds."""
    r = (
        get_sb()
        .rpc(
            "adjust_credits",
            {
                "p_user_id": user_id,
                "p_amount": -amount,
                "p_default_balance": DEFAULT_CREDIT_BALANCE,
            },
        )
        .execute()
    )
    new_balance = r.data
    if new_balance == _INSUFFICIENT_FUNDS_SENTINEL:
        raise ValidationError(INSUFFICIENT_CREDITS, code=INSUFFICIENT_CREDITS_CODE)
    return new_balance


def create_promotion(
    user_id: str,
    event_id: int,
) -> PromotionResponse:
    """Create the single v1 event promotion.

    Credit deduction and promotion insertion happen inside a single
    PostgreSQL RPC (``promote_event``), guaranteeing atomicity — if the
    insert fails the deduction is rolled back automatically.
    """
    package = DEFAULT_PROMOTION_PACKAGE
    pkg = PROMOTION_PACKAGES.get(package)
    if pkg is None:
        raise ValidationError(INVALID_PROMOTION_PACKAGE)
    credits_cost, duration_days = pkg

    try:
        r = (
            get_sb()
            .rpc(
                "promote_event",
                {
                    "p_user_id": user_id,
                    "p_event_id": event_id,
                    "p_package": package,
                    "p_credits_cost": credits_cost,
                    "p_duration_days": duration_days,
                    "p_default_balance": DEFAULT_CREDIT_BALANCE,
                },
            )
            .execute()
        )
    except APIError as e:
        if _is_insufficient_credits(e):
            raise ValidationError(INSUFFICIENT_CREDITS, code=INSUFFICIENT_CREDITS_CODE) from e
        # C18: include the traceback so post-mortems of atomicity edge cases
        # have the full stack.  A plain ``log.error("... %s", e)`` drops it.
        log.exception("RPC promote_event failed: %s", e)
        raise

    # C10: empty data from a write RPC is a real problem, not a success.
    # Fabricating a synthetic response (id="", start_date="", ...) hides
    # whether the DB committed a row and whether credits were deducted.
    # Raise so the global handler maps it to 500 and the client can retry.
    if not r.data:
        log.error(
            "RPC promote_event returned no rows for user=%s event=%s package=%s",
            user_id,
            event_id,
            package,
        )
        raise ServiceError("promote_event returned no rows")

    row = r.data[0]
    # The RPC returns "promotion_id" as the key; map it to "id" for model_validate.
    if "promotion_id" in row and "id" not in row:
        row["id"] = row.pop("promotion_id")
    return PromotionResponse.model_validate(row)


def get_user_promotions(
    user_id: str,
    *,
    active: bool | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[PromotionResponse]:
    """Return promotions for a user, newest first.

    C14: added pagination (``limit`` / ``offset``) and an optional ``active``
    filter so clients that only care about currently-running promotions
    don't download the user's entire history on every app-open.
    """
    q = (
        get_sb()
        .table(EVENT_PROMOTIONS)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
    )
    if active is True:
        q = q.gt("end_date", datetime.now(timezone.utc).isoformat())
    elif active is False:
        q = q.lte("end_date", datetime.now(timezone.utc).isoformat())

    # Supabase-py maps (offset, offset + limit - 1) inclusive via .range().
    if limit > 0:
        q = q.range(offset, offset + limit - 1)

    r = q.execute()
    return [PromotionResponse.model_validate(row) for row in (r.data or [])]


def get_active_promoted_event_ids() -> list[int]:
    """Return event IDs with currently active promotions.

    C12: uses strict ``gt`` (>) to align with the RPC's ``end_date > now()``
    predicate.  A row at the exact expiry second is considered expired by
    both queries.
    """
    now = datetime.now(timezone.utc).isoformat()
    try:
        r = get_sb().table(EVENT_PROMOTIONS).select("event_id").gt("end_date", now).execute()
    except APIError as exc:
        if exc.code != "42703" or "end_date" not in (exc.message or ""):
            raise
        r = get_sb().table(EVENT_PROMOTIONS).select("event_id").gt("expires_at", now).execute()
    return list({row["event_id"] for row in (r.data or [])})


def refund_active_promotions_for_event(event_id: int) -> int:
    """Refund the unused portion of every active promotion on *event_id*.

    Called before deleting an event so the owner does not silently lose
    credits they paid for a promotion that will never run its full term.

    The refund is prorated: ``credits_spent * remaining / total`` rounded
    down to whole credits.  Credits are returned via ``adjust_credits``
    which emits a ledger row automatically (see migration
    20260416003_add_credit_ledger.sql).

    Returns the number of promotion rows refunded (0 if none active).
    Errors on individual refunds are logged and the loop continues so
    a single bad row does not block event deletion.
    """
    now = datetime.now(timezone.utc)
    r = (
        get_sb()
        .table(EVENT_PROMOTIONS)
        .select("id,user_id,credits_spent,start_date,end_date")
        .eq("event_id", event_id)
        .gt("end_date", now.isoformat())
        .execute()
    )
    rows = r.data or []
    refunded = 0
    for row in rows:
        try:
            start = datetime.fromisoformat(row["start_date"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(row["end_date"].replace("Z", "+00:00"))
        except (KeyError, ValueError, AttributeError) as e:
            log.warning(
                "Skipping refund for promotion %s on event %s — bad timestamps: %s",
                row.get("id"),
                event_id,
                e,
            )
            continue

        total = (end - start).total_seconds()
        remaining = max(0.0, (end - now).total_seconds())
        if total <= 0:
            # Defensive: a zero-duration row has no refund.
            continue
        credits_spent = int(row.get("credits_spent") or 0)
        refund_amount = int(credits_spent * remaining / total)
        if refund_amount <= 0:
            continue
        try:
            add_credits(row["user_id"], refund_amount)
            refunded += 1
            log.info(
                "Refunded %s credits to user=%s for promotion=%s on deleted event=%s",
                refund_amount,
                row["user_id"],
                row["id"],
                event_id,
            )
        except Exception as e:
            # Don't block event deletion on a single bad refund — log and
            # continue so the caller can still delete the event.  The
            # ledger will show the skipped refunds via the absence of a
            # row if operators audit later.
            log.error(
                "Failed to refund %s credits to user=%s for promotion=%s on event=%s: %s",
                refund_amount,
                row["user_id"],
                row["id"],
                event_id,
                e,
            )
    return refunded
