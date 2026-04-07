import logging

from fastapi import APIRouter, Depends, Query

from core.auth import get_optional_user
from schemas.recommendation import RecommendationItem
from services.recommendation_service import engine as recommendation_engine
from services.recommender.config import DEFAULT_LIMIT, MAX_LIMIT
from services.ab_test_service import ab_test
from services import user_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("/", response_model=list[RecommendationItem])
def get_recommendations(
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    auth_user: dict | None = Depends(get_optional_user),
):
    """Get event recommendations. Personalized if logged in, popular otherwise."""
    if auth_user:
        db_user = user_service.get_user_by_supabase_id(auth_user["id"])
        if db_user:
            user_id = str(db_user.id)
            variant = ab_test.get_user_variant(user_id)
            recs = recommendation_engine.get_recommendations(
                user_id=user_id,
                limit=limit,
            )
            try:
                ab_test.record_impressions(
                    user_id, [r.event_id for r in recs], variant
                )
            except Exception:
                log.debug("Failed to record AB impressions", exc_info=True)
            return recs
    return recommendation_engine.get_popular_recommendations(limit=limit)
