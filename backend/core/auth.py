from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from core.database import supabase

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
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not res or not res.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
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
    if not db_user or db_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return auth_user
