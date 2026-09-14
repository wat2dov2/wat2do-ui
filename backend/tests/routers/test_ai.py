from unittest.mock import MagicMock

import pytest

from core.constants import MAX_IMAGE_SIZE_BYTES
from core.errors import EVENT_IMAGE_NO_EVENT
from core.exceptions import ValidationError
from core.rate_limit import ai_parse_event_image_rate_limiter


@pytest.fixture(autouse=True)
def school_directory(monkeypatch):
    monkeypatch.setattr(
        "services.school_service.get_school",
        lambda school: (
            MagicMock(timezone="America/Toronto")
            if school in {"uwaterloo", "ualberta", "ulaval"}
            else None
        ),
    )


@pytest.mark.parametrize("school", ["uwaterloo", "ualberta", "ulaval"])
def test_event_image_passes_campus_to_extractor(client, monkeypatch, school):
    ai_parse_event_image_rate_limiter._requests.clear()
    _mock_image_parse(monkeypatch)
    extract = MagicMock(return_value=[{"title": "Campus event", "occurrences": []}])
    monkeypatch.setattr("services.scraper.extractor.extract_events_from_post", extract)
    response = client.post(
        f"/ai/parse-event-image?school={school}",
        files={"file": ("poster.jpg", b"image", "image/jpeg")},
    )
    assert response.status_code == 200
    assert extract.call_args.kwargs["school"] == school


@pytest.mark.parametrize("query,status", [("", 422), ("?school=unknown", 400)])
def test_event_image_requires_registered_campus(client, monkeypatch, query, status):
    ai_parse_event_image_rate_limiter._requests.clear()
    parse = MagicMock()
    monkeypatch.setattr("routers.ai.svc_parse_event_image", parse)
    response = client.post(
        f"/ai/parse-event-image{query}", files={"file": ("poster.jpg", b"image", "image/jpeg")}
    )
    assert response.status_code == status
    parse.assert_not_called()


def _mock_image_parse(monkeypatch):
    monkeypatch.setattr(
        "services.scraper.extractor.extract_events_from_post",
        lambda **kwargs: [{"title": "Campus event", "occurrences": []}],
    )
    monkeypatch.setattr(
        "services.storage_service.storage.validate_and_prepare",
        lambda bucket, data, content_type: (data, content_type),
    )
    monkeypatch.setattr(
        "services.storage_service.storage.upload_file",
        lambda bucket, file_bytes, content_type: "https://example.com/public-flyer.png",
    )


def test_parse_event_image_anonymous(client, monkeypatch):
    ai_parse_event_image_rate_limiter._requests.clear()
    _mock_image_parse(monkeypatch)

    resp = client.post(
        "/ai/parse-event-image?school=uwaterloo",
        files={"file": ("flyer.jpg", b"fake_bytes", "image/jpeg")},
    )

    assert resp.status_code == 200
    assert resp.json()["source_image_url"] == "https://example.com/public-flyer.png"


def test_position_image_uses_requested_school_and_typed_payment(authenticated_client, monkeypatch):
    from types import SimpleNamespace

    ai_parse_event_image_rate_limiter._requests.clear()
    _mock_image_parse(monkeypatch)
    monkeypatch.setattr("services.school_service.get_school", lambda _school: SimpleNamespace(id=2))
    extract = MagicMock(
        return_value=SimpleNamespace(
            positions=[
                {
                    "title": "Design Lead",
                    "description": "Design campus posters",
                    "position_type": "committee",
                    "is_paid": True,
                }
            ]
        )
    )
    monkeypatch.setattr("services.scraper.extractor.extract_post_content", extract)
    response = authenticated_client.post(
        "/ai/parse-position-image?school=laval",
        files={"file": ("poster.png", b"fake", "image/png")},
    )
    assert response.status_code == 200
    assert response.json()["is_paid"] is True
    assert response.json()["source_image_url"] == "https://example.com/public-flyer.png"
    assert extract.call_args.kwargs["school"] == "laval"


def test_position_image_rejects_no_hiring_content(authenticated_client, monkeypatch):
    from types import SimpleNamespace

    ai_parse_event_image_rate_limiter._requests.clear()
    _mock_image_parse(monkeypatch)
    monkeypatch.setattr("services.school_service.get_school", lambda _school: SimpleNamespace(id=2))
    monkeypatch.setattr(
        "services.scraper.extractor.extract_post_content",
        lambda **kwargs: SimpleNamespace(positions=[]),
    )
    response = authenticated_client.post(
        "/ai/parse-position-image?school=laval",
        files={"file": ("poster.png", b"fake", "image/png")},
    )
    assert response.status_code == 400


