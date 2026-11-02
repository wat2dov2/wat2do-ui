from services import going_event_service

USER_ID = "11111111-1111-1111-1111-111111111111"


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
