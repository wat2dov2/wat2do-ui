from types import SimpleNamespace
from unittest.mock import MagicMock

from scripts import backfill_club_instagram_logos as module
from scripts.backfill_club_instagram_logos import (
    _profile_picture_urls,
    list_school_clubs,
    load_profile_cache,
    normalize_instagram_identifier,
    profile_identifiers,
)


def test_normalize_instagram_identifier_accepts_handle_url_and_profile_id():
    assert normalize_instagram_identifier(" @MacClub ") == "macclub"
    assert normalize_instagram_identifier("https://www.instagram.com/Mac.Club/") == "mac.club"
    assert normalize_instagram_identifier("48072609927") == "48072609927"


def test_profile_identifiers_supports_renamed_and_numeric_profiles():
    assert profile_identifiers(
        {
            "inputUrl": "https://www.instagram.com/old_name/",
            "username": "new_name",
            "id": "48072609927",
        }
    ) == {"old_name", "new_name", "48072609927"}


def test_profile_picture_urls_prefers_hd_and_deduplicates_sources():
    assert _profile_picture_urls(
        {"profilePicUrlHD": "https://cdn/hd.jpg", "profilePicUrl": "https://cdn/small.jpg"}
    ) == ["https://cdn/hd.jpg", "https://cdn/small.jpg"]
    assert _profile_picture_urls(
        {"profilePicUrlHD": "https://cdn/same.jpg", "profilePicUrl": "https://cdn/same.jpg"}
    ) == ["https://cdn/same.jpg"]


def test_list_school_clubs_reads_every_page(monkeypatch):
    clubs = [SimpleNamespace(id=index) for index in range(3)]

    def list_clubs(*, school, skip, limit):
        assert school == "mcmaster"
        assert limit == module.PAGE_SIZE
        return clubs[skip : skip + 2], len(clubs)

    monkeypatch.setattr(
        module.club_service,
        "list_clubs",
        list_clubs,
    )
    monkeypatch.setattr(module, "PAGE_SIZE", 2)

    assert list_school_clubs("mcmaster") == clubs


def test_load_profile_cache_uses_latest_requested_handle_record(tmp_path):
    path = tmp_path / "profiles.jsonl"
    path.write_text(
        "\n".join(
            [
                '{"requested_handle":"@MacClub","profile":{"username":"old"}}',
                '{"requested_handle":"macclub","profile":{"username":"current"}}',
            ]
        )
    )

    assert load_profile_cache(path) == {"macclub": {"username": "current"}}


def test_backfill_school_updates_matches_and_reports_not_found(monkeypatch):
    clubs = [
        SimpleNamespace(id=1, club_name="Handle Org", ig="handle_org", logo_url=None),
        SimpleNamespace(id=2, club_name="Numeric Org", ig="12345", logo_url=None),
        SimpleNamespace(id=3, club_name="Missing Org", ig="missing_org", logo_url=None),
    ]
    monkeypatch.setattr(
        module.club_service,
        "list_clubs",
        lambda **kwargs: (clubs, len(clubs)),
    )
    scraper = MagicMock()
    scraper.scrape_profiles.return_value = [
        {
            "inputUrl": "https://www.instagram.com/handle_org/",
            "username": "handle_org",
            "id": "100",
            "profilePicUrlHD": "https://cdn/handle.jpg",
        },
        {
            "username": "renamed_org",
            "id": "12345",
            "profilePicUrlHD": "https://cdn/numeric.jpg",
        },
        {"username": "missing_org", "error": "not_found"},
    ]
    monkeypatch.setattr(module, "get_scraper", lambda: scraper)
    monkeypatch.setattr(
        module,
        "upload_image_from_url",
        lambda url, **kwargs: (
            f"https://wat2do.io/media/organization-logos/{url.rsplit('/', 1)[-1]}"
        ),
    )
    update = MagicMock(return_value=SimpleNamespace(id=1))
    monkeypatch.setattr(module.club_service, "update_club", update)

    assert module.backfill_school("mcmaster") == (3, 2, 1)
    assert [call.args[0] for call in update.call_args_list] == [1, 2]


def test_backfill_school_reuses_profile_cache_without_apify(monkeypatch):
    club = SimpleNamespace(
        id=1,
        club_name="Cached Org",
        ig="cached_org",
        logo_url=None,
    )
    monkeypatch.setattr(module, "list_school_clubs", lambda school: [club])
    scraper = MagicMock()
    monkeypatch.setattr(module, "get_scraper", lambda: scraper)
    upload = MagicMock(side_effect=[None, "https://wat2do.io/media/organization-logos/cached.jpg"])
    monkeypatch.setattr(module, "upload_image_from_url", upload)
    monkeypatch.setattr(
        module.club_service,
        "update_club",
        MagicMock(return_value=SimpleNamespace(id=1)),
    )

    result = module.backfill_school(
        "mcmaster",
        profile_cache={
            "cached_org": {
                "username": "cached_org",
                "profilePicUrlHD": "https://cdn/cached.jpg",
                "profilePicUrl": "https://cdn/cached-small.jpg",
            }
        },
    )

    assert result == (1, 1, 0)
    assert [call.args[0] for call in upload.call_args_list] == [
        "https://cdn/cached.jpg",
        "https://cdn/cached-small.jpg",
    ]
    scraper.scrape_profiles.assert_not_called()
