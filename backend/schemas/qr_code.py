"""Pydantic schemas for QR codes and scans."""

from datetime import datetime
from urllib.parse import urlparse
from uuid import UUID

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

QrDestinationType = Literal["event", "events-list", "custom-url"]

# Protocols considered safe for custom-url redirects.
_SAFE_PROTOCOLS = {"http", "https"}


def _is_safe_url(url: str) -> bool:
    """Return True if *url* is a well-formed http(s) URL."""
    try:
        parsed = urlparse(url)
        return parsed.scheme in _SAFE_PROTOCOLS and bool(parsed.netloc)
    except Exception:
        return False


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

    @model_validator(mode="after")
    def validate_custom_url(self):
        """Reject non-http(s) URLs for custom-url destination type."""
        if self.destination_type == "custom-url" and self.destination_id is not None:
            url = str(self.destination_id)
            if not _is_safe_url(url):
                raise ValueError(
                    "custom-url destination_id must be a valid http or https URL"
                )
        return self


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
