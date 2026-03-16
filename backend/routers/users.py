from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import get_current_user
from schemas.user import UserUpdate, UserProfileUpdate, UserResponse
from services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
def get_me(auth_user: dict = Depends(get_current_user)):
    user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found — complete signup first",
        )
    return user


@router.patch("/me", response_model=UserResponse)
def update_me(
    data: UserUpdate,
    auth_user: dict = Depends(get_current_user),
):
    user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found"
        )
    updated = user_service.update_user(UUID(user["id"]), data)
    return updated


@router.patch("/me/profile", response_model=UserResponse)
def update_profile(
    data: UserProfileUpdate,
    auth_user: dict = Depends(get_current_user),
):
    user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found"
        )
    update_data = UserUpdate(**data.model_dump(exclude_unset=True))
    updated = user_service.update_user(UUID(user["id"]), update_data)
    return updated


@router.get("/", response_model=list[UserResponse])
def list_users(
    skip: int = 0,
    limit: int = 100,
    _=Depends(get_current_user),
):
    return user_service.list_users(skip=skip, limit=limit)


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: UUID,
    _=Depends(get_current_user),
):
    user = user_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    _=Depends(get_current_user),
):
    deleted = user_service.delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
