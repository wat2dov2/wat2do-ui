from uuid import uuid4

import pytest

from schemas.club import ClubCreate
from services.instagram_follow import candidates as module


@pytest.fixture
def sb(fake_sb, patch_sb):
    patch_sb("services.instagram_follow.candidates")
    return fake_sb


def test_known_handles_cover_every_status(sb):
    sb.set_response(data=[{"handle": "utmaclub"}, {"handle": "rejected.club"}])

    assert module.known_handles(7) == {"utmaclub", "rejected.club"}
    sb.eq.assert_any_call("school_id", 7)
    assert not [call for call in sb.eq.call_args_list if call.args[0] == "status"]


def test_a_requested_account_never_replaces_an_existing_row(sb):
    module.add_candidate(7, "@UTMAClub", source="crawl", name="UTMAC", found_via=["rocsaut"])

    row = sb.upsert.call_args.args[0]
    assert row["handle"] == "utmaclub"
    assert (row["source"], row["status"], row["found_via"]) == ("crawl", "pending", ["rocsaut"])
    assert sb.upsert.call_args.kwargs == {
        "on_conflict": "school_id,handle",
        "ignore_duplicates": True,
    }


def _pending(candidate_id, handle="utmaclub"):
    return {
        "id": str(candidate_id),
        "handle": handle,
        "name": "UTMAC",
        "school_record": {"slug": "utsg"},
    }


def test_approving_creates_the_club_when_the_school_has_none(sb, monkeypatch):
    candidate_id = uuid4()
    sb.queue_responses([[_pending(candidate_id)]])
    monkeypatch.setattr(
        module.club_service, "lookup_club_by_school_and_ig", lambda school, handle: None
    )
    created = []

    def create_club(data, *, created_by, auto_approve):
        created.append((data, created_by, auto_approve))
        return type("Club", (), {"id": 55})()

    monkeypatch.setattr(module.club_service, "create_club", create_club)

    outcomes = module.decide([(candidate_id, "approved")], decided_by="admin-1")

    assert outcomes == {"approved": 1, "rejected": 0}
    [(data, created_by, auto_approve)] = created
    assert data == ClubCreate(club_name="UTMAC", ig="utmaclub", school="utsg")
    assert (created_by, auto_approve) == (None, True)
    update = sb.update.call_args.args[0]
    assert (update["status"], update["club_id"], update["decided_by"]) == (
        "approved",
        55,
        "admin-1",
    )


def test_approving_reuses_the_schools_existing_club(sb, monkeypatch):
    candidate_id = uuid4()
    sb.queue_responses([[_pending(candidate_id)]])
    monkeypatch.setattr(
        module.club_service, "lookup_club_by_school_and_ig", lambda school, handle: {"id": 9}
    )
    monkeypatch.setattr(module.club_service, "create_club", pytest.fail)

    module.decide([(candidate_id, "approved")], decided_by="admin-1")

    assert sb.update.call_args.args[0]["club_id"] == 9


def test_rejecting_creates_nothing_and_decisions_on_settled_rows_are_skipped(sb, monkeypatch):
    rejected, settled = uuid4(), uuid4()
    sb.queue_responses([[_pending(rejected)]])
    monkeypatch.setattr(module.club_service, "create_club", pytest.fail)

    outcomes = module.decide([(rejected, "rejected"), (settled, "approved")], decided_by="admin-1")

    assert outcomes == {"approved": 0, "rejected": 1}
    sb.eq.assert_any_call("status", "pending")
    assert "club_id" not in sb.update.call_args.args[0]


def test_a_read_profile_and_its_score_are_stored(sb):
    posts = [
        {
            "url": "https://www.instagram.com/p/NEW/",
            "posted_at": "2026-10-20T00:00:00+00:00",
            "caption": "Quiz",
            "image": None,
        }
    ]

    module.save_profile(
        "c1",
        {"read": "ok", "name": "UTMAC", "followers_count": 436, "posts": posts},
        {"score": 82, "verdict": "approve", "reason": "Weekly mahjong nights"},
    )

    update = sb.update.call_args.args[0]
    assert update["last_posted_at"] == "2026-10-20T00:00:00+00:00"
    assert (update["score"], update["verdict"], update["name"]) == (82, "approve", "UTMAC")
    assert "scored_at" in update


def test_an_unanswered_score_leaves_the_account_to_score_again(sb):
    module.save_profile("c1", {"read": "failed"}, None)

    update = sb.update.call_args.args[0]
    assert update["read_status"] == "failed"
    assert "scored_at" not in update


def test_listed_clubs_are_queued_approved_for_their_school_once(sb, monkeypatch):
    monkeypatch.setattr(
        module.school_service, "get_school_id", lambda slug: {"utsg": 7, "utm": 8}.get(slug)
    )
    sb.queue_responses(
        [
            [
                {"id": 1, "club_name": "UTMAC", "ig": "@UTMAClub", "school_id": 7},
                {"id": 2, "club_name": "Duplicate", "ig": "utmaclub", "school_id": 7},
                {"id": 3, "club_name": "Website", "ig": "https://instagram.com/x", "school_id": 7},
                {"id": 4, "club_name": "No account", "ig": "utmmsa", "school_id": 99},
            ],
            [{"handle": "utmaclub"}],
        ]
    )

    assert module.sync_club_targets() == 1

    [rows] = sb.upsert.call_args.args
    assert rows == [
        {
            "school_id": 7,
            "handle": "utmaclub",
            "name": "UTMAC",
            "source": "club",
            "status": "approved",
            "club_id": 1,
        }
    ]
    assert sb.upsert.call_args.kwargs == {
        "on_conflict": "school_id,handle",
        "ignore_duplicates": True,
    }
    sb.eq.assert_any_call("status", "approved")


@pytest.mark.parametrize(
    ("value", "handle"),
    [
        ("@UTMAClub", "utmaclub"),
        (" utm.mocktrials ", "utm.mocktrials"),
        ("https://instagram.com/x", None),
        ("", None),
        (None, None),
    ],
)
def test_handles_are_bare_usernames(value, handle):
    assert module.normalize_handle(value) == handle


def test_confirming_a_followed_account_keeps_the_day_it_was_followed(sb):
    module.mark_followed("1", tapped=False)

    update = sb.update.call_args.args[0]
    assert update["status"] == "followed"
    assert "followed_at" not in update


def test_a_follow_that_failed_after_its_tap_is_dated(sb):
    module.mark_follow_failed("1", "bell never showed", tapped=True)
    assert "followed_at" in sb.update.call_args.args[0]

    module.mark_follow_failed("2", "profile never loaded")
    assert "followed_at" not in sb.update.call_args.args[0]
