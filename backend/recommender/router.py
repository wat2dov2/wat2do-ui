import logging

from fastapi import APIRouter, Depends, Query

from core.auth import get_optional_user, resolve_db_user
from core.exceptions import NotFoundError
from recommender.schemas import RecommendationItem
from recommender.service import engine as recommendation_engine
from recommender.config import DEFAULT_LIMIT, MAX_LIMIT

log = logging.getLogger(__name__)

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("/", response_model=list[RecommendationItem])
def get_recommendations(
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    auth_user: dict | None = Depends(get_optional_user),
):
    """Get event recommendations. Personalized if logged in, popular otherwise."""
    if auth_user:
        try:
            db_user = resolve_db_user(auth_user)
        except NotFoundError:
            log.warning("Auth user %s has no DB row, falling back to popular", auth_user["id"])
            db_user = None
        if db_user:
            try:
                return recommendation_engine.get_personalized_recommendations(
                    user_id=str(db_user.id),
                    limit=limit,
                )
            except Exception:
                log.warning(
                    "Personalized recommendations endpoint failed for user %s",
                    db_user.id,
                    exc_info=True,
                )
    try:
        return recommendation_engine.get_popular_recommendations(limit=limit)
    except Exception:
        log.warning("Popular recommendations endpoint failed", exc_info=True)
        return []
