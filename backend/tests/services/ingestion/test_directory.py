import pytest

from core.tables import DIRECTORY_SOURCES
from schemas.directory_source import DirectorySource
from services.ingestion import directory as module

LISTING_URL = "https://clubs.example.edu/events"


def _source(**overrides) -> DirectorySource:
    fields = {
        "id": 4,
        "school": "upenn",
        "name": "Penn Clubs",
        "url": LISTING_URL,
        "default_club": "Penn Clubs",
        "default_club_ig": "pennclubs",
    }
    return DirectorySource.model_validate({**fields, **overrides})


@pytest.fixture
def sources_cache():
    module._sources_by_school.cache_clear()
    yield
    module._sources_by_school.cache_clear()


def test_list_sources_flattens_the_school_slug(fake_sb, patch_sb):
    patch_sb("services.ingestion.directory")
    row = _source().model_dump(exclude={"school"})
    fake_sb.set_response(data=[{**row, "school_record": {"slug": "upenn"}}])

    assert module.list_sources() == [_source()]
    fake_sb.table.assert_called_once_with(DIRECTORY_SOURCES)
    fake_sb.order.assert_called_once_with("id")


@pytest.mark.parametrize(
    ("school", "source_url", "expected_handle"),
    [
        ("upenn", "https://www.calendar.example.edu/event/7", "penncalendar"),
        ("upenn", "https://clubs.example.edu/events/1", "pennclubs"),
        ("upenn", "https://elsewhere.example.edu/x", "pennclubs"),
        ("upenn", None, "pennclubs"),
        ("mit", "https://clubs.example.edu/events/1", None),
        (None, None, None),
    ],
)
def test_default_club_logo_matches_the_directory_host(
    monkeypatch, sources_cache, school, source_url, expected_handle
):
    sources = [
        _source(),
        _source(id=5, url="https://calendar.example.edu/", default_club_ig="penncalendar"),
    ]
    monkeypatch.setattr(module, "list_sources", lambda: sources)
    lookups = []
    monkeypatch.setattr(
        module.club_service,
        "lookup_club_by_school_and_ig",
        lambda school, handle: lookups.append((school, handle)) or {"logo_url": f"{handle}.png"},
    )

    logo = module.default_club_logo(school, source_url)

    assert logo == (f"{expected_handle}.png" if expected_handle else None)
    assert lookups == ([("upenn", expected_handle)] if expected_handle else [])


def test_default_club_logo_needs_a_registered_publisher(monkeypatch, sources_cache):
    sources = [_source(default_club_ig=None), _source(id=5, school="mit")]
    monkeypatch.setattr(module, "list_sources", lambda: sources)
    monkeypatch.setattr(module.club_service, "lookup_club_by_school_and_ig", lambda *_: None)

    assert module.default_club_logo("upenn", LISTING_URL) is None
    assert module.default_club_logo("mit", LISTING_URL) is None
