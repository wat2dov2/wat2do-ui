"""Read public post details inside the existing, account-verified browser.

Only public media fields leave the tab. Credentials and authenticated requests
stay inside Brave, using the shared request cancellation lifecycle.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from core.controlbox import controlbox
from services.instagram_notifications.browser_session import (
    _REQUEST_KEY,
    BrowserInstagramSession,
    BrowserSessionError,
    _current_account_username_source,
    _open_post_source,
    canonical_post_url,
)

_CONTROL = controlbox.instagram_browser
_PROFILE_PATH = re.compile(r"^/([A-Za-z0-9._]{1,30})/?$")
_RESERVED = {"p", "reel", "reels", "accounts", "explore", "direct", "stories"}


def canonical_target_url(url: str) -> str:
    """Normalize a manual username, profile URL or exact post URL once at ingestion."""
    url = url.strip()
    username = url.removeprefix("@")
    if _PROFILE_PATH.fullmatch(f"/{username}/"):
        url = f"https://www.instagram.com/{username}/"
    parsed = urlsplit(url)
    if parsed.hostname not in {"instagram.com", "www.instagram.com"} or parsed.scheme != "https":
        raise ValueError("Retrieval requires an HTTPS Instagram profile or post URL")
    if parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment:
        raise ValueError("Instagram retrieval URL must not contain credentials or extra parameters")
    match = _PROFILE_PATH.fullmatch(parsed.path)
    if match and match[1].casefold() not in _RESERVED:
        return f"https://www.instagram.com/{match[1].casefold()}/"
    return canonical_post_url(url)


def media_id_from_url(url: str) -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    shortcode = canonical_post_url(url).rstrip("/").split("/")[-1]
    value = 0
    for character in shortcode:
        value = value * 64 + alphabet.index(character)
    if not 0 < value < 10**32:
        raise ValueError("Instagram post identity is invalid")
    return str(value)


class BrowserInstagramRetriever:
    def __init__(self, session: BrowserInstagramSession) -> None:
        self.session = session

    def _active_account(self) -> str:
        # Capture the verified read itself instead of immediately rereading a loading DOM.
        username = None

        def ready():
            nonlocal username
            username = self.session.current_account_username()
            return username is not None

        self.session.poll_until(ready)
        if username is None:
            raise TimeoutError("Instagram account identity did not settle before the deadline")
        return username

    def retrieve(self, url: str, *, cutoff_days: int) -> dict:
        target = canonical_target_url(url)
        profile = _PROFILE_PATH.fullmatch(urlsplit(target).path)
        path = self.session.run("window.location.pathname")
        if path.startswith(("/accounts/suspended", "/accounts/login", "/challenge", "/checkpoint")):
            raise BrowserSessionError("Instagram browser requires human account recovery")
        username = self._active_account()
        self.session.run(_open_post_source(target))
        self.session.poll_until(
            lambda: (
                self.session.run("window.location.pathname").strip("/")
                == urlsplit(target).path.strip("/")
                and self.session.current_account_username() is not None
            )
        )
        if self._active_account() != username:
            raise BrowserSessionError("Instagram browser account changed during retrieval")
        endpoint = (
            f"/api/v1/users/web_profile_info/?username={profile[1]}"
            if profile
            else f"/api/v1/media/{media_id_from_url(target)}/info/"
        )
        result = self.session.query(_query_source(endpoint, username, profile=bool(profile)))
        if self._active_account() != username:
            raise BrowserSessionError("Instagram browser account changed during retrieval")
        if result.get("state") != "succeeded":
            # Never persist server response text, request headers or browser internals.
            raise BrowserSessionError(
                "Instagram public media retrieval failed; inspect login or retry"
            )
        posts = result.get("posts")
        if not isinstance(posts, list) or (not profile and len(posts) != 1):
            raise BrowserSessionError("Instagram retrieval returned incomplete media details")
        checked = [_validate_post(post) for post in posts]
        if profile:
            if any(post["ownerUsername"].casefold() != profile[1] for post in checked):
                raise BrowserSessionError("Instagram profile returned a different post owner")
            cutoff = datetime.now(timezone.utc) - timedelta(days=cutoff_days)
            checked = [
                post for post in checked if datetime.fromisoformat(post["timestamp"]) >= cutoff
            ]
        elif media_id_from_url(checked[0]["url"]) != media_id_from_url(target):
            raise BrowserSessionError("Instagram retrieval returned a different media identity")
        return {"account_username": username, "posts": checked, "target_url": target}


def _validate_post(post: object) -> dict:
    if not isinstance(post, dict):
        raise BrowserSessionError("Instagram retrieval returned invalid post data")
    try:
        canonical_post_url(post["url"])
        if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", post["ownerUsername"]):
            raise ValueError
        if datetime.fromisoformat(post["timestamp"]).tzinfo is None:
            raise ValueError
        if not isinstance(post["caption"], str) or not isinstance(post["coauthors"], list):
            raise ValueError
        children = post.get("childPosts", [])
        if post.get("type") == "Sidecar" and not children:
            raise ValueError
        for media in children or [post]:
            if not isinstance(media, dict) or not _public_media_url(media.get("displayUrl")):
                raise ValueError
            if media.get("type") == "Video" and not media.get("videoUrl"):
                raise ValueError
            if media.get("videoUrl") and not _public_media_url(media["videoUrl"]):
                raise ValueError
    except (KeyError, TypeError, ValueError):
        raise BrowserSessionError(
            "Instagram retrieval omitted required caption or media fields"
        ) from None
    return post


def _public_media_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    return (
        parsed.scheme == "https"
        and (host.endswith(".cdninstagram.com") or host.endswith(".fbcdn.net"))
        and not parsed.username
        and not parsed.password
    )


def _query_source(endpoint: str, username: str, *, profile: bool) -> str:
    """Project only the fields the existing pipeline understands inside the tab."""
    return f"""
