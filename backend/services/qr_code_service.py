"""QR code and scan business logic."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.qr_code import QrCode, QrCodeScan
from schemas.qr_code import QrCodeCreate, QrCodeRedirect


async def get_qr_code_by_id(db: AsyncSession, qr_code_id: str) -> QrCode | None:
    """Return QR code by id or None."""
    result = await db.execute(select(QrCode).where(QrCode.id == qr_code_id))
    return result.scalar_one_or_none()


async def upsert_qr_code(db: AsyncSession, data: QrCodeCreate) -> QrCode:
    """Create or replace a QR code by id (for dashboard create/update)."""
    existing = await get_qr_code_by_id(db, data.id)
    dest_id = str(data.destination_id) if data.destination_id is not None else None
    if existing:
        existing.name = data.name
        existing.description = data.description
        existing.destination_type = data.destination_type
        existing.destination_id = dest_id
        existing.filters = data.filters
        existing.created_by = data.created_by
        existing.is_active = data.is_active
        existing.image_url = data.image_url
        existing.latitude = data.latitude
        existing.longitude = data.longitude
        await db.commit()
        await db.refresh(existing)
        return existing
    qr = QrCode(
        id=data.id,
        name=data.name,
        description=data.description,
        destination_type=data.destination_type,
        destination_id=dest_id,
        filters=data.filters,
        created_by=data.created_by,
        is_active=data.is_active if existing else False,  # new posters start inactive
        image_url=data.image_url,
        latitude=data.latitude,
        longitude=data.longitude,
    )
    db.add(qr)
    await db.commit()
    await db.refresh(qr)
    return qr


async def activate_poster_and_record_scan(
    db: AsyncSession,
    qr_code_id: str,
    latitude: float,
    longitude: float,
    *,
    session_id: str,
    user_agent: str | None = None,
) -> QrCodeRedirect | None:
    """
    If poster is inactive, set location from this (first) scan, set is_active=True, record the scan.
    Returns redirect config. Returns None if poster not found or already active.
    """
    qr = await get_qr_code_by_id(db, qr_code_id)
    if not qr or qr.is_active:
        return None
    qr.latitude = latitude
    qr.longitude = longitude
    qr.is_active = True
    scan = QrCodeScan(
        qr_code_id=qr_code_id,
        session_id=session_id,
        user_agent=user_agent,
    )
    db.add(scan)
    await db.commit()
    await db.refresh(qr)
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


async def record_scan(
    db: AsyncSession,
    qr_code_id: str,
    *,
    user_id: str | None = None,
    session_id: str,
    user_agent: str | None = None,
) -> QrCodeScan:
    """Record a single scan for a QR code (e.g. when user opens /qr/{id})."""
    scan = QrCodeScan(
        qr_code_id=qr_code_id,
        user_id=user_id,
        session_id=session_id,
        user_agent=user_agent,
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)
    return scan


async def delete_qr_code(db: AsyncSession, qr_code_id: str) -> None:
    """Delete a poster (scans are deleted by CASCADE). Raises if not found."""
    from sqlalchemy import delete
    qr = await get_qr_code_by_id(db, qr_code_id)
    if not qr:
        raise ValueError("Poster not found")
    await db.execute(delete(QrCode).where(QrCode.id == qr_code_id))
    await db.commit()


async def list_qr_codes(db: AsyncSession) -> list[QrCode]:
    """List all QR codes (for dashboard)."""
    result = await db.execute(select(QrCode).order_by(QrCode.created_at.desc()))
    return list(result.scalars().all())


async def list_scans(
    db: AsyncSession,
    qr_code_id: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
) -> list[QrCodeScan]:
    """List scans, optionally filtered by qr_code_id and time range."""
    q = select(QrCodeScan).order_by(QrCodeScan.scanned_at.desc())
    if qr_code_id:
        q = q.where(QrCodeScan.qr_code_id == qr_code_id)
    if from_time:
        q = q.where(QrCodeScan.scanned_at >= from_time)
    if to_time:
        q = q.where(QrCodeScan.scanned_at <= to_time)
    result = await db.execute(q)
    return list(result.scalars().all())
