import httpx

from scripts import backfill_club_directory_logos as module
from scripts.backfill_club_directory_logos import (
    directory_instagram,
    directory_logo,
    without_shared_defaults,
)


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


def test_engage_lists_the_clubs_instagram_handle():
    def organization(instagram):
        return httpx.Response(200, json={"socialMedia": {"InstagramUrl": instagram}})

    client = _client(
        {
            "https://engage.nyu.edu/api/discovery/organization/bykey/chess": organization(
                "https://www.instagram.com/NYUChess/?hl=en"
            ),
            "https://engage.nyu.edu/api/discovery/organization/bykey/go": organization(
                "https://facebook.com/nyugo"
            ),
            "https://engage.nyu.edu/api/discovery/organization/bykey/art": organization(""),
        }
    )
    assert directory_instagram(client, "https://engage.nyu.edu/organization/chess") == "nyuchess"
    assert directory_instagram(client, "https://engage.nyu.edu/organization/go") is None
    assert directory_instagram(client, "https://engage.nyu.edu/organization/art") is None
    assert directory_instagram(client, "https://cornell.campusgroups.com/chess/") is None


def test_handles_are_kept_only_for_clubs_left_without_a_logo(monkeypatch):
    clubs = [
        {"id": club_id, "club_page": f"https://engage.nyu.edu/organization/{club_id}"}
        for club_id in (1, 2, 3, 4)
    ]
    school_default = "https://x/school.png"
    logos = {1: "https://x/one.png", 2: school_default, 3: school_default, 4: school_default}
    monkeypatch.setattr(module, "directory_logo", lambda _client, url: logos[int(url[-1])])
    monkeypatch.setattr(module, "directory_instagram", lambda _client, url: f"club{url[-1]}")

    found, handles = module.find_logos(clubs, delay=0)

    assert found == {1: "https://x/one.png"}
    assert handles == {2: "club2", 3: "club3", 4: "club4"}


def test_store_handles_saves_each_handle(monkeypatch):
    saved = []
    monkeypatch.setattr(
        module.club_service,
        "update_club",
        lambda club_id, update: saved.append((club_id, update.ig)) or {"id": club_id},
    )
    assert module.store_handles({5: "nyuchess"}) == 1
    assert saved == [(5, "nyuchess")]
