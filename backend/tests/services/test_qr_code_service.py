from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from core.config import settings
from services import qr_code_service


@pytest.fixture(autouse=True)
def poster_secrets(monkeypatch):
    monkeypatch.setattr(settings, "poster_hash_secret", "hash-secret")
    monkeypatch.setattr(settings, "poster_confirmation_secret", "confirmation-secret")


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
        current = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)

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
