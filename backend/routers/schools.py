from fastapi import APIRouter, Query

from core.constants import MAX_SEARCH_QUERY_LENGTH
from services import school_service

router = APIRouter(prefix="/schools", tags=["schools"])


@router.get("", response_model=list[str])
def search_schools_endpoint(
    q: str = Query(default="", max_length=MAX_SEARCH_QUERY_LENGTH),
    limit: int = Query(default=school_service.DEFAULT_SEARCH_LIMIT, ge=1, le=50),
):
    return school_service.search_schools(q, limit=limit)
