from datetime import date, datetime, timezone
from unittest.mock import MagicMock, call
from uuid import UUID

import pytest
from postgrest.exceptions import APIError

from core.errors import (
    ADMIN_ACCESS_REQUIRED,
    INVALID_PAYOUT_FILTERS,
    INVALID_STATUS_TRANSITION,
    PAYOUT_EXPORT_PENDING_ONLY,
    PAYOUT_NOT_FOUND,
    PAYOUT_NOTES_REQUIRED,
)
from core.exceptions import (
    AuthorizationError,
    NotFoundError,
    ValidationError,
)
from schemas.payout import PayoutReviewEvent, PosterPayoutResponse
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
        school="uwaterloo",
        payout_email="promoter@example.com",
        promoter_tos_accepted_at=now,
        promoter_tos_version="2026-07",
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


def _api_error(message: str) -> APIError:
    return APIError(
        {
            "message": message,
            "code": "P0001",
            "details": "",
            "hint": "",
        }
    )


def test_month_bounds_are_utc_and_cross_year():
    start, end = poster_payout_service.month_bounds(date(2026, 12, 15))

    assert start == datetime(2026, 12, 1, tzinfo=timezone.utc)
    assert end == datetime(2027, 1, 1, tzinfo=timezone.utc)


def test_period_scan_attempt_count_is_scoped_to_posters_and_month(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    fake_sb.set_response(count=6)
    period_start, period_end = poster_payout_service.month_bounds(date(2026, 7, 1))

    result = poster_payout_service._count_period_scan_attempts(
        ["poster-1", "poster-2"],
        period_start,
        period_end,
    )

    assert result == 6
    fake_sb.table.assert_called_once_with("qr_code_scans")
    fake_sb.select.assert_called_once_with("id", count="exact")
    fake_sb.in_.assert_called_once_with("qr_code_id", ["poster-1", "poster-2"])
    fake_sb.gte.assert_called_once_with("scanned_at", period_start.isoformat())
    fake_sb.lt.assert_called_once_with("scanned_at", period_end.isoformat())


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
                    "latitude": 43.4723,
                    "longitude": -80.5449,
                    "poster_template_id": "campus-colour",
                    "image_url": ("https://wat2do.ca/poster-templates/campus-colour-v1.png"),
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
    count_attempts = MagicMock(return_value=6)
    monkeypatch.setattr(
        poster_payout_service,
        "_count_period_scan_attempts",
        count_attempts,
    )

    result = poster_payout_service.get_promoter_earnings(_user())

    assert result.period_creditable_scans == 2
    assert result.period_unqualified_scans == 4
    assert result.pending_cents == 50
    assert result.lifetime_paid_cents == 1000
    assert result.active_slots_used == 1
    assert result.posters[0].latitude == 43.4723
    assert result.posters[0].poster_template_id == "campus-colour"
    count_attempts.assert_called_once()


def test_promoter_earnings_remain_readable_with_earlier_acceptance_metadata(
    monkeypatch,
):
    monkeypatch.setattr(
        poster_payout_service,
        "_get_earnings_rows",
        MagicMock(return_value=[]),
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_lifetime_paid_cents",
        MagicMock(return_value=0),
    )
    stale_user = _user().model_copy(update={"promoter_tos_version": "retired-version"})

    result = poster_payout_service.get_promoter_earnings(stale_user)

    assert result.posters == []
    assert result.program_enabled is True


def test_hold_requires_notes(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    fake_sb.raise_on_execute(_api_error("payout_notes_required"))

    with pytest.raises(ValidationError, match=PAYOUT_NOTES_REQUIRED):
        poster_payout_service.transition_payout(
            PAYOUT_ID,
            target_status="held",
            notes=None,
            reviewed_by=USER_ID,
        )


def test_terminal_payout_cannot_transition(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    fake_sb.raise_on_execute(_api_error("invalid_payout_status_transition"))

    with pytest.raises(ValidationError, match=INVALID_STATUS_TRANSITION):
        poster_payout_service.transition_payout(
            PAYOUT_ID,
            target_status="held",
            notes="Cannot reopen",
            reviewed_by=USER_ID,
        )


def test_transition_uses_atomic_review_history_rpc(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    held = _payout(
        status="held",
        notes="Confirm poster placement",
        reviewed_by=USER_ID,
    )
    fake_sb.set_response(data=[held.model_dump(mode="json")])

    result = poster_payout_service.transition_payout(
        PAYOUT_ID,
        target_status="held",
        notes="Confirm poster placement",
        reviewed_by=USER_ID,
    )

    assert result == held
    fake_sb.rpc.assert_called_once_with(
        "transition_poster_payout_status",
        {
            "p_payout_id": str(PAYOUT_ID),
            "p_target_status": "held",
            "p_notes": "Confirm poster placement",
            "p_reviewed_by": str(USER_ID),
        },
    )
    fake_sb.table.assert_not_called()


@pytest.mark.parametrize(
    ("database_message", "expected_exception", "expected_detail"),
    [
        ("payout_not_found", NotFoundError, PAYOUT_NOT_FOUND),
        ("payout_notes_required", ValidationError, PAYOUT_NOTES_REQUIRED),
        (
            "invalid_payout_status_transition",
            ValidationError,
            INVALID_STATUS_TRANSITION,
        ),
        ("admin_access_required", AuthorizationError, ADMIN_ACCESS_REQUIRED),
    ],
)
def test_payout_rpc_errors_are_mapped(
    database_message,
    expected_exception,
    expected_detail,
):
    with pytest.raises(expected_exception, match=expected_detail):
        poster_payout_service._raise_payout_rpc_error(_api_error(database_message))


def test_bulk_mark_paid_uses_atomic_review_history_rpc(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    paid = _payout(
        status="paid",
        paid_at=datetime.now(timezone.utc),
        reviewed_by=USER_ID,
    )
    fake_sb.set_response(data=[paid.model_dump(mode="json")])

    result = poster_payout_service.bulk_mark_paid(
        [PAYOUT_ID, PAYOUT_ID],
        reviewed_by=USER_ID,
    )

    assert result == [paid]
    fake_sb.rpc.assert_called_once_with(
        "mark_poster_payouts_paid",
        {
            "p_ids": [str(PAYOUT_ID)],
            "p_reviewed_by": str(USER_ID),
        },
    )


def test_interac_csv_uses_frozen_payout_email_and_reference(tmp_path):
    output = tmp_path / "payouts.csv"

    poster_payout_service._write_interac_csv([_payout()], output)

    contents = output.read_text(encoding="utf-8")
    assert "promoter@example.com" in contents
    assert "2.50" in contents
    assert str(PAYOUT_ID) in contents
    
    import os
    if os.name != "nt":
        assert output.stat().st_mode & 0o777 == 0o600


def test_admin_payout_filters_reject_inverted_ranges(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")

    with pytest.raises(ValidationError, match=INVALID_PAYOUT_FILTERS):
        poster_payout_service.list_admin_payouts(
            period_from=date(2026, 7, 1),
            period_to=date(2026, 6, 1),
        )

    with pytest.raises(ValidationError, match=INVALID_PAYOUT_FILTERS):
        poster_payout_service.list_admin_payouts(
            minimum_amount_cents=500,
            maximum_amount_cents=100,
        )

    fake_sb.table.assert_not_called()


def test_admin_payout_filters_are_applied_to_database_query(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    fake_sb.set_response(data=[], count=0)

    poster_payout_service.list_admin_payouts(
        status="pending",
        payout_email="waterloo",
        period_from=date(2026, 5, 1),
        period_to=date(2026, 7, 1),
        minimum_amount_cents=25,
        maximum_amount_cents=500,
        fraud_status="clear",
    )

    fake_sb.eq.assert_any_call("status", "pending")
    fake_sb.ilike.assert_called_once_with("payout_email", "%waterloo%")
    fake_sb.gte.assert_any_call("period", "2026-05-01")
    fake_sb.gte.assert_any_call("amount_cents", 25)
    fake_sb.lte.assert_any_call("period", "2026-07-01")
    fake_sb.lte.assert_any_call("amount_cents", 500)
    assert fake_sb.neq.call_args_list == [
        (("status", "held"),),
        (("status", "voided"),),
    ]


def test_export_requires_every_selected_payout_to_be_pending(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    held = _payout(status="held", notes="Review")
    fake_sb.set_response(data=[held.model_dump(mode="json")])

    with pytest.raises(ValidationError, match=PAYOUT_EXPORT_PENDING_ONLY):
        poster_payout_service.get_pending_payouts_for_export([PAYOUT_ID])


def test_admin_payout_detail_summarizes_fraud_and_poster_contributions(monkeypatch):
    payout = _payout(status="held", notes="Review")
    monkeypatch.setattr(
        poster_payout_service,
        "get_payout",
        MagicMock(return_value=payout),
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_load_period_scans",
        MagicMock(
            return_value=[
                {
                    "risk_flags": [
                        {
                            "code": "RAPID_VISITORS",
                            "points": 60,
                            "evidence": {"window_seconds": 60},
                        }
                    ]
                },
                {
                    "risk_flags": [
                        {
                            "code": "RAPID_VISITORS",
                            "points": 60,
                            "evidence": {"window_seconds": 60},
                        }
                    ]
                },
            ]
        ),
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_get_earnings_rows",
        MagicMock(
            return_value=[
                {
                    "qr_code_id": "poster-1",
                    "name": "SLC second floor",
                    "poster_template_id": "campus-colour",
                    "period_creditable_scans": 10,
                }
            ]
        ),
    )
    review_event = PayoutReviewEvent(
        id=UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        from_status="pending",
        to_status="held",
        notes="Review",
        reviewed_by=USER_ID,
        reviewed_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_get_payout_review_history",
        MagicMock(return_value=[review_event]),
    )

    detail = poster_payout_service.get_admin_payout_detail(PAYOUT_ID)

    assert detail.fraud_reasons[0].code == "RAPID_VISITORS"
    assert detail.fraud_reasons[0].affected_scan_count == 2
    assert detail.contributions[0].amount_cents == 250
    assert detail.period_start == datetime(2026, 6, 1, tzinfo=timezone.utc)
    assert detail.period_end == datetime(2026, 7, 1, tzinfo=timezone.utc)
    assert detail.review_history == [review_event]


def test_admin_payout_detail_structures_manual_hold_reason(monkeypatch):
    payout = _payout(status="held", notes="Confirm placement with promoter")
    monkeypatch.setattr(
        poster_payout_service,
        "get_payout",
        MagicMock(return_value=payout),
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_load_period_scans",
        MagicMock(return_value=[]),
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_get_earnings_rows",
        MagicMock(return_value=[]),
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_get_payout_review_history",
        MagicMock(return_value=[]),
    )

    detail = poster_payout_service.get_admin_payout_detail(PAYOUT_ID)

    assert detail.fraud_reasons[0].code == "MANUAL_REVIEW"
    assert detail.fraud_reasons[0].evidence == {"review_notes": "Confirm placement with promoter"}


def test_review_history_is_loaded_oldest_first(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    first_id = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    second_id = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
    fake_sb.set_response(
        data=[
            {
                "id": str(first_id),
                "from_status": "pending",
                "to_status": "held",
                "notes": "Confirm placement",
                "reviewed_by": str(USER_ID),
                "reviewed_at": "2026-07-01T10:00:00Z",
            },
            {
                "id": str(second_id),
                "from_status": "held",
                "to_status": "pending",
                "notes": None,
                "reviewed_by": str(USER_ID),
                "reviewed_at": "2026-07-02T10:00:00Z",
            },
        ]
    )

    result = poster_payout_service._get_payout_review_history(PAYOUT_ID)

    assert [event.id for event in result] == [first_id, second_id]
    fake_sb.table.assert_called_once_with("poster_payout_reviews")
    fake_sb.eq.assert_called_once_with("payout_id", str(PAYOUT_ID))
    assert fake_sb.order.call_args_list == [call("reviewed_at"), call("id")]


def test_payout_job_rejects_open_period(tmp_path):
    with pytest.raises(ValueError, match="has not closed"):
        poster_payout_service.run_period_payouts(
            date(2026, 7, 1),
            output_path=tmp_path / "payouts.csv",
            now=datetime(2026, 7, 15, tzinfo=timezone.utc),
        )


def test_closed_period_job_exports_pending_and_skips_held_zero_and_paid(
    monkeypatch,
    tmp_path,
):
    owner_ids = ["pending-owner", "held-owner", "zero-owner", "paid-owner"]
    users = {
        owner_id: _user().model_copy(update={"id": UUID(int=index + 10)})
        for index, owner_id in enumerate(owner_ids)
    }
    scan_counts = {
        "pending-owner": 4,
        "held-owner": 3,
        "zero-owner": 0,
        "paid-owner": 2,
    }
    statuses = {
        str(users["pending-owner"].id): "pending",
        str(users["held-owner"].id): "held",
        str(users["paid-owner"].id): "paid",
    }
    monkeypatch.setattr(
        poster_payout_service,
        "_load_promoter_owner_ids",
        MagicMock(return_value=owner_ids),
    )
    monkeypatch.setattr(
        poster_payout_service.user_service,
        "get_users_by_ids",
        MagicMock(return_value=users),
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_get_earnings_rows",
        lambda owner_id, *_: [{"period_creditable_scans": scan_counts[owner_id]}],
    )
    monkeypatch.setattr(
        poster_payout_service,
        "_load_period_scans",
        lambda owner_id, *_: [{"id": owner_id}],
    )
    monkeypatch.setattr(
        poster_payout_service,
        "evaluate_period_scans",
        lambda scans, _: RiskEvaluation(
            score=100 if scans[0]["id"] == "held-owner" else 0,
            findings=(),
        ),
    )
    store_scan_risk = MagicMock()
    monkeypatch.setattr(
        poster_payout_service,
        "_store_scan_risk",
        store_scan_risk,
    )

    def fake_upsert(*, user, period, scan_count, evaluation):
        status = statuses[str(user.id)]
        return _payout(
            user_id=user.id,
            period=period,
            scan_count=scan_count,
            amount_cents=scan_count * 25,
            status=status,
            notes="Automated hold" if status == "held" else None,
            paid_at=(datetime(2026, 7, 5, tzinfo=timezone.utc) if status == "paid" else None),
        )

    monkeypatch.setattr(
        poster_payout_service,
        "_upsert_period_payout",
        fake_upsert,
    )
    output_path = tmp_path / "payouts.csv"

    result = poster_payout_service.run_period_payouts(
        date(2026, 6, 1),
        output_path=output_path,
        now=datetime(2026, 7, 1, 1, 15, tzinfo=timezone.utc),
    )

    assert result["payouts_written"] == 2
    assert result["held"] == 1
    assert result["exported"] == 1
    assert result["amount_cents"] == 100
    assert "promoter@example.com,1.00,4,pending" in output_path.read_text(encoding="utf-8")
    assert store_scan_risk.call_count == 2


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


def test_recompute_leaves_paid_payout_unchanged(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    paid_at = datetime(2026, 7, 5, tzinfo=timezone.utc)
    existing = _payout(status="paid", paid_at=paid_at)
    fake_sb.set_response(data=[existing.model_dump(mode="json")])

    result = poster_payout_service._upsert_period_payout(
        user=_user(),
        period=date(2026, 6, 1),
        scan_count=99,
        evaluation=RiskEvaluation(score=100, findings=()),
    )

    assert result == existing
    fake_sb.update.assert_not_called()
    fake_sb.insert.assert_not_called()


def test_recompute_preserves_manual_hold_review(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    existing = _payout(
        status="held",
        notes="Confirm poster placement",
        reviewed_by=USER_ID,
    )
    fake_sb.set_response(data=[existing.model_dump(mode="json")])

    result = poster_payout_service._upsert_period_payout(
        user=_user(),
        period=date(2026, 6, 1),
        scan_count=10,
        evaluation=RiskEvaluation(score=0, findings=()),
    )

    assert result == existing
    fake_sb.update.assert_not_called()


def test_automatic_rehold_clears_stale_reviewer(fake_sb, patch_sb):
    patch_sb("services.poster_payout_service")
    existing = _payout(
        status="pending",
        reviewed_by=USER_ID,
    )
    updated = existing.model_copy(
        update={
            "status": "held",
            "notes": "Automatic fraud hold using qr-poster-risk-v1: ",
            "reviewed_by": None,
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
        scan_count=10,
        evaluation=RiskEvaluation(score=100, findings=()),
    )

    payload = fake_sb.update.call_args.args[0]
    assert payload["status"] == "held"
    assert payload["reviewed_by"] is None
