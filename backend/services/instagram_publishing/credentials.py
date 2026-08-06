"""Encrypted credentials for configured Instagram publishing accounts."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from core.config import settings
from core.controlbox import controlbox
from core.database import get_sb
from core.errors import (
    INSTAGRAM_PUBLISHING_NOT_CONFIGURED,
    INSTAGRAM_REAUTHORIZATION_REQUIRED,
)
from core.exceptions import ValidationError
from core.tables import INSTAGRAM_PUBLISHING_ACCOUNTS
from services import school_service
from services.instagram_publishing.meta import MetaInstagramClient

log = logging.getLogger(__name__)
_CONTROL = controlbox.instagram_publishing


@dataclass(frozen=True)
class InstagramAccountCredentials:
    account_key: str
    school: str
    instagram_user_id: str
    instagram_username: str
    access_token: str = field(repr=False)
    expires_at: datetime
    school_id: int | None = None


def import_access_token(
    access_token: str,
    account_key: str,
    *,
    now_utc: datetime | None = None,
) -> InstagramAccountCredentials:
    """Validate, encrypt, and store one manually generated token for *account_key*.

    The caller names the account. The Instagram handle is recorded as observed
    rather than asserted against config: a handle can be renamed at any time,
    while the numeric user id behind it cannot, so the id is what later refreshes
    verify against.
    """
    token = access_token.strip()
    if not token:
        raise ValidationError("Instagram access token cannot be empty")

    now = _aware_utc(now_utc or datetime.now(timezone.utc))
    key = account_key.strip()
    # The key is the slug of the school the account publishes for, so an
    # unregistered school is the one thing worth rejecting before calling out.
    school = school_service.get_school(key)
    if school is None:
        raise ValidationError(f"No registered school matches account key {key!r}")
    identity = MetaInstagramClient(token).get_identity()

    expires_at = now + timedelta(days=_CONTROL.token_lifetime_days)
    row = {
        "account_key": key,
        "school_id": school.id,
        "instagram_user_id": identity["id"],
        "instagram_username": identity["username"],
        "encrypted_access_token": _encrypt(token),
        "expires_at": expires_at.isoformat(),
        "requires_reauthorization": False,
        "last_validated_at": now.isoformat(),
        "last_refreshed_at": None,
        "refresh_error": None,
        "refresh_failed_at": None,
        "updated_at": now.isoformat(),
    }
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
        .upsert(row, on_conflict="account_key")
        .execute()
    )
    if not response.data:
        raise RuntimeError(f"Could not store Instagram credentials for {key}")
    return _credentials_from_row(
        {**response.data[0], "school": key},
        token=token,
    )


def load_account_credentials(
    account_key: str,
    *,
    now_utc: datetime | None = None,
) -> InstagramAccountCredentials:
    """Load and decrypt the credential belonging to one connected account."""
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
        .select(f"*,{school_service.SCHOOL_SLUG_EMBED}")
        .eq("account_key", account_key)
        .limit(1)
        .execute()
    )
    if not response.data:
        raise ValidationError(INSTAGRAM_PUBLISHING_NOT_CONFIGURED)

    row = response.data[0]
    if row.get("requires_reauthorization"):
        raise ValidationError(INSTAGRAM_REAUTHORIZATION_REQUIRED)

    expires_at = _parse_datetime(row["expires_at"])
    now = _aware_utc(now_utc or datetime.now(timezone.utc))
    if expires_at <= now:
        _mark_reauthorization_required(
            account_key,
            "Instagram access token expired before it could be refreshed",
            now,
        )
        raise ValidationError(INSTAGRAM_REAUTHORIZATION_REQUIRED)

    return _credentials_from_row(row, token=_decrypt(row["encrypted_access_token"]))


def refresh_expiring_tokens(
    now_utc: datetime | None = None,
) -> dict[str, int]:
    """Refresh every healthy token within the configured expiry window."""
    now = _aware_utc(now_utc or datetime.now(timezone.utc))
    refresh_before = now + timedelta(days=_CONTROL.token_refresh_lead_days)
    rows = (
        get_sb()
        .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
        .select(f"*,{school_service.SCHOOL_SLUG_EMBED}")
        .eq("requires_reauthorization", False)
        .lte("expires_at", refresh_before.isoformat())
        .order("expires_at")
        .execute()
    ).data or []
    stats = {"due": len(rows), "refreshed": 0, "failed": 0}

    for row in rows:
        account_key = str(row.get("account_key") or "")
        try:
            current_token = _decrypt(row["encrypted_access_token"])
        except Exception:
            log.exception(
                "Instagram token refresh configuration failed account_key=%s",
                account_key,
            )
            stats["failed"] += 1
            continue

        try:
            refreshed = MetaInstagramClient(current_token).refresh_access_token()
            refreshed_token = str(refreshed["access_token"])
            identity = MetaInstagramClient(refreshed_token).get_identity()
            # The numeric id is the account's stable identity; the handle is
            # free to change and is simply recorded below.
            if identity["id"] != str(row["instagram_user_id"]):
                raise RuntimeError("Refreshed Instagram token identity does not match account")

            expires_at = now + timedelta(seconds=int(refreshed["expires_in"]))
            (
                get_sb()
                .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
                .update(
                    {
                        "instagram_user_id": identity["id"],
                        "instagram_username": identity["username"],
                        "encrypted_access_token": _encrypt(refreshed_token),
                        "expires_at": expires_at.isoformat(),
                        "requires_reauthorization": False,
                        "last_validated_at": now.isoformat(),
                        "last_refreshed_at": now.isoformat(),
                        "refresh_error": None,
                        "refresh_failed_at": None,
                        "updated_at": now.isoformat(),
                    }
                )
                .eq("account_key", account_key)
                .execute()
            )
            stats["refreshed"] += 1
        except Exception as exc:
            error = _safe_error(exc, current_token)
            _mark_reauthorization_required(account_key, error, now)
            log.error(
                "Instagram token refresh failed account_key=%s: %s",
                account_key,
                error,
            )
            stats["failed"] += 1
    return stats


def _credentials_from_row(
    row: dict[str, Any],
    *,
    token: str,
) -> InstagramAccountCredentials:
    row = school_service.with_school_slug(row)
    return InstagramAccountCredentials(
        account_key=str(row["account_key"]),
        school_id=int(row["school_id"]) if row.get("school_id") is not None else None,
        school=str(row["school"]),
        instagram_user_id=str(row["instagram_user_id"]),
        instagram_username=str(row["instagram_username"]),
        access_token=token,
        expires_at=_parse_datetime(row["expires_at"]),
    )


def _mark_reauthorization_required(
    account_key: str,
    error: str,
    now: datetime,
) -> None:
    (
        get_sb()
        .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
        .update(
            {
                "requires_reauthorization": True,
                "refresh_error": error[:2000],
                "refresh_failed_at": now.isoformat(),
                "updated_at": now.isoformat(),
            }
        )
        .eq("account_key", account_key)
        .execute()
    )


def _fernet() -> Fernet:
    key = settings.instagram_token_encryption_key.strip()
    if not key:
        raise ValidationError(INSTAGRAM_PUBLISHING_NOT_CONFIGURED)
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise ValidationError("Instagram token encryption key is invalid") from exc


def _encrypt(access_token: str) -> str:
    return _fernet().encrypt(access_token.encode("utf-8")).decode("ascii")


def _decrypt(encrypted_access_token: str) -> str:
    try:
        return _fernet().decrypt(encrypted_access_token.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError, UnicodeEncodeError) as exc:
        raise ValidationError("Stored Instagram access token could not be decrypted") from exc


def _safe_error(exc: Exception, access_token: str) -> str:
    message = str(exc) or exc.__class__.__name__
    return message.replace(access_token, "[REDACTED]")[:2000]


def _parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return _aware_utc(value)
    return _aware_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(timezone.utc)


__all__ = (
    "InstagramAccountCredentials",
    "import_access_token",
    "load_account_credentials",
    "refresh_expiring_tokens",
)
