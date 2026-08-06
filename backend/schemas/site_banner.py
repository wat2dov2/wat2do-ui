from pydantic import BaseModel


class SiteBannerResponse(BaseModel):
    """The single site-wide banner, as shown above the navigation."""

    message: str
    cta_label: str
    cta_href: str
