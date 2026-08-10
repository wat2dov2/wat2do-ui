from types import SimpleNamespace
from unittest.mock import MagicMock

from scripts import backfill_organization_instagram_logos as module
from scripts.backfill_organization_instagram_logos import (
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


def test_backfill_school_updates_matches_and_reports_not_found(monkeypatch):
    organizations = [
        SimpleNamespace(id=1, organization_name="Handle Org", ig="handle_org", logo_url=None),
        SimpleNamespace(id=2, organization_name="Numeric Org", ig="12345", logo_url=None),
        SimpleNamespace(id=3, organization_name="Missing Org", ig="missing_org", logo_url=None),
    ]
    monkeypatch.setattr(
        module.organization_service,
        "list_organizations",
        lambda **kwargs: (organizations, len(organizations)),
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
    monkeypatch.setattr(module.organization_service, "update_organization", update)
    revalidate = MagicMock()
    monkeypatch.setattr(module.event_feed_revalidation_service, "revalidate_school", revalidate)

    assert module.backfill_school("mcmaster") == (3, 2, 1)
    assert [call.args[0] for call in update.call_args_list] == [1, 2]
    revalidate.assert_called_once_with("mcmaster")
