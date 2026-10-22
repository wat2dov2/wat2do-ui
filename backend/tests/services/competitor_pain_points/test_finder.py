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
REDDIT_POST = {
    "url": "https://www.reddit.com/r/toronto/comments/abc/meetup/def/",
    "author": "someone",
    "thread": "Meetup alternatives?",
    "text": "meetup is too expensive",
}
X_POST = {"url": "https://x.com/someone/status/1", "author": "someone", "text": "eventbrite fees"}


def _answer(*findings):
    return {"findings": list(findings)}


def test_findings_are_checked_and_invented_or_known_links_dropped(monkeypatch):
    calls = []

    def run_agent(prompt, **kwargs):
        written = json.loads((Path(kwargs["workdir"]) / "posts.json").read_text())
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

    findings = finder.find("eventbrite", "x", ["https://www.reddit.com/r/known/"], [X_POST])

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
    assert written == [X_POST] and "posts.json" in prompt
    assert "Eventbrite" in prompt and "https://www.reddit.com/r/known/" in prompt
    assert "{{" not in prompt
    assert kwargs["tools"] == ("Read",)
    assert kwargs["allowed_tools"] == ("Read(./**)",)
    assert kwargs["model"] == finder.CONTROL.model


def test_web_lanes_search_only_their_part_of_the_web(monkeypatch):
    calls = []
    monkeypatch.setattr(
        finder, "run_agent", lambda prompt, **kwargs: calls.append((prompt, kwargs)) or _answer()
    )

    assert finder.find("fable", "app_stores", [], []) == []

    prompt, kwargs = calls[0]
    assert kwargs["tools"] == kwargs["allowed_tools"] == ("WebSearch", "WebFetch")
    assert "App Store and Google Play reviews of the Fable Social app" in prompt
    assert finder.CONTROL.about["fable"] in prompt
    assert "posts.json" not in prompt and "{{" not in prompt


def test_sweep_reads_x_in_turn_stores_unique_links_and_reports_failures(monkeypatch):
    saved = []
    read = []
    monkeypatch.setattr(finder, "remove_leftovers", lambda _prefix: None)
    monkeypatch.setattr(finder.service, "recent_urls", lambda _limit: [])
    monkeypatch.setattr(
        finder.service, "save_findings", lambda findings: saved.extend(findings) or len(findings)
    )

    def read_x(name):
        read.append(("x", name))
        if name == finder.CONTROL.competitors["fable"]:
            raise finder.safari.SafariUnavailable("Safari is not logged in to X")
        return [X_POST] if name == "Eventbrite" else []

    def read_reddit(name):
        read.append(("reddit", name))
        return [REDDIT_POST] if name == "Meetup" else []

    def run_agent(prompt, **kwargs):
        lanes.append(kwargs["tools"])
        if "Meetup" in prompt and "review sites such as" in prompt:
            raise ClaudeCodeError("failed (exit 1)")
        return _answer(GOOD)

    lanes = []
    monkeypatch.setitem(finder.BROWSER_LANES, "x", ("X (Twitter)", read_x))
    monkeypatch.setitem(finder.BROWSER_LANES, "reddit", ("Reddit", read_reddit))
    monkeypatch.setattr(finder, "run_agent", run_agent)

    assert finder.sweep() == {"saved": 1, "failed": ["meetup/review_sites"]}
    assert [f.url for f in saved] == [GOOD["url"]]
    # Every competitor gets every web lane; only Eventbrite's X and Meetup's
    # Reddit had posts for an agent to read.
    competitors, web_lanes = len(finder.CONTROL.competitors), len(finder.CONTROL.lanes)
    assert lanes.count(("WebSearch", "WebFetch")) == competitors * web_lanes
    assert lanes.count(("Read",)) == 2
    # Safari reads one site at a time; a logged-out Safari only skips that site.
    names = [finder.CONTROL.search_names.get(c, n) for c, n in finder.CONTROL.competitors.items()]
    assert read == [(lane, name) for name in names for lane in ("x", "reddit")]
