"""Pydantic schemas for QR codes and scans."""

from datetime import datetime
from uuid import UUID

from typing import Literal

from pydantic import BaseModel, ConfigDict

QrDestinationType = Literal["event", "events-list", "custom-url"]


class QrCodeRedirect(BaseModel):
    """Public response for GET /qr/{id}: redirect config only. Scan is recorded server-side."""

    destination_type: QrDestinationType
    destination_id: str | int | None = None
    filters: dict | list | None = None


class QrCodeCreate(BaseModel):
    """Payload to create or upsert a QR code (after first scan or dashboard edit)."""

    id: str
    name: str
    description: str | None = None
    destination_type: QrDestinationType
    destination_id: str | int | None = None
    filters: dict | list | None = None
    created_by: str
    is_active: bool = True
    image_url: str | None = None
    latitude: float = 0.0
    longitude: float = 0.0


class QrCodeResponse(BaseModel):
    """Full QR code for list/dashboard."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    destination_type: QrDestinationType
    destination_id: str | None
    filters: dict | list | None
    created_at: datetime
    created_by: str
    is_active: bool
    image_url: str | None
    latitude: float
    longitude: float


class QrCodeScanResponse(BaseModel):
    """Single scan for dashboard."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    qr_code_id: str
    scanned_at: datetime
    user_id: str | None
    session_id: str
    conversion_actions: list
    user_agent: str | None
