import logging

from fastapi import APIRouter, Depends, status
from postgrest.exceptions import APIError

from core.auth import get_db_user
from core.constants import MAX_SAVED_ORGANIZATIONS_PER_USER
from core.errors import ORGANIZATION_NOT_FOUND, SAVED_ORGANIZATIONS_CAP_REACHED
from core.exceptions import NotFoundError, ValidationError
from schemas.saved_organization import SaveOrganizationStatusResponse
from services import organization_service, saved_organization_service

router = APIRouter(prefix="/saved-organizations", tags=["saved-organizations"])
log = logging.getLogger(__name__)


@router.get("/", response_model=list[int])
def list_saved_organizations(user=Depends(get_db_user)):
    """Return organization IDs saved by the current user.

    - 401 if unauthenticated.
    """
    try:
        return saved_organization_service.get_saved_organization_ids(str(user.id))
    except APIError as e:
        log.warning("saved_organizations table unavailable: %s", e)
        return []


@router.put(
    "/{organization_id}",
    status_code=status.HTTP_200_OK,
    response_model=SaveOrganizationStatusResponse,
)
def save_organization(organization_id: int, user=Depends(get_db_user)):
    """Save (bookmark) a organization.

    - 401 if unauthenticated.
    - 404 if the referenced organization does not exist.
    - 400 if the user has already hit the ``MAX_SAVED_ORGANIZATIONS_PER_USER`` cap.
    """
    if organization_service.get_organization(organization_id) is None:
        raise NotFoundError(ORGANIZATION_NOT_FOUND)

    count = saved_organization_service.count_saved_organizations(str(user.id))
    if count >= MAX_SAVED_ORGANIZATIONS_PER_USER:
        raise ValidationError(SAVED_ORGANIZATIONS_CAP_REACHED)

    saved_organization_service.save_organization(str(user.id), organization_id)
    return {"status": "saved"}


@router.delete(
    "/{organization_id}",
    status_code=status.HTTP_200_OK,
    response_model=SaveOrganizationStatusResponse,
)
def unsave_organization(organization_id: int, user=Depends(get_db_user)):
    """Remove a saved organization.

    - 401 if unauthenticated.
    """
    saved_organization_service.unsave_organization(str(user.id), organization_id)
    return {"status": "unsaved"}
