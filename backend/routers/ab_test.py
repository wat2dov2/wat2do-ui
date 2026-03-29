from fastapi import APIRouter, Depends

from core.auth import get_current_user
from services import ab_test_service, user_service

router = APIRouter(prefix="/ab", tags=["ab-test"])


@router.get("/variant")
def get_variant(auth_user: dict = Depends(get_current_user)):
    """Get the current user's A/B test variant."""
    db_user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not db_user:
        return {"variant": "control"}
    return {"variant": ab_test_service.get_user_variant(db_user["id"])}


@router.get("/metrics")
def get_metrics(_: dict = Depends(get_current_user)):
    """Get CTR metrics by variant (admin use)."""
    return ab_test_service.get_ctr_by_variant()
