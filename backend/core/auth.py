import logging
from collections.abc import Callable
from typing import TypeVar

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

log = logging.getLogger(__name__)

bearer = HTTPBearer()
bearer_optional = HTTPBearer(auto_error=False)

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


def _payload_to_user(payload: dict) -> dict:
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
) -> dict:
    """Require a valid Bearer token. Returns the auth user or 401.

    Defined as a plain ``def`` so FastAPI runs it in a thread-pool,
    keeping the synchronous JWT / JWKS operations off the event loop.
    """
    return _resolve_user(token)


def get_optional_user(
    token: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
) -> dict | None:
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


def _check_admin(supabase_id: str, *, user_lookup=None) -> bool:
    """Return True if the user identified by *supabase_id* has the admin role.

    Single source of truth for the DB lookup + role comparison used by
    both ``get_admin_user`` and ``is_admin``.  Always bypasses the user
    cache so that role changes take effect immediately.

    *user_lookup* can be injected for testing; defaults to
    ``user_service.get_user_by_supabase_id`` (with ``bypass_cache=True``).
    """
    lookup = user_lookup or (
        lambda sid: _get_user_service().get_user_by_supabase_id(sid, bypass_cache=True)
    )
    db_user = lookup(supabase_id)
    return db_user is not None and db_user.role == ROLE_ADMIN


def get_admin_user(
    auth_user: dict = Depends(get_current_user),
) -> dict:
    """Require a valid Bearer token AND admin role. Returns 403 if not admin.

    Bypasses the user cache so that role changes (e.g. demotion) take
    effect immediately — no stale-cache window.
    """
    if not _check_admin(auth_user["id"]):
        raise AuthorizationError(ADMIN_ACCESS_REQUIRED)
    return auth_user


def is_admin(auth_user: dict, *, user_lookup=None) -> bool:
    """Return True if the authenticated user has the admin role (requires DB lookup).

    Bypasses the user cache so that role changes take effect immediately.

    *user_lookup* can be injected for testing; defaults to
    ``user_service.get_user_by_supabase_id``.
    """
    return _check_admin(auth_user["id"], user_lookup=user_lookup)


def resolve_db_user(auth_user: dict, *, user_lookup=None):
    """Look up the internal DB user from a Supabase auth user dict.

    Raises 404 if the user has not completed signup (no row in ``users``).
    Shared by routers that need the internal user row after auth.

    *user_lookup* can be injected for testing; defaults to
    ``user_service.get_user_by_supabase_id``.
    """
    lookup = user_lookup or _get_user_service().get_user_by_supabase_id
    db_user = lookup(auth_user["id"])
    if not db_user:
        raise NotFoundError(USER_NOT_FOUND)
    return db_user


def get_db_user(
    auth_user: dict = Depends(get_current_user),
):
    """FastAPI dependency: authenticate then resolve the internal DB user.

    Composes ``get_current_user`` with ``resolve_db_user`` so routers
    can use ``Depends(get_db_user)`` instead of the manual two-step.
    """
    return resolve_db_user(auth_user)


def require_owner_or_admin(auth_user: dict, resource_owner_id: str | None) -> None:
    """Raise 403 if the user is neither the resource owner nor an admin.

    When *resource_owner_id* is ``None`` (legacy rows created before ownership
    tracking), only admins may modify the resource.
    """
    if resource_owner_id and auth_user["id"] == resource_owner_id:
        return
    if is_admin(auth_user):
        return
    raise AuthorizationError(NOT_AUTHORIZED)


T = TypeVar("T")


def get_authorized_resource(
    fetcher: Callable[[], T | None],
    not_found_detail: str,
    auth_user: dict,
    *,
    owner_field: str = "created_by",
) -> T:
    """Fetch a resource, raise 404 if missing, raise 403 if not owner/admin.

    *fetcher* is a zero-argument callable that returns the resource or ``None``.
    *not_found_detail* is the error string for the 404 response.
    *owner_field* is the attribute name on the resource that holds the owner ID.
    """
    resource = fetcher()
    if resource is None:
        raise NotFoundError(not_found_detail)
    require_owner_or_admin(auth_user, getattr(resource, owner_field))
    return resource
