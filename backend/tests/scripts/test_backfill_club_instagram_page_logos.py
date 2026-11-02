import httpx
import pytest

from scripts.backfill_club_instagram_page_logos import Refused, profile_picture


def _client(routes: dict[str, httpx.Response]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        return routes.get(str(request.url), httpx.Response(404))

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


def _page(picture: str) -> httpx.Response:
    return httpx.Response(200, text=f'<meta property="og:image" content="{picture}" />')


def test_the_logo_is_the_profile_page_picture():
    client = _client(
        {
            "https://www.instagram.com/chess/": _page(
                "https://scontent.cdninstagram.com/a.jpg?x=1&amp;y=2"
            )
        }
    )
    assert profile_picture(client, "chess") == "https://scontent.cdninstagram.com/a.jpg?x=1&y=2"


def test_a_missing_account_or_the_default_avatar_has_no_logo():
    default = "https://scontent.cdninstagram.com/44884218_345707102882519_2446069589734326272_n.jpg"
    client = _client(
        {
            "https://www.instagram.com/gone/": httpx.Response(200, text="<title>Instagram</title>"),
            "https://www.instagram.com/blank/": _page(default),
        }
    )
    assert profile_picture(client, "gone") is None
    assert profile_picture(client, "blank") is None


def test_a_rate_limit_or_login_wall_is_refused():
    client = _client(
        {
            "https://www.instagram.com/busy/": httpx.Response(429),
            "https://www.instagram.com/walled/": httpx.Response(
                302, headers={"location": "https://www.instagram.com/accounts/login/"}
            ),
            "https://www.instagram.com/accounts/login/": httpx.Response(200, text="login"),
        }
    )
    with pytest.raises(Refused):
        profile_picture(client, "busy")
    with pytest.raises(Refused):
        profile_picture(client, "walled")
