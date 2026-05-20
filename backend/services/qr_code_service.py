"""QR codes and scans via Supabase. Sync."""

import logging
import uuid
from datetime import datetime

from postgrest.exceptions import APIError

from core.constants import PG_UNIQUE_VIOLATION
from core.database import get_sb
from core.exceptions import ConflictError, NotFoundError, ValidationError

log = logging.getLogger(__name__)
from core.errors import POSTER_NOT_FOUND, REQUIRES_LOCATION
from core.tables import QR_CODE_SCANS, QR_CODES
from schemas.qr_code import QrCodeCreate, QrCodeRedirect, QrCodeResponse, QrCodeScanResponse

POSTER_ALREADY_EXISTS = "Poster with this ID already exists"


def _coerce_destination_id(
    destination_type: str,
    destination_id: str | None,
    qr_code_id: str,
) -> str | int | None:
    """Cast destination_id to int for event-type QR codes.

    Returns the original value for non-event types.  Logs a warning
    (instead of raising) when the cast fails so callers always get a
    usable redirect.
    """
    if destination_type == "event" and destination_id is not None:
        try:
            return int(destination_id)
        except (TypeError, ValueError) as e:
            log.warning("QR %s has non-integer destination_id for event type: %s", qr_code_id, e)
    return destination_id


