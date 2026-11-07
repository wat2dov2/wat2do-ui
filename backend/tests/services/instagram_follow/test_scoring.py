import pytest

from services.claude_code import ClaudeCodeError, ClaudeLimited
from services.ingestion.instagram_fetch import FetchBlocked
from services.instagram_follow import scoring as module

PROFILE = {
    "read": "ok",
    "name": "UTMAC",
    "posts": [
        {"url": "u", "posted_at": "2026-10-20T00:00:00+00:00", "caption": "Quiz", "image": None}
    ],
}


@pytest.fixture
def world(monkeypatch):
    saved = []
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        module.candidates,
        "unscored",
        lambda limit: [
            {"id": "1", "handle": "utmaclub", "school": "utsg"},
            {"id": "2", "handle": "rocsaut", "school": "utsg"},
        ],
    )
    monkeypatch.setattr(module.candidates, "save_profile", lambda *args: saved.append(args))
    monkeypatch.setattr(module.candidates, "requeue_for_recheck", lambda limit: 0)
    monkeypatch.setattr(
        module.candidates,
        "auto_decide",
        lambda candidate_id, status: saved.append((candidate_id, status)),
    )
    monkeypatch.setattr(module, "fetch_profile", lambda handle: PROFILE)
    return saved


def test_each_account_is_stored_with_its_score(world, monkeypatch):
    asked = []

    def run_agent(prompt, **kwargs):
        asked.append(prompt)
        return {
            "scores": [
                {
                    "handle": "utmaclub",
                    "score": 80,
                    "verdict": "approve",
                    "reason": "Weekly quiz nights",
                }
            ]
        }

    monkeypatch.setattr(module, "run_agent", run_agent)

    assert module.score_pending() == {"scored": 1}
    assert "utsg" in asked[0]
    assert world[0] == (
        "1",
        PROFILE,
        {"handle": "utmaclub", "score": 80, "verdict": "approve", "reason": "Weekly quiz nights"},
    )
    # The score decides the account right away.
    assert world[1] == ("1", "approved")
    # An account the scorer skipped keeps its profile and is scored next time.
    assert world[2] == ("2", PROFILE, None)


def test_a_scorer_that_does_not_answer_scores_nothing(world, monkeypatch):
    def run_agent(prompt, **kwargs):
        raise ClaudeCodeError("gave no answer")

    monkeypatch.setattr(module, "run_agent", run_agent)

    assert module.score_pending() == {"scored": 0}
    assert [entry[2] for entry in world] == [None, None]


def test_throttling_stops_the_run(world, monkeypatch):
    def fetch_profile(handle):
        raise FetchBlocked("Instagram answered HTTP 429")

    monkeypatch.setattr(module, "fetch_profile", fetch_profile)
    monkeypatch.setattr(module, "run_agent", pytest.fail)

    assert module.score_pending() == {"scored": 0, "stopped": 1}
    assert world == []


def test_claudes_usage_limit_stops_the_run_and_leaves_accounts_unscored(world, monkeypatch):
    def run_agent(prompt, **kwargs):
        raise ClaudeLimited("hit Claude's usage limit")

    monkeypatch.setattr(module, "run_agent", run_agent)

    assert module.score_pending() == {"scored": 0, "stopped": 1}
    assert world == []


def _posted(days_ago):
    from datetime import datetime, timedelta, timezone

    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return {"read": "ok", "posts": [{"posted_at": when.isoformat()}]}


@pytest.mark.parametrize(
    ("verdict", "profile", "handle", "expected"),
    [
        ("approve", _posted(400), "anything", "approved"),
        ("review", _posted(30), "anything", "approved"),
        ("review", _posted(200), "anything", "rejected"),
        ("reject", _posted(5), "anything", "rejected"),
        ("review", {"read": "failed"}, "laurieritalianclub", "approved"),
        ("review", {"read": "failed"}, "someband", "rejected"),
        ("reject", {"read": "failed"}, "laurierconfessions", "rejected"),
        ("review", {"read": "no_posts"}, "laurierchess", "rejected"),
    ],
)
def test_each_score_decides_the_account(verdict, profile, handle, expected):
    score = {"verdict": verdict, "score": 50, "reason": "r"}
    assert module.decision("wlu", {"handle": handle}, profile, score) == expected
