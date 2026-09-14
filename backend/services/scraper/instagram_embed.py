"""Parse public Instagram embeds into the scraping pipeline's post contract."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from services.scraper.dedup import _extract_shortcode
from services.scraper.single_user import is_exact_post_url_target


class _JsonScripts(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.documents: list[object] = []
        self.simple_embed = False
        self._script: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self._script = []

    def handle_data(self, data):
        if self._script is not None:
            self._script.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            source = "".join(self._script)
            try:
                self.documents.append(json.loads(source))
            except ValueError:
                # Public embeds put JSON inside a JS initializer. Decode data only.
                for match in re.finditer(r'"contextJSON"\s*:\s*', source):
                    try:
                        context, _ = json.JSONDecoder().raw_decode(source[match.end() :])
                        if isinstance(context, str):
                            self.documents.append(json.loads(context))
                    except ValueError:
                        continue
                for match in re.finditer(
                    r'\[\s*"PolarisEmbedSimple"\s*,\s*"init"\s*,\s*\[\]\s*,\s*', source
                ):
                    try:
                        arguments, _ = json.JSONDecoder().raw_decode(source[match.end() :])
                        flags = arguments[0]
                        self.simple_embed = (
                            flags.get("isSidecar") is False and flags.get("isRichEmbed") is False
                        )
                    except (ValueError, TypeError, IndexError, AttributeError):
                        continue
            self._script = None


def _objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _objects(child)


def _image(media: dict) -> str:
    candidates = media.get("image_versions2", {}).get("candidates", [])
    url = media.get("display_url") or (candidates[0].get("url") if candidates else None)
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("Media is missing a usable image; refusing partial carousel data")
    return url


def _normalize(media: dict, url: str) -> dict:
    owner = media.get("owner") or media.get("user") or {}
    username = owner.get("username")
    taken_at = media.get("taken_at_timestamp", media.get("taken_at"))
    if not isinstance(username, str) or not username:
        raise ValueError("Post is missing its author")
    if taken_at is not None and (
        isinstance(taken_at, bool)
        or not isinstance(taken_at, (int, float))
        or not math.isfinite(taken_at)
    ):
        raise ValueError("Invalid timestamp")
    if "edge_media_to_caption" in media:
        edges = media["edge_media_to_caption"]["edges"]
        caption = edges[0]["node"]["text"] if edges else ""
    elif "caption" in media:
        caption = (media["caption"] or {}).get("text", "")
    else:
        raise ValueError("Post has no caption field; response may be incomplete")
    if not isinstance(caption, str):
        raise ValueError("Invalid caption")

    if "edge_sidecar_to_children" in media:
        sidecar = media["edge_sidecar_to_children"]
        children = [edge["node"] for edge in sidecar["edges"]]
        if sidecar.get("page_info", {}).get("has_next_page") or sidecar.get(
            "count", len(children)
        ) != len(children):
            raise ValueError("Incomplete carousel")
    elif "carousel_media" in media:
        children = media["carousel_media"]
        if len(children) != media.get("carousel_media_count", len(children)):
            raise ValueError("Incomplete carousel")
    elif media.get("media_type") == 8 or media.get("__typename") == "GraphSidecar":
        raise ValueError("Missing carousel children")
    else:
        children = [media]
    if not children:
        raise ValueError("Empty carousel")

    return {
        "url": url,
        "ownerUsername": username,
        "timestamp": (
            datetime.fromtimestamp(taken_at, timezone.utc).isoformat()
            if taken_at is not None
            else None
        ),
        "caption": caption,
        "images": [_image(child) for child in children],
        "coauthors": media.get("coauthor_producers", []),
    }


def _single_image_post(response: str, url: str) -> dict:
    soup = BeautifulSoup(response, "html.parser")
    link = soup.select_one("a.EmbeddedMedia")
    image = soup.select_one("img.EmbeddedMediaImage")
    caption = soup.select_one(".Caption")
    if link is None or image is None or caption is None:
        raise ValueError("Missing single-image embed content")
    linked = urlsplit(link.get("href", ""))
    if linked.hostname not in {"www.instagram.com", "instagram.com"} or _extract_shortcode(
        linked.path
    ) != _extract_shortcode(url):
        raise ValueError("Embed does not match requested post")
    author = caption.select_one(".CaptionUsername")
    if author is None:
        raise ValueError("Missing embed author")
    username = author.get_text(strip=True)
    author.decompose()
    for br in caption.find_all("br"):
        br.replace_with("\n")
    return _normalize(
        {
            "owner": {"username": username},
            "caption": {"text": caption.get_text().strip()},
            "display_url": image.get("src"),
        },
        url,
    )


def extract_post(response: str, url: str) -> dict:
    if not is_exact_post_url_target(url):
        raise ValueError("Use a canonical HTTPS Instagram post or reel URL")
    parser = None
    try:
        documents = [json.loads(response)]
    except ValueError:
        parser = _JsonScripts()
        parser.feed(response)
        documents = parser.documents
    shortcode = _extract_shortcode(url)
    for media in _objects(documents):
        if media.get("shortcode", media.get("code")) == shortcode and (
            "owner" in media or "user" in media
        ):
            return _normalize(media, url)
    if parser is not None and parser.simple_embed:
        return _single_image_post(response, url)
    raise ValueError("No complete matching media object returned; HTTP 200 is not proof of access")
