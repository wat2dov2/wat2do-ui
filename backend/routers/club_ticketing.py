"""A club's side of ticketing: Stripe payouts and sales across its events."""

from fastapi import APIRouter, Depends

from core.auth import get_db_user
from schemas.ticketing import ClubEventTicketSummary, ClubPayoutStatus, StripeRedirectResponse
from schemas.user import UserResponse
from services import club_payouts_service, club_service, ticketing_service

router = APIRouter(prefix="/clubs", tags=["club-ticketing"])


@router.get("/{club_id}/payouts", response_model=ClubPayoutStatus)
def get_payout_status(club_id: int, db_user: UserResponse = Depends(get_db_user)):
    return club_payouts_service.payout_status(club_service.get_managed_club(club_id, db_user))


@router.post("/{club_id}/payouts/onboarding", response_model=StripeRedirectResponse)
def start_payout_onboarding(club_id: int, db_user: UserResponse = Depends(get_db_user)):
    club = club_service.get_managed_club(club_id, db_user)
    return StripeRedirectResponse(url=club_payouts_service.onboarding_url(club, db_user))


@router.post("/{club_id}/payouts/dashboard", response_model=StripeRedirectResponse)
def open_payout_dashboard(club_id: int, db_user: UserResponse = Depends(get_db_user)):
    club = club_service.get_managed_club(club_id, db_user)
    return StripeRedirectResponse(url=club_payouts_service.dashboard_url(club))


@router.get("/{club_id}/ticket-sales", response_model=list[ClubEventTicketSummary])
def list_club_ticket_sales(club_id: int, db_user: UserResponse = Depends(get_db_user)):
    return ticketing_service.club_ticket_summaries(club_service.get_managed_club(club_id, db_user))
