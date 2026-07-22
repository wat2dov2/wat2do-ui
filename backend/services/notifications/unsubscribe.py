"""Stateless signed morning-email unsubscribe links."""

import base64
import hashlib
import hmac
from uuid import UUID

from core.config import settings
from core.constants import NOTIFICATION_TYPE_MORNING_EMAIL
from schemas.notification_preference import NotificationPreferenceUpdate
from services.notifications.preferences import set_preferences

_TOKEN_VERSION = "1"


def create_unsubscribe_token(user_id: str) -> str:
    payload = f"{_TOKEN_VERSION}:{UUID(user_id)}:{NOTIFICATION_TYPE_MORNING_EMAIL}"
    signature = hmac.new(
        _secret(),
        payload.encode(),
        hashlib.sha256,
    ).digest()
    return _encode(payload.encode() + b"." + signature)


def verify_unsubscribe_token(token: str) -> str | None:
    try:
        decoded = _decode(token)
        payload_bytes, supplied_signature = decoded.rsplit(b".", 1)
        expected_signature = hmac.new(
            _secret(),
            payload_bytes,
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(supplied_signature, expected_signature):
            return None
        version, raw_user_id, notification_type = payload_bytes.decode().split(
            ":",
            2,
        )
        if version != _TOKEN_VERSION or notification_type != NOTIFICATION_TYPE_MORNING_EMAIL:
            return None
        return str(UUID(raw_user_id))
    except (ValueError, UnicodeDecodeError):
        return None


def unsubscribe(token: str) -> bool:
    user_id = verify_unsubscribe_token(token)
    if user_id is None:
        return False
    set_preferences(
        user_id,
        [
            NotificationPreferenceUpdate(
                notification_type=NOTIFICATION_TYPE_MORNING_EMAIL,
                enabled=False,
            )
        ],
    )
    return True


def unsubscribe_url(user_id: str) -> str:
    base_url = settings.frontend_url.rstrip("/")
    return (
        f"{base_url}/api/notification-preferences/unsubscribe"
        f"?token={create_unsubscribe_token(user_id)}"
    )


def _secret() -> bytes:
    secret = settings.email_unsubscribe_secret
    if not secret:
        raise RuntimeError("EMAIL_UNSUBSCRIBE_SECRET is required for email sends")
    return secret.encode()


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
