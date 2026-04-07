from fastapi import APIRouter, Depends

from core.auth import get_current_user, get_admin_user
from core.constants import AB_VARIANT_CONTROL
from services.ab_test_service import ab_test
from services import user_service

router = APIRouter(prefix="/ab", tags=["ab-test"])


@router.get("/variant")
def get_variant(auth_user: dict = Depends(get_current_user)):
    """Get the current user's A/B test variant."""
    db_user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not db_user:
        return {"variant": AB_VARIANT_CONTROL}
    return {"variant": ab_test.get_user_variant(str(db_user.id))}


@router.get("/metrics")
def get_metrics(_: dict = Depends(get_admin_user)):
    """Get CTR metrics by variant (admin only)."""
    return ab_test.get_ctr_by_variant()
