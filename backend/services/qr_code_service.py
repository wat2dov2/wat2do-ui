"""QR codes and scans via Supabase. Sync."""

from datetime import datetime

from core.database import get_sb
from schemas.qr_code import QrCodeCreate, QrCodeRedirect


def get_qr_code_by_id(qr_code_id: str) -> dict | None:
    r = get_sb().table("qr_codes").select("*").eq("id", qr_code_id).execute()
    if not r.data or len(r.data) == 0:
        return None
    return r.data[0]


def upsert_qr_code(data: QrCodeCreate) -> dict:
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
        "created_by": data.created_by,
        "is_active": data.is_active if existing else False,
        "image_url": data.image_url,
        "latitude": data.latitude,
        "longitude": data.longitude,
    }
    if existing:
        sb.table("qr_codes").update(payload).eq("id", data.id).execute()
        return get_qr_code_by_id(data.id)
    sb.table("qr_codes").insert(payload).execute()
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
    if not qr or qr.get("is_active"):
        return None
    sb = get_sb()
    sb.table("qr_codes").update({
        "latitude": latitude,
        "longitude": longitude,
        "is_active": True,
    }).eq("id", qr_code_id).execute()
    sb.table("qr_code_scans").insert({
        "qr_code_id": qr_code_id,
        "session_id": session_id,
        "user_agent": user_agent,
    }).execute()
    qr = get_qr_code_by_id(qr_code_id)
    dest_id = qr.get("destination_id")
    if qr.get("destination_type") == "event" and dest_id is not None:
        try:
            dest_id = int(dest_id)
        except (TypeError, ValueError):
            pass
    return QrCodeRedirect(
        destination_type=qr["destination_type"],
        destination_id=dest_id,
        filters=qr.get("filters"),
    )


def record_scan(
    qr_code_id: str,
    *,
    user_id: str | None = None,
    session_id: str,
    user_agent: str | None = None,
) -> dict:
    r = get_sb().table("qr_code_scans").insert({
        "qr_code_id": qr_code_id,
        "user_id": user_id,
        "session_id": session_id,
        "user_agent": user_agent,
    }).execute()
    return r.data[0]


def delete_qr_code(qr_code_id: str) -> None:
    if not get_qr_code_by_id(qr_code_id):
        raise ValueError("Poster not found")
    get_sb().table("qr_codes").delete().eq("id", qr_code_id).execute()


def list_qr_codes() -> list[dict]:
    r = get_sb().table("qr_codes").select("*").order("created_at", desc=True).execute()
    return r.data or []


def list_scans(
    qr_code_id: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
) -> list[dict]:
    q = get_sb().table("qr_code_scans").select("*").order("scanned_at", desc=True)
    if qr_code_id:
        q = q.eq("qr_code_id", qr_code_id)
    if from_time:
        q = q.gte("scanned_at", from_time.isoformat())
    if to_time:
        q = q.lte("scanned_at", to_time.isoformat())
    r = q.execute()
    return r.data or []
