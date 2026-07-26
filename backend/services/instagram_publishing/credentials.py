"""Encrypted credentials for configured Instagram publishing accounts."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from core.config import settings
from core.controlbox import InstagramPublishingAccountControl, controlbox
from core.database import get_sb
from core.errors import (
    INSTAGRAM_PUBLISHING_NOT_CONFIGURED,
    INSTAGRAM_REAUTHORIZATION_REQUIRED,
)
from core.exceptions import ValidationError
from core.tables import INSTAGRAM_PUBLISHING_ACCOUNTS
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


def import_access_token(
    access_token: str,
    *,
    now_utc: datetime | None = None,
) -> InstagramAccountCredentials:
    """Validate, identify, encrypt, and store one manually generated token."""
    token = access_token.strip()
    if not token:
        raise ValidationError("Instagram access token cannot be empty")

    now = _aware_utc(now_utc or datetime.now(timezone.utc))
    identity = MetaInstagramClient(token).get_identity()
    account = _configured_account_by_username(identity["username"])
    if account is None:
        raise ValidationError(
            "Instagram token belongs to an account that is not configured for publishing"
        )

    expires_at = now + timedelta(days=_CONTROL.token_lifetime_days)
    row = {
        "account_key": account.key,
        "school": account.school,
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
        raise RuntimeError(f"Could not store Instagram credentials for {account.key}")
    return _credentials_from_row(response.data[0], token=token)


def load_account_credentials(
    account: InstagramPublishingAccountControl,
    *,
    now_utc: datetime | None = None,
) -> InstagramAccountCredentials:
    """Load and decrypt the credential belonging to one configured account."""
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISHING_ACCOUNTS)
        .select("*")
        .eq("account_key", account.key)
        .limit(1)
        .execute()
    )
    if not response.data:
        raise ValidationError(INSTAGRAM_PUBLISHING_NOT_CONFIGURED)

    row = response.data[0]
    _assert_row_matches_account(row, account)
    if row.get("requires_reauthorization"):
        raise ValidationError(INSTAGRAM_REAUTHORIZATION_REQUIRED)

    expires_at = _parse_datetime(row["expires_at"])
    now = _aware_utc(now_utc or datetime.now(timezone.utc))
    if expires_at <= now:
        _mark_reauthorization_required(
            account.key,
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
        .select("*")
        .eq("requires_reauthorization", False)
        .lte("expires_at", refresh_before.isoformat())
        .order("expires_at")
        .execute()
    ).data or []
    stats = {"due": len(rows), "refreshed": 0, "failed": 0}

    for row in rows:
        account = _configured_account_by_key(str(row.get("account_key") or ""))
        if account is None:
            log.error(
                "Instagram token refresh skipped unknown account_key=%s",
                row.get("account_key"),
            )
            stats["failed"] += 1
            continue
        try:
            _assert_row_matches_account(row, account)
            current_token = _decrypt(row["encrypted_access_token"])
        except Exception:
            log.exception(
                "Instagram token refresh configuration failed account_key=%s",
                account.key,
            )
            stats["failed"] += 1
            continue

        try:
            refreshed = MetaInstagramClient(current_token).refresh_access_token()
            refreshed_token = str(refreshed["access_token"])
            identity = MetaInstagramClient(refreshed_token).get_identity()
            if (
                identity["id"] != str(row["instagram_user_id"])
                or identity["username"].casefold() != account.instagram_username.casefold()
            ):
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
                .eq("account_key", account.key)
                .execute()
            )
            stats["refreshed"] += 1
        except Exception as exc:
            error = _safe_error(exc, current_token)
            _mark_reauthorization_required(account.key, error, now)
            log.error(
                "Instagram token refresh failed account_key=%s: %s",
                account.key,
                error,
            )
            stats["failed"] += 1
    return stats


def _credentials_from_row(
    row: dict[str, Any],
    *,
    token: str,
) -> InstagramAccountCredentials:
    return InstagramAccountCredentials(
        account_key=str(row["account_key"]),
        school=str(row["school"]),
        instagram_user_id=str(row["instagram_user_id"]),
        instagram_username=str(row["instagram_username"]),
        access_token=token,
        expires_at=_parse_datetime(row["expires_at"]),
    )


def _assert_row_matches_account(
    row: dict[str, Any],
    account: InstagramPublishingAccountControl,
) -> None:
    if (
        row.get("school") != account.school
        or str(row.get("instagram_username") or "").casefold()
        != account.instagram_username.casefold()
    ):
        raise ValidationError(
            f"Stored Instagram credentials do not match configured account {account.key}"
        )


def _configured_account_by_key(key: str) -> InstagramPublishingAccountControl | None:
    return next((account for account in _CONTROL.accounts if account.key == key), None)


def _configured_account_by_username(
    instagram_username: str,
) -> InstagramPublishingAccountControl | None:
    return next(
        (
            account
            for account in _CONTROL.accounts
            if account.instagram_username.casefold() == instagram_username.casefold()
        ),
        None,
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
