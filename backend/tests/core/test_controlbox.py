import json
import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from core.controlbox import controlbox, load_controlbox

_SOURCE = Path(__file__).resolve().parents[2] / "controlbox"


def _write_control(tmp_path: Path, feature: str, mutate) -> Path:
    directory = tmp_path / "controlbox"
    shutil.copytree(_SOURCE, directory)
    path = directory / f"{feature}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    mutate(payload)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return directory


def test_checked_in_controlbox_is_valid() -> None:
    assert controlbox.recommendations.snapshot.candidate_events_per_school == 1000
    assert controlbox.morning_email.new_event_window_hours == 24
    assert controlbox.event_reminder.lead_minutes == 60
    assert controlbox.event_discovery.feed_revalidate_seconds == 3600
    assert controlbox.event_discovery.new_event_window_hours == 24
    assert controlbox.event_discovery.event_without_end_visibility_minutes == 60
    assert controlbox.event_discovery.initial_render_count == 24
    assert str(controlbox.authentication.legacy_frontend_origins[0]) == "https://wat2do.ca/"
    assert controlbox.organization_management.directory_page_size == 20
    assert controlbox.organization_management.directory_revalidate_seconds == 3600
    assert str(controlbox.contact.recipient_email) == "contact@wat2do.io"
    assert controlbox.contact.rate_limit.maximum_requests == 5
    # Publishing accounts are not configured here at all: which accounts exist,
    # which school each serves, and whether each runs all come from the row
    # written when the account is connected.
    assert not hasattr(controlbox.instagram_publishing, "accounts")
    assert controlbox.instagram_publishing.new_event_window_hours == 24
    assert controlbox.instagram_publishing.maximum_event_slides == 9
    assert controlbox.instagram_publishing.token_refresh_lead_days == 14
    assert controlbox.promoter_program.rate_cents == 25
    assert controlbox.promoter_program.maximum_active_posters == 50
    assert controlbox.promoter_program.payout_day_of_month == 1
    assert controlbox.promoter_program.quiet_poster_days == 30
    assert controlbox.promoter_program.banner_dismissal_days == 30
    assert controlbox.promoter_program.tos_version == "2026-07"
    assert str(controlbox.promoter_program.discord_invite_url) == ("https://discord.gg/uVcZcp4q8R")
    assert [template.id for template in controlbox.promoter_program.approved_templates] == [
        "campus-colour",
        "campus-black-white",
        "campus-low-ink",
    ]
    assert all(
        template.qr_placement.width == pytest.approx(0.470588)
        for template in controlbox.promoter_program.approved_templates
    )


def test_upload_contract_matches_event_image_bucket() -> None:
    """The frontend picker reads this control, so it must be the bucket's own rule."""
    from core.constants import BUCKET_EVENT_IMAGES
    from services.storage_service import storage

    assert storage.get_allowed_mime_types(BUCKET_EVENT_IMAGES) == [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    ]
    assert storage.get_file_size_limit(BUCKET_EVENT_IMAGES) == 5 * 1024 * 1024
    assert controlbox.uploads.event_image_allowed_mime_types == storage.get_allowed_mime_types(
        BUCKET_EVENT_IMAGES
    )


def test_non_image_upload_mime_type_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "uploads",
        lambda payload: payload.update({"event_image_allowed_mime_types": ["application/pdf"]}),
    )

    with pytest.raises(ValidationError, match="must be image/\\* types"):
        load_controlbox(path)


def test_duplicate_upload_mime_types_are_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "uploads",
        lambda payload: payload.update(
            {"event_image_allowed_mime_types": ["image/png", "image/png"]}
        ),
    )

    with pytest.raises(ValidationError, match="must be unique"):
        load_controlbox(path)


def test_unknown_control_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "morning_email",
        lambda payload: payload.update({"mystery_knob": 1}),
    )

    with pytest.raises(ValidationError, match="mystery_knob"):
        load_controlbox(path)


def test_invalid_recommendation_blend_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "recommendations",
        lambda payload: payload["personalization"]["hot_blend"].update({"content": 0.9}),
    )

    with pytest.raises(ValidationError, match="blend weights must total 1"):
        load_controlbox(path)


def test_invalid_cross_field_limits_are_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "recommendations",
        lambda payload: payload["snapshot"].update({"recommendations_per_user": 100}),
    )

    with pytest.raises(ValidationError, match="cannot exceed maximum_results"):
        load_controlbox(path)


def test_missing_feature_control_is_rejected(tmp_path: Path) -> None:
    path = _write_control(tmp_path, "admin", lambda payload: payload)
    (path / "admin.json").unlink()

    with pytest.raises(RuntimeError, match="Feature control file not found"):
        load_controlbox(path)


def test_promoter_template_qr_must_fit_inside_asset(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "promoter_program",
        lambda payload: payload["approved_templates"][0]["qr_placement"].update(
            {"x": 0.8, "width": 0.4}
        ),
    )

    with pytest.raises(ValidationError, match="must fit inside the asset"):
        load_controlbox(path)


def test_promoter_template_ids_must_be_unique(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "promoter_program",
        lambda payload: payload["approved_templates"][1].update(
            {"id": payload["approved_templates"][0]["id"]}
        ),
    )

    with pytest.raises(ValidationError, match="template IDs must be unique"):
        load_controlbox(path)


def test_promoter_map_buckets_must_be_unique_and_ascending(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "promoter_program",
        lambda payload: payload.update({"map_visitor_bucket_maximums": [0, 49, 9]}),
    )

    with pytest.raises(ValidationError, match="visitor bucket maximums"):
        load_controlbox(path)


def test_promoter_payout_day_must_exist_in_every_month(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "promoter_program",
        lambda payload: payload.update({"payout_day_of_month": 29}),
    )

    with pytest.raises(ValidationError, match="payout_day_of_month"):
        load_controlbox(path)
