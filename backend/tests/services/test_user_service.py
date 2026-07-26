from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from core.errors import PROMOTER_TOS_REQUIRED, USER_HAS_PAYOUTS
from core.exceptions import ValidationError
from core.tables import USERS
from schemas.user import PromoterEnrollmentUpdate, UserResponse
from services import user_service
from services.user_service import get_user


def test_get_user_returns_none_when_no_row(fake_sb, patch_sb):
    """No rows back from Supabase → service returns ``None`` (not an error)."""
    patch_sb("services.user_service")
    fake_sb.set_response(data=[])

    assert get_user(uuid4()) is None


def test_get_user_queries_users_table_by_id(fake_sb, patch_sb):
    """Guards against filter-column drift (``.eq("id", ...)`` → ``.eq("uuid", ...)``)."""
    patch_sb("services.user_service")
    user_id = uuid4()
    fake_sb.set_response(data=[])

    get_user(user_id)

    fake_sb.table.assert_called_once_with(USERS)
    fake_sb.select.assert_called_once_with("*")
    fake_sb.eq.assert_called_once_with("id", str(user_id))


def test_promoter_enrollment_requires_tos_for_first_acceptance(monkeypatch):
    user = UserResponse(
        id=uuid4(),
        email="person@example.com",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=user))

    with pytest.raises(ValidationError, match=PROMOTER_TOS_REQUIRED):
        user_service.update_promoter_enrollment(
            user.id,
            PromoterEnrollmentUpdate(
                payout_email="promoter@example.com",
                accept_tos=False,
            ),
        )


def test_promoter_enrollment_stamps_server_owned_fields(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.user_service")
    user = UserResponse(
        id=uuid4(),
        email="person@example.com",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=user))
    updated = {
        **user.model_dump(mode="json"),
        "payout_email": "promoter@example.com",
        "promoter_tos_accepted_at": datetime.now(timezone.utc).isoformat(),
        "promoter_tos_version": "2026-01",
    }
    fake_sb.set_response(data=[updated])

    result = user_service.update_promoter_enrollment(
        user.id,
        PromoterEnrollmentUpdate(
            payout_email="promoter@example.com",
            accept_tos=True,
        ),
    )

    payload = fake_sb.update.call_args.args[0]
    assert payload["payout_email"] == "promoter@example.com"
    assert payload["promoter_tos_version"] == "2026-01"
    assert "promoter_tos_accepted_at" in payload
    assert result is not None


def test_delete_user_rejects_financial_record_removal(fake_sb, patch_sb):
    patch_sb("services.user_service")
    fake_sb.set_response(data=[{"id": str(uuid4())}], count=1)

    with pytest.raises(ValidationError, match=USER_HAS_PAYOUTS):
        user_service.delete_user(uuid4())

    fake_sb.delete.assert_not_called()


def test_delete_user_without_payouts_deletes_profile(fake_sb, patch_sb):
    patch_sb("services.user_service")
    user_id = uuid4()
    fake_sb.queue_responses([[], [{"id": str(user_id)}]])

    assert user_service.delete_user(user_id) is True
    fake_sb.delete.assert_called_once()
