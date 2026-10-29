import pytest

from services.claude_code import ClaudeCodeError
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
    # An account the scorer skipped keeps its profile and is scored next time.
    assert world[1] == ("2", PROFILE, None)


def test_a_scorer_that_does_not_answer_scores_nothing(world, monkeypatch):
    def run_agent(prompt, **kwargs):
        raise ClaudeCodeError("gave no answer")

    monkeypatch.setattr(module, "run_agent", run_agent)

    assert module.score_pending() == {"scored": 0}
    assert [score for _, _, score in world] == [None, None]


def test_throttling_stops_the_run(world, monkeypatch):
    def fetch_profile(handle):
        raise FetchBlocked("Instagram answered HTTP 429")

    monkeypatch.setattr(module, "fetch_profile", fetch_profile)
    monkeypatch.setattr(module, "run_agent", pytest.fail)

    assert module.score_pending() == {"scored": 0, "stopped": 1}
    assert world == []
