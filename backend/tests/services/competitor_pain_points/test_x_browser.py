import json

import pytest

from services.competitor_pain_points import safari, x_browser


@pytest.fixture
def fake_safari(monkeypatch):
    """Fake osascript: one window, pages of posts per read, and a record of calls."""
    state = {"pages": [], "calls": []}

    def osascript(*lines, args):
        script = " ".join(lines)
        state["calls"].append((script, args))
        if "make new document" in script:
            return "42"
        if "do JavaScript" in script and args[0].startswith("window.scrollBy"):
            return ""
        if "do JavaScript" in script:
            return json.dumps(state["pages"].pop(0))
        return ""

    monkeypatch.setattr(safari, "_osascript", osascript)
    monkeypatch.setattr(x_browser.time, "sleep", lambda _seconds: None)
    return state


def post(n):
    return {
        "url": f"https://x.com/u/status/{n}",
        "posted_at": f"2026-10-1{n}T00:00:00Z",
        "author": "u",
        "text": f"post {n}",
    }


def test_search_scrolls_collects_unique_posts_and_closes_its_window(fake_safari, monkeypatch):
    fake_safari["pages"] = [[post(1), post(2)], [post(2), post(3)]] + [[]] * 10

    posts = x_browser._search("Eventbrite fees")

    assert [p["url"] for p in posts] == [post(n)["url"] for n in (1, 2, 3)]
    opened = fake_safari["calls"][0][1][0]
    assert opened.startswith("https://x.com/search?q=Eventbrite%20fees") and "f=live" in opened
    assert "close window id" in fake_safari["calls"][-1][0] and fake_safari["calls"][-1][1] == [
        "42"
    ]
    assert not any("click" in script.lower() for script, _ in fake_safari["calls"])


def test_logged_out_safari_raises_and_still_closes_the_window(fake_safari):
    fake_safari["pages"] = [None]
    with pytest.raises(safari.SafariUnavailable, match="not logged in"):
        x_browser._search("Meetup")
    assert "close window id" in fake_safari["calls"][-1][0]


def test_read_posts_merges_every_query_newest_first(monkeypatch):
    monkeypatch.setattr(
        x_browser,
        "_search",
        lambda query: [post(1), post(3)] if "fees" in query else [post(2), post(1)],
    )
    assert [p["url"] for p in x_browser.read_posts("Meetup")] == [post(n)["url"] for n in (3, 2, 1)]
