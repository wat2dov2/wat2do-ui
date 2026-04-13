from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.auth import get_current_user, get_admin_user, get_db_user
from core.constants import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from schemas.user import UserUpdate, UserProfileUpdate, UserResponse
from core.errors import USER_NOT_FOUND, USER_PROFILE_NOT_FOUND
from services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
def get_me(auth_user: dict = Depends(get_current_user)):
    user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=USER_PROFILE_NOT_FOUND,
        )
    return user


@router.patch("/me", response_model=UserResponse)
def update_me(
    data: UserUpdate,
    user=Depends(get_db_user),
):
    updated = user_service.update_user(user.id, data)
    return updated


@router.patch("/me/profile", response_model=UserResponse)
def update_profile(
    data: UserProfileUpdate,
    user=Depends(get_db_user),
):
    update_data = UserUpdate(**data.model_dump(exclude_unset=True))
    updated = user_service.update_user(user.id, update_data)
    return updated


@router.get("/", response_model=list[UserResponse])
def list_users(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=DEFAULT_LIST_LIMIT, ge=1, le=MAX_LIST_LIMIT),
    _=Depends(get_admin_user),
):
    return user_service.list_users(skip=skip, limit=limit)


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: UUID,
    _=Depends(get_admin_user),
):
    user = user_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=USER_NOT_FOUND)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    _=Depends(get_admin_user),
):
    deleted = user_service.delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=USER_NOT_FOUND)
