"""Verifying our ES256 access tokens.

The Rust API (``rust/src/api/auth.rs``, ``rust/src/api/routes/auth``) signs
them with ``AUTH_SIGNING_KEY`` (a base64 PKCS#8 DER EC P-256 private key) and
runs the sessions behind them; the Python routes verify them locally with the
key's public half.
"""

import base64
from functools import cache

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from core.config import settings
from core.controlbox import controlbox

ACCESS_TOKEN_AUDIENCE = "authenticated"
_ALGORITHM = "ES256"


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