def test_parse_event_image_accepts_five_megabyte_file_without_disk_rollover(
    client,
    monkeypatch,
):
    ai_parse_event_image_rate_limiter._requests.clear()
    _mock_image_parse(monkeypatch)
    monkeypatch.setattr(
        "tempfile.TemporaryFile",
        MagicMock(side_effect=OSError("temporary directory is not writable")),
    )

    resp = client.post(
        "/ai/parse-event-image?school=uwaterloo",
        files={
            "file": (
                "five-megabyte-flyer.jpg",
                b"x" * MAX_IMAGE_SIZE_BYTES,
                "image/jpeg",
            )
        },
    )

    assert resp.status_code == 200


def test_parse_event_image_anonymous_rate_limit(client, monkeypatch):
    ai_parse_event_image_rate_limiter._requests.clear()
    _mock_image_parse(monkeypatch)
    original_max = ai_parse_event_image_rate_limiter.max_requests
    ai_parse_event_image_rate_limiter.max_requests = 1
    try:
        first_resp = client.post(
            "/ai/parse-event-image?school=uwaterloo",
            files={"file": ("flyer.jpg", b"fake_bytes", "image/jpeg")},
        )
        second_resp = client.post(
            "/ai/parse-event-image?school=uwaterloo",
            files={"file": ("flyer.jpg", b"fake_bytes", "image/jpeg")},
        )
        assert first_resp.status_code == 200
        assert second_resp.status_code == 429
    finally:
        ai_parse_event_image_rate_limiter.max_requests = original_max
        ai_parse_event_image_rate_limiter._requests.clear()


def test_parse_event_image_validates_before_ai(client, monkeypatch):
    ai_parse_event_image_rate_limiter._requests.clear()
    parse_mock = MagicMock()
    monkeypatch.setattr("routers.ai.svc_parse_event_image", parse_mock)
    monkeypatch.setattr(
        "services.storage_service.storage.validate_and_prepare",
        MagicMock(
            side_effect=ValidationError(
                "Invalid image file",
                code="invalid_file_type",
            )
        ),
    )

    resp = client.post(
        "/ai/parse-event-image?school=uwaterloo",
        files={"file": ("flyer.txt", b"not-an-image", "text/plain")},
    )

    assert resp.status_code == 400
    parse_mock.assert_not_called()


def test_parse_event_image_authenticated(authenticated_client, monkeypatch):
    ai_parse_event_image_rate_limiter._requests.clear()
    fake_extracted = [
        {
            "title": "Mock Image Event",
            "description": "Mock Description",
            "location": "McMaster Student Centre, room 201",
            "club": "Mock Org",
            "price": 0.0,
            "food": ["Samosas", "Pizza"],
            "registration": False,
            "occurrences": [
                {
                    "dtstart_utc": "2026-04-10T22:00:00Z",
                    "dtend_utc": "",
                    "tz": "America/Toronto",
                }
            ],
            "category": "Games & Recreation",
        }
    ]

    monkeypatch.setattr(
        "services.scraper.extractor.extract_events_from_post",
        lambda **kwargs: fake_extracted,
    )
    monkeypatch.setattr(
        "services.storage_service.storage.validate_and_prepare",
        lambda bucket, data, content_type: (data, content_type),
    )
    monkeypatch.setattr(
        "services.storage_service.storage.upload_file",
        lambda bucket, file_bytes, content_type: "https://example.com/mock-flyer.png",
    )

    resp = authenticated_client.post(
        "/ai/parse-event-image?school=uwaterloo",
        files={"file": ("flyer.jpg", b"fake_bytes", "image/jpeg")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Mock Image Event"
    assert data["location"] == "McMaster Student Centre, room 201"
    assert data["food"] == ["Samosas", "Pizza"]
    assert data["occurrences"][0]["dtstart_local"] == "2026-04-10T18:00"
    assert data["source_image_url"] == "https://example.com/mock-flyer.png"


def test_empty_extraction_is_not_reported_as_success(client, monkeypatch):
    ai_parse_event_image_rate_limiter._requests.clear()
    _mock_image_parse(monkeypatch)
    monkeypatch.setattr("services.scraper.extractor.extract_events_from_post", lambda **kwargs: [])
    upload = MagicMock()
    monkeypatch.setattr("services.storage_service.storage.upload_file", upload)
    response = client.post(
        "/ai/parse-event-image?school=uwaterloo",
        files={"file": ("blank.png", b"image", "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == EVENT_IMAGE_NO_EVENT
    upload.assert_not_called()
