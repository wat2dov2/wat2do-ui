from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from core.auth import get_current_user, get_admin_user, get_db_user
from core.constants import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, ROLE_ADMIN
from core.errors import (
    CANNOT_DELETE_SELF,
    LAST_ADMIN_REQUIRED,
    USER_NOT_FOUND,
    USER_PROFILE_NOT_FOUND,
)
from core.exceptions import AuthorizationError, ValidationError, get_or_404
from schemas.user import UserRoleUpdate, UserUpdate, UserProfileUpdate, UserResponse
from services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
def get_me(auth_user: dict = Depends(get_current_user)):
    return get_or_404(user_service.get_user_by_supabase_id(auth_user["id"]), USER_PROFILE_NOT_FOUND)


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
    return get_or_404(user_service.get_user(user_id), USER_NOT_FOUND)


@router.patch("/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: UUID,
    data: UserRoleUpdate,
    _=Depends(get_admin_user),
):
    """Admin-only: rotate a user's role ('user' <-> 'admin').

    Separate from ``PATCH /users/{id}`` so the role is only mutable through
    an explicitly-admin endpoint — keeps the trust boundary bright and
    closes audit I16.  ``user_service.set_role`` invalidates the
    supabase-auth-id cache so the change is immediately visible in
    subsequent role checks.

    A26: if the target is currently an admin and the new role is not
    ``admin``, refuse the demotion when it would leave zero admins.
    """
    if data.role != ROLE_ADMIN:
        target = user_service.get_user(user_id)
        if target is not None and target.role == ROLE_ADMIN and user_service.count_admins() <= 1:
            raise ValidationError(LAST_ADMIN_REQUIRED)
    return get_or_404(user_service.set_role(user_id, data.role), USER_NOT_FOUND)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    admin=Depends(get_admin_user),
):
    """Admin-only user deletion with A26 guardrails.

    - **Self-delete block:** admins cannot delete their own account via
      this endpoint.  Account deletion for the caller must be done through
      an explicit "delete my account" flow (not implemented here) so that
      the operation is intentional and separate from moderation.
    - **Admin quorum:** if the target is currently an admin, refuse the
      delete when the system would end up with zero admins.  A bored or
      compromised admin could otherwise demote/delete every other admin
      and lock the system into an un-administered state.
    """
    caller = user_service.get_user_by_supabase_id(admin["id"])
    if caller is not None and caller.id == user_id:
        raise AuthorizationError(CANNOT_DELETE_SELF)

    target = user_service.get_user(user_id)
    if target is not None and target.role == ROLE_ADMIN and user_service.count_admins() <= 1:
        raise ValidationError(LAST_ADMIN_REQUIRED)

    get_or_404(user_service.delete_user(user_id), USER_NOT_FOUND)
