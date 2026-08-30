from pydantic import BaseModel


class SiteBannerResponse(BaseModel):
    """The single site-wide banner, as shown above the navigation."""

    message_translation_key: str
    cta_label_translation_key: str
    cta_href: str
