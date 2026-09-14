"""QR code creation, privacy-preserving scans, and landing confirmation."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import logging
import math
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from postgrest.exceptions import APIError

from core.config import settings
from core.constants import DEFAULT_LIST_LIMIT, PG_UNIQUE_VIOLATION
from core.controlbox import PromoterTemplateControl, controlbox
from core.database import get_sb
from core.errors import (
    INVALID_SCAN_CONFIRMATION,
    POSTER_NOT_FOUND,
    PROMOTER_ENROLLMENT_REQUIRED,
    PROMOTER_POSTER_LIMIT_REACHED,
    PROMOTER_POSTERS_CANNOT_BE_DELETED,
    PROMOTER_POSTERS_CANNOT_BE_UPDATED,
    PROMOTER_PROGRAM_PAUSED,
    PROMOTER_SCHOOL_REQUIRED,
    PROMOTER_TEMPLATE_NOT_FOUND,
    PROMOTER_TEMPLATE_SCHOOL_MISMATCH,
    PROMOTER_TEMPLATE_UNAVAILABLE,
    REQUIRES_LOCATION,
)
from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.tables import QR_CODE_SCANS, QR_CODES
from schemas.qr_code import (
    CampusCoverageCell,
    CampusCoverageResponse,
    ConfirmedVisitorBucket,
    PromoterPosterBatchCreate,
    QrCodeCreate,
    QrCodeRedirect,
    QrCodeResponse,
    QrCodeScanResponse,
    QrCodeUpdate,
    QrScanConfirmResponse,
)
from schemas.user import UserResponse
from services import school_service
from services.school_context import canonical_school_key

log = logging.getLogger(__name__)

POSTER_ALREADY_EXISTS = "Poster with this ID already exists"
POSTER_VISITOR_COOKIE = "wat2do_poster_visitor"
_CONFIRMATION_TOKEN_VERSION = "1"
_QR_CODE_SELECT = f"*,{school_service.SCHOOL_SLUG_EMBED}"


def _qr_code_response(row: dict) -> QrCodeResponse:
    normalized = school_service.with_school_slug(row)
    school = normalized.pop("school", None)
    filters = normalized.get("filters")
    if isinstance(filters, dict):
        filters = dict(filters)
        filters.pop("school", None)
        if school:
            filters["school"] = school
        normalized["filters"] = filters
    return QrCodeResponse.model_validate(normalized)


def _coerce_destination_id(
    destination_type: str,
    destination_id: str | None,
    qr_code_id: str,
) -> str | int | None:
    if destination_type == "event" and destination_id is not None:
        try:
            return int(destination_id)
        except (TypeError, ValueError) as exc:
            log.warning(
                "QR %s has non-integer destination_id for event type: %s",
                qr_code_id,
                exc,
            )
    return destination_id


def get_qr_code_by_id(qr_code_id: str) -> QrCodeResponse | None:
    response = get_sb().table(QR_CODES).select(_QR_CODE_SELECT).eq("id", qr_code_id).execute()
    if not response.data:
        return None
    return _qr_code_response(response.data[0])


def create_qr_code(data: QrCodeCreate, *, creator: UserResponse) -> QrCodeResponse:
    """Create one standard club or administrator QR code."""
    if get_qr_code_by_id(data.id) is not None:
        raise ConflictError(POSTER_ALREADY_EXISTS)

    payload = _build_qr_payload(
        data,
        created_by=str(creator.id),
        program="standard",
        is_active=True,
    )
    try:
        response = get_sb().table(QR_CODES).insert(payload).execute()
    except APIError as exc:
        if exc.code == PG_UNIQUE_VIOLATION:
            raise ConflictError(POSTER_ALREADY_EXISTS) from exc
        raise
    created = get_qr_code_by_id(str(response.data[0]["id"]))
    if created is None:
        raise RuntimeError("Created QR code could not be reloaded")
    return created


def create_promoter_qr_codes(
    data: PromoterPosterBatchCreate,
    *,
    creator: UserResponse,
) -> list[QrCodeResponse]:
    """Create a complete promoter batch through one transactional RPC."""
    promoter_control = controlbox.promoter_program
    if not promoter_control.enabled:
        raise ValidationError(PROMOTER_PROGRAM_PAUSED)
    if (
        creator.payout_email is None
        or creator.promoter_tos_accepted_at is None
        or creator.promoter_tos_version is None
    ):
        raise ValidationError(PROMOTER_ENROLLMENT_REQUIRED)
    school = canonical_school_key(creator.school)
    school_record = school_service.get_school(school)
    if school_record is None:
        raise ValidationError(PROMOTER_SCHOOL_REQUIRED)
    if data.copies > promoter_control.maximum_active_posters:
        raise ValidationError(PROMOTER_POSTER_LIMIT_REACHED)

    template = _get_creation_template(data.poster_template_id, school=school)
    ids = [str(uuid.uuid4()) for _ in range(data.copies)]
    names = _promoter_copy_names(data.name, data.copies)
    try:
        response = (
            get_sb()
            .rpc(
                "create_promoter_qr_codes",
                {
                    "p_ids": ids,
                    "p_names": names,
                    "p_created_by": str(creator.id),
                    "p_school_id": school_record.id,
                    "p_image_url": _template_preview_url(template),
                    "p_poster_template_id": template.id,
                    "p_maximum_active_posters": promoter_control.maximum_active_posters,
                },
            )
            .execute()
        )
    except APIError as exc:
        message = str(exc)
        if exc.code == PG_UNIQUE_VIOLATION:
            raise ConflictError(POSTER_ALREADY_EXISTS) from exc
        if "promoter_poster_limit_reached" in message:
            raise ValidationError(PROMOTER_POSTER_LIMIT_REACHED) from exc
        if "promoter_enrollment_required" in message:
            raise ValidationError(PROMOTER_ENROLLMENT_REQUIRED) from exc
        if "promoter_school_required" in message:
            raise ValidationError(PROMOTER_SCHOOL_REQUIRED) from exc
        raise

    if not response.data:
        raise RuntimeError("create_promoter_qr_codes returned no rows")
    rows_by_id = {str(row["id"]): row for row in response.data}
    if any(qr_code_id not in rows_by_id for qr_code_id in ids):
        raise RuntimeError("create_promoter_qr_codes returned incomplete rows")
    return [
        _qr_code_response(
            {
                **rows_by_id[qr_code_id],
                "school_record": {"slug": school},
            }
        )
        for qr_code_id in ids
    ]


def _get_creation_template(
    template_id: str,
    *,
    school: str,
) -> PromoterTemplateControl:
    template = next(
        (
            candidate
            for candidate in controlbox.promoter_program.approved_templates
            if candidate.id == template_id
        ),
        None,
    )
    if template is None:
        raise ValidationError(PROMOTER_TEMPLATE_NOT_FOUND)
    if not template.available_for_creation:
        raise ValidationError(PROMOTER_TEMPLATE_UNAVAILABLE)
    if template.eligible_school not in {"global", school}:
        raise ValidationError(PROMOTER_TEMPLATE_SCHOOL_MISMATCH)
    return template


def _template_preview_url(template: PromoterTemplateControl) -> str:
    return f"{settings.frontend_url.rstrip('/')}{template.asset_path}"


def _promoter_copy_names(name: str, copies: int) -> list[str]:
    if copies == 1:
        return [name]
    names: list[str] = []
    for index in range(1, copies + 1):
        suffix = f" - {index} of {copies}"
        names.append(f"{name[: 200 - len(suffix)]}{suffix}")
    return names


def _build_qr_payload(
    data: QrCodeCreate | QrCodeUpdate,
    *,
    created_by: str,
    program: str,
    is_active: bool,
) -> dict:
    filters: dict | list | None = data.filters
    school_slug = ""
    if isinstance(filters, dict):
        filters = dict(filters)
        school_slug = canonical_school_key(filters.pop("school", None))
    school_id = school_service.get_school_id(school_slug) if school_slug else None
    if school_slug and school_id is None:
        raise ValidationError("School is not registered")
    return {
        "id": data.id,
        "name": data.name,
        "description": data.description,
        "destination_type": data.destination_type,
        "destination_id": str(data.destination_id) if data.destination_id is not None else None,
        "filters": filters,
        "school_id": school_id,
        "created_by": created_by,
        "is_active": is_active,
        "program": program,
        "image_url": data.image_url,
        "latitude": data.latitude,
        "longitude": data.longitude,
    }


def update_qr_code(data: QrCodeUpdate, *, existing: QrCodeResponse) -> QrCodeResponse:
    if existing.program == "promoter":
        raise ValidationError(PROMOTER_POSTERS_CANNOT_BE_UPDATED)
    payload = _build_qr_payload(
        data,
        created_by=existing.created_by,
        program=existing.program,
        is_active=existing.is_active,
    )
    get_sb().table(QR_CODES).update(payload).eq("id", data.id).execute()
    updated = get_qr_code_by_id(data.id)
    if updated is None:
        raise NotFoundError(POSTER_NOT_FOUND)
    return updated


def handle_scan(
    qr_code_id: str,
    *,
    lat: float | None,
    lon: float | None,
    visitor_token: str,
    client_ip: str,
    user_agent: str | None,
) -> QrCodeRedirect:
    """Record one accepted scan and return its redirect configuration."""
    qr_code = get_qr_code_by_id(qr_code_id)
    if qr_code is None:
        raise NotFoundError(POSTER_NOT_FOUND)

    if not qr_code.is_active:
        return build_redirect(qr_code)

    promoter_is_unplaced = (
        qr_code.program == "promoter" and qr_code.latitude == 0 and qr_code.longitude == 0
    )
    needs_initial_location = (
        qr_code.program == "standard" and qr_code.latest_scan is None
    ) or promoter_is_unplaced
    if needs_initial_location and (lat is None or lon is None):
        raise ValidationError(REQUIRES_LOCATION)

    scan_latitude = lat
    scan_longitude = lon
    if qr_code.program == "promoter" and not promoter_is_unplaced:
        scan_latitude = None
        scan_longitude = None

    browser_family, os_family = parse_user_agent(user_agent)
    scan = record_scan(
        qr_code.id,
        dedupe_hash=hash_visitor_token(visitor_token),
        ip_hash=hash_client_ip(client_ip),
        browser_family=browser_family,
        os_family=os_family,
        latitude=scan_latitude,
        longitude=scan_longitude,
    )
    if scan is None:
        return build_redirect(qr_code)
    confirmation_token = (
        create_scan_confirmation_token(scan.id) if qr_code.program == "promoter" else None
    )
    return build_redirect(qr_code, confirmation_token=confirmation_token)


def record_scan(
    qr_code_id: str,
    *,
    dedupe_hash: str,
    ip_hash: str,
    browser_family: str | None,
    os_family: str | None,
    asn: int | None = None,
    country: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> QrCodeScanResponse | None:
    try:
        response = (
            get_sb()
            .rpc(
                "record_qr_scan",
                {
                    "p_scan_id": str(uuid.uuid4()),
                    "p_qr_code_id": qr_code_id,
                    "p_dedupe_hash": dedupe_hash,
                    "p_ip_hash": ip_hash,
                    "p_browser_family": browser_family,
                    "p_os_family": os_family,
                    "p_asn": asn,
                    "p_country": country,
                    "p_latitude": latitude,
                    "p_longitude": longitude,
                },
            )
            .execute()
        )
    except APIError as exc:
        message = str(exc)
        if "qr_code_archived" in message:
            return None
        if "qr_code_not_found" in message:
            raise NotFoundError(POSTER_NOT_FOUND) from exc
        if "requires_location" in message:
            raise ValidationError(REQUIRES_LOCATION) from exc
        raise
    if not response.data:
        raise RuntimeError("record_qr_scan returned no row")
    return _to_scan_response(response.data[0])


def confirm_scan(token: str, *, visitor_token: str) -> QrScanConfirmResponse:
    scan_id = verify_scan_confirmation_token(token)
    if scan_id is None:
        raise ValidationError(INVALID_SCAN_CONFIRMATION)

    dedupe_hash = hash_visitor_token(visitor_token)
    response = (
        get_sb()
        .table(QR_CODE_SCANS)
        .select("id, dedupe_hash, landing_confirmed_at")
        .eq("id", scan_id)
        .eq("dedupe_hash", dedupe_hash)
        .execute()
    )
    if not response.data:
        raise ValidationError(INVALID_SCAN_CONFIRMATION)

    existing = response.data[0]
    confirmed_at = existing.get("landing_confirmed_at")
    if confirmed_at is None:
        confirmed_at = datetime.now(timezone.utc).isoformat()
        update_response = (
            get_sb()
            .table(QR_CODE_SCANS)
            .update({"landing_confirmed_at": confirmed_at})
            .eq("id", scan_id)
            .is_("landing_confirmed_at", "null")
            .execute()
        )
        if update_response.data:
            confirmed_at = update_response.data[0]["landing_confirmed_at"]
        else:
            refreshed = (
                get_sb()
                .table(QR_CODE_SCANS)
                .select("landing_confirmed_at")
                .eq("id", scan_id)
                .execute()
            )
            if not refreshed.data or refreshed.data[0].get("landing_confirmed_at") is None:
                raise ValidationError(INVALID_SCAN_CONFIRMATION)
            confirmed_at = refreshed.data[0]["landing_confirmed_at"]

    return QrScanConfirmResponse(
        confirmed=True,
        landing_confirmed_at=confirmed_at,
    )


def delete_qr_code(qr_code_id: str) -> None:
    qr_code = get_qr_code_by_id(qr_code_id)
    if qr_code is None:
        raise NotFoundError(POSTER_NOT_FOUND)
    if qr_code.program == "promoter":
        raise ValidationError(PROMOTER_POSTERS_CANNOT_BE_DELETED)
    get_sb().table(QR_CODES).delete().eq("id", qr_code_id).execute()


def build_redirect(
    qr_code: QrCodeResponse,
    *,
    confirmation_token: str | None = None,
) -> QrCodeRedirect:
    query_params = None
    if qr_code.program == "promoter":
        query_params = {"utm_source": "poster", "poster_id": qr_code.id}
    return QrCodeRedirect(
        destination_type=qr_code.destination_type,
        destination_id=_coerce_destination_id(
            qr_code.destination_type,
            qr_code.destination_id,
            qr_code.id,
        ),
        filters=qr_code.filters,
        query_params=query_params,
        scan_confirmation_token=confirmation_token,
    )


def list_qr_codes(
    *,
    created_by: str | None = None,
    school: str | None = None,
    program: str | None = None,
    is_active: bool | None = None,
    latest_scan_before: datetime | None = None,
    latest_scan_after: datetime | None = None,
    never_scanned: bool | None = None,
    offset: int = 0,
    limit: int | None = DEFAULT_LIST_LIMIT,
) -> tuple[list[QrCodeResponse], int]:
    query = (
        get_sb()
        .table(QR_CODES)
        .select(_QR_CODE_SELECT, count="exact")
        .order("created_at", desc=True)
    )
    if created_by:
        query = query.eq("created_by", created_by)
    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return [], 0
        query = query.eq("school_id", school_id)
    if program:
        query = query.eq("program", program)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    if latest_scan_before:
        query = query.lt("latest_scan", latest_scan_before.isoformat())
    if latest_scan_after:
        query = query.gte("latest_scan", latest_scan_after.isoformat())
    if never_scanned is True:
        query = query.is_("latest_scan", "null")
    elif never_scanned is False:
        query = query.not_.is_("latest_scan", "null")
    if limit is not None:
        query = query.range(offset, offset + limit - 1)
    response = query.execute()
    items = [_qr_code_response(row) for row in response.data or []]
    return items, response.count or len(items)


def list_scans(
    qr_code_id: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    *,
    owned_by: str | None = None,
    offset: int = 0,
    limit: int | None = DEFAULT_LIST_LIMIT,
) -> tuple[list[QrCodeScanResponse], int]:
    if owned_by is not None:
        owned_items, _ = list_qr_codes(created_by=owned_by, limit=None)
        # Promoters receive aggregate earnings only. Raw promoter scan and
        # risk details remain admin-only so fraud controls are not exposed.
        owned_ids = [qr_code.id for qr_code in owned_items if qr_code.program == "standard"]
        if not owned_ids:
            return [], 0
        if qr_code_id and qr_code_id not in owned_ids:
            return [], 0

    public_columns = (
        "id, qr_code_id, scanned_at, dedupe_hash, browser_family, os_family, asn, country, "
        "landing_confirmed_at, risk_score, risk_flags, risk_evaluated_at, "
        "risk_rules_version"
    )
    query = (
        get_sb()
        .table(QR_CODE_SCANS)
        .select(public_columns, count="exact")
        .order("scanned_at", desc=True)
    )
    if qr_code_id:
        query = query.eq("qr_code_id", qr_code_id)
    elif owned_by is not None:
        query = query.in_("qr_code_id", owned_ids)
    if from_time:
        query = query.gte("scanned_at", from_time.isoformat())
    if to_time:
        query = query.lte("scanned_at", to_time.isoformat())
    if limit is not None:
        query = query.range(offset, offset + limit - 1)
    response = query.execute()
    items = [_to_scan_response(row) for row in response.data or []]
    return items, response.count or len(items)


def get_campus_coverage(school: str) -> CampusCoverageResponse:
    """Return public campus coverage without exact posters or owner identifiers."""
    school_slug = canonical_school_key(school)
    quiet_days = controlbox.promoter_program.quiet_poster_days
    school_record = school_service.get_school(school_slug)
    if school_record is None:
        return CampusCoverageResponse(
            school=school_slug,
            quiet_after_days=quiet_days,
            cells=[],
        )

    quiet_cutoff = datetime.now(timezone.utc) - timedelta(days=quiet_days)
    response = (
        get_sb()
        .rpc(
            "get_promoter_campus_coverage",
            {
                "p_school_id": school_record.id,
                "p_quiet_cutoff": quiet_cutoff.isoformat(),
                "p_coordinate_decimal_places": (
                    controlbox.promoter_program.map_coordinate_decimal_places
                ),
            },
        )
        .execute()
    )
    cells = [
        CampusCoverageCell(
            latitude=float(row["latitude"]),
            longitude=float(row["longitude"]),
            poster_count=int(row["poster_count"]),
            recent_poster_count=int(row["recent_poster_count"]),
            quiet_poster_count=int(row["quiet_poster_count"]),
            confirmed_visitor_bucket=_confirmed_visitor_bucket(
                int(row["confirmed_unique_visitors"])
            ),
        )
        for row in response.data or []
    ]
    return CampusCoverageResponse(
        school=school_slug,
        quiet_after_days=quiet_days,
        cells=cells,
    )


def _confirmed_visitor_bucket(visitor_count: int) -> ConfirmedVisitorBucket:
    none_maximum, low_maximum, medium_maximum = (
        controlbox.promoter_program.map_visitor_bucket_maximums
    )
    if visitor_count <= none_maximum:
        return "none"
    if visitor_count <= low_maximum:
        return "low"
    if visitor_count <= medium_maximum:
        return "medium"
    return "high"


def _to_scan_response(row: dict) -> QrCodeScanResponse:
    public_row = {
        **row,
        "visitor_reference": str(row["dedupe_hash"])[:16],
    }
    public_row.pop("dedupe_hash", None)
    return QrCodeScanResponse.model_validate(public_row)


def new_visitor_token() -> str:
    return secrets.token_urlsafe(32)


def hash_visitor_token(visitor_token: str) -> str:
    return _keyed_hash("visitor:v1", visitor_token, settings.poster_hash_secret)


def hash_client_ip(client_ip: str) -> str:
    return _keyed_hash("ip:v1", client_ip, settings.poster_hash_secret)


def _keyed_hash(domain: str, value: str, secret: str) -> str:
    if not secret:
        raise RuntimeError("POSTER_HASH_SECRET is required for QR scan recording")
    return hmac.new(
        secret.encode(),
        f"{domain}:{value}".encode(),
        hashlib.sha256,
    ).hexdigest()


def create_scan_confirmation_token(scan_id: uuid.UUID) -> str:
    secret = settings.poster_confirmation_secret
    if not secret:
        raise RuntimeError("POSTER_CONFIRMATION_SECRET is required for promoter scans")
    issued_at = datetime.now(timezone.utc)
    not_before = issued_at + timedelta(
        seconds=controlbox.promoter_program.landing_confirmation_seconds
    )
    expires_at = issued_at + timedelta(
        minutes=controlbox.promoter_program.confirmation_token_minutes
    )
    payload = (
        f"{_CONFIRMATION_TOKEN_VERSION}:{scan_id}:"
        f"{math.ceil(not_before.timestamp())}:{math.floor(expires_at.timestamp())}"
    )
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
    return f"{_encode_token(payload.encode())}.{_encode_token(signature)}"


def verify_scan_confirmation_token(token: str) -> str | None:
    secret = settings.poster_confirmation_secret
    if not secret:
        raise RuntimeError("POSTER_CONFIRMATION_SECRET is required for scan confirmation")
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        payload_bytes = _decode_token(encoded_payload)
        supplied_signature = _decode_token(encoded_signature)
        expected_signature = hmac.new(
            secret.encode(),
            payload_bytes,
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(supplied_signature, expected_signature):
            return None
        version, raw_scan_id, raw_not_before, raw_expiry = payload_bytes.decode().split(":", 3)
        if version != _CONFIRMATION_TOKEN_VERSION:
            return None
        scan_id = str(uuid.UUID(raw_scan_id))
        now_timestamp = datetime.now(timezone.utc).timestamp()
        if now_timestamp < int(raw_not_before) or now_timestamp > int(raw_expiry):
            return None
        return scan_id
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None


def parse_user_agent(user_agent: str | None) -> tuple[str | None, str | None]:
    """Return broad client families without retaining the detailed header."""
    if not user_agent:
        return None, None

    normalized = user_agent.lower()
    if "edg/" in normalized:
        browser = "Edge"
    elif "opr/" in normalized or "opera" in normalized:
        browser = "Opera"
    elif "chrome/" in normalized or "crios/" in normalized:
        browser = "Chrome"
    elif "firefox/" in normalized or "fxios/" in normalized:
        browser = "Firefox"
    elif "safari/" in normalized:
        browser = "Safari"
    else:
        browser = "Other"

    if "android" in normalized:
        operating_system = "Android"
    elif "iphone" in normalized or "ipad" in normalized or "ios" in normalized:
        operating_system = "iOS"
    elif "windows" in normalized:
        operating_system = "Windows"
    elif "mac os" in normalized or "macintosh" in normalized:
        operating_system = "macOS"
    elif "linux" in normalized:
        operating_system = "Linux"
    else:
        operating_system = "Other"
    return browser, operating_system


def _encode_token(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _decode_token(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
