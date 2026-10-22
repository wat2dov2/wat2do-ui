import json

import pytest

from services.competitor_pain_points import reddit_browser, safari


@pytest.fixture
def safari_pages(monkeypatch):
    """Fake osascript: one window, a page of items per read, and a record of calls."""
    state = {"pages": [], "calls": []}

    def osascript(*lines, args):
        script = " ".join(lines)
        state["calls"].append((script, args))
        if "make new document" in script:
            return "7"
        if "do JavaScript" in script and args[0].startswith("window.scrollBy"):
            return ""
        if "do JavaScript" in script:
            return json.dumps(state["pages"].pop(0) if state["pages"] else [])
        return ""

    monkeypatch.setattr(safari, "_osascript", osascript)
    monkeypatch.setattr(reddit_browser.time, "sleep", lambda _seconds: None)
    return state


def item(n):
    return {
        "url": f"https://www.reddit.com/r/x/comments/{n}/t/c{n}/",
        "posted_at": f"2026-10-1{n}T00:00:00+0000",
        "author": "u",
        "thread": "t",
        "text": f"comment {n}",
    }


def test_search_reads_newest_results_and_closes_its_window(safari_pages):
    safari_pages["pages"] = [[item(1), item(2)], [item(2), item(3)]]

    found = reddit_browser._search("Eventbrite fees", "comments", reddit_browser._READ_COMMENTS)

    assert [i["url"] for i in found] == [item(n)["url"] for n in (1, 2, 3)]
    opened = safari_pages["calls"][0][1][0]
    assert opened == "https://www.reddit.com/search/?q=Eventbrite%20fees&type=comments&sort=new"
    assert "close window id" in safari_pages["calls"][-1][0]
    assert safari_pages["calls"][-1][1] == ["7"]
    assert not any("click" in script.lower() for script, _ in safari_pages["calls"])


def test_read_posts_searches_comments_and_posts_for_every_query(monkeypatch):
    searched = []

    def search(query, kind, _reader):
        searched.append((query, kind))
        return [item(1), item(3)] if kind == "comments" else [item(2), item(1)]

    monkeypatch.setattr(reddit_browser, "_search", search)

    found = reddit_browser.read_posts("Meetup")

    assert [i["url"] for i in found] == [item(n)["url"] for n in (3, 2, 1)]
    queries = [q.format(name="Meetup") for q in reddit_browser.CONTROL.reddit_queries]
    assert searched == [(q, kind) for q in queries for kind in ("comments", "posts")]
