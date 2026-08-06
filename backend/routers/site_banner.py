from fastapi import APIRouter, Response, status

from schemas.site_banner import SiteBannerResponse
from services import site_banner_service

router = APIRouter(prefix="/site-banner", tags=["site-banner"])


@router.get("", response_model=SiteBannerResponse | None)
def get_site_banner_endpoint(response: Response):
    """Public: the banner shown above the navigation, or nothing when disabled."""
    banner = site_banner_service.get_site_banner()
    if banner is None:
        response.status_code = status.HTTP_204_NO_CONTENT
    return banner