(() => {{
 const key = {json.dumps(_REQUEST_KEY)};
 const request = {{controller: new AbortController(), settled: false, result: {{state: "pending"}}}};
 window[key] = request;
 (async () => {{
  try {{
   if (({_current_account_username_source()}) !== {json.dumps(username)}) throw new Error();
   const response = await fetch({json.dumps(endpoint)}, {{credentials: "include",
     signal: request.controller.signal,
     headers: {{"x-ig-app-id": {json.dumps(controlbox.scraping.instagram_web_app_id)}}}}});
   if (!response.ok) throw new Error();
   const body = await response.json();
   if (({_current_account_username_source()}) !== {json.dumps(username)}) throw new Error();
   const image = media => {{
     const candidates = media.image_versions2?.candidates || [];
     const best = [...candidates].sort((a,b) => b.width*b.height-a.width*a.height)[0];
     const videos = [...(media.video_versions || [])].sort((a,b) => b.width*b.height-a.width*a.height);
     return {{type: media.media_type === 2 || media.is_video ? "Video" : "Image", displayUrl: best?.url || media.display_url, videoUrl: videos[0]?.url || media.video_url || null}};
   }};
   const project = media => {{
     const children = media.carousel_media || media.edge_sidecar_to_children?.edges?.map(e => e.node) || [];
     const coauthors = media.coauthor_producers || media.coauthors || [];
     return {{url: `https://www.instagram.com/p/${{media.code || media.shortcode}}/`,
       ownerUsername: media.user?.username || media.owner?.username || {"body.data?.user?.username" if profile else "null"},
       timestamp: new Date((media.taken_at || media.taken_at_timestamp)*1000).toISOString(),
       caption: media.caption?.text || media.edge_media_to_caption?.edges?.[0]?.node?.text || "",
       ...image(media),
       type: children.length || media.media_type === 8 || media.__typename === "GraphSidecar" ? "Sidecar" : (media.media_type === 2 || media.is_video ? "Video" : "Image"),
       childPosts: children.map(image),
       coauthors: coauthors.map(u => ({{username:u.username}})),
       taggedUsers: (media.usertags?.in || []).map(t => ({{username:t.user?.username}}))}};
   }};
   const media = {"body.data?.user?.edge_owner_to_timeline_media?.edges?.map(e => e.node)" if profile else "body.items"};
   if (!Array.isArray(media)) throw new Error();
   request.result = {{state: "succeeded", posts: media.slice(0,{_CONTROL.profile_post_limit if profile else 1}).map(project)}};
  }} catch (_error) {{request.result = {{state: "failed"}};}}
  finally {{request.settled = true;}}
 }})();
 return "started";
}})()
""".strip()
