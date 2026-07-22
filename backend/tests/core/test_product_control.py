import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from core.product_control import load_product_control, product_control


def _write_control(tmp_path: Path, mutate) -> Path:
    source = Path(__file__).resolve().parents[3] / "product-control.json"
    payload = json.loads(source.read_text(encoding="utf-8"))
    mutate(payload)
    target = tmp_path / "product-control.json"
    target.write_text(json.dumps(payload), encoding="utf-8")
    return target


def test_checked_in_product_control_is_valid() -> None:
    assert product_control.recommendations.snapshot.candidate_events_per_school == 1000
    assert product_control.morning_email.new_event_window_hours == 24
    assert product_control.event_discovery.feed_revalidate_seconds == 3600


def test_unknown_control_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        lambda payload: payload["morning_email"].update({"mystery_knob": 1}),
    )

    with pytest.raises(ValidationError, match="mystery_knob"):
        load_product_control(path)


def test_invalid_recommendation_blend_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        lambda payload: payload["recommendations"]["personalization"]["hot_blend"].update(
            {"content": 0.9}
        ),
    )

    with pytest.raises(ValidationError, match="blend weights must total 1"):
        load_product_control(path)


def test_invalid_cross_field_limits_are_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        lambda payload: payload["recommendations"]["snapshot"].update(
            {"recommendations_per_user": 100}
        ),
    )

    with pytest.raises(ValidationError, match="cannot exceed maximum_results"):
        load_product_control(path)
