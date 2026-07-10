"""Response schemas for the A/B test endpoints.

The previous handlers returned bare ``dict`` shapes with no ``response_model``,
so OpenAPI type generation could not describe them and any future addition
of a field would silently leak to the client.  These models lock the
public contract.
"""

from typing import Literal

from pydantic import BaseModel

from core.constants import AB_VARIANT_CONTROL, AB_VARIANT_TREATMENT

# Mirrors the constants in core.constants so the OpenAPI schema emits a
# proper string enum rather than a bare ``string``.
ABVariant = Literal[AB_VARIANT_CONTROL, AB_VARIANT_TREATMENT]


class ABVariantResponse(BaseModel):
    variant: ABVariant


class ABVariantCTR(BaseModel):
    """Per-variant click-through-rate breakdown."""

    impressions: int
    clicks: int
    ctr: float


class ABMetricsResponse(BaseModel):
    """CTR per variant.

    Keyed by variant name; the backend guarantees entries for both
    ``control`` and ``treatment`` even when one has zero traffic.
    """

    control: ABVariantCTR
    treatment: ABVariantCTR
