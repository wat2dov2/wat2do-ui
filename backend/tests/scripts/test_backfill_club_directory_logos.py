import httpx

from scripts import backfill_club_directory_logos as module
from scripts.backfill_club_directory_logos import directory_logo, without_shared_defaults


def _client(routes: dict[str, httpx.Response]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        return routes.get(str(request.url), httpx.Response(404))

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


def test_engage_logo_comes_from_the_discovery_api():
    client = _client(
        {
            "https://engage.nyu.edu/api/discovery/organization/bykey/chess": httpx.Response(
                200, json={"profilePicture": "abc.png"}
            )
        }
    )
    assert (
        directory_logo(client, "https://engage.nyu.edu/organization/chess")
        == "https://se-images.campuslabs.com/clink/images/abc.png?preset=med-sq"
    )


def test_engage_without_a_picture_or_behind_a_login_has_no_logo():
    client = _client(
        {
            "https://engage.nyu.edu/api/discovery/organization/bykey/chess": httpx.Response(
                200, json={"profilePicture": None}
            ),
            "https://callink.berkeley.edu/api/discovery/organization/bykey/chess": (
                httpx.Response(200, text="<html>login</html>")
            ),
        }
    )
    assert directory_logo(client, "https://engage.nyu.edu/organization/chess") is None
    assert directory_logo(client, "https://callink.berkeley.edu/organization/chess") is None


def test_penn_clubs_logo_comes_from_the_club_api():
    client = _client(
        {
            "https://pennclubs.com/api/clubs/chess/": httpx.Response(
                200, json={"image_url": "https://s3.amazonaws.com/penn.clubs/chess.png"}
            )
        }
    )
    assert (
        directory_logo(client, "https://pennclubs.com/club/chess")
        == "https://s3.amazonaws.com/penn.clubs/chess.png"
    )


def test_campusgroups_logo_is_the_page_header_image():
    page = (
        '<img class="logo logo-dark section-cont__content-menu_club_logo" '
        'alt="Chess, website logo" src="/upload/cornell/2024/chess.png">'
    )
    client = _client({"https://cornell.campusgroups.com/chess/": httpx.Response(200, text=page)})
    assert (
        directory_logo(client, "https://cornell.campusgroups.com/chess/")
        == "https://cornell.campusgroups.com/upload/cornell/2024/chess.png"
    )


def test_other_pages_have_no_logo():
    client = _client({"https://example.com/": httpx.Response(200, text="<img src='/a.png'>")})
    assert directory_logo(client, "https://example.com/") is None
    assert directory_logo(client, "https://missing.example.com/") is None


def test_a_picture_many_clubs_share_is_the_school_default():
    found = {1: "https://x/school.png", 2: "https://x/school.png", 3: "https://x/school.png"}
    found[4] = "https://x/chess.png"
    assert without_shared_defaults(found) == {4: "https://x/chess.png"}


def test_store_logos_uploads_then_updates_each_club(monkeypatch):
    uploads = {"https://x/chess.png": "https://s3/chess.png", "https://x/go.png": None}
    updated = []
    monkeypatch.setattr(module, "upload_image_from_url", lambda url, **_: uploads[url])
    monkeypatch.setattr(
        module.club_service,
        "update_club",
        lambda club_id, update: updated.append((club_id, update.logo_url)) or {"id": club_id},
    )
    assert module.store_logos({1: "https://x/chess.png", 2: "https://x/go.png"}) == (1, 1)
    assert updated == [(1, "https://s3/chess.png")]
