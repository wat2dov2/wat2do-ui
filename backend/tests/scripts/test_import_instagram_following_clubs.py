import json
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from scripts import import_instagram_following_clubs as module


def _archive(path: Path, *handles: str) -> Path:
    html = "".join(f"<h2>{handle}</h2>" for handle in handles)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(module.FOLLOWING_HTML, html)
    return path


def test_read_following_handles_normalizes_and_deduplicates(tmp_path):
    path = _archive(tmp_path / "following.zip", "@MacClub", "macclub", "Other.Club")

    assert module.read_following_handles(path) == {"macclub", "other.club"}


def test_new_candidate_requires_high_confidence_for_agent_classification():
    classifications = {
        ("utsg", "clear.club"): {
            "action": "insert",
            "confidence": "high",
            "club_name": "Clear Club",
            "categories": ["Community Service"],
        },
        ("utsg", "maybe.club"): {
            "action": "insert",
            "confidence": "medium",
            "club_name": "Maybe Club",
            "categories": [],
        },
    }

    clear, reason = module._new_candidate("utsg", "clear.club", {}, classifications)
    maybe, maybe_reason = module._new_candidate("utsg", "maybe.club", {}, classifications)

    assert clear == {
        "club_name": "Clear Club",
        "categories": ["Community Service"],
        "ig": "clear.club",
        "club_page": None,
        "discord": None,
    }
    assert reason is None
    assert maybe is None
    assert maybe_reason == "classification_not_high_confidence"


def test_build_plan_freezes_existing_rows_and_reconciles_exact_name(monkeypatch, tmp_path):
    path = _archive(tmp_path / "following.zip", "existing.club", "attached.club", "new.club")
    monkeypatch.setattr(module, "_fetch_schools", lambda sb: {"utsg": 1})
    monkeypatch.setattr(
        module,
        "_fetch_clubs",
        lambda sb, school_ids: [
            {
                "id": 10,
                "club_name": "Existing Club",
                "school_id": 1,
                "categories": ["Business"],
                "ig": "existing.club",
                "club_type": "independent",
                "status": "approved",
            },
            {
                "id": 11,
                "club_name": "Attached Club",
                "school_id": 1,
                "categories": [],
                "ig": None,
                "club_type": "independent",
                "status": "approved",
            },
        ],
    )
    monkeypatch.setattr(module, "_workbook_index", lambda: {})
    classifications = {
        ("utsg", "attached.club"): {
            "action": "insert",
            "confidence": "high",
            "club_name": "Attached Club",
            "categories": ["Arts & Culture"],
        },
        ("utsg", "new.club"): {
            "action": "insert",
            "confidence": "high",
            "club_name": "New Club",
            "categories": ["Health"],
        },
    }

    plan = module.build_plan(object(), {"utsg": path}, classifications)

    assert plan["updates"] == [
        {"id": 10, "school": "utsg", "club_type": "utsu"},
        {
            "categories": ["Arts & Culture"],
            "id": 11,
            "ig": "attached.club",
            "school": "utsg",
            "club_type": "utsu",
        },
    ]
    assert plan["inserts"] == [
        {
            "categories": ["Health"],
            "discord": None,
            "ig": "new.club",
            "club_name": "New Club",
            "club_page": None,
            "club_type": "independent",
            "school": "utsg",
            "school_id": 1,
            "status": "approved",
        }
    ]


def test_reconcile_planned_inserts_holds_duplicate_names_and_cross_school_handles():
    inserts = [
        {"school": "utsg", "ig": "club.old", "club_name": "Same Club"},
        {"school": "utsg", "ig": "club.new", "club_name": "Same Club"},
        {"school": "utsg", "ig": "shared.club", "club_name": "Shared Club"},
        {"school": "utsc", "ig": "shared.club", "club_name": "Shared Club UTSC"},
        {"school": "utsg", "ig": "unique.club", "club_name": "Unique Club"},
    ]
    reviews = []

    kept = module.reconcile_planned_inserts(inserts, reviews)

    assert kept == [{"school": "utsg", "ig": "unique.club", "club_name": "Unique Club"}]
    assert {row["reason"] for row in reviews} == {
        "duplicate_planned_name",
        "planned_handle_multiple_schools",
    }


def test_apply_plan_writes_selected_school_and_revalidates_once(monkeypatch):
    query = MagicMock()
    query.update.return_value = query
    query.eq.return_value = query
    query.in_.return_value = query
    query.insert.return_value = query
    query.execute.return_value = SimpleNamespace(data=[])
    sb = MagicMock()
    sb.table.return_value = query
    monkeypatch.setattr(module, "_fetch_schools", lambda sb: {"utsg": 1})
    monkeypatch.setattr(module, "_fetch_clubs", lambda sb, school_ids: [])
    revalidate = MagicMock()
    monkeypatch.setattr(module.event_feed_revalidation_service, "revalidate_school", revalidate)
    plan = {
        "updates": [
            {"id": 1, "school": "utsg", "club_type": "utsu"},
            {"id": 2, "school": "utsc", "club_type": "scsu"},
        ],
        "inserts": [
            {
                "school": "utsg",
                "school_id": 1,
                "club_name": "New Club",
                "categories": [],
                "ig": "new.club",
                "club_type": "independent",
                "status": "approved",
            }
        ],
    }

    assert module.apply_plan(sb, plan, "utsg") == {"utsg"}
    assert query.update.call_args.args[0] == {"club_type": "utsu"}
    query.in_.assert_called_once_with("id", [1])
    assert query.insert.call_args.args[0][0]["club_name"] == "New Club"
    revalidate.assert_called_once_with("utsg", resources=("events", "positions", "clubs"))


def test_apply_plan_skips_insert_already_written_by_a_partial_run(monkeypatch):
    query = MagicMock()
    query.update.return_value = query
    query.eq.return_value = query
    query.execute.return_value = SimpleNamespace(data=[])
    sb = MagicMock()
    sb.table.return_value = query
    monkeypatch.setattr(module, "_fetch_schools", lambda sb: {"utsg": 1})
    monkeypatch.setattr(
        module,
        "_fetch_clubs",
        lambda sb, school_ids: [{"school_id": 1, "ig": "new.club"}],
    )
    plan = {
        "updates": [],
        "inserts": [
            {
                "school": "utsg",
                "school_id": 1,
                "club_name": "New Club",
                "ig": "new.club",
            }
        ],
    }

    assert module.apply_plan(sb, plan, "utsg") == set()
    query.insert.assert_not_called()


def test_write_plan_is_stable_json(tmp_path):
    path = tmp_path / "plan.json"
    module.write_plan(path, {"version": 1, "reviews": []})

    assert json.loads(path.read_text()) == {"reviews": [], "version": 1}
