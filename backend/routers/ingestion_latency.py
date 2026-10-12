from fastapi import APIRouter, Depends, Query

from core.auth import get_admin_user
from schemas.ingestion_latency import IngestionLatencyResponse
from schemas.user import UserResponse
from services import ingestion_latency_service

router = APIRouter(prefix="/ingestion-latency", tags=["ingestion-latency"])


@router.get("/", response_model=IngestionLatencyResponse)
def get_ingestion_latency(
    days: int = Query(default=7, ge=1, le=30),
    _: UserResponse = Depends(get_admin_user),
) -> IngestionLatencyResponse:
    """Delay between an Instagram post and its event being added to wat2do."""
    return ingestion_latency_service.get_report(days)
