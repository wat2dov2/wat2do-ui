import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, TypedDict, TypeVar

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from core.config import settings
from core.constants import ROLE_ADMIN
from core.errors import (
    ADMIN_ACCESS_REQUIRED,
    AUTHENTICATION_ERROR,
    CLUB_MEMBER_OR_ADMIN_ACCESS_REQUIRED,
    CREDENTIALS_INVALID,
    INVALID_OR_EXPIRED_TOKEN,
    NOT_AUTHORIZED,
    USER_NOT_FOUND,
)
from core.exceptions import AuthenticationError, AuthorizationError, NotFoundError

if TYPE_CHECKING:
    from schemas.user import UserResponse

log = logging.getLogger(__name__)

bearer = HTTPBearer()
bearer_optional = HTTPBearer(auto_error=False)


class AuthUser(TypedDict):
    """JWT-derived identity dict returned by ``get_current_user``.

    ``id`` is the Supabase auth id (JWT ``sub`` claim), **not** the
    internal ``users.id`` UUID. Use this dict when you only need to
    confirm authentication; use ``get_db_user`` whenever you need the
    internal user id or the user's role (ownership, admin checks).
    """

    id: str
    email: str | None
    aud: str | None
    role: str | None


# JWKS client - fetches public keys from Supabase's discovery endpoint
# and caches them in-memory for 10 minutes.
_jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
_jwks_client: PyJWKClient | None = None
# Only asymmetric algorithms are allowed in the JWKS path.  Never include
# HS256 here - doing so enables the classic "algorithm confusion" attack where
# an attacker signs a token with the *public* key as an HMAC secret.
_ASYMMETRIC_ALGS = ("RS256", "ES256", "EdDSA")
# Supabase issues tokens with iss = <project_url>/auth/v1
_EXPECTED_ISSUER = settings.supabase_jwt_issuer or f"{settings.supabase_url.rstrip('/')}/auth/v1"

# Lazy import to avoid circular dependency (user_service → database → config)
_user_service = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(_jwks_url, cache_keys=True, lifespan=600)
    return _jwks_client


def _get_user_service():
    global _user_service
    if _user_service is None:
        from services import user_service

        _user_service = user_service
    return _user_service


def _resolve_user(token: HTTPAuthorizationCredentials) -> AuthUser:
    """Validate a Bearer token locally via JWKS signature verification."""
    return _decode_jwt(token.credentials)


def _decode_jwt(credentials: str) -> AuthUser:
    """Decode and verify a raw JWT string.

    Narrowed exception surface so signature failures surface clearly.
    Failures are logged at ``warning`` so operators see JWKS regressions.
    """
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(credentials)
        payload = jwt.decode(
            credentials,
            signing_key.key,
            algorithms=list(_ASYMMETRIC_ALGS),
            audience="authenticated",
            issuer=_EXPECTED_ISSUER,
        )
        return _payload_to_user(payload)
    except jwt.PyJWKClientConnectionError as e:
        # A fresh worker has no cached signing keys. Failure to fetch them
        # during a deployment is not evidence that the user's token is invalid.
        log.warning("JWKS endpoint unavailable: %s", e)
        raise HTTPException(status_code=503, detail=AUTHENTICATION_ERROR) from e
    except (jwt.PyJWKClientError, jwt.PyJWKSetError, jwt.InvalidTokenError) as e:
        log.warning("JWKS verification failed: %s", e)
        raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN) from e


def _payload_to_user(payload: dict) -> AuthUser:
    """Extract user info from a verified JWT payload."""
    sub = payload.get("sub")
    if not sub:
        raise AuthenticationError(CREDENTIALS_INVALID)
    return {
        "id": sub,
        "email": payload.get("email"),
        "aud": payload.get("aud"),
        "role": payload.get("role"),
    }


def get_current_user(
    token: HTTPAuthorizationCredentials = Depends(bearer),
) -> AuthUser:
    """Require a valid Bearer token. Returns the auth user or 401.

    Defined as a plain ``def`` so FastAPI runs it in a thread-pool,
    keeping the synchronous JWT / JWKS operations off the event loop.
    """
    return _resolve_user(token)


