from uuid import UUID

from fastapi import APIRouter, Depends, Query

from core.auth import get_admin_user
from core.constants import MAX_SEARCH_QUERY_LENGTH
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.outreach import LeadStatus, OutreachLeadResponse, OutreachLeadUpdate
from schemas.user import UserResponse
from services.outreach import service

router = APIRouter(prefix="/outreach", tags=["outreach"])


@router.get("/leads/", response_model=PaginatedResponse[OutreachLeadResponse])
def list_leads(
    lead_status: LeadStatus | None = Query(default=None),
    school: str | None = Query(default=None, pattern=r"^[a-z0-9-]{1,80}$"),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    items, total = service.list_leads(
        status=lead_status,
        school=school,
        search=search,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.patch("/leads/{lead_id}", response_model=OutreachLeadResponse)
def update_lead(
    lead_id: UUID,
    data: OutreachLeadUpdate,
    _: UserResponse = Depends(get_admin_user),
):
    return service.update_lead(str(lead_id), data)
