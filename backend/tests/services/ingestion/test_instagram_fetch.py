import json
from types import SimpleNamespace

import pytest

from services.ingestion import instagram_fetch as module


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


def _response(text="", status=200, url="https://www.instagram.com/utmaclub/embed/"):
    return SimpleNamespace(text=text, status_code=status, url=url)


PROFILE_URL = "https://www.instagram.com/utmaclub/embed/"


def _embed(context: dict | None) -> str:
    """A profile embed page: its data is a JSON string inside the page's own JSON."""
    raw = json.dumps(json.dumps({"context": context}) if context is not None else None)
    return f'<html><script>{{"contextJSON":{raw}}}</script></html>'


def _media(shortcode: str, taken_at: int, caption: str) -> dict:
    return {
        "shortcode_media": {
            "shortcode": shortcode,
            "taken_at_timestamp": taken_at,
            "display_url": f"https://scontent.cdninstagram.com/{shortcode}.jpg",
            "edge_media_to_caption": {"edges": [{"node": {"text": caption}}]},
            "owner": {"is_private": False},
        }
    }


def test_a_profile_comes_back_with_its_newest_posts_first(respond):
    respond.response = _response(
        _embed(
            {
                "full_name": "UTMAC",
                "profile_pic_url": "https://scontent.cdninstagram.com/utmac.jpg",
                "followers_count": 436,
                "posts_count": 68,
                "graphql_media": [
                    _media("OLD", 1790000000, "Game night"),
                    _media("NEW", 1791000000, "Mahjong quiz Friday"),
                    _media("MID", 1790500000, "Workshop"),
                    _media("OLDEST", 1780000000, "Welcome"),
                ],
            }
        ),
        url=PROFILE_URL,
    )

    profile = module.fetch_profile("utmaclub")

    assert profile["read"] == "ok"
    assert (profile["name"], profile["followers_count"], profile["is_private"]) == (
        "UTMAC",
        436,
        False,
    )
    assert [post["url"] for post in profile["posts"]] == [
        "https://www.instagram.com/p/NEW/",
        "https://www.instagram.com/p/MID/",
        "https://www.instagram.com/p/OLD/",
    ]
    assert profile["posts"][0]["caption"] == "Mahjong quiz Friday"
    assert profile["profile_picture_url"] == "https://scontent.cdninstagram.com/utmac.jpg"
    assert respond.requests[0][1]["headers"]["Sec-Fetch-Dest"] == "iframe"


def test_a_profile_without_posts_or_a_picture_says_so(respond):
    blank = "https://scontent.cdninstagram.com/44884218_345707102882519_2446069589734326272_n.jpg"
    respond.response = _response(
        _embed({"full_name": "New club", "profile_pic_url": blank, "graphql_media": []}),
        url=PROFILE_URL,
    )

    profile = module.fetch_profile("newclub")

    assert profile["read"] == "no_posts"
    # Instagram's default silhouette is no logo.
    assert profile["profile_picture_url"] is None


@pytest.mark.parametrize("text", ["<html>no data</html>", _embed(None)])
def test_a_profile_that_never_renders_is_a_failed_read(respond, text):
    respond.response = _response(text, url=PROFILE_URL)

    assert module.fetch_profile("gone") == {"read": "failed"}


@pytest.mark.parametrize(
    "response",
    [_response(url="https://www.instagram.com/accounts/login/"), _response(status=429)],
)
def test_a_profile_read_refused_by_instagram_stops(respond, response):
    respond.response = response
    with pytest.raises(module.FetchBlocked):
        module.fetch_profile("utmaclub")
