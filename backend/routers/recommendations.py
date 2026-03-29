from fastapi import APIRouter, Depends, Query

from core.auth import get_current_user
from schemas.recommendation import RecommendationItem
from services import recommendation_service, user_service

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("/", response_model=list[RecommendationItem])
def get_recommendations(
    limit: int = Query(default=20, le=50),
    lambda_param: float = Query(default=0.7, alias="lambda", ge=0.0, le=1.0),
    auth_user: dict = Depends(get_current_user),
):
    """Get personalized event recommendations for the current user."""
    db_user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not db_user:
        return []
    return recommendation_service.get_recommendations(
        user_id=db_user["id"],
        limit=limit,
        lambda_param=lambda_param,
    )
