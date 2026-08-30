"""The one site-wide banner row."""

from typing import Any

from core.database import get_sb
from core.tables import SITE_BANNER
from schemas.site_banner import SiteBannerResponse

_SINGLE_ROW_ID = 1


def get_site_banner() -> SiteBannerResponse | None:
    """Return the banner when one is enabled, otherwise None.

    A disabled banner reads as absent rather than as empty copy, so callers
    render nothing at all instead of an empty bar.
    """
    response = (
        get_sb()
        .table(SITE_BANNER)
        .select("message_translation_key,cta_label_translation_key,cta_href,enabled")
        .eq("id", _SINGLE_ROW_ID)
        .limit(1)
        .execute()
    )
    rows: list[dict[str, Any]] = response.data or []
    if not rows or not rows[0].get("enabled"):
        return None
    return SiteBannerResponse.model_validate(rows[0])
