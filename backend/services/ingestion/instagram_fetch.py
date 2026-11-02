"""Read public Instagram profiles the way a logged-out browser sees them.

No account, cookie or session ID is involved: the request carries only a
browser-like TLS fingerprint. Posts are read by the Rust ingestion processor
(``rust/src/ingestion/fetch.rs``). A profile comes from its embed page, which Instagram renders on the server when
it is requested the way a browser loads an iframe, and carries its picture.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from curl_cffi import requests

from services.ingestion.items import CONTROL

_PROFILE_CONTEXT = '"contextJSON":'
# Instagram's grey silhouette for accounts that never set a picture.
_DEFAULT_PICTURE = "44884218_345707102882519_2446069589734326272_n"
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
    picture = context.get("profile_pic_url")
    return {
        "read": "ok" if posts else "no_posts",
        "name": context.get("full_name"),
        "followers_count": context.get("followers_count"),
        "posts_count": context.get("posts_count"),
        "is_private": owner.get("is_private"),
        "profile_picture_url": None
        if not isinstance(picture, str) or _DEFAULT_PICTURE in picture
        else picture,
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
