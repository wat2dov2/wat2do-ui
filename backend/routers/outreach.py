from uuid import UUID

from fastapi import APIRouter, Depends, Query

from core.auth import get_admin_user
from core.constants import MAX_SEARCH_QUERY_LENGTH
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.outreach import (
    LeadStatus,
    OutreachCampaignCreate,
    OutreachCampaignResponse,
    OutreachCampaignUpdate,
    OutreachLeadResponse,
    OutreachLeadUpdate,
)
from schemas.user import UserResponse
from services.outreach import service

router = APIRouter(prefix="/outreach", tags=["outreach"])


@router.get("/campaigns/", response_model=list[OutreachCampaignResponse])
def list_campaigns(_: UserResponse = Depends(get_admin_user)):
    return service.list_campaigns()


@router.post("/campaigns/", response_model=OutreachCampaignResponse, status_code=201)
def create_campaign(data: OutreachCampaignCreate, _: UserResponse = Depends(get_admin_user)):
    return service.create_campaign(data)


@router.patch("/campaigns/{campaign_id}", response_model=OutreachCampaignResponse)
def update_campaign(
    campaign_id: UUID,
    data: OutreachCampaignUpdate,
    _: UserResponse = Depends(get_admin_user),
):
    return service.update_campaign(str(campaign_id), data)


@router.get("/leads/", response_model=PaginatedResponse[OutreachLeadResponse])
def list_leads(
    campaign_id: UUID | None = Query(default=None),
    lead_status: LeadStatus | None = Query(default=None),
    school: str | None = Query(default=None, pattern=r"^[a-z0-9-]{1,80}$"),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    items, total = service.list_leads(
        campaign_id=str(campaign_id) if campaign_id else None,
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
