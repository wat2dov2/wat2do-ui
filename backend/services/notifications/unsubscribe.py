"""Stateless signed unsubscribe links for user-configurable email types."""

import base64
import hashlib
import hmac
from dataclasses import dataclass
from typing import cast
from uuid import UUID

from core.config import settings
from core.constants import NOTIFICATION_TYPES
from schemas.notification_preference import NotificationPreferenceUpdate, NotificationType
from services.notifications.preferences import set_preferences
from services.school_context import school_frontend_url

_TOKEN_VERSION = "1"


@dataclass(frozen=True)
class UnsubscribeTarget:
    user_id: str
    notification_type: NotificationType


def create_unsubscribe_token(user_id: str, notification_type: NotificationType) -> str:
    payload = f"{_TOKEN_VERSION}:{UUID(user_id)}:{notification_type}"
    signature = hmac.new(
        _secret(),
        payload.encode(),
        hashlib.sha256,
    ).digest()
    return _encode(payload.encode() + b"." + signature)


def verify_unsubscribe_token(token: str) -> UnsubscribeTarget | None:
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
        if version != _TOKEN_VERSION or notification_type not in NOTIFICATION_TYPES:
            return None
        return UnsubscribeTarget(
            user_id=str(UUID(raw_user_id)),
            notification_type=cast(NotificationType, notification_type),
        )
    except (ValueError, UnicodeDecodeError):
        return None


def unsubscribe(token: str) -> bool:
    target = verify_unsubscribe_token(token)
    if target is None:
        return False
    set_preferences(
        target.user_id,
        [
            NotificationPreferenceUpdate(
                notification_type=target.notification_type,
                enabled=False,
            )
        ],
    )
    return True


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


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
