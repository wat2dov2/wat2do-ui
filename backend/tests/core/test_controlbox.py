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
    assert controlbox.event_discovery.feed_revalidate_seconds == 3600
    assert (
        controlbox.instagram_publishing.accounts[0].instagram_business_account_id
        == "17841476154506771"
    )


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
