"""Read X search results in Safari, logged in by a person, for the pain point sweep.

X shows nothing to logged-out visitors, so posts are read from the page in a
Safari window this module opens and closes itself. It only reads what the
page displays: it never likes, replies, posts or follows, and never touches
cookies or the login (see ``safari``).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any
from urllib.parse import quote

from core.controlbox import controlbox
from services.competitor_pain_points import safari

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


def read_posts(competitor_name: str) -> list[dict[str, Any]]:
    """Recent X posts for the competitor's configured searches, newest first."""
    posts: dict[str, dict[str, Any]] = {}
    for template in CONTROL.x_queries:
        query = template.format(name=competitor_name)
        for post in _search(query):
            posts.setdefault(post["url"], post)
    return sorted(posts.values(), key=lambda post: post.get("posted_at") or "", reverse=True)


def _search(query: str) -> list[dict[str, Any]]:
    window = safari.open_window(f"https://x.com/search?q={quote(query)}&src=typed_query&f=live")
    try:
        found: dict[str, dict[str, Any]] = {}
        for scroll in range(CONTROL.scrolls + 1):
            time.sleep(CONTROL.page_wait_seconds)
            page = json.loads(safari.run_javascript(window, _READ_POSTS) or "null")
            if page is None:
                raise safari.SafariUnavailable("Safari is not logged in to X")
            for post in page:
                found.setdefault(post["url"], post)
            if len(found) >= CONTROL.posts_per_query or scroll == CONTROL.scrolls:
                break
            safari.run_javascript(window, "window.scrollBy(0, 4000)")
        return list(found.values())[: CONTROL.posts_per_query]
    finally:
        safari.close_window(window)
