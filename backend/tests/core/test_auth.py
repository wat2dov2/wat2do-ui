import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.security import HTTPAuthorizationCredentials

from core import auth, auth_tokens
from core.controlbox import controlbox
from core.errors import INVALID_OR_EXPIRED_TOKEN
from core.exceptions import AuthenticationError


def _bearer(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _claims(**overrides) -> dict:
    now = int(time.time())
    claims = {
        "iss": controlbox.authentication.token_issuer,
        "aud": "authenticated",
        "role": "authenticated",
        "sub": "auth-id-1",
        "email": "student@example.com",
        "session_id": "session-1",
        "iat": now,
        "exp": now + 60,
    }
    claims.update(overrides)
    return claims


def test_our_access_token_resolves_to_its_user():
    token = auth_tokens.issue_access_token(
        subject="auth-id-1", email="student@example.com", session_id="session-1"
    )

    user = auth.get_current_user(_bearer(token))

    assert user == {
        "id": "auth-id-1",
        "email": "student@example.com",
        "aud": "authenticated",
        "role": "authenticated",
    }


@pytest.mark.parametrize(
    "token",
    [
        jwt.encode(_claims(), ec.generate_private_key(ec.SECP256R1()), algorithm="ES256"),
        jwt.encode(_claims(), "shared-secret", algorithm="HS256"),
        jwt.encode(_claims(), None, algorithm="none"),
        "not-a-jwt",
    ],
    ids=["foreign-key", "hmac", "unsigned", "garbage"],
)
def test_tokens_we_did_not_sign_are_rejected(token):
    with pytest.raises(AuthenticationError) as exc:
        auth.get_current_user(_bearer(token))

    assert exc.value.detail == INVALID_OR_EXPIRED_TOKEN


@pytest.mark.parametrize(
    "overrides",
    [
        {"exp": int(time.time()) - 1},
        {"aud": "anon"},
        {"iss": "https://other-issuer.example/auth/v1"},
        {"session_id": None},
    ],
    ids=["expired", "audience", "issuer", "no-session"],
)
def test_expired_or_misaddressed_tokens_are_rejected(overrides):
    claims = {key: value for key, value in _claims(**overrides).items() if value is not None}
    token = jwt.encode(claims, auth_tokens._private_key(), algorithm="ES256")

    with pytest.raises(AuthenticationError):
        auth.get_current_user(_bearer(token))


def test_optional_auth_treats_a_bad_token_as_anonymous():
    assert auth.get_optional_user(_bearer("not-a-jwt")) is None


def test_refresh_token_successor_is_stable_and_distinct():
    token = auth_tokens.new_refresh_token()

    successor = auth_tokens.next_refresh_token(token)

    assert successor == auth_tokens.next_refresh_token(token)
    assert successor != token
    assert auth_tokens.next_refresh_token(successor) != successor


def test_refresh_token_hash_matches_the_sql_import_formula():
    # The session import computes encode(sha256(convert_to(token, 'UTF8')), 'hex').
    assert (
        auth_tokens.refresh_token_hash("abc")
        == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
