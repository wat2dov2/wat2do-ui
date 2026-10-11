import json
from types import SimpleNamespace

import pytest

from services.ingestion import instagram_fetch as module

POST_URL = "https://www.instagram.com/p/ABC123/"


def _page(*media: dict) -> str:
    """A public post page: Instagram embeds the post (and others) as JSON scripts."""
    scripts = "".join(
        f'<script type="application/json" data-sjs>{json.dumps({"require": [[{"items": [m]}]]})}</script>'
        for m in media
    )
    return f"<html><head></head><body>{scripts}</body></html>"


def _image(name: str, width: int) -> dict:
    return {"url": f"https://scontent.cdninstagram.com/{name}.jpg", "width": width, "height": width}


CAROUSEL = {
    "code": "ABC123",
    "taken_at": 1791205389,
    "user": {"username": "uwimprov"},
    "caption": {"text": "Drop-in jam, Wednesday 7pm in AL 116"},
    "coauthor_producers": [{"username": "yourwusa"}],
    "usertags": {"in": [{"user": {"username": "taggedfriend"}}]},
    "carousel_media": [
        {"image_versions2": {"candidates": [_image("small", 320), _image("poster", 1080)]}},
        {
            "image_versions2": {"candidates": [_image("cover", 1080)]},
            "video_versions": [
                {"url": "https://scontent.cdninstagram.com/low.mp4", "width": 480, "height": 480},
                {
                    "url": "https://scontent.cdninstagram.com/high.mp4",
                    "width": 1080,
                    "height": 1080,
                },
            ],
        },
    ],
}


@pytest.fixture
def respond(monkeypatch):
    state = SimpleNamespace(requests=[], response=None)

    def get(url, **kwargs):
        state.requests.append((url, kwargs))
        if isinstance(state.response, BaseException):
            raise state.response
        return state.response

    monkeypatch.setattr(module.requests, "get", get)
    return state


def _response(text="", status=200, url=POST_URL):
    return SimpleNamespace(text=text, status_code=status, url=url)


def test_a_carousel_comes_back_in_the_retriever_shape(respond):
    other_post = {**CAROUSEL, "code": "OTHER", "caption": {"text": "Someone else's post"}}
    respond.response = _response(_page(other_post, CAROUSEL))

    post = module.fetch_post("https://www.instagram.com/reel/ABC123/")

    url, options = respond.requests[0]
    assert url == POST_URL
    # A browser-like fingerprint and nothing else: no cookies, no session.
    assert set(options) == {"impersonate", "timeout"}
    assert post == {
        "url": POST_URL,
        "ownerUsername": "uwimprov",
        "timestamp": "2026-10-05T13:03:09+00:00",
        "caption": "Drop-in jam, Wednesday 7pm in AL 116",
        "type": "Sidecar",
        "displayUrl": "https://scontent.cdninstagram.com/poster.jpg",
        "videoUrl": None,
        "childPosts": [
            {
                "type": "Image",
                "displayUrl": "https://scontent.cdninstagram.com/poster.jpg",
                "videoUrl": None,
            },
            {
                "type": "Video",
                "displayUrl": "https://scontent.cdninstagram.com/cover.jpg",
                "videoUrl": "https://scontent.cdninstagram.com/high.mp4",
            },
        ],
        "coauthors": [{"username": "yourwusa"}],
        "taggedUsers": [{"username": "taggedfriend"}],
    }


def test_a_single_image_post_has_no_children(respond):
    single = {key: CAROUSEL[key] for key in ("code", "taken_at", "user", "caption")}
    single["image_versions2"] = {"candidates": [_image("only", 1080)]}
    respond.response = _response(_page(single))

    post = module.fetch_post(POST_URL)

    assert post["type"] == "Image"
    assert post["displayUrl"] == "https://scontent.cdninstagram.com/only.jpg"
    assert post["childPosts"] == []


@pytest.mark.parametrize(
    "response",
    [
        _response("<html>Sorry, this page isn't available.</html>"),
        _response(status=404),
        _response(_page({**CAROUSEL, "code": "OTHER"})),
    ],
)
def test_a_deleted_or_missing_post_is_none(respond, response):
    respond.response = response
    assert module.fetch_post(POST_URL) is None


@pytest.mark.parametrize(
    "response",
    [
        _response(url="https://www.instagram.com/accounts/login/?next=/p/ABC123/"),
        _response(status=429),
        _response(status=503),
        module.requests.RequestsError("connection reset"),
    ],
)
def test_a_refusal_is_never_mistaken_for_a_deleted_post(respond, response):
    respond.response = response
    with pytest.raises(module.FetchBlocked):
        module.fetch_post(POST_URL)


def test_only_post_urls_are_fetched(respond):
    with pytest.raises(ValueError):
        module.fetch_post("https://www.instagram.com/uwimprov/")
    assert respond.requests == []
