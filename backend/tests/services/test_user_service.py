from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from core.errors import (
    PROMOTER_PROGRAM_PAUSED,
    PROMOTER_SCHOOL_REQUIRED,
    PROMOTER_TOS_REQUIRED,
    USER_HAS_PAYOUT_REVIEWS,
    USER_HAS_PAYOUTS,
    USER_HAS_PROMOTER_POSTERS,
)
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
        school="uwaterloo",
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
        school="uwaterloo",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=user))
    updated = {
        **user.model_dump(mode="json"),
        "payout_email": "promoter@example.com",
        "promoter_tos_accepted_at": datetime.now(timezone.utc).isoformat(),
        "promoter_tos_version": "2026-07",
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
    assert payload["promoter_tos_version"] == "2026-07"
    assert "promoter_tos_accepted_at" in payload
    assert result is not None


def test_first_promoter_enrollment_requires_supported_school(monkeypatch):
    user = UserResponse(
        id=uuid4(),
        email="person@example.com",
        school=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=user))

    with pytest.raises(ValidationError, match=PROMOTER_SCHOOL_REQUIRED):
        user_service.update_promoter_enrollment(
            user.id,
            PromoterEnrollmentUpdate(
                payout_email="promoter@example.com",
                accept_tos=True,
            ),
        )


def test_first_promoter_enrollment_is_blocked_while_program_paused(monkeypatch):
    user = UserResponse(
        id=uuid4(),
        email="person@example.com",
        school="uwaterloo",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=user))
    monkeypatch.setattr(
        user_service,
        "controlbox",
        SimpleNamespace(
            promoter_program=SimpleNamespace(
                enabled=False,
                tos_version="2026-07",
            )
        ),
    )

    with pytest.raises(ValidationError, match=PROMOTER_PROGRAM_PAUSED):
        user_service.update_promoter_enrollment(
            user.id,
            PromoterEnrollmentUpdate(
                payout_email="promoter@example.com",
                accept_tos=True,
            ),
        )


def test_enrolled_promoter_can_update_email_while_program_paused(
    fake_sb,
    patch_sb,
    monkeypatch,
):
    patch_sb("services.user_service")
    accepted_at = datetime.now(timezone.utc)
    user = UserResponse(
        id=uuid4(),
        email="person@example.com",
        school="uwaterloo",
        payout_email="old@example.com",
        promoter_tos_accepted_at=accepted_at,
        promoter_tos_version="2026-07",
        created_at=accepted_at,
        updated_at=accepted_at,
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=user))
    monkeypatch.setattr(
        user_service,
        "controlbox",
        SimpleNamespace(
            promoter_program=SimpleNamespace(
                enabled=False,
                tos_version="2026-07",
            )
        ),
    )
    fake_sb.set_response(
        data=[
            {
                **user.model_dump(mode="json"),
                "payout_email": "new@example.com",
            }
        ]
    )

    result = user_service.update_promoter_enrollment(
        user.id,
        PromoterEnrollmentUpdate(
            payout_email="new@example.com",
            accept_tos=False,
        ),
    )

    assert result is not None
    assert str(result.payout_email) == "new@example.com"
    assert fake_sb.update.call_args.args[0] == {"payout_email": "new@example.com"}


def test_delete_user_rejects_financial_record_removal(fake_sb, patch_sb):
    patch_sb("services.user_service")
    fake_sb.set_response(data=[{"id": str(uuid4())}], count=1)

    with pytest.raises(ValidationError, match=USER_HAS_PAYOUTS):
        user_service.delete_user(uuid4())

    fake_sb.delete.assert_not_called()


def test_delete_user_rejects_promoter_poster_removal(fake_sb, patch_sb):
    patch_sb("services.user_service")
    fake_sb.queue_responses([[], [{"id": "promoter-poster"}]])

    with pytest.raises(ValidationError, match=USER_HAS_PROMOTER_POSTERS):
        user_service.delete_user(uuid4())

    fake_sb.delete.assert_not_called()


def test_delete_user_rejects_payout_reviewer_removal(fake_sb, patch_sb):
    patch_sb("services.user_service")
    fake_sb.queue_responses([[], [], [{"id": str(uuid4())}]])

    with pytest.raises(ValidationError, match=USER_HAS_PAYOUT_REVIEWS):
        user_service.delete_user(uuid4())

    fake_sb.delete.assert_not_called()


def test_delete_user_without_payouts_deletes_profile(fake_sb, patch_sb):
    patch_sb("services.user_service")
    user_id = uuid4()
    fake_sb.queue_responses([[], [], [], [{"id": str(user_id)}]])

    assert user_service.delete_user(user_id) is True
    fake_sb.delete.assert_called_once()
