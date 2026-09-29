from schemas.site_banner import SiteBannerResponse
from services import site_banner_service


def test_get_site_banner_returns_translation_keys(fake_sb, patch_sb):
    patch_sb("services.site_banner_service")
    fake_sb.set_response(
        data=[
            {
                "enabled": True,
                "message_translation_key": "siteBanner.businessSupport.message",
                "cta_label_translation_key": "siteBanner.businessSupport.cta",
                "cta_href": "/support-local",
            }
        ]
    )

    assert site_banner_service.get_site_banner() == SiteBannerResponse(
        message_translation_key="siteBanner.businessSupport.message",
        cta_label_translation_key="siteBanner.businessSupport.cta",
        cta_href="/support-local",
    )


def test_get_site_banner_hides_disabled_row(fake_sb, patch_sb):
    patch_sb("services.site_banner_service")
    fake_sb.set_response(
        data=[
            {
                "enabled": False,
                "message_translation_key": "siteBanner.businessSupport.message",
                "cta_label_translation_key": "siteBanner.businessSupport.cta",
                "cta_href": "/support-local",
            }
        ]
    )

    assert site_banner_service.get_site_banner() is None