def get_qr_code_by_id(qr_code_id: str) -> QrCodeResponse | None:
    r = get_sb().table(QR_CODES).select("*").eq("id", qr_code_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return QrCodeResponse.model_validate(r.data[0])


def _build_qr_payload(
    data: QrCodeCreate,
    *,
    created_by: str,
    is_active: bool,
) -> dict:
    """Assemble the PostgREST payload for a QR row.

    ``is_active`` is passed in explicitly: inserts always start
    inactive, updates preserve the existing value (see
    ``update_qr_code``).
    """
    dest_id = str(data.destination_id) if data.destination_id is not None else None
    return {
        "id": data.id,
        "name": data.name,
        "description": data.description,
        "destination_type": data.destination_type,
        "destination_id": dest_id,
        "filters": data.filters,
        "created_by": created_by,
        "is_active": is_active,
        "image_url": data.image_url,
        "latitude": data.latitude,
        "longitude": data.longitude,
    }


def create_qr_code(data: QrCodeCreate, *, created_by: str) -> QrCodeResponse:
    """Insert a new QR code row.

    Raises ``ConflictError`` (mapped to 409) if *data.id* already exists.

    D18: the explicit pre-check + INSERT is TOCTOU-vulnerable — two
    parallel POSTs with the same client-supplied ``id`` both see no
    existing row and both proceed to INSERT.  The second insert raises
    ``APIError`` with ``PG_UNIQUE_VIOLATION``.  We catch that and map it
    to ``ConflictError`` with the POSTER_ALREADY_EXISTS message so the
    race surfaces as a clean 409 with the poster-specific detail
    instead of the generic "Resource already exists" from the global
    PostgREST error handler.
    """
    existing = get_qr_code_by_id(data.id)
    if existing is not None:
        raise ConflictError(POSTER_ALREADY_EXISTS)
    payload = _build_qr_payload(data, created_by=created_by, is_active=False)
    try:
        get_sb().table(QR_CODES).insert(payload).execute()
    except APIError as e:
        if e.code == PG_UNIQUE_VIOLATION:
            log.warning(
                "QR code insert raced with concurrent create for id=%s: %s",
                data.id,
                e,
            )
            raise ConflictError(POSTER_ALREADY_EXISTS) from e
        raise
    return get_qr_code_by_id(data.id)


def update_qr_code(data: QrCodeCreate, *, created_by: str) -> QrCodeResponse:
    """Update an existing QR code row.

    Caller MUST have verified ownership (or admin status) before calling
    this.  *created_by* is the trusted value that will be written to the
    row — the PATCH router passes ``existing.created_by`` so the
    original owner cannot be overwritten.  Raises ``NotFoundError`` if
    the row does not exist.
    """
    existing = get_qr_code_by_id(data.id)
    if existing is None:
        raise NotFoundError(POSTER_NOT_FOUND)
    payload = _build_qr_payload(data, created_by=created_by, is_active=existing.is_active)
    get_sb().table(QR_CODES).update(payload).eq("id", data.id).execute()
    return get_qr_code_by_id(data.id)


def upsert_qr_code(data: QrCodeCreate, *, created_by: str) -> QrCodeResponse:
    """Backward-compatible upsert.

    Prefer ``create_qr_code`` for POST and ``update_qr_code`` for PATCH
    so the caller's intent is explicit.  Left in place for any internal
    callers (e.g. tests / seeds) that rely on idempotent upsert
    semantics.
    """
    existing = get_qr_code_by_id(data.id)
    if existing is not None:
        return update_qr_code(data, created_by=created_by)
    return create_qr_code(data, created_by=created_by)


def activate_poster_and_record_scan(
    qr_code_id: str,
    latitude: float,
    longitude: float,
    *,
    session_id: str,
    user_agent: str | None = None,
) -> QrCodeRedirect | None:
    qr = get_qr_code_by_id(qr_code_id)
    if not qr or qr.is_active:
        return None
    sb = get_sb()
    # Conditional update: only succeeds if is_active is still False,
    # preventing the TOCTOU race when multiple first-scans arrive concurrently.
    r = (
        sb.table(QR_CODES)
        .update(
            {
                "latitude": latitude,
                "longitude": longitude,
                "is_active": True,
            }
        )
        .eq("id", qr_code_id)
        .eq("is_active", False)
        .execute()
    )
    if not r.data:
        # Another request won the race — this poster was already activated.
        return None
    sb.table(QR_CODE_SCANS).insert(
        {
            "id": str(uuid.uuid4()),
            "qr_code_id": qr_code_id,
            "session_id": session_id,
            "user_agent": user_agent,
            "conversion_actions": [],
        }
    ).execute()
    qr = get_qr_code_by_id(qr_code_id)
    return QrCodeRedirect(
        destination_type=qr.destination_type,
        destination_id=_coerce_destination_id(qr.destination_type, qr.destination_id, qr_code_id),
        filters=qr.filters,
    )


def handle_scan(
    qr_code_id: str,
    *,
    lat: float | None,
    lon: float | None,
    session_id: str,
    user_agent: str | None = None,
) -> QrCodeRedirect:
    """Orchestrate a QR scan: activate if inactive (with coordinates), otherwise record and redirect.

    Raises ``NotFoundError`` when the QR code does not exist.
    Raises ``ValidationError`` when the poster is inactive and no coordinates
    were provided (the client must supply lat/lon to activate the poster).
    """
    qr = get_qr_code_by_id(qr_code_id)
    if not qr:
        raise NotFoundError(POSTER_NOT_FOUND)

    if not qr.is_active:
        if lat is not None and lon is not None:
            redirect_config = activate_poster_and_record_scan(
                qr_code_id, lat, lon, session_id=session_id, user_agent=user_agent
            )
            if redirect_config:
                return redirect_config
        raise ValidationError(REQUIRES_LOCATION)

    record_scan(qr_code_id, session_id=session_id, user_agent=user_agent)
    return build_redirect(qr)


def build_redirect(qr: QrCodeResponse) -> QrCodeRedirect:
    """Build a QrCodeRedirect from a QrCodeResponse, coercing destination_id."""
    return QrCodeRedirect(
        destination_type=qr.destination_type,
        destination_id=_coerce_destination_id(qr.destination_type, qr.destination_id, qr.id),
        filters=qr.filters,
    )


def record_scan(
    qr_code_id: str,
    *,
    user_id: str | None = None,
    session_id: str,
    user_agent: str | None = None,
) -> QrCodeScanResponse:
    r = (
        get_sb()
        .table(QR_CODE_SCANS)
        .insert(
            {
                "id": str(uuid.uuid4()),
                "qr_code_id": qr_code_id,
                "user_id": user_id,
                "session_id": session_id,
                "user_agent": user_agent,
                "conversion_actions": [],
            }
        )
        .execute()
    )
    return QrCodeScanResponse.model_validate(r.data[0])


def delete_qr_code(qr_code_id: str) -> None:
    if not get_qr_code_by_id(qr_code_id):
        raise NotFoundError(POSTER_NOT_FOUND)
    get_sb().table(QR_CODES).delete().eq("id", qr_code_id).execute()


def list_qr_codes(
    *,
    created_by: str | None = None,
    offset: int = 0,
    limit: int | None = None,
) -> tuple[list[QrCodeResponse], int]:
    """Return QR codes, newest first.

    Returns (items, total_count).  When *limit* is None the query is
    unbounded (legacy behaviour for non-paginated callers).
    """
    q = get_sb().table(QR_CODES).select("*", count="exact").order("created_at", desc=True)
    if created_by:
        q = q.eq("created_by", created_by)
    if limit is not None:
        q = q.range(offset, offset + limit - 1)
    r = q.execute()
    items = [QrCodeResponse.model_validate(qr) for qr in (r.data or [])]
    return items, r.count or len(items)


def list_scans(
    qr_code_id: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    *,
    owned_by: str | None = None,
    offset: int = 0,
    limit: int | None = None,
) -> tuple[list[QrCodeScanResponse], int]:
    """Return scans, newest first.

    Returns (items, total_count).  When *limit* is None the query is
    unbounded (legacy behaviour for non-paginated callers).
    """
    # When owned_by is set, restrict results to QR codes created by that user.
    if owned_by is not None:
        owned_items, _ = list_qr_codes(created_by=owned_by)
        owned_ids = [qr.id for qr in owned_items]
        if not owned_ids:
            return [], 0
        if qr_code_id and qr_code_id not in owned_ids:
            return [], 0

    q = get_sb().table(QR_CODE_SCANS).select("*", count="exact").order("scanned_at", desc=True)
    if qr_code_id:
        q = q.eq("qr_code_id", qr_code_id)
    elif owned_by is not None:
        q = q.in_("qr_code_id", owned_ids)
    if from_time:
        q = q.gte("scanned_at", from_time.isoformat())
    if to_time:
        q = q.lte("scanned_at", to_time.isoformat())
    if limit is not None:
        q = q.range(offset, offset + limit - 1)
    r = q.execute()
    items = [QrCodeScanResponse.model_validate(s) for s in (r.data or [])]
    return items, r.count or len(items)
