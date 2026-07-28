"""Derived promoter earnings, payout persistence, fraud holds, and CSV export."""

from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import NoReturn
from uuid import UUID

from postgrest.exceptions import APIError

from core.controlbox import controlbox
from core.database import get_sb
from core.errors import (
    ADMIN_ACCESS_REQUIRED,
    INVALID_PAYOUT_FILTERS,
    INVALID_STATUS_TRANSITION,
    PAYOUT_EXPORT_PENDING_ONLY,
    PAYOUT_NOT_FOUND,
    PAYOUT_NOTES_REQUIRED,
    PROMOTER_ENROLLMENT_REQUIRED,
)
from core.exceptions import (
    AuthorizationError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from core.pagination import fetch_all_pages
from core.tables import POSTER_PAYOUT_REVIEWS, POSTER_PAYOUTS, QR_CODE_SCANS, QR_CODES
from schemas.payout import (
    AdminPayoutDetail,
    PayoutFraudReason,
    PayoutReviewEvent,
    PosterPayoutContribution,
    PosterPayoutResponse,
)
from schemas.qr_code import (
    PosterEarningsItem,
    PromoterEarningsResponse,
)
from schemas.user import UserResponse
from services import user_service
from services.poster_risk import RiskEvaluation, evaluate_period_scans


def get_promoter_earnings(user: UserResponse) -> PromoterEarningsResponse:
    if user.payout_email is None or user.promoter_tos_accepted_at is None:
        raise ValidationError(PROMOTER_ENROLLMENT_REQUIRED)

    now = datetime.now(timezone.utc)
    period_start, period_end = month_bounds(now.date())
    rows = _get_earnings_rows(str(user.id), period_start, period_end)
    active_rows = [row for row in rows if bool(row["is_active"])]
    rate_cents = controlbox.promoter_program.rate_cents
    posters = [
        PosterEarningsItem(
            qr_code_id=row["qr_code_id"],
            name=row["name"],
            latest_scan=row.get("latest_scan"),
            latitude=float(row["latitude"]),
            longitude=float(row["longitude"]),
            poster_template_id=row.get("poster_template_id"),
            template_preview_url=row.get("image_url"),
            lifetime_unique_scans=int(row["lifetime_unique_scans"]),
            period_unique_scans=int(row["period_unique_scans"]),
            period_creditable_scans=int(row["period_creditable_scans"]),
            pending_cents=int(row["period_creditable_scans"]) * rate_cents,
        )
        for row in active_rows
    ]
    creditable = sum(item.period_creditable_scans for item in posters)
    scan_attempts = _count_period_scan_attempts(
        [item.qr_code_id for item in posters],
        period_start,
        period_end,
    )
    unqualified = max(scan_attempts - creditable, 0)
    return PromoterEarningsResponse(
        period=period_start.strftime("%Y-%m"),
        posters=posters,
        period_creditable_scans=creditable,
        period_unqualified_scans=unqualified,
        pending_cents=creditable * rate_cents,
        lifetime_paid_cents=_lifetime_paid_cents(str(user.id)),
        active_slots_used=len(posters),
        active_slots_limit=controlbox.promoter_program.maximum_active_posters,
        program_enabled=controlbox.promoter_program.enabled,
    )


def list_user_payouts(
    user_id: str,
    *,
    status: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[PosterPayoutResponse], int]:
    return _list_payouts(
        user_id=user_id,
        status=status,
        period=None,
        payout_email=None,
        period_from=None,
        period_to=None,
        minimum_amount_cents=None,
        maximum_amount_cents=None,
        fraud_status=None,
        offset=offset,
        limit=limit,
    )


def list_admin_payouts(
    *,
    user_id: str | None = None,
    status: str | None = None,
    period: date | None = None,
    payout_email: str | None = None,
    period_from: date | None = None,
    period_to: date | None = None,
    minimum_amount_cents: int | None = None,
    maximum_amount_cents: int | None = None,
    fraud_status: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[PosterPayoutResponse], int]:
    return _list_payouts(
        user_id=user_id,
        status=status,
        period=period,
        payout_email=payout_email,
        period_from=period_from,
        period_to=period_to,
        minimum_amount_cents=minimum_amount_cents,
        maximum_amount_cents=maximum_amount_cents,
        fraud_status=fraud_status,
        offset=offset,
        limit=limit,
    )


def _list_payouts(
    *,
    user_id: str | None,
    status: str | None,
    period: date | None,
    payout_email: str | None,
    period_from: date | None,
    period_to: date | None,
    minimum_amount_cents: int | None,
    maximum_amount_cents: int | None,
    fraud_status: str | None,
    offset: int,
    limit: int,
) -> tuple[list[PosterPayoutResponse], int]:
    if period_from and period_to and period_from > period_to:
        raise ValidationError(INVALID_PAYOUT_FILTERS)
    if (
        minimum_amount_cents is not None
        and maximum_amount_cents is not None
        and minimum_amount_cents > maximum_amount_cents
    ):
        raise ValidationError(INVALID_PAYOUT_FILTERS)

    query = (
        get_sb()
        .table(POSTER_PAYOUTS)
        .select("*", count="exact")
        .order("period", desc=True)
        .order("created_at", desc=True)
    )
    if user_id:
        query = query.eq("user_id", user_id)
    if status:
        query = query.eq("status", status)
    if period:
        query = query.eq("period", period.isoformat())
    if payout_email:
        query = query.ilike("payout_email", f"%{payout_email}%")
    if period_from:
        query = query.gte("period", period_from.isoformat())
    if period_to:
        query = query.lte("period", period_to.isoformat())
    if minimum_amount_cents is not None:
        query = query.gte("amount_cents", minimum_amount_cents)
    if maximum_amount_cents is not None:
        query = query.lte("amount_cents", maximum_amount_cents)
    if fraud_status == "flagged":
        query = query.in_("status", ["held", "voided"])
    elif fraud_status == "clear":
        query = query.neq("status", "held").neq("status", "voided")
    response = query.range(offset, offset + limit - 1).execute()
    items = [PosterPayoutResponse.model_validate(row) for row in response.data or []]
    return items, response.count or len(items)


def get_payout(payout_id: UUID) -> PosterPayoutResponse | None:
    response = get_sb().table(POSTER_PAYOUTS).select("*").eq("id", str(payout_id)).execute()
    if not response.data:
        return None
    return PosterPayoutResponse.model_validate(response.data[0])


def _get_payout_review_history(payout_id: UUID) -> list[PayoutReviewEvent]:
    response = (
        get_sb()
        .table(POSTER_PAYOUT_REVIEWS)
        .select("id, from_status, to_status, notes, reviewed_by, reviewed_at")
        .eq("payout_id", str(payout_id))
        .order("reviewed_at")
        .order("id")
        .execute()
    )
    return [PayoutReviewEvent.model_validate(row) for row in response.data or []]


def get_admin_payout_detail(payout_id: UUID) -> AdminPayoutDetail:
    payout = get_payout(payout_id)
    if payout is None:
        raise NotFoundError(PAYOUT_NOT_FOUND)

    period_start, period_end = month_bounds(payout.period)
    scans = _load_period_scans(str(payout.user_id), period_start, period_end)
    reasons_by_key: dict[str, dict] = {}
    for scan in scans:
        for flag in scan.get("risk_flags") or []:
            key = json.dumps(
                {
                    "code": flag.get("code"),
                    "points": flag.get("points"),
                    "evidence": flag.get("evidence") or {},
                },
                sort_keys=True,
            )
            entry = reasons_by_key.setdefault(
                key,
                {
                    "code": str(flag.get("code") or "UNKNOWN"),
                    "points": int(flag.get("points") or 0),
                    "affected_scan_count": 0,
                    "evidence": flag.get("evidence") or {},
                },
            )
            entry["affected_scan_count"] += 1

    if not reasons_by_key and payout.status in {"held", "voided"}:
        reasons_by_key["manual-review"] = {
            "code": "MANUAL_REVIEW",
            "points": 0,
            "affected_scan_count": 0,
            "evidence": {"review_notes": payout.notes or ""},
        }

    contribution_rows = _get_earnings_rows(
        str(payout.user_id),
        period_start,
        period_end,
    )
    contributions = [
        PosterPayoutContribution(
            qr_code_id=str(row["qr_code_id"]),
            name=str(row["name"]),
            poster_template_id=row.get("poster_template_id"),
            scan_count=int(row["period_creditable_scans"]),
            amount_cents=int(row["period_creditable_scans"]) * payout.rate_cents,
        )
        for row in contribution_rows
        if int(row["period_creditable_scans"]) > 0
    ]
    return AdminPayoutDetail(
        payout=payout,
        fraud_reasons=[
            PayoutFraudReason.model_validate(reason) for reason in reasons_by_key.values()
        ],
        contributions=contributions,
        period_start=period_start,
        period_end=period_end,
        review_history=_get_payout_review_history(payout.id),
    )


def transition_payout(
    payout_id: UUID,
    *,
    target_status: str,
    notes: str | None,
    reviewed_by: UUID,
) -> PosterPayoutResponse:
    try:
        response = (
            get_sb()
            .rpc(
                "transition_poster_payout_status",
                {
                    "p_payout_id": str(payout_id),
                    "p_target_status": target_status,
                    "p_notes": notes,
                    "p_reviewed_by": str(reviewed_by),
                },
            )
            .execute()
        )
    except APIError as exc:
        _raise_payout_rpc_error(exc)
    if not response.data:
        raise ConflictError(INVALID_STATUS_TRANSITION)
    return PosterPayoutResponse.model_validate(response.data[0])


def bulk_mark_paid(
    payout_ids: list[UUID],
    *,
    reviewed_by: UUID,
) -> list[PosterPayoutResponse]:
    try:
        response = (
            get_sb()
            .rpc(
                "mark_poster_payouts_paid",
                {
                    "p_ids": [str(payout_id) for payout_id in dict.fromkeys(payout_ids)],
                    "p_reviewed_by": str(reviewed_by),
                },
            )
            .execute()
        )
    except APIError as exc:
        _raise_payout_rpc_error(exc)
    return [PosterPayoutResponse.model_validate(row) for row in response.data or []]


def _raise_payout_rpc_error(exc: APIError) -> NoReturn:
    message = str(exc)
    if "payout_not_found" in message:
        raise NotFoundError(PAYOUT_NOT_FOUND) from exc
    if "payout_notes_required" in message:
        raise ValidationError(PAYOUT_NOTES_REQUIRED) from exc
    if "invalid_payout_status_transition" in message:
        raise ValidationError(INVALID_STATUS_TRANSITION) from exc
    if "admin_access_required" in message:
        raise AuthorizationError(ADMIN_ACCESS_REQUIRED) from exc
    raise exc


def get_pending_payouts_for_export(
    payout_ids: list[UUID],
) -> list[PosterPayoutResponse]:
    unique_ids = list(dict.fromkeys(payout_ids))
    response = (
        get_sb()
        .table(POSTER_PAYOUTS)
        .select("*")
        .in_("id", [str(payout_id) for payout_id in unique_ids])
        .execute()
    )
    payouts_by_id = {
        payout.id: payout
        for payout in (PosterPayoutResponse.model_validate(row) for row in response.data or [])
    }
    if len(payouts_by_id) != len(unique_ids):
        raise NotFoundError(PAYOUT_NOT_FOUND)
    payouts = [payouts_by_id[payout_id] for payout_id in unique_ids]
    if any(payout.status != "pending" for payout in payouts):
        raise ValidationError(PAYOUT_EXPORT_PENDING_ONLY)
    return payouts


def serialize_interac_csv(payouts: list[PosterPayoutResponse]) -> str:
    """Serialize reviewed pending payouts for the job and admin download."""
    csv_file = io.StringIO(newline="")
    writer = csv.DictWriter(
        csv_file,
        fieldnames=[
            "recipient_email",
            "amount",
            "scan_count",
            "status",
            "reference",
            "notes",
        ],
    )
    writer.writeheader()
    for payout in payouts:
        writer.writerow(
            {
                "recipient_email": str(payout.payout_email),
                "amount": f"{payout.amount_cents // 100}.{payout.amount_cents % 100:02d}",
                "scan_count": payout.scan_count,
                "status": payout.status,
                "reference": str(payout.id),
                "notes": f"Wat2Do poster payout {payout.period:%Y-%m}",
            }
        )
    return csv_file.getvalue()


def run_period_payouts(
    period: date,
    *,
    output_path: Path,
    now: datetime | None = None,
) -> dict[str, int | str]:
    """Freeze one closed UTC period and export pending Interac transfers."""
    period_start, period_end = month_bounds(period)
    current_time = now or datetime.now(timezone.utc)
    if current_time < period_end:
        raise ValueError("Payout period has not closed")

    owner_ids = _load_promoter_owner_ids()
    users = user_service.get_users_by_ids(owner_ids)
    exported: list[PosterPayoutResponse] = []
    created_or_updated = 0
    held = 0

    for owner_id in owner_ids:
        user = users.get(owner_id)
        if user is None or user.payout_email is None:
            continue
        earnings_rows = _get_earnings_rows(owner_id, period_start, period_end)
        scan_count = sum(int(row["period_creditable_scans"]) for row in earnings_rows)
        if scan_count == 0:
            continue

        scans = _load_period_scans(owner_id, period_start, period_end)
        evaluation = evaluate_period_scans(scans, controlbox.promoter_program)
        payout = _upsert_period_payout(
            user=user,
            period=period_start.date(),
            scan_count=scan_count,
            evaluation=evaluation,
        )
        if payout.status in {"paid", "voided"}:
            continue

        _store_scan_risk(scans, evaluation)
        created_or_updated += 1
        if payout.status == "held":
            held += 1
        elif payout.status == "pending":
            exported.append(payout)

    _write_interac_csv(exported, output_path)
    return {
        "period": period_start.strftime("%Y-%m"),
        "payouts_written": created_or_updated,
        "held": held,
        "exported": len(exported),
        "amount_cents": sum(payout.amount_cents for payout in exported),
        "csv": str(output_path),
    }


def month_bounds(value: date) -> tuple[datetime, datetime]:
    start = datetime(value.year, value.month, 1, tzinfo=timezone.utc)
    if value.month == 12:
        end = datetime(value.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(value.year, value.month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _get_earnings_rows(
    user_id: str,
    period_start: datetime,
    period_end: datetime,
) -> list[dict]:
    response = (
        get_sb()
        .rpc(
            "get_promoter_earnings",
            {
                "p_user_id": user_id,
                "p_period_start": period_start.isoformat(),
                "p_period_end": period_end.isoformat(),
            },
        )
        .execute()
    )
    return response.data or []


def _count_period_scan_attempts(
    qr_code_ids: list[str],
    period_start: datetime,
    period_end: datetime,
) -> int:
    if not qr_code_ids:
        return 0
    response = (
        get_sb()
        .table(QR_CODE_SCANS)
        .select("id", count="exact")
        .in_("qr_code_id", qr_code_ids)
        .gte("scanned_at", period_start.isoformat())
        .lt("scanned_at", period_end.isoformat())
        .execute()
    )
    return int(response.count or len(response.data or []))


def _lifetime_paid_cents(user_id: str) -> int:
    rows = fetch_all_pages(
        lambda offset, page_size: (
            get_sb()
            .table(POSTER_PAYOUTS)
            .select("amount_cents")
            .eq("user_id", user_id)
            .eq("status", "paid")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
    )
    return sum(int(row["amount_cents"]) for row in rows)


def _load_promoter_owner_ids() -> list[str]:
    rows = fetch_all_pages(
        lambda offset, page_size: (
            get_sb()
            .table(QR_CODES)
            .select("created_by")
            .eq("program", "promoter")
            .order("created_by")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
    )
    return list(dict.fromkeys(str(row["created_by"]) for row in rows))


def _load_period_scans(
    user_id: str,
    period_start: datetime,
    period_end: datetime,
) -> list[dict]:
    qr_rows = fetch_all_pages(
        lambda offset, page_size: (
            get_sb()
            .table(QR_CODES)
            .select("id")
            .eq("created_by", user_id)
            .eq("program", "promoter")
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
    )
    qr_ids = [str(row["id"]) for row in qr_rows]
    if not qr_ids:
        return []

    return fetch_all_pages(
        lambda offset, page_size: (
            get_sb()
            .table(QR_CODE_SCANS)
            .select(
                "id, qr_code_id, scanned_at, dedupe_hash, ip_hash, landing_confirmed_at, risk_flags"
            )
            .in_("qr_code_id", qr_ids)
            .gte("scanned_at", period_start.isoformat())
            .lt("scanned_at", period_end.isoformat())
            .order("scanned_at")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
    )


def _store_scan_risk(scans: list[dict], evaluation: RiskEvaluation) -> None:
    evaluated_at = datetime.now(timezone.utc).isoformat()
    flags_by_scan_id = evaluation.flags_by_scan_id
    groups: dict[str, tuple[dict, list[str]]] = {}
    for scan in scans:
        scan_id = str(scan["id"])
        flags = flags_by_scan_id.get(scan_id, [])
        payload = {
            "risk_score": sum(int(flag["points"]) for flag in flags),
            "risk_flags": flags,
            "risk_evaluated_at": evaluated_at,
            "risk_rules_version": controlbox.promoter_program.risk_rules_version,
        }
        group_key = json.dumps(payload, sort_keys=True)
        if group_key not in groups:
            groups[group_key] = (payload, [])
        groups[group_key][1].append(scan_id)

    for payload, scan_ids in groups.values():
        for chunk_start in range(0, len(scan_ids), 500):
            chunk = scan_ids[chunk_start : chunk_start + 500]
            get_sb().table(QR_CODE_SCANS).update(payload).in_("id", chunk).execute()


def _upsert_period_payout(
    *,
    user: UserResponse,
    period: date,
    scan_count: int,
    evaluation: RiskEvaluation,
) -> PosterPayoutResponse:
    response = (
        get_sb()
        .table(POSTER_PAYOUTS)
        .select("*")
        .eq("user_id", str(user.id))
        .eq("period", period.isoformat())
        .execute()
    )
    existing = PosterPayoutResponse.model_validate(response.data[0]) if response.data else None
    if existing and existing.status in {"paid", "voided"}:
        return existing

    should_hold = evaluation.score >= controlbox.promoter_program.hold_score_threshold
    status = "held" if should_hold or (existing and existing.status == "held") else "pending"
    notes = existing.notes if existing else None
    reviewed_by = existing.reviewed_by if existing else None
    manually_held = (
        existing is not None and existing.status == "held" and existing.reviewed_by is not None
    )
    if should_hold and not manually_held:
        notes = _risk_notes(evaluation)
        if existing is None or existing.status != "held":
            reviewed_by = None
    rate_cents = existing.rate_cents if existing else controlbox.promoter_program.rate_cents
    payout_email = str(existing.payout_email) if existing else str(user.payout_email)
    payload = {
        "user_id": str(user.id),
        "period": period.isoformat(),
        "payout_email": payout_email,
        "rate_cents": rate_cents,
        "scan_count": scan_count,
        "amount_cents": scan_count * rate_cents,
        "status": status,
        "paid_at": None,
        "notes": notes,
        "reviewed_by": str(reviewed_by) if reviewed_by else None,
    }
    if existing and all(
        getattr(existing, key) == value
        for key, value in {
            "payout_email": payout_email,
            "rate_cents": rate_cents,
            "scan_count": scan_count,
            "amount_cents": scan_count * rate_cents,
            "status": status,
            "paid_at": None,
            "notes": notes,
            "reviewed_by": reviewed_by,
        }.items()
    ):
        return existing

    if existing:
        write_response = (
            get_sb()
            .table(POSTER_PAYOUTS)
            .update(payload)
            .eq("id", str(existing.id))
            .eq("status", existing.status)
            .execute()
        )
    else:
        write_response = get_sb().table(POSTER_PAYOUTS).insert(payload).execute()
    if not write_response.data:
        raise ConflictError("Payout changed during computation")
    return PosterPayoutResponse.model_validate(write_response.data[0])


def _risk_notes(evaluation: RiskEvaluation) -> str:
    reason_codes = ", ".join(finding.code for finding in evaluation.findings)
    return (
        f"Automatic fraud hold using {controlbox.promoter_program.risk_rules_version}: "
        f"{reason_codes}"
    )


def _write_interac_csv(payouts: list[PosterPayoutResponse], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(serialize_interac_csv(payouts), encoding="utf-8")
    output_path.chmod(0o600)
