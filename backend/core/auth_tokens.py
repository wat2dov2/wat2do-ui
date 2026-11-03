"""Our session credentials: ES256 access tokens and opaque refresh tokens.

Access tokens are JWTs we sign with ``AUTH_SIGNING_KEY`` (a base64 PKCS#8 DER
EC P-256 private key) and verify locally with its public half.  Refresh tokens
are random strings; only their SHA-256 hash is stored (``auth_sessions``).
Rotating a refresh token derives its successor with an HMAC of the old one, so
a browser that sends the just-rotated token again within the reuse window gets
the same successor instead of forking the session.
"""

import base64
import hashlib
import hmac
import secrets
import time
from functools import cache

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from core.config import settings
from core.controlbox import controlbox

ACCESS_TOKEN_AUDIENCE = "authenticated"
ACCESS_TOKEN_ROLE = "authenticated"
_ALGORITHM = "ES256"
_REFRESH_TOKEN_BYTES = 32


@cache
def _private_key() -> ec.EllipticCurvePrivateKey:
    if not settings.auth_signing_key:
        raise RuntimeError(
            "AUTH_SIGNING_KEY is not set. Generate one with "
            "`openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -outform DER "
            "| base64` and put it in your .env file."
        )
    key = serialization.load_der_private_key(
        base64.b64decode(settings.auth_signing_key), password=None
    )
    if not isinstance(key, ec.EllipticCurvePrivateKey) or key.curve.name != "secp256r1":
        raise RuntimeError("AUTH_SIGNING_KEY must be an EC P-256 private key")
    return key


@cache
def _public_key() -> ec.EllipticCurvePublicKey:
    return _private_key().public_key()


@cache
def _key_id() -> str:
    der = _public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return hashlib.sha256(der).hexdigest()[:16]


@cache
def _rotation_key() -> bytes:
    der = _private_key().private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return hashlib.sha256(b"wat2do refresh token rotation\x00" + der).digest()


def access_token_seconds() -> int:
    return controlbox.authentication.access_token_minutes * 60


def issue_access_token(*, subject: str, email: str | None, session_id: str) -> str:
    """Sign a short-lived access token for one session."""
    now = int(time.time())
    claims = {
        "iss": controlbox.authentication.token_issuer,
        "aud": ACCESS_TOKEN_AUDIENCE,
        "role": ACCESS_TOKEN_ROLE,
        "sub": subject,
        "email": email,
        "session_id": session_id,
        "iat": now,
        "exp": now + access_token_seconds(),
    }
    return jwt.encode(claims, _private_key(), algorithm=_ALGORITHM, headers={"kid": _key_id()})


def decode_access_token(token: str) -> dict:
    """Verify an access token we signed; raises ``jwt.InvalidTokenError``."""
    return jwt.decode(
        token,
        _public_key(),
        algorithms=[_ALGORITHM],
        audience=ACCESS_TOKEN_AUDIENCE,
        issuer=controlbox.authentication.token_issuer,
        options={"require": ["exp", "iat", "sub", "session_id"]},
    )


def new_refresh_token() -> str:
    return secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)


def next_refresh_token(refresh_token: str) -> str:
    """The token that replaces *refresh_token* when it is rotated."""
    digest = hmac.new(_rotation_key(), refresh_token.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def refresh_token_hash(refresh_token: str) -> str:
    """Stored form of a refresh token (matches Postgres ``sha256(convert_to(t, 'UTF8'))``)."""
    return hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