def get_optional_user(
    token: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
) -> AuthUser | None:
    """Accept an optional Bearer token. Returns the auth user or None.

    Distinguishes "no header" (truly anonymous, silent) from "bad
    header" (malformed / expired token).  Malformed tokens are logged at
    ``warning`` so operators can spot auth regressions and clients can
    detect misconfigured sessions via log correlation rather than blind
    anonymity.
    """
    if token is None:
        return None
    try:
        return _resolve_user(token)
    except (AuthenticationError, HTTPException) as e:
        log.warning("Optional auth failed with invalid token, continuing as anonymous: %s", e)
        return None


def resolve_db_user(auth_user: AuthUser, *, user_lookup=None) -> "UserResponse":
    """Look up the internal DB user from a Supabase auth user dict.

    Unifying on the DB user means we pay for one fresh read and everyone
    downstream gets the current role.

    Raises 404 if the user has not completed signup (no row in ``users``).
    Shared by routers that need the internal user row after auth.

    *user_lookup* can be injected for testing.
    """
    lookup = user_lookup or _get_user_service().get_user_by_supabase_id
    db_user = lookup(auth_user["id"])
    if not db_user:
        raise NotFoundError(USER_NOT_FOUND)
    return db_user


def get_db_user(
    auth_user: AuthUser = Depends(get_current_user),
) -> "UserResponse":
    """FastAPI dependency: authenticate then resolve the internal DB user.

    Composes ``get_current_user`` with ``resolve_db_user`` so routers
    can use ``Depends(get_db_user)`` instead of the manual two-step.

    Returned ``UserResponse`` carries both ``.id`` (internal UUID used
    for ownership comparisons) and ``.role`` (used for admin checks)
    - one consistent shape for every downstream helper.
    """
    return resolve_db_user(auth_user)


def get_admin_user(
    db_user: "UserResponse" = Depends(get_db_user),
) -> "UserResponse":
    """Require a valid Bearer token AND admin role. Returns 403 if not admin.

    Reads role from the fresh DB user returned by ``get_db_user`` (which
    bypasses the user cache) so demotions take effect immediately.
    """
    if db_user.role != ROLE_ADMIN:
        raise AuthorizationError(ADMIN_ACCESS_REQUIRED)
    return db_user


def get_club_owner_or_admin(
    db_user: "UserResponse" = Depends(get_db_user),
) -> "UserResponse":
    """Require admin OR club manager/member (user in at least one club). Returns 403 if neither."""
    if db_user.role == ROLE_ADMIN:
        return db_user

    from services import club_service

    clubs = club_service.list_clubs_by_owner(str(db_user.id))
    if not clubs:
        raise AuthorizationError(CLUB_MEMBER_OR_ADMIN_ACCESS_REQUIRED)
    return db_user


def is_admin(db_user: "UserResponse") -> bool:
    """Return True if *db_user* has the admin role.

    Trivial role check - no DB lookup. Callers must pass the DB user
    from ``get_db_user`` (or ``get_admin_user``), which already bypasses
    the user cache at resolve time.
    """
    return db_user.role == ROLE_ADMIN


def require_owner_or_admin(db_user: "UserResponse", resource_owner_id: str | None) -> None:
    """Raise 403 if *db_user* is neither the resource owner nor an admin.

    Ownership is compared against the internal ``users.id`` UUID - every
    resource's ``created_by`` / ``owner_id`` / ``user_id`` column stores
    this value after the ``unify_created_by_to_internal_id`` migration.

    When *resource_owner_id* is ``None``, only admins may modify the resource.
    """
    if resource_owner_id is not None and str(db_user.id) == str(resource_owner_id):
        return
    if db_user.role == ROLE_ADMIN:
        return
    raise AuthorizationError(NOT_AUTHORIZED)


T = TypeVar("T")


def get_authorized_resource(
    fetcher: Callable[[], T | None],
    not_found_detail: str,
    db_user: "UserResponse",
    *,
    owner_field: str = "created_by",
) -> T:
    """Fetch a resource, raise 404 if missing, raise 403 if not owner/admin.

    *fetcher* is a zero-argument callable that returns the resource or ``None``.
    *not_found_detail* is the error string for the 404 response.
    *db_user* is the authenticated DB user (``Depends(get_db_user)``).
    *owner_field* is the attribute name on the resource that holds the
    owner's internal ``users.id`` UUID.
    """
    resource = fetcher()
    if resource is None:
        raise NotFoundError(not_found_detail)
    owner = getattr(resource, owner_field)
    require_owner_or_admin(db_user, str(owner) if owner is not None else None)
    return resource
