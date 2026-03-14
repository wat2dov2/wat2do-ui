"""QR code and scan models for poster redirects and analytics."""

from datetime import datetime
import uuid

from sqlalchemy import String, DateTime, Boolean, Float, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.user import Base


class QrCode(Base):
    """QR code / poster definition. Resolved by ID for redirects and scan recording."""

    __tablename__ = "qr_codes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    destination_type: Mapped[str] = mapped_column(String(32), nullable=False)
    destination_id: Mapped[str | None] = mapped_column(String(512))
    filters: Mapped[dict | list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    image_url: Mapped[str | None] = mapped_column(String(1024))
    latitude: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    longitude: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")


class QrCodeScan(Base):
    """A single scan of a QR code (any device). Persisted so dashboard shows scans from phones."""

    __tablename__ = "qr_code_scans"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    qr_code_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("qr_codes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scanned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    user_id: Mapped[str | None] = mapped_column(String(255))
    session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    conversion_actions: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    user_agent: Mapped[str | None] = mapped_column(String(512))
