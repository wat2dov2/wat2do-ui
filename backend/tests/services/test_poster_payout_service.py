from datetime import date, datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from core.errors import INVALID_STATUS_TRANSITION, PAYOUT_NOTES_REQUIRED
from core.exceptions import ValidationError
from schemas.payout import PosterPayoutResponse
from schemas.user import UserResponse
from services import poster_payout_service
from services.poster_risk import RiskEvaluation

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
PAYOUT_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")


def _user() -> UserResponse:
    now = datetime.now(timezone.utc)
    return UserResponse(
        id=USER_ID,
        email="person@example.com",
        school="University of Waterloo",
        payout_email="promoter@example.com",
        promoter_tos_accepted_at=now,
        promoter_tos_version="2026-01",
        created_at=now,
        updated_at=now,
    )


def _payout(**overrides) -> PosterPayoutResponse:
    now = datetime.now(timezone.utc)
    defaults = {
        "id": PAYOUT_ID,
        "user_id": USER_ID,
        "period": date(2026, 6, 1),
        "payout_email": "promoter@example.com",
        "rate_cents": 25,
        "amount_cents": 250,
        "scan_count": 10,
        "status": "pending",
        "paid_at": None,
        "notes": None,
        "reviewed_by": None,
        "created_at": now,
        "updated_at": now,
    }
    defaults.update(overrides)
    return PosterPayoutResponse.model_validate(defaults)


def test_month_bounds_are_utc_and_cross_year():
    start, end = poster_payout_service.month_bounds(date(2026, 12, 15))

    assert start == datetime(2026, 12, 1, tzinfo=timezone.utc)
    assert end == datetime(2027, 1, 1, tzinfo=timezone.utc)


def test_promoter_earnings_calculates_integer_cents(monkeypatch):
    monkeypatch.setattr(
        poster_payout_service,
        "_get_earnings_rows",
        MagicMock(
            return_value=[
                {
                    "qr_code_id": "poster-1",
                    "name": "Poster",
                    "is_active": True,
                    "latest_scan": None,
                    "lifetime_unique_scans": 5,
                    "period_unique_scans": 3,
                    "period_creditable_scans": 2,
                }
            ]
        ),
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_lifetime_paid_cents",
        MagicMock(return_value=1000),
    )

    result = poster_payout_service.get_promoter_earnings(_user())

    assert result.period_creditable_scans == 2
    assert result.pending_cents == 50
    assert result.lifetime_paid_cents == 1000


def test_hold_requires_notes(monkeypatch):
    monkeypatch.setattr(
        poster_payout_service,
        "get_payout",
        MagicMock(return_value=_payout()),
    )

    with pytest.raises(ValidationError, match=PAYOUT_NOTES_REQUIRED):
        poster_payout_service.transition_payout(
            PAYOUT_ID,
            target_status="held",
            notes=None,
            reviewed_by=USER_ID,
        )


def test_terminal_payout_cannot_transition(monkeypatch):
    monkeypatch.setattr(
        poster_payout_service,
        "get_payout",
        MagicMock(
            return_value=_payout(
                status="paid",
                paid_at=datetime.now(timezone.utc),
            )
        ),
    )

    with pytest.raises(ValidationError, match=INVALID_STATUS_TRANSITION):
        poster_payout_service.transition_payout(
            PAYOUT_ID,
            target_status="held",
            notes="Cannot reopen",
            reviewed_by=USER_ID,
        )


def test_interac_csv_uses_frozen_payout_email_and_reference(tmp_path):
    output = tmp_path / "payouts.csv"

    poster_payout_service._write_interac_csv([_payout()], output)

    contents = output.read_text(encoding="utf-8")
    assert "promoter@example.com" in contents
    assert "2.50" in contents
    assert str(PAYOUT_ID) in contents


def test_payout_job_rejects_open_period(tmp_path):
    with pytest.raises(ValueError, match="has not closed"):
        poster_payout_service.run_period_payouts(
            date(2026, 7, 1),
            output_path=tmp_path / "payouts.csv",
            now=datetime(2026, 7, 15, tzinfo=timezone.utc),
        )


def test_recompute_preserves_frozen_email_and_rate(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    existing = _payout(
        payout_email="frozen@example.com",
        rate_cents=20,
        amount_cents=200,
    )
    updated = existing.model_copy(
        update={
            "scan_count": 12,
            "amount_cents": 240,
        }
    )
    fake_sb.queue_responses(
        [
            [existing.model_dump(mode="json")],
            [updated.model_dump(mode="json")],
        ]
    )

    poster_payout_service._upsert_period_payout(
        user=_user(),
        period=date(2026, 6, 1),
        scan_count=12,
        evaluation=RiskEvaluation(score=0, findings=()),
    )

    payload = fake_sb.update.call_args.args[0]
    assert payload["payout_email"] == "frozen@example.com"
    assert payload["rate_cents"] == 20
    assert payload["amount_cents"] == 240
