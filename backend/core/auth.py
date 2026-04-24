import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, TypedDict, TypeVar

import jwt
from jwt import PyJWKClient

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from core.config import settings
from core.constants import ROLE_ADMIN
from core.errors import (
    ADMIN_ACCESS_REQUIRED,
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

# JWKS client — fetches public keys from Supabase's discovery endpoint
# and caches them in-memory for 10 minutes.
_jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
_jwks_client: PyJWKClient | None = None
# Only asymmetric algorithms are allowed in the JWKS path.  Never include
# HS256 here — doing so enables the classic "algorithm confusion" attack where
# an attacker signs a token with the *public* key as an HMAC secret.
_ASYMMETRIC_ALGS = ("RS256", "ES256", "EdDSA")
# Supabase issues tokens with iss = <project_url>/auth/v1
_EXPECTED_ISSUER = f"{settings.supabase_url.rstrip('/')}/auth/v1"

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


def _resolve_user(token: HTTPAuthorizationCredentials) -> dict:
    """Validate a Bearer token locally via JWT signature verification.

    Tries JWKS discovery first (asymmetric signing keys — ES256/RS256).
    Falls back to SUPABASE_JWT_SECRET (HS256) for legacy projects.
    """
    return _decode_jwt(token.credentials)


def _decode_jwt(credentials: str) -> dict:
    """Decode and verify a raw JWT string. Returns the auth-user dict.

    A21: narrowed the exception surface of the JWKS branch so that signature
    failures surface clearly.  Only JWKS-specific (``PyJWKClientError``) and
    signature-specific (``InvalidTokenError``) errors trigger the HS256
    fallback — arbitrary bugs no longer silently downgrade the verification.
    Failures are logged at ``warning`` so operators see JWKS regressions.
    """
    # 1) JWKS discovery (asymmetric signing keys only — never HS256)
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
    except (jwt.PyJWKClientError, jwt.InvalidTokenError) as e:
        log.warning("JWKS verification failed (%s), trying JWT secret fallback", e)

    # 2) Shared secret fallback (legacy HS256)
    if settings.supabase_jwt_secret:
        try:
            payload = jwt.decode(
                credentials,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=_EXPECTED_ISSUER,
            )
            return _payload_to_user(payload)
        except jwt.InvalidTokenError as e:
            log.warning("JWT HS256 fallback verification failed: %s", e)

    raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)


def decode_jwt_payload(credentials: str) -> dict:
    """Decode a JWT and return the *raw payload* (not the auth-user dict).

    Used by flows that need to inspect claims beyond ``sub/email/aud/role``
    — e.g. password reset, which must verify the token was issued for
    recovery (``amr=["recovery"]`` / ``email_action_type="recovery"``) and
    not a regular session.
    """
    # Reuse the signature-verification path in _decode_jwt by decoding a
    # second time without the auth-user projection.
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(credentials)
        return jwt.decode(
            credentials,
            signing_key.key,
            algorithms=list(_ASYMMETRIC_ALGS),
            audience="authenticated",
            issuer=_EXPECTED_ISSUER,
        )
    except (jwt.PyJWKClientError, jwt.InvalidTokenError) as e:
        log.warning("JWKS payload decode failed (%s), trying HS256 fallback", e)

    if settings.supabase_jwt_secret:
        try:
            return jwt.decode(
                credentials,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=_EXPECTED_ISSUER,
            )
        except jwt.InvalidTokenError as e:
            log.warning("HS256 payload decode failed: %s", e)

    raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)


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

    A4: Distinguishes "no header" (truly anonymous, silent) from "bad
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

    Bypasses the user-service cache so that role changes (and, by
    extension, ownership-vs-admin decisions) take effect immediately on
    the very next request. The old ``_check_admin`` path used to do this
    with a second DB round-trip; unifying on the DB user means we pay
    for one fresh read and everyone downstream gets the current role.

    Raises 404 if the user has not completed signup (no row in ``users``).
    Shared by routers that need the internal user row after auth.

    *user_lookup* can be injected for testing; defaults to
    ``user_service.get_user_by_supabase_id(bypass_cache=True)``.
    """
    lookup = user_lookup or (
        lambda sid: _get_user_service().get_user_by_supabase_id(sid, bypass_cache=True)
    )
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
    — one consistent shape for every downstream helper.
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


def is_admin(db_user: "UserResponse") -> bool:
    """Return True if *db_user* has the admin role.

    Trivial role check — no DB lookup. Callers must pass the DB user
    from ``get_db_user`` (or ``get_admin_user``), which already bypasses
    the user cache at resolve time.
    """
    return db_user.role == ROLE_ADMIN


def require_owner_or_admin(
    db_user: "UserResponse", resource_owner_id: str | None
) -> None:
    """Raise 403 if *db_user* is neither the resource owner nor an admin.

    Ownership is compared against the internal ``users.id`` UUID — every
    resource's ``created_by`` / ``owner_id`` / ``user_id`` column stores
    this value after the ``unify_created_by_to_internal_id`` migration.

    When *resource_owner_id* is ``None`` (legacy rows created before
    ownership tracking), only admins may modify the resource.
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
