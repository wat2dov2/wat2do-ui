import json
from pathlib import Path

from services.claude_code import ClaudeCodeError
from services.competitor_pain_points import finder

GOOD = {
    "url": "https://www.reddit.com/r/uwaterloo/comments/abc/eventbrite_fees/",
    "source": "reddit",
    "author": "club_treasurer",
    "quote": "  Eventbrite charges us for free tickets.  ",
    "pain_point": "Fees on free events",
    "audience": "organizer",
    "posted_at": "2026-10-18",
}
X_POST = {"url": "https://x.com/someone/status/1", "author": "someone", "text": "eventbrite fees"}


def _answer(*findings):
    return {"findings": list(findings)}


def test_findings_are_checked_and_invented_or_known_links_dropped(monkeypatch):
    calls = []

    def run_agent(prompt, **kwargs):
        written = json.loads((Path(kwargs["workdir"]) / "x_posts.json").read_text())
        calls.append((prompt, kwargs, written))
        return _answer(
            GOOD,
            {**GOOD, "url": "https://evil.example.com/r/fake/"},
            {**GOOD, "url": "https://www.reddit.com/search/?q=eventbrite"},
            {**GOOD, "url": "https://www.reddit.com/r/known/"},
            {**GOOD, "url": "https://forum.example.org/t/eventbrite", "source": "forum"},
            {**GOOD, "url": "https://apps.apple.com/ca/app/eventbrite/id1", "source": "app_store"},
            {**GOOD, "audience": "investor"},
            {**GOOD, "quote": ""},
        )

    monkeypatch.setattr(finder, "run_agent", run_agent)

    findings = finder.find("eventbrite", ["https://www.reddit.com/r/known/"], [X_POST])

    assert [f.url.split("#")[0] for f in findings] == [
        GOOD["url"],
        "https://forum.example.org/t/eventbrite",
        "https://apps.apple.com/ca/app/eventbrite/id1",
    ]
    # Reviews on a shared app page get a stable per-quote link.
    assert findings[2].url.startswith("https://apps.apple.com/ca/app/eventbrite/id1#review-")
    assert findings[0].competitor == "eventbrite"
    assert findings[0].quote == "Eventbrite charges us for free tickets."
    prompt, kwargs, written = calls[0]
    assert written == [X_POST] and "x_posts.json" in prompt
    assert "Eventbrite" in prompt and "https://www.reddit.com/r/known/" in prompt
    assert "{{" not in prompt
    assert kwargs["tools"] == ("Read", "WebSearch", "WebFetch")
    assert kwargs["model"] == finder.CONTROL.model


def test_sweep_reads_x_in_turn_stores_unique_links_and_reports_failures(monkeypatch):
    saved = []
    read = []
    monkeypatch.setattr(finder, "remove_leftovers", lambda _prefix: None)
    monkeypatch.setattr(finder.service, "recent_urls", lambda _limit: [])
    monkeypatch.setattr(
        finder.service, "save_findings", lambda findings: saved.extend(findings) or len(findings)
    )

    def read_posts(name):
        read.append(name)
        if name == "Fable Social":
            raise finder.x_browser.XUnavailable("Safari is not logged in to X")
        return []

    def run_agent(prompt, **_kwargs):
        if "Meetup" in prompt:
            raise ClaudeCodeError("failed (exit 1)")
        return _answer(GOOD)

    monkeypatch.setattr(finder.x_browser, "read_posts", read_posts)
    monkeypatch.setattr(finder, "run_agent", run_agent)

    assert finder.sweep() == {"saved": 1, "failed": ["meetup"]}
    assert [f.url for f in saved] == [GOOD["url"]]
    # X is read one competitor at a time; a logged-out Safari only skips X.
    assert read == ["Eventbrite", "Meetup", "Fable Social"]
