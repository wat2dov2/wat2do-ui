"""Read X search results in Safari, logged in by a person, for the pain point sweep.

X shows nothing to logged-out visitors, so posts are read from the page in a
Safari window this module opens and closes itself. It only reads what the
page displays: it never likes, replies, posts or follows, and never touches
cookies or the login. Safari needs "Allow JavaScript from Apple Events".
"""

from __future__ import annotations

import json
import logging
import subprocess
import time
from typing import Any
from urllib.parse import quote

from core.controlbox import controlbox

log = logging.getLogger(__name__)
CONTROL = controlbox.competitor_pain_points

# Each post article's link, time, author line and text, as the page renders them.
_READ_POSTS = """
JSON.stringify(location.pathname.startsWith("/i/flow/login") ? null : [...document.querySelectorAll("article")].map(article => {
  const time = article.querySelector("time");
  const link = time && time.closest("a[href*='/status/']");
  const text = article.querySelector("[data-testid='tweetText']");
  const user = article.querySelector("[data-testid='User-Name']");
  return {
    url: link ? link.href.split("?")[0] : null,
    posted_at: time ? time.getAttribute("datetime") : null,
    author: user ? user.innerText.split("\\n")[0] : "",
    text: text ? text.innerText : "",
  };
}).filter(post => post.url && post.text))
"""


class XUnavailable(RuntimeError):
    """Safari could not show X search results (not logged in, or not scriptable)."""


def read_posts(competitor_name: str) -> list[dict[str, Any]]:
    """Recent X posts for the competitor's configured searches, newest first."""
    posts: dict[str, dict[str, Any]] = {}
    for template in CONTROL.x_queries:
        query = template.format(name=competitor_name)
        for post in _search(query):
            posts.setdefault(post["url"], post)
    return sorted(posts.values(), key=lambda post: post.get("posted_at") or "", reverse=True)


def _search(query: str) -> list[dict[str, Any]]:
    url = f"https://x.com/search?q={quote(query)}&src=typed_query&f=live"
    window = _osascript(
        'tell application "Safari" to make new document with properties {URL:(item 1 of argv)}',
        'tell application "Safari" to return id of front window',
        args=[url],
    )
    try:
        found: dict[str, dict[str, Any]] = {}
        for scroll in range(CONTROL.x_scrolls + 1):
            time.sleep(CONTROL.x_page_wait_seconds)
            page = json.loads(_javascript(window, _READ_POSTS) or "null")
            if page is None:
                raise XUnavailable("Safari is not logged in to X")
            for post in page:
                found.setdefault(post["url"], post)
            if len(found) >= CONTROL.x_posts_per_query or scroll == CONTROL.x_scrolls:
                break
            _javascript(window, "window.scrollBy(0, 4000)")
        return list(found.values())[: CONTROL.x_posts_per_query]
    finally:
        _osascript(
            'tell application "Safari" to close window id ((item 1 of argv) as integer)',
            args=[window],
        )


def _javascript(window: str, source: str) -> str:
    return _osascript(
        'tell application "Safari" to do JavaScript (item 1 of argv) '
        "in current tab of window id ((item 2 of argv) as integer)",
        args=[source, window],
    )


def _osascript(*lines: str, args: list[str]) -> str:
    script = ["on run argv", *lines, "end run"]
    try:
        result = subprocess.run(
            ["osascript", *(part for line in script for part in ("-e", line)), *args],
            capture_output=True,
            text=True,
            timeout=CONTROL.x_page_wait_seconds * 4,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        # Safari's own reason, such as JavaScript from Apple Events being off.
        reason = (exc.stderr or "").strip().splitlines()[-1:] or ["unknown error"]
        raise XUnavailable(f"Safari could not be scripted: {reason[0]}") from None
    except (OSError, subprocess.SubprocessError) as exc:
        raise XUnavailable(f"Safari could not be scripted ({type(exc).__name__})") from None
    return result.stdout.strip()
