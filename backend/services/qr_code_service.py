"""QR codes and scans via Supabase. Sync."""

import uuid
from datetime import datetime

from core.database import get_sb
from core.errors import POSTER_NOT_FOUND
from core.tables import QR_CODES, QR_CODE_SCANS
from schemas.qr_code import QrCodeCreate, QrCodeRedirect, QrCodeResponse, QrCodeScanResponse


def get_qr_code_by_id(qr_code_id: str) -> QrCodeResponse | None:
    r = get_sb().table(QR_CODES).select("*").eq("id", qr_code_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return QrCodeResponse.model_validate(r.data[0])


def upsert_qr_code(data: QrCodeCreate, *, created_by: str) -> QrCodeResponse:
    sb = get_sb()
    existing = get_qr_code_by_id(data.id)
    dest_id = str(data.destination_id) if data.destination_id is not None else None
    payload = {
        "id": data.id,
        "name": data.name,
        "description": data.description,
        "destination_type": data.destination_type,
        "destination_id": dest_id,
        "filters": data.filters,
        "created_by": created_by,
        "is_active": data.is_active if existing else False,
        "image_url": data.image_url,
        "latitude": data.latitude,
        "longitude": data.longitude,
    }
    if existing:
        sb.table(QR_CODES).update(payload).eq("id", data.id).execute()
        return get_qr_code_by_id(data.id)
    sb.table(QR_CODES).insert(payload).execute()
    return get_qr_code_by_id(data.id)


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
    sb.table(QR_CODES).update({
        "latitude": latitude,
        "longitude": longitude,
        "is_active": True,
    }).eq("id", qr_code_id).execute()
    sb.table(QR_CODE_SCANS).insert({
        "id": str(uuid.uuid4()),
        "qr_code_id": qr_code_id,
        "session_id": session_id,
        "user_agent": user_agent,
        "conversion_actions": [],
    }).execute()
    qr = get_qr_code_by_id(qr_code_id)
    dest_id = qr.destination_id
    if qr.destination_type == "event" and dest_id is not None:
        try:
            dest_id = int(dest_id)
        except (TypeError, ValueError):
            pass
    return QrCodeRedirect(
        destination_type=qr.destination_type,
        destination_id=dest_id,
        filters=qr.filters,
    )


def record_scan(
    qr_code_id: str,
    *,
    user_id: str | None = None,
    session_id: str,
    user_agent: str | None = None,
) -> QrCodeScanResponse:
    r = get_sb().table(QR_CODE_SCANS).insert({
        "id": str(uuid.uuid4()),
        "qr_code_id": qr_code_id,
        "user_id": user_id,
        "session_id": session_id,
        "user_agent": user_agent,
        "conversion_actions": [],
    }).execute()
    return QrCodeScanResponse.model_validate(r.data[0])


def delete_qr_code(qr_code_id: str) -> None:
    if not get_qr_code_by_id(qr_code_id):
        raise ValueError(POSTER_NOT_FOUND)
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
