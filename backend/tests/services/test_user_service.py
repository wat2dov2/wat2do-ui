from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from core.constants import MAX_AVATAR_URL_LENGTH
from core.exceptions import ValidationError
from core.tables import USERS
from schemas.user import UserResponse, UserUpdate
from services import user_service
from services.user_service import get_user


def test_default_avatar_is_stable_distinct_and_preserves_uploaded_photo():
    first = user_service.avatar_url_for_user("first-user")
    assert first.startswith("data:image/svg+xml;base64,")
    assert first == user_service.avatar_url_for_user("first-user")
    assert first != user_service.avatar_url_for_user("second-user")
    assert (
        user_service.avatar_url_for_user("first-user", "https://example.com/photo.jpg")
        == "https://example.com/photo.jpg"
    )


def test_generated_avatars_fit_the_profile_url_contract():
    for seed in range(1000):
        assert len(user_service.avatar_url_for_user(str(seed))) <= MAX_AVATAR_URL_LENGTH


def test_profile_rejects_faculty_from_another_school(monkeypatch):
    user = UserResponse(
        id=uuid4(),
        email="person@example.com",
        school="uwaterloo",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user", lambda _id: user)
    monkeypatch.setattr(
        user_service.school_service,
        "get_school",
        lambda _slug: SimpleNamespace(
            faculties=["Arts", "Engineering"],
        ),
    )
    with pytest.raises(ValidationError, match="Faculty is not offered"):
        user_service.update_user(user.id, UserUpdate(faculty="DeGroote School of Business"))


def test_profile_school_change_clears_inapplicable_faculty(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.user_service")
    user = UserResponse(
        id=uuid4(),
        email="person@example.com",
        school="uwaterloo",
        faculty="Mathematics",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user", lambda _id: user)
    monkeypatch.setattr(
        user_service.school_service,
        "get_school",
        lambda _slug: SimpleNamespace(
            id=2,
            faculties=["Humanities", "Science"],
        ),
    )
    fake_sb.set_response(data=[])

    user_service.update_user(user.id, UserUpdate(school="mcmaster"))

    fake_sb.update.assert_called_once_with({"school_id": 2, "faculty": None})


def test_get_user_returns_none_when_no_row(fake_sb, patch_sb):
    """No rows back from the data API → service returns ``None`` (not an error)."""
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
    fake_sb.select.assert_called_once_with("*,school_record:schools(slug)")
    fake_sb.eq.assert_called_once_with("id", str(user_id))


@pytest.mark.parametrize("count", [0, 1, 999, 1000, 1001, 2001])
def test_get_users_by_ids_preserves_batch_boundaries(fake_sb, patch_sb, count):
    patch_sb("services.user_service")
    ids = [str(uuid4()) for _ in range(count)]
    fake_sb.set_response(data=[])

    assert user_service.get_users_by_ids(ids) == {}

    calls = fake_sb.in_.call_args_list
    assert [list(call.args[1]) for call in calls] == [
        ids[start : start + 1000] for start in range(0, count, 1000)
    ]
    assert all(call.args[0] == "id" for call in calls)
    assert fake_sb.execute.call_count == len(calls)


def test_get_users_by_ids_normalizes_profiles_and_omits_missing_users(fake_sb, patch_sb):
    patch_sb("services.user_service")
    user_ids = [str(uuid4()) for _ in range(1001)]
    first = {
        "id": user_ids[0],
        "email": "first@example.com",
        "school_record": {"slug": "uwaterloo"},
        "created_at": "2026-09-12T12:00:00+00:00",
        "updated_at": "2026-09-12T12:00:00+00:00",
    }
    last = {
        **first,
        "id": user_ids[-1],
        "email": "last@example.com",
        "avatar_url": "https://example.com/avatar.jpg",
    }
    fake_sb.execute.side_effect = [
        SimpleNamespace(data=[first]),
        SimpleNamespace(data=[last]),
    ]

    result = user_service.get_users_by_ids(user_ids)

    assert list(result) == [user_ids[0], user_ids[-1]]
    assert result[user_ids[0]].school == "uwaterloo"
    assert result[user_ids[0]].avatar_url == user_service.avatar_url_for_user(user_ids[0])
    assert result[user_ids[-1]].avatar_url == last["avatar_url"]
