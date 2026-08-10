from scripts.backfill_escaped_event_descriptions import description_repairs


def test_description_repairs_returns_only_changed_rows():
    escaped = {
        "id": 19027,
        "title": "STAT 231 Final Review Session",
        "description": r"\ud83d\udcca Review session\n\nPizza provided.",
    }
    correct = {
        "id": 19028,
        "title": "Already correct",
        "description": "📊 Review session\n\nPizza provided.",
    }

    repairs = description_repairs([escaped, correct, {"id": 19029, "description": None}])

    assert repairs == [(escaped, "📊 Review session\n\nPizza provided.")]


def test_description_repairs_is_idempotent():
    repaired = {
        "id": 19027,
        "description": "📊 Review session\n\nPizza provided.",
    }

    assert description_repairs([repaired]) == []
