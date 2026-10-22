"""Read Reddit search results in Safari for the pain point sweep.

Reddit refuses Claude's WebFetch and plain HTTP clients, but a logged-out
Safari window shows its search pages. Comment search gives each comment's full
text; post search gives titles. Like ``x_browser`` it only reads the page.
"""

from __future__ import annotations

import json
import time
from typing import Any
from urllib.parse import quote

from core.controlbox import controlbox
from services.competitor_pain_points import safari

CONTROL = controlbox.competitor_pain_points

# Each comment unit's own permalink, time, author and text. The unit's text
# starts with "author\n·\n" and ends with its vote count, which are cut off.
_READ_COMMENTS = """
JSON.stringify([...document.querySelectorAll("[data-testid='search-sdui-comment-unit']")].map(unit => {
  const link = [...unit.querySelectorAll("a[href*='/comments/']")]
    .map(a => a.getAttribute("href")).find(href => href.split("/").filter(Boolean).length >= 6);
  const time = unit.querySelector("faceplate-timeago");
  const content = unit.querySelector("[data-testid='search-comment-content']");
  const lines = content ? content.innerText.split("\\n") : [];
  const dot = lines.indexOf("·");
  const body = lines.slice(dot + 1).join("\\n").replace(/\\s*\\d[\\d.,k]*\\s+votes?\\s*$/i, "").trim();
  const title = unit.querySelector("h2");
  return {
    url: link ? new URL(link, location.origin).href : null,
    posted_at: time ? time.getAttribute("ts") : null,
    author: dot > 0 ? lines[0].trim() : "",
    thread: title ? title.innerText : "",
    text: body,
  };
}).filter(item => item.url && item.text))
"""

_READ_POSTS = """
JSON.stringify([...document.querySelectorAll("[data-testid='search-post-unit']")].map(unit => {
  const title = unit.querySelector("[data-testid='post-title']");
  const time = unit.querySelector("faceplate-timeago");
  return {
    url: title ? new URL(title.getAttribute("href"), location.origin).href : null,
    posted_at: time ? time.getAttribute("ts") : null,
    author: "",
    thread: "",
    text: title ? title.innerText.trim() : "",
  };
}).filter(item => item.url && item.text))
"""


def read_posts(competitor_name: str) -> list[dict[str, Any]]:
    """Recent Reddit comments and posts for the competitor's searches, newest first."""
    found: dict[str, dict[str, Any]] = {}
    for template in CONTROL.reddit_queries:
        query = template.format(name=competitor_name)
        for kind, reader in (("comments", _READ_COMMENTS), ("posts", _READ_POSTS)):
            for item in _search(query, kind, reader):
                found.setdefault(item["url"], item)
    return sorted(found.values(), key=lambda item: item.get("posted_at") or "", reverse=True)


def _search(query: str, kind: str, reader: str) -> list[dict[str, Any]]:
    window = safari.open_window(
        f"https://www.reddit.com/search/?q={quote(query)}&type={kind}&sort=new"
    )
    try:
        found: dict[str, dict[str, Any]] = {}
        for scroll in range(CONTROL.scrolls + 1):
            time.sleep(CONTROL.page_wait_seconds)
            for item in json.loads(safari.run_javascript(window, reader) or "[]"):
                found.setdefault(item["url"], item)
            if len(found) >= CONTROL.posts_per_query or scroll == CONTROL.scrolls:
                break
            safari.run_javascript(window, "window.scrollBy(0, 4000)")
        return list(found.values())[: CONTROL.posts_per_query]
    finally:
        safari.close_window(window)
