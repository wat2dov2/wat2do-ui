"""Read public Instagram posts and profiles the way a logged-out browser sees them.

No account, cookie or session ID is involved: the request carries only a
browser-like TLS fingerprint. A post's details come from the JSON Instagram
embeds in the public page, projected into the same shape the Brave retriever
produced, so the processing agent sees one post format whatever fetched it.
A profile comes from its embed page, which Instagram renders on the server when
it is requested the way a browser loads an iframe.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any, Iterator

from curl_cffi import requests

from services.ingestion.items import CONTROL, post_key

_JSON_SCRIPT = re.compile(r'<script type="application/json"[^>]*>(.*?)</script>', re.S)
_PROFILE_CONTEXT = '"contextJSON":'
# A profile embed renders on the server only for a request that looks like an iframe load.
_EMBED_HEADERS = {
    "Accept": "text/html,application/xhtml+xml",
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Referer": "https://wat2do.io/",
}


class FetchBlocked(RuntimeError):
    """Instagram refused the logged-out request; nothing about the post is known."""


def fetch_post(source_url: str) -> dict | None:
    """Return the post, or None when the page has no post (usually deleted or private)."""
    shortcode = post_key(source_url).rstrip("/").rsplit("/", 1)[1]
    try:
        response = requests.get(
            f"https://www.instagram.com/p/{shortcode}/",
            impersonate=CONTROL.fetch_impersonate,
            timeout=CONTROL.fetch_timeout_seconds,
        )
    except requests.RequestsError as exc:
        raise FetchBlocked(f"Instagram request failed ({type(exc).__name__})") from None
    if "/accounts/login" in response.url or response.status_code == 429:
        raise FetchBlocked("Instagram asked for a login")
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise FetchBlocked(f"Instagram answered HTTP {response.status_code}")
    media = _post_media(response.text, shortcode)
    return _project(media, shortcode) if media else None


def fetch_profile(handle: str, *, post_limit: int = 3) -> dict:
    """The profile's name, counts and newest posts, with ``read`` saying how it went.

    ``read`` is ``ok`` (posts found), ``no_posts`` (a public profile that never posted)
    or ``failed`` (private, renamed or deleted, or the embed did not render twice).
    """
    for _ in range(2):
        try:
            response = requests.get(
                f"https://www.instagram.com/{handle}/embed/",
                headers=_EMBED_HEADERS,
                impersonate=CONTROL.fetch_impersonate,
                timeout=CONTROL.fetch_timeout_seconds,
            )
        except requests.RequestsError as exc:
            raise FetchBlocked(f"Instagram request failed ({type(exc).__name__})") from None
        if "/accounts/login" in response.url or "/challenge" in response.url:
            raise FetchBlocked("Instagram asked for a login")
        if response.status_code == 429:
            raise FetchBlocked("Instagram answered HTTP 429")
        if response.status_code != 200:
            return {"read": "failed"}
        profile = _embed_profile(response.text, post_limit)
        if profile is not None:
            return profile
    return {"read": "failed"}


def _embed_profile(html: str, post_limit: int) -> dict | None:
    """None when the page came back as the client-side shell, which renders on retry."""
    start = html.find(_PROFILE_CONTEXT)
    if start < 0:
        return {"read": "failed"}
    raw, _ = json.JSONDecoder().raw_decode(html, start + len(_PROFILE_CONTEXT))
    if raw is None:
        return None
    context = json.loads(raw).get("context") or {}
    media = [item.get("shortcode_media") or {} for item in context.get("graphql_media") or []]
    posts = sorted(
        (_embed_post(item) for item in media if item.get("shortcode")),
        key=lambda post: post["posted_at"] or "",
        reverse=True,
    )
    owner = (media[0].get("owner") if media else None) or {}
    return {
        "read": "ok" if posts else "no_posts",
        "name": context.get("full_name"),
        "followers_count": context.get("followers_count"),
        "posts_count": context.get("posts_count"),
        "is_private": owner.get("is_private"),
        "posts": posts[:post_limit],
    }


def _embed_post(media: dict) -> dict:
    captions = (media.get("edge_media_to_caption") or {}).get("edges") or []
    taken_at = media.get("taken_at_timestamp")
    return {
        "url": f"https://www.instagram.com/p/{media['shortcode']}/",
        "posted_at": datetime.fromtimestamp(taken_at, UTC).isoformat()
        if isinstance(taken_at, int)
        else None,
        "caption": captions[0]["node"]["text"] if captions else "",
        "image": media.get("display_url"),
    }


def _post_media(html: str, shortcode: str) -> dict | None:
    """The fullest embedded copy of this post; the page also embeds other posts."""
    best: dict | None = None
    for blob in _JSON_SCRIPT.findall(html):
        try:
            data = json.loads(blob)
        except ValueError:
            continue
        for node in _walk(data):
            if node.get("code") == shortcode and "taken_at" in node:
                if best is None or len(node) > len(best):
                    best = node
    return best


def _walk(node: Any) -> Iterator[dict]:
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _largest(candidates: list[dict] | None) -> str | None:
    sized = [c for c in candidates or [] if isinstance(c, dict) and c.get("url")]
    if not sized:
        return None
    return max(sized, key=lambda c: (c.get("width") or 0) * (c.get("height") or 0))["url"]


def _slide(media: dict) -> dict:
    video = _largest(media.get("video_versions"))
    return {
        "type": "Video" if video else "Image",
        "displayUrl": _largest((media.get("image_versions2") or {}).get("candidates")),
        "videoUrl": video,
    }


def _usernames(entries: list[Any] | None) -> list[dict]:
    names = (entry.get("username") for entry in entries or [] if isinstance(entry, dict))
    return [{"username": name} for name in names if isinstance(name, str) and name]


def _project(media: dict, shortcode: str) -> dict | None:
    owner = (media.get("user") or media.get("owner") or {}).get("username")
    taken_at = media.get("taken_at")
    if not isinstance(owner, str) or not isinstance(taken_at, int):
        return None
    children = [child for child in media.get("carousel_media") or [] if isinstance(child, dict)]
    cover = _slide(children[0] if children else media)
    if not cover["displayUrl"]:
        return None
    tagged = [tag.get("user") for tag in (media.get("usertags") or {}).get("in") or []]
    return {
        "url": f"https://www.instagram.com/p/{shortcode}/",
        "ownerUsername": owner,
        "timestamp": datetime.fromtimestamp(taken_at, UTC).isoformat(),
        "caption": (media.get("caption") or {}).get("text") or "",
        **cover,
        "type": "Sidecar" if children else cover["type"],
        "childPosts": [_slide(child) for child in children],
        "coauthors": _usernames(media.get("coauthor_producers")),
        "taggedUsers": _usernames(tagged),
    }
