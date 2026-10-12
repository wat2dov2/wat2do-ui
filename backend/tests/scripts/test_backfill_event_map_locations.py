from scripts.backfill_event_map_locations import parse_map_locations


def test_parse_map_locations_keeps_requested_answers_and_nulls():
    answer = """```json
{"0": " Arts Lecture Hall, University of Waterloo, Waterloo, ON ", "1": null, "7": "Elsewhere"}
```"""

    assert parse_map_locations(answer, 2) == {
        0: "Arts Lecture Hall, University of Waterloo, Waterloo, ON",
        1: None,
    }


def test_parse_map_locations_ignores_unusable_answers():
    assert parse_map_locations(None, 2) == {}
    assert parse_map_locations("not json", 2) == {}
    assert parse_map_locations('{"0": "", "1": 5, "x": "Hall"}', 2) == {}
