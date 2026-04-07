from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from core.constants import ROLE_ADMIN
from core.database import supabase
from core.errors import (
    ADMIN_ACCESS_REQUIRED,
    CREDENTIALS_INVALID,
    INVALID_OR_EXPIRED_TOKEN,
    NOT_AUTHORIZED,
    USER_NOT_FOUND,
)

bearer = HTTPBearer()
bearer_optional = HTTPBearer(auto_error=False)

# Lazy import to avoid circular dependency (user_service → database → config)
_user_service = None


def _get_user_service():
    global _user_service
    if _user_service is None:
        from services import user_service
        _user_service = user_service
    return _user_service


def _resolve_user(token: HTTPAuthorizationCredentials) -> dict:
    """Validate a Bearer token and return the Supabase auth user dict."""
    try:
        res = supabase.auth.get_user(token.credentials)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=INVALID_OR_EXPIRED_TOKEN,
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not res or not res.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=CREDENTIALS_INVALID,
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "id": res.user.id,
        "email": res.user.email,
        "aud": res.user.aud,
        "role": res.user.role,
    }


async def get_current_user(
    token: HTTPAuthorizationCredentials = Depends(bearer),
) -> dict:
    """Require a valid Bearer token. Returns the auth user or 401."""
    return _resolve_user(token)


async def get_optional_user(
    token: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
) -> dict | None:
    """Accept an optional Bearer token. Returns the auth user or None."""
    if token is None:
        return None
    try:
        return _resolve_user(token)
    except HTTPException:
        return None


async def get_admin_user(
    auth_user: dict = Depends(get_current_user),
) -> dict:
    """Require a valid Bearer token AND admin role. Returns 403 if not admin."""
    db_user = _get_user_service().get_user_by_supabase_id(auth_user["id"])
    if not db_user or db_user.role != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ADMIN_ACCESS_REQUIRED,
        )
    return auth_user


def is_admin(auth_user: dict) -> bool:
    """Return True if the authenticated user has the admin role (requires DB lookup)."""
    db_user = _get_user_service().get_user_by_supabase_id(auth_user["id"])
    return db_user is not None and db_user.role == ROLE_ADMIN


def resolve_db_user(auth_user: dict):
    """Look up the internal DB user from a Supabase auth user dict.

    Raises 404 if the user has not completed signup (no row in ``users``).
    Shared by routers that need the internal user row after auth.
    """
    db_user = _get_user_service().get_user_by_supabase_id(auth_user["id"])
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=USER_NOT_FOUND)
    return db_user


def require_owner_or_admin(auth_user: dict, resource_owner_id: str | None) -> None:
    """Raise 403 if the user is neither the resource owner nor an admin.

    When *resource_owner_id* is ``None`` (legacy rows created before ownership
    tracking), only admins may modify the resource.
    """
    if resource_owner_id and auth_user["id"] == resource_owner_id:
        return
    if is_admin(auth_user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=NOT_AUTHORIZED,
    )
