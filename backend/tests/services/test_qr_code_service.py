from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from core.config import settings
from core.errors import (
    PROMOTER_POSTER_LIMIT_REACHED,
    PROMOTER_POSTERS_CANNOT_BE_UPDATED,
    PROMOTER_TEMPLATE_NOT_FOUND,
    PROMOTER_TEMPLATE_SCHOOL_MISMATCH,
    PROMOTER_TEMPLATE_UNAVAILABLE,
    REQUIRES_LOCATION,
)
from core.exceptions import ValidationError
from schemas.qr_code import PromoterPosterBatchCreate, QrCodeResponse, QrCodeUpdate
from schemas.user import UserResponse
from services import qr_code_service


@pytest.fixture(autouse=True)
def poster_secrets(monkeypatch):
    monkeypatch.setattr(settings, "poster_hash_secret", "hash-secret")
    monkeypatch.setattr(settings, "poster_confirmation_secret", "confirmation-secret")


def _qr(**overrides) -> QrCodeResponse:
    defaults = {
        "id": "poster-1",
        "name": "Poster",
        "description": None,
        "destination_type": "events-list",
        "destination_id": None,
        "filters": {"school": "uwaterloo"},
        "created_at": datetime.now(timezone.utc),
        "created_by": str(uuid4()),
        "is_active": True,
        "program": "promoter",
        "latest_scan": None,
        "poster_template_id": "campus-colour",
        "image_url": "https://wat2do.ca/poster-templates/campus-colour-v1.png",
        "latitude": 0.0,
        "longitude": 0.0,
    }
    defaults.update(overrides)
    return QrCodeResponse.model_validate(defaults)


def _enrolled_user() -> UserResponse:
    now = datetime.now(timezone.utc)
    return UserResponse(
        id=uuid4(),
        email="promoter@example.com",
        school="uwaterloo",
        payout_email="promoter@example.com",
        promoter_tos_accepted_at=now,
        promoter_tos_version="2026-01",
        created_at=now,
        updated_at=now,
    )


def test_visitor_hash_is_stable_and_domain_separated():
    visitor_hash = qr_code_service.hash_visitor_token("visitor")

    assert visitor_hash == qr_code_service.hash_visitor_token("visitor")
    assert visitor_hash != qr_code_service.hash_client_ip("visitor")
    assert "visitor" not in visitor_hash


@pytest.mark.parametrize(
    ("user_agent", "expected"),
    [
        (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604.1",
            ("Safari", "iOS"),
        ),
        (
            "Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/126.0 Safari/537.36",
            ("Chrome", "Windows"),
        ),
        (None, (None, None)),
    ],
)
def test_parse_user_agent_returns_only_broad_families(user_agent, expected):
    assert qr_code_service.parse_user_agent(user_agent) == expected


def test_scan_confirmation_token_is_signed_and_delayed(monkeypatch):
    class FrozenDateTime(datetime):
        current = datetime(
            2026,
            7,
            25,
            12,
            0,
            0,
            500_000,
            tzinfo=timezone.utc,
        )

        @classmethod
        def now(cls, tz=None):
            return cls.current

    monkeypatch.setattr(qr_code_service, "datetime", FrozenDateTime)
    scan_id = uuid4()
    token = qr_code_service.create_scan_confirmation_token(scan_id)

    assert qr_code_service.verify_scan_confirmation_token(token) is None

    FrozenDateTime.current += timedelta(
        seconds=qr_code_service.controlbox.promoter_program.landing_confirmation_seconds
    )
    assert qr_code_service.verify_scan_confirmation_token(token) is None

    FrozenDateTime.current += timedelta(seconds=1)
    assert qr_code_service.verify_scan_confirmation_token(token) == str(scan_id)
    assert qr_code_service.verify_scan_confirmation_token(token + "tampered") is None


def test_promoter_raw_scans_are_not_returned_to_owner(monkeypatch):
    monkeypatch.setattr(
        qr_code_service,
        "list_qr_codes",
        MagicMock(
            return_value=(
                [SimpleNamespace(id="promoter-1", program="promoter")],
                1,
            )
        ),
    )

    items, total = qr_code_service.list_scans(owned_by=str(uuid4()))

    assert items == []
    assert total == 0


