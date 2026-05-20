"""Schemas for the scraped_events table.

Tightens inbound payloads so admin-token compromise or a buggy scraper
cannot flood the table with unbounded source strings or multi-megabyte
``raw_data`` JSON (audit M9 / M12).
"""

import json
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

# Source allowlist strings can be scraper names / identifiers.  255 chars
# matches the existing VARCHAR(255) column in the migration so we don't
# need a DB change to enforce the schema-layer cap.
_MAX_SCRAPED_SOURCE_LENGTH = 255

# 32 KB is generous for a single scraped row yet still small enough that
# a 1000-row admin list stays under a typical PostgREST response cap.
_MAX_RAW_DATA_BYTES = 32 * 1024


class ScrapedEventCreate(BaseModel):
    event_id: int | None = None
    source: str = Field(..., min_length=1, max_length=_MAX_SCRAPED_SOURCE_LENGTH)
    raw_data: dict | None = None

    @field_validator("raw_data")
    @classmethod
    def _raw_data_size_cap(cls, v: dict | None) -> dict | None:
        """Reject ``raw_data`` payloads larger than ``_MAX_RAW_DATA_BYTES``.

        Scrapers occasionally paste the entire HTML of a page into
        ``raw_data`` — that can be multiple MB and becomes an admin-list
        memory amplification bug (every GET /scraped-events/ returns all
        ``raw_data`` columns).  Enforce the cap at the schema layer so
        it bites before the INSERT, not when the table is queried later.
        """
        if v is None:
            return v
        try:
            serialised = json.dumps(v)
        except (TypeError, ValueError) as e:
            raise ValueError(f"raw_data is not JSON-serialisable: {e}")
        if len(serialised.encode("utf-8")) > _MAX_RAW_DATA_BYTES:
            raise ValueError(f"raw_data exceeds maximum size of {_MAX_RAW_DATA_BYTES} bytes")
        return v


class ScrapedEventResponse(BaseModel):
    id: str
    event_id: int | None = None
    source: str
    # Datetime parsed via Pydantic v2 (audit S9) so the OpenAPI spec
    # exposes ``format: date-time`` to clients.
    scraped_at: datetime
    raw_data: dict | None = None
