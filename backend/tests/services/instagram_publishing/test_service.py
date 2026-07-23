from services.instagram_publishing import service


def test_select_events_orders_by_ai_score_and_limits_each_organization():
    candidates = [
        {
            "id": 1,
            "organization": "Same Club",
            "dtstart_utc": "2026-07-25T10:00:00+00:00",
        },
        {
            "id": 2,
            "organization": "Same Club",
            "dtstart_utc": "2026-07-26T10:00:00+00:00",
        },
        {
            "id": 3,
            "organization": "Same Club",
            "dtstart_utc": "2026-07-27T10:00:00+00:00",
        },
        {
            "id": 4,
            "organization": "Another Club",
            "dtstart_utc": "2026-07-28T10:00:00+00:00",
        },
    ]
    scores = [
        {"event_id": 1, "overall_score": 9.0},
        {"event_id": 2, "overall_score": 8.0},
        {"event_id": 3, "overall_score": 7.0},
        {"event_id": 4, "overall_score": 6.0},
    ]

    selected = service._select_events(candidates, scores)

    assert [event["id"] for event, _ in selected] == [1, 2, 4]


def test_select_events_filters_below_threshold():
    candidates = [
        {
            "id": 1,
            "organization": "Club",
            "dtstart_utc": "2026-07-25T10:00:00+00:00",
        }
    ]

    assert service._select_events(candidates, [{"event_id": 1, "overall_score": 2.0}]) == []