def test_record_scan_uses_transactional_rpc(fake_sb, patch_sb):
    patch_sb("services.qr_code_service")
    scan_id = uuid4()
    scanned_at = datetime.now(timezone.utc)
    fake_sb.set_response(
        data=[
            {
                "id": str(scan_id),
                "qr_code_id": "poster-1",
                "scanned_at": scanned_at.isoformat(),
                "dedupe_hash": "a" * 64,
                "browser_family": "Safari",
                "os_family": "iOS",
                "asn": None,
                "country": None,
                "landing_confirmed_at": None,
                "risk_score": 0,
                "risk_flags": [],
                "risk_evaluated_at": None,
                "risk_rules_version": None,
            }
        ]
    )

    result = qr_code_service.record_scan(
        "poster-1",
        dedupe_hash="a" * 64,
        ip_hash="b" * 64,
        browser_family="Safari",
        os_family="iOS",
    )

    assert result is not None
    assert result.visitor_reference == "a" * 16
    fake_sb.rpc.assert_called_once()
    assert fake_sb.rpc.call_args.args[0] == "record_qr_scan"


def test_create_promoter_batch_uses_template_and_one_row_per_copy(
    fake_sb,
    patch_sb,
    monkeypatch,
):
    patch_sb("services.qr_code_service")
    generated_ids = [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]
    generated = iter(generated_ids)
    monkeypatch.setattr(
        qr_code_service.uuid,
        "uuid4",
        lambda: next(generated),
    )
    rows = [
        _qr(
            id=qr_code_id,
            name=f"SLC second floor - {index} of 2",
        ).model_dump(mode="json")
        for index, qr_code_id in enumerate(generated_ids, start=1)
    ]
    fake_sb.set_response(data=list(reversed(rows)))

    result = qr_code_service.create_promoter_qr_codes(
        PromoterPosterBatchCreate(
            program="promoter",
            poster_template_id="campus-colour",
            name="SLC second floor",
            copies=2,
        ),
        creator=_enrolled_user(),
    )

    assert [poster.id for poster in result] == generated_ids
    rpc_name, rpc_payload = fake_sb.rpc.call_args.args
    assert rpc_name == "create_promoter_qr_codes"
    assert rpc_payload["p_ids"] == generated_ids
    assert rpc_payload["p_names"] == [
        "SLC second floor - 1 of 2",
        "SLC second floor - 2 of 2",
    ]
    assert rpc_payload["p_school"] == "uwaterloo"
    assert rpc_payload["p_poster_template_id"] == "campus-colour"
    assert rpc_payload["p_image_url"].endswith("/poster-templates/campus-colour-v1.png")
    assert "p_description" not in rpc_payload


def test_create_promoter_batch_rejects_unknown_template(fake_sb, patch_sb):
    patch_sb("services.qr_code_service")

    with pytest.raises(ValidationError, match=PROMOTER_TEMPLATE_NOT_FOUND):
        qr_code_service.create_promoter_qr_codes(
            PromoterPosterBatchCreate(
                program="promoter",
                poster_template_id="not-approved",
                name="SLC second floor",
                copies=1,
            ),
            creator=_enrolled_user(),
        )

    fake_sb.rpc.assert_not_called()


@pytest.mark.parametrize(
    ("template_updates", "expected_error"),
    [
        (
            {
                "id": "retired-template",
                "available_for_creation": False,
            },
            PROMOTER_TEMPLATE_UNAVAILABLE,
        ),
        (
            {
                "id": "utoronto-template",
                "eligible_school": "utoronto",
            },
            PROMOTER_TEMPLATE_SCHOOL_MISMATCH,
        ),
    ],
)
def test_create_promoter_batch_enforces_template_availability_and_school(
    fake_sb,
    patch_sb,
    monkeypatch,
    template_updates,
    expected_error,
):
    patch_sb("services.qr_code_service")
    promoter_control = qr_code_service.controlbox.promoter_program
    template = promoter_control.approved_templates[0].model_copy(update=template_updates)
    monkeypatch.setattr(
        qr_code_service,
        "controlbox",
        SimpleNamespace(
            promoter_program=promoter_control.model_copy(update={"approved_templates": (template,)})
        ),
    )

    with pytest.raises(ValidationError, match=expected_error):
        qr_code_service.create_promoter_qr_codes(
            PromoterPosterBatchCreate(
                program="promoter",
                poster_template_id=template.id,
                name="SLC second floor",
                copies=1,
            ),
            creator=_enrolled_user(),
        )

    fake_sb.rpc.assert_not_called()


