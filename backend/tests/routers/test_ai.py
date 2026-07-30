from unittest.mock import MagicMock

from core.constants import MAX_IMAGE_SIZE_BYTES
from core.exceptions import ValidationError
from core.rate_limit import ai_parse_event_image_rate_limiter


def _mock_empty_image_parse(monkeypatch):
    monkeypatch.setattr(
        "services.scraper.extractor.extract_events_from_post",
        lambda **kwargs: [],
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
    _mock_empty_image_parse(monkeypatch)

    resp = client.post(
        "/ai/parse-event-image", files={"file": ("flyer.jpg", b"fake_bytes", "image/jpeg")}
    )

    assert resp.status_code == 200
    assert resp.json()["source_image_url"] == "https://example.com/public-flyer.png"


def test_parse_event_image_accepts_five_megabyte_file_without_disk_rollover(
    client,
    monkeypatch,
):
    ai_parse_event_image_rate_limiter._requests.clear()
    _mock_empty_image_parse(monkeypatch)
    monkeypatch.setattr(
        "tempfile.TemporaryFile",
        MagicMock(side_effect=OSError("temporary directory is not writable")),
    )

    resp = client.post(
        "/ai/parse-event-image",
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
    _mock_empty_image_parse(monkeypatch)
    original_max = ai_parse_event_image_rate_limiter.max_requests
    ai_parse_event_image_rate_limiter.max_requests = 1
    try:
        first_resp = client.post(
            "/ai/parse-event-image",
            files={"file": ("flyer.jpg", b"fake_bytes", "image/jpeg")},
        )
        second_resp = client.post(
            "/ai/parse-event-image",
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
        "/ai/parse-event-image",
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
            "location": "SLC",
            "organization": "Mock Org",
            "price": 0.0,
            "food": ["Pizza"],
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
        "/ai/parse-event-image", files={"file": ("flyer.jpg", b"fake_bytes", "image/jpeg")}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Mock Image Event"
    assert data["occurrences"][0]["dtstart_local"] == "2026-04-10T18:00"
    assert data["source_image_url"] == "https://example.com/mock-flyer.png"
