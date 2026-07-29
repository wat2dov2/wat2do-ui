from fastapi import APIRouter, HTTPException, Query

from core.constants import MAX_SEARCH_QUERY_LENGTH
from schemas.school import School, SchoolSummary
from services import school_service

router = APIRouter(prefix="/schools", tags=["schools"])


@router.get("", response_model=list[SchoolSummary])
def search_schools_endpoint(
    q: str = Query(default="", max_length=MAX_SEARCH_QUERY_LENGTH),
    limit: int = Query(default=school_service.DEFAULT_SEARCH_LIMIT, ge=1, le=50),
):
    return school_service.search_schools(q, limit=limit)


@router.get("/{slug}", response_model=School)
def get_school_endpoint(slug: str):
    school = school_service.get_school(slug)
    if school is None:
        raise HTTPException(status_code=404, detail="School not found")
    return school
