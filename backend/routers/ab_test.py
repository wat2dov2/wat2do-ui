import logging

from fastapi import APIRouter, Depends

from core.auth import get_current_user, get_admin_user, resolve_db_user
from core.exceptions import NotFoundError
from schemas.ab_test import ABMetricsResponse, ABVariantResponse
from services.ab_test_service import ab_test

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ab", tags=["ab-test"])


@router.get("/variant", response_model=ABVariantResponse)
def get_variant(auth_user: dict = Depends(get_current_user)):
    """Get the current user's A/B test variant.

    If the authenticated user has no DB row yet (race between signup and
    profile creation), we still want a stable variant rather than locking
    everyone into control and biasing the treatment share downward (M5).
    Hashing on ``auth_user["id"]`` gives a deterministic assignment that
    will match once a DB row exists only if the two IDs agree — but since
    they typically don't, we instead use the auth ID directly so the
    fallback is random-by-hash, not hard-coded to control.
    """
    try:
        db_user = resolve_db_user(auth_user)
    except NotFoundError:
        auth_id = str(auth_user["id"])
        log.warning(
            "Auth user %s has no DB row, assigning variant from auth id hash",
            auth_id,
        )
        return {"variant": ab_test.get_user_variant(auth_id)}
    return {"variant": ab_test.get_user_variant(str(db_user.id))}


@router.get("/metrics", response_model=ABMetricsResponse)
def get_metrics(_: dict = Depends(get_admin_user)):
    """Get CTR metrics by variant (admin only).

    Response is cached in-process for 60 s (see
    ``ABTestService.get_ctr_by_variant``) so polling dashboards don't
    trigger a full table scan per poll.
    """
    return ab_test.get_ctr_by_variant()