def test_create_promoter_batch_rejects_complete_batch_over_active_cap(
    fake_sb,
    patch_sb,
):
    patch_sb("services.qr_code_service")

    with pytest.raises(ValidationError, match=PROMOTER_POSTER_LIMIT_REACHED):
        qr_code_service.create_promoter_qr_codes(
            PromoterPosterBatchCreate(
                program="promoter",
                poster_template_id="campus-colour",
                name="Campus posters",
                copies=51,
            ),
            creator=_enrolled_user(),
        )

    fake_sb.rpc.assert_not_called()


def test_promoter_patch_is_rejected_before_database_write(fake_sb, patch_sb):
    patch_sb("services.qr_code_service")
    update = QrCodeUpdate(
        id="poster-1",
        name="Moved poster",
        destination_type="events-list",
    )

    with pytest.raises(ValidationError, match=PROMOTER_POSTERS_CANNOT_BE_UPDATED):
        qr_code_service.update_qr_code(update, existing=_qr())

    fake_sb.update.assert_not_called()


def test_unplaced_promoter_scan_without_coordinates_requests_location(monkeypatch):
    monkeypatch.setattr(
        qr_code_service,
        "get_qr_code_by_id",
        MagicMock(return_value=_qr()),
    )
    record = MagicMock()
    monkeypatch.setattr(qr_code_service, "record_scan", record)

    with pytest.raises(ValidationError, match=REQUIRES_LOCATION):
        qr_code_service.handle_scan(
            "poster-1",
            lat=None,
            lon=None,
            visitor_token="visitor",
            client_ip="203.0.113.5",
            user_agent=None,
        )

    record.assert_not_called()


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        (0.0, 0.0),
        (43.4723, -80.5449),
    ],
)
def test_unplaced_promoter_scan_records_coordinate_attempt(
    latitude,
    longitude,
    monkeypatch,
):
    monkeypatch.setattr(
        qr_code_service,
        "get_qr_code_by_id",
        MagicMock(return_value=_qr()),
    )
    record = MagicMock(return_value=SimpleNamespace(id=uuid4()))
    monkeypatch.setattr(qr_code_service, "record_scan", record)

    redirect = qr_code_service.handle_scan(
        "poster-1",
        lat=latitude,
        lon=longitude,
        visitor_token="visitor",
        client_ip="203.0.113.5",
        user_agent=None,
    )

    assert redirect.destination_type == "events-list"
    assert record.call_args.kwargs["latitude"] == latitude
    assert record.call_args.kwargs["longitude"] == longitude


def test_placed_promoter_scan_cannot_move_location(monkeypatch):
    monkeypatch.setattr(
        qr_code_service,
        "get_qr_code_by_id",
        MagicMock(return_value=_qr(latitude=43.4723, longitude=-80.5449)),
    )
    record = MagicMock(return_value=SimpleNamespace(id=uuid4()))
    monkeypatch.setattr(qr_code_service, "record_scan", record)

    qr_code_service.handle_scan(
        "poster-1",
        lat=45.5019,
        lon=-73.5674,
        visitor_token="visitor",
        client_ip="203.0.113.5",
        user_agent=None,
    )

    assert record.call_args.kwargs["latitude"] is None
    assert record.call_args.kwargs["longitude"] is None


@pytest.mark.parametrize(
    ("visitor_count", "expected"),
    [
        (0, "none"),
        (1, "low"),
        (9, "low"),
        (10, "medium"),
        (49, "medium"),
        (50, "high"),
    ],
)
def test_confirmed_visitor_bucket_uses_controlbox_thresholds(
    visitor_count,
    expected,
):
    assert qr_code_service._confirmed_visitor_bucket(visitor_count) == expected


def test_campus_coverage_returns_only_aggregate_cells(fake_sb, patch_sb):
    patch_sb("services.qr_code_service")
    fake_sb.set_response(
        data=[
            {
                "latitude": 43.472,
                "longitude": -80.545,
                "poster_count": 3,
                "recent_poster_count": 2,
                "quiet_poster_count": 1,
                "confirmed_unique_visitors": 17,
            }
        ]
    )

    result = qr_code_service.get_campus_coverage("uwaterloo")

    assert result.school == "uwaterloo"
    assert result.quiet_after_days == 30
    assert result.cells[0].confirmed_visitor_bucket == "medium"
    assert set(result.cells[0].model_dump()) == {
        "latitude",
        "longitude",
        "poster_count",
        "recent_poster_count",
        "quiet_poster_count",
        "confirmed_visitor_bucket",
    }
