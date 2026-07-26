"""Pydantic schemas for QR codes and scans."""

import json
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.constants import MAX_URL_LENGTH

QrDestinationType = Literal["event", "events-list", "custom-url"]
QrProgram = Literal["standard", "promoter"]

# ---------------------------------------------------------------------------
# Per-field caps on QrCodeCreate.  Prevents a single authenticated user from
# ballooning a row to >100 MB.  Values chosen to comfortably
# fit the UI's inputs while rejecting clearly-abusive sizes.
# ---------------------------------------------------------------------------
_MAX_QR_ID_LENGTH = 128  # QR id is usually a short slug / UUID
_MAX_QR_NAME_LENGTH = 200  # QR code name (shown in dashboard cards)
_MAX_QR_DESCRIPTION_LENGTH = 5_000  # free-text description
# Reuse MAX_URL_LENGTH (2048) for image_url - it's a storage URL, not a
# data: blob.  Data-URL images (base64 PNGs) would blow past this cap and
# that's intentional: they should be uploaded via /uploads/qr-asset.
_MAX_QR_IMAGE_URL_LENGTH = MAX_URL_LENGTH
# Max serialised size for the ``filters`` JSONB value.  4 KB
# is generous for any legitimate filter spec (categories + date range +
# a handful of other flags) while rejecting deeply-nested payloads
# and megabyte key dumps.
_MAX_QR_FILTERS_BYTES = 4 * 1024

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
    """Redirect config for a QR scan; the scan itself is recorded server-side."""

    destination_type: QrDestinationType
    destination_id: str | int | None = None
    filters: dict | list | None = None
    query_params: dict[str, str] | None = None
    scan_confirmation_token: str | None = None


class _QrCodeMutation(BaseModel):
    """Shared editable QR fields for create and update requests."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=_MAX_QR_NAME_LENGTH)
    description: str | None = Field(default=None, max_length=_MAX_QR_DESCRIPTION_LENGTH)
    destination_type: QrDestinationType
    # destination_id is validated by validate_custom_url when destination_type
    # is "custom-url"; we still cap its string form so an integer or short
    # URL can't carry a 10 MB payload.
    destination_id: str | int | None = Field(default=None)
    filters: dict | list | None = None
    image_url: str | None = Field(default=None, max_length=_MAX_QR_IMAGE_URL_LENGTH)
    # Latitude/longitude bounded to the valid geographic ranges.  Matches
    # the ``ge/le`` guards already applied to the scan-time query params
    # in ``GET /qr/{id}`` - so create and scan agree on what a valid
    # coordinate looks like.
    latitude: float = Field(default=0.0, ge=-90, le=90)
    longitude: float = Field(default=0.0, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_custom_url(self):
        """Reject non-http(s) URLs for custom-url destination type."""
        if self.destination_type == "custom-url" and self.destination_id is not None:
            url = str(self.destination_id)
            if len(url) > MAX_URL_LENGTH:
                raise ValueError(f"custom-url destination_id exceeds {MAX_URL_LENGTH} chars")
            if not _is_safe_url(url):
                raise ValueError("custom-url destination_id must be a valid http or https URL")
        # For non-custom-url types, destination_id may be a short string or
        # int - cap its string form to MAX_URL_LENGTH as a safety net.
        elif self.destination_id is not None:
            if len(str(self.destination_id)) > MAX_URL_LENGTH:
                raise ValueError(f"destination_id exceeds {MAX_URL_LENGTH} chars")
        return self

    @model_validator(mode="after")
    def validate_image_url(self):
        """Reject non-http(s) ``image_url`` values.

        Prevents ``javascript:``, ``data:``, ``file:`` schemes from being
        persisted and later rendered in the dashboard.
        """
        if self.image_url is None:
            return self
        if not _is_safe_url(self.image_url):
            raise ValueError("image_url must use http or https scheme")
        return self

    @field_validator("filters")
    @classmethod
    def _filters_size_limit(cls, v):
        """Cap serialised ``filters`` at ``_MAX_QR_FILTERS_BYTES``.

        The column accepts ``dict | list | None``; attackers can otherwise
        post deeply-nested or megabyte-sized structures that bloat JSONB
        and later render as attacker-controlled keys in the dashboard.
        """
        if v is None:
            return v
        try:
            serialised = json.dumps(v, separators=(",", ":"))
        except (TypeError, ValueError) as e:
            raise ValueError(f"filters is not JSON-serialisable: {e}")
        if len(serialised.encode("utf-8")) > _MAX_QR_FILTERS_BYTES:
            raise ValueError(f"filters exceeds maximum size of {_MAX_QR_FILTERS_BYTES} bytes")
        return v


class QrCodeCreate(_QrCodeMutation):
    """Create a QR code with an immutable program marker."""

    id: str = Field(
        min_length=1,
        max_length=_MAX_QR_ID_LENGTH,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )
    program: QrProgram = "standard"

    @model_validator(mode="after")
    def validate_promoter_destination(self):
        """Keep promoter posters on the server-defined school events feed."""
        if self.program != "promoter":
            return self
        if self.destination_type != "events-list" or self.destination_id is not None:
            raise ValueError("promoter posters must use the school events feed")
        if self.latitude != 0 or self.longitude != 0:
            raise ValueError("promoter poster coordinates are set by scan activity")
        if self.filters is not None and not isinstance(self.filters, dict):
            raise ValueError("promoter poster filters must be an object")
        return self


class QrCodeUpdate(_QrCodeMutation):
    """Update editable QR content without accepting lifecycle or program fields."""

    id: str = Field(
        min_length=1,
        max_length=_MAX_QR_ID_LENGTH,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )


class QrCodeResponse(BaseModel):
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
    program: QrProgram
    latest_scan: datetime | None = None
    image_url: str | None
    latitude: float
    longitude: float


class QrCodeScanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    qr_code_id: str
    scanned_at: datetime
    visitor_reference: str
    browser_family: str | None
    os_family: str | None
    asn: int | None
    country: str | None
    landing_confirmed_at: datetime | None
    risk_score: int
    risk_flags: list[dict]
    risk_evaluated_at: datetime | None
    risk_rules_version: str | None


class QrScanConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=2048)


class QrScanConfirmResponse(BaseModel):
    confirmed: bool
    landing_confirmed_at: datetime


class PosterEarningsItem(BaseModel):
    qr_code_id: str
    name: str
    is_active: bool
    latest_scan: datetime | None
    lifetime_unique_scans: int
    period_unique_scans: int
    period_creditable_scans: int
    pending_cents: int


class PromoterEarningsResponse(BaseModel):
    period: str
    posters: list[PosterEarningsItem]
    period_creditable_scans: int
    pending_cents: int
    lifetime_paid_cents: int
    active_slots_used: int
    active_slots_limit: int
    program_enabled: bool
