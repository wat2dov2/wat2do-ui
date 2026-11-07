"""Stateless signed unsubscribe links for user-configurable email types.

The API verifies them (``rust/src/notifications/unsubscribe.rs``), so the format
never changes."""

import base64
import hashlib
import hmac
from uuid import UUID

from core.config import settings
from schemas.notification_preference import NotificationType
from services.school_context import school_frontend_url

_TOKEN_VERSION = "1"


def create_unsubscribe_token(user_id: str, notification_type: NotificationType) -> str:
    payload = f"{_TOKEN_VERSION}:{UUID(user_id)}:{notification_type}"
    signature = hmac.new(
        _secret(),
        payload.encode(),
        hashlib.sha256,
    ).digest()
    return _encode(payload.encode() + b"." + signature)


def unsubscribe_url(
    user_id: str,
    notification_type: NotificationType,
    school: str | None,
) -> str:
    base_url = school_frontend_url(school)
    return (
        f"{base_url}/api/notification-preferences/unsubscribe"
        f"?token={create_unsubscribe_token(user_id, notification_type)}"
    )


def _secret() -> bytes:
    secret = settings.email_unsubscribe_secret
    if not secret:
        raise RuntimeError("EMAIL_UNSUBSCRIBE_SECRET is required for email sends")
    return secret.encode()


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()
