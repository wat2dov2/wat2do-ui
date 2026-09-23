import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from core import auth
from core.errors import INVALID_OR_EXPIRED_TOKEN
from core.exceptions import AuthenticationError


def test_cold_process_key_fetch_failure_is_retryable(monkeypatch):
    class UnreachableJwksClient:
        def get_signing_key_from_jwt(self, credentials):
            raise jwt.PyJWKClientConnectionError("Signing key endpoint unavailable")

    monkeypatch.setattr(auth, "_get_jwks_client", lambda: UnreachableJwksClient())

    with pytest.raises(HTTPException) as exc:
        auth.get_current_user(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="valid-token"),
        )

    assert exc.value.status_code == 503


class EmptyJwksClient:
    def get_signing_key_from_jwt(self, credentials: str):
        raise jwt.PyJWKSetError("The JWK Set did not contain any keys")


def test_required_auth_converts_empty_jwks_to_authentication_error(monkeypatch):
    monkeypatch.setattr(auth, "_get_jwks_client", lambda: EmptyJwksClient())

    with pytest.raises(AuthenticationError) as exc:
        auth.get_current_user(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
        )

    assert exc.value.detail == INVALID_OR_EXPIRED_TOKEN


def test_optional_auth_treats_empty_jwks_as_anonymous(monkeypatch):
    monkeypatch.setattr(auth, "_get_jwks_client", lambda: EmptyJwksClient())

    user = auth.get_optional_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
    )

    assert user is None
