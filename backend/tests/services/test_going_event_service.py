from uuid import UUID

from services import going_event_service

USER_ID = "11111111-1111-1111-1111-111111111111"
OCCURRENCE_1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
OCCURRENCE_2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


def test_get_going_event_selections_groups_occurrences(fake_sb, patch_sb):
    patch_sb("services.going_event_service")
    fake_sb.set_response(
        data=[
            {"event_id": 42, "event_date_id": OCCURRENCE_1},
            {"event_id": 42, "event_date_id": OCCURRENCE_2},
        ]
    )

    selections = going_event_service.get_going_event_selections(USER_ID)

    assert len(selections) == 1
    assert selections[0].event_id == 42
    assert selections[0].occurrence_ids == [
        UUID(OCCURRENCE_1),
        UUID(OCCURRENCE_2),
    ]
    fake_sb.eq.assert_any_call("user_id", USER_ID)


def test_set_going_occurrences_uses_single_rpc(fake_sb, patch_sb):
    patch_sb("services.going_event_service")
    fake_sb.set_response(
        data=[
            {
                "status": "going",
                "event_id": 42,
                "occurrence_ids": [OCCURRENCE_1],
                "going_count": 7,
            }
        ]
    )

    response = going_event_service.set_going_occurrences(
        USER_ID,
        42,
        [UUID(OCCURRENCE_1)],
    )

    assert response.going_count == 7
    fake_sb.rpc.assert_called_once_with(
        "set_user_going_occurrences",
        {
            "p_user_id": USER_ID,
            "p_event_id": 42,
            "p_occurrence_ids": [OCCURRENCE_1],
        },
    )


def test_get_going_counts_for_events_uses_distinct_user_rpc(fake_sb, patch_sb):
    patch_sb("services.going_event_service")
    fake_sb.set_response(
        data=[
            {"event_id": 1, "going_count": 2},
            {"event_id": 2, "going_count": 1},
        ]
    )

    assert going_event_service.get_going_counts_for_events([1, 2, 1]) == {
        1: 2,
        2: 1,
    }
    fake_sb.rpc.assert_called_once_with(
        "get_event_going_counts",
        {"p_event_ids": [1, 2]},
    )


def test_get_all_user_goings_collapses_occurrence_duplicates(fake_sb, patch_sb):
    patch_sb("services.going_event_service")
    fake_sb.set_response(
        data=[
            {"user_id": USER_ID, "event_id": 42},
            {"user_id": USER_ID, "event_id": 42},
        ]
    )

    pairs = going_event_service.get_all_user_goings()

    assert [(str(pair.user_id), pair.event_id) for pair in pairs] == [(USER_ID, 42)]


def test_get_attendee_display_names_deduplicates_users(fake_sb, patch_sb):
    patch_sb("services.going_event_service")
    fake_sb.queue_responses(
        [
            [{"user_id": "u1"}, {"user_id": "u1"}, {"user_id": "u2"}],
            [
                {"id": "u1", "full_name": "Sean Yun-Park"},
                {"id": "u2", "full_name": "Jesse"},
            ],
        ]
    )

    assert going_event_service.get_attendee_display_names(42) == [
        "Sean Y.",
        "Jesse",
    ]
    fake_sb.in_.assert_called_once_with("id", ["u1", "u2"])
