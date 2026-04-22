"""Pydantic schemas for QR codes and scans."""

import json
from datetime import datetime
from urllib.parse import urlparse
from uuid import UUID

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.constants import MAX_URL_LENGTH

QrDestinationType = Literal["event", "events-list", "custom-url"]

# ---------------------------------------------------------------------------
# Per-field caps on QrCodeCreate.  Prevents a single authenticated user from
# ballooning a row to >100 MB (see audit U11).  Values chosen to comfortably
# fit the UI's inputs while rejecting clearly-abusive sizes.
# ---------------------------------------------------------------------------
_MAX_QR_ID_LENGTH = 128        # QR id is usually a short slug / UUID
_MAX_QR_NAME_LENGTH = 200      # poster name (shown in dashboard cards)
_MAX_QR_DESCRIPTION_LENGTH = 5_000  # free-text description
# Reuse MAX_URL_LENGTH (2048) for image_url — it's a storage URL, not a
# data: blob.  Data-URL images (base64 PNGs) would blow past this cap and
# that's intentional: they should be uploaded via /uploads/qr-asset.
_MAX_QR_IMAGE_URL_LENGTH = MAX_URL_LENGTH
# Max serialised size for the ``filters`` JSONB value (audit S17).  4 KB
# is generous for any legitimate filter spec (categories + date range +
# a handful of other flags) while rejecting the deeply-nested payloads
# and megabyte key dumps flagged in the audit.
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
    """Public response for GET /qr/{id}: redirect config only. Scan is recorded server-side."""

    destination_type: QrDestinationType
    destination_id: str | int | None = None
    filters: dict | list | None = None


class QrCodeCreate(BaseModel):
    """Payload to create or upsert a QR code (after first scan or dashboard edit).

    Note on ``is_active`` and ``created_by`` (audit S4): ``is_active`` is
    accepted for backward compatibility with existing frontend clients
    but **ignored** — the service always starts inserts at ``is_active=False``
    (see ``qr_code_service._build_qr_payload``).  ``created_by`` is not
    modelled here; the service sets it from the authenticated user's ID.
    ``extra="ignore"`` (the default) is left in place so client-supplied
    ``created_by`` values are silently dropped rather than 422'ing clients
    that still send them.
    """

    # ``id`` is an opaque slug used as both the DB primary key and the URL
    # path segment in ``GET /qr/{id}``.  Restricting to URL-safe characters
    # prevents path traversal / control-character injection at the
    # boundary (audit S4).  Hyphens and underscores cover most slugify
    # outputs; dots/slashes/question-marks are rejected.
    id: str = Field(
        min_length=1,
        max_length=_MAX_QR_ID_LENGTH,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )
    name: str = Field(min_length=1, max_length=_MAX_QR_NAME_LENGTH)
    description: str | None = Field(default=None, max_length=_MAX_QR_DESCRIPTION_LENGTH)
    destination_type: QrDestinationType
    # destination_id is validated by validate_custom_url when destination_type
    # is "custom-url"; we still cap its string form so an integer or short
    # URL can't carry a 10 MB payload.
    destination_id: str | int | None = Field(default=None)
    filters: dict | list | None = None
    # is_active is client-settable but service-ignored (see class docstring).
    is_active: bool = True
    image_url: str | None = Field(default=None, max_length=_MAX_QR_IMAGE_URL_LENGTH)
    # Latitude/longitude bounded to the valid geographic ranges.  Matches
    # the ``ge/le`` guards already applied to the scan-time query params
    # in ``GET /qr/{id}`` — so create and scan agree on what a valid
    # coordinate looks like (audit S4).
    latitude: float = Field(default=0.0, ge=-90, le=90)
    longitude: float = Field(default=0.0, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_custom_url(self):
        """Reject non-http(s) URLs for custom-url destination type."""
        if self.destination_type == "custom-url" and self.destination_id is not None:
            url = str(self.destination_id)
            if len(url) > MAX_URL_LENGTH:
                raise ValueError(
                    f"custom-url destination_id exceeds {MAX_URL_LENGTH} chars"
                )
            if not _is_safe_url(url):
                raise ValueError(
                    "custom-url destination_id must be a valid http or https URL"
                )
        # For non-custom-url types, destination_id may be a short string or
        # int — cap its string form to MAX_URL_LENGTH as a safety net.
        elif self.destination_id is not None:
            if len(str(self.destination_id)) > MAX_URL_LENGTH:
                raise ValueError(
                    f"destination_id exceeds {MAX_URL_LENGTH} chars"
                )
        return self

    @model_validator(mode="after")
    def validate_image_url(self):
        """Reject non-http(s) ``image_url`` values.

        Prevents ``javascript:``, ``data:``, ``file:`` schemes from being
        persisted and later rendered in the dashboard (audit S4).
        """
        if self.image_url is None:
            return self
        if not _is_safe_url(self.image_url):
            raise ValueError("image_url must use http or https scheme")
        return self

    @field_validator("filters")
    @classmethod
    def _filters_size_limit(cls, v):
        """Cap serialised ``filters`` at ``_MAX_QR_FILTERS_BYTES`` (audit S17).

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
            raise ValueError(
                f"filters exceeds maximum size of {_MAX_QR_FILTERS_BYTES} bytes"
            )
        return v


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
