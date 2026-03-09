from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from core.database import supabase

bearer = HTTPBearer()


async def get_current_user(
    token: HTTPAuthorizationCredentials = Depends(bearer),
) -> dict:
    """Validate the Bearer token against Supabase and return the auth user.

    Returns a dict with at minimum:
      - id:    supabase auth uid (str)
      - email: user email (str)
    """
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
