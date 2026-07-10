import logging

from fastapi import APIRouter, Depends

from core.auth import get_admin_user, get_current_user, resolve_db_user
from core.exceptions import NotFoundError
from schemas.ab_test import ABMetricsResponse, ABVariantResponse
from services.ab_test_service import ab_test

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ab", tags=["ab-test"])


@router.get("/variant", response_model=ABVariantResponse)
def get_variant(auth_user: dict = Depends(get_current_user)):
    """Return the user's A/B variant.

    If the auth user has no DB row yet (signup race), hash on
    ``auth_user["id"]`` for a stable assignment instead of locking everyone
    into control and biasing treatment share downward.
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
    """CTR metrics by variant (admin only).

    Cached in-process for 60 s (see ``ABTestService.get_ctr_by_variant``)
    so polling dashboards do not full-scan per poll.
    """
    return ab_test.get_ctr_by_variant()
