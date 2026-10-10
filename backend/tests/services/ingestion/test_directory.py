import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest

from core.tables import DIRECTORY_SOURCES, EVENTS, POSITIONS
from schemas.directory_source import DirectorySource
from services.ingestion import directory as module
from services.ingestion.queue import IngestionQueue

LISTING_URL = "https://clubs.example.edu/events"


def _source(**overrides) -> DirectorySource:
    fields = {
        "id": 4,
        "school": "upenn",
        "name": "Penn Clubs",
        "url": LISTING_URL,
        "default_club": "Penn Clubs",
        "default_club_ig": "pennclubs",
        "source_format": "html",
        "event_url_patterns": ["/events/"],
    }
    return DirectorySource.model_validate({**fields, **overrides})


@pytest.fixture
def web(monkeypatch):
    """Serve ``web.pages[url]`` as (content-type, body) to every directory HTTP call."""
    state = SimpleNamespace(pages={}, requests=[])
    real_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        state.requests.append(request)
        if str(request.url) not in state.pages:
            return httpx.Response(404)
        content_type, body = state.pages[str(request.url)]
        return httpx.Response(200, headers={"content-type": content_type}, content=body)

    def client(**kwargs):
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    def get(url, **kwargs):
        with client(**kwargs) as session:
            return session.get(url)

    monkeypatch.setattr(module.httpx, "Client", client)
    monkeypatch.setattr(module.httpx, "get", get)
    return state


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
    ("url", "source", "expected"),
    [
        ("https://clubs.example.edu/events/42", _source(), True),
        ("https://www.clubs.example.edu/events/42?occurrence=2", _source(), True),
        ("https://other.example.edu/events/42", _source(), False),
        ("https://clubs.example.edu/news/42", _source(), False),
        ("mailto:events@clubs.example.edu", _source(), False),
        ("https://clubs.example.edu/events/42", _source(event_url_exclude_patterns=["/42"]), False),
        (
            "https://calendar.example.edu/event/7",
            _source(event_url_patterns=["calendar.example.edu/event/"]),
            True,
        ),
        ("https://[invalid/events/1", _source(), False),
    ],
)
def test_matches_event_url(url, source, expected):
    assert module.matches_event_url(url, source) is expected


def test_html_listing_follows_pagination_and_reads_json_ld(web):
    web.pages[LISTING_URL] = (
        "text/html",
        """
        <a href="/events/1/">One</a>
        <a href="/events/1#details">One again</a>
        <a href="https://clubs.example.edu/events">Listing</a>
        <a href="/about">About</a>
        <script type="application/ld+json">
          {"@graph": [{"@type": ["Event"], "url": "/events/2"}, {"@type": "Place", "url": "/x"}]}
        </script>
        <script type="application/ld+json">not json</script>
        <a class="next" href="/events?page=2">Next</a>
        """,
    )
    web.pages[f"{LISTING_URL}?page=2"] = ("text/html", '<a href="/events/3">Three</a>')

    urls = module.crawl_directory_links(_source(next_page_selector="a.next"))

    assert urls == [
        "https://clubs.example.edu/events/1",
        "https://clubs.example.edu/events/2",
        "https://clubs.example.edu/events/3",
    ]
    assert all(request.headers["user-agent"] == "curl/8.7.1" for request in web.requests)


def test_json_listing_reads_configured_url_fields_of_titled_records(web):
    web.pages[LISTING_URL] = (
        "application/json",
        json.dumps(
            {
                "results": [
                    {"title": "Social", "link": "/events/social", "url": "/ignored"},
                    {"name": "Untitled", "link": "/events/untitled"},
                    {"group": {"title": "Nested", "link": "https://clubs.example.edu/events/n"}},
                ]
            }
        ),
    )

    urls = module.crawl_directory_links(_source(source_format="json", json_url_fields=["link"]))

    assert urls == [
        "https://clubs.example.edu/events/social",
        "https://clubs.example.edu/events/n",
    ]


def test_ical_listing_keeps_upcoming_events_in_start_order(web):
    today = datetime.now(timezone.utc)

    def vevent(uid: str, start: datetime, url: str) -> str:
        return (
            f"BEGIN:VEVENT\r\nUID:{uid}\r\nDTSTART:{start:%Y%m%dT%H%M%SZ}\r\n"
            f"URL:{url}\r\nEND:VEVENT\r\n"
        )

    web.pages[LISTING_URL] = (
        "text/calendar",
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\n"
        + vevent("late", today + timedelta(days=9), "https://clubs.example.edu/events/late")
        + vevent("past", today - timedelta(days=9), "https://clubs.example.edu/events/past")
        + vevent("soon", today + timedelta(days=1), "https://clubs.example.edu/events/soon")
        + "BEGIN:VEVENT\r\nUID:allday\r\nDTSTART;VALUE=DATE:"
        + f"{today + timedelta(days=5):%Y%m%d}\r\n"
        + "URL:https://clubs.example.edu/events/allday\r\nEND:VEVENT\r\n"
        + "END:VCALENDAR\r\n",
    )

    urls = module.crawl_directory_links(_source(source_format="ical"))

    assert urls == [
        "https://clubs.example.edu/events/soon",
        "https://clubs.example.edu/events/allday",
        "https://clubs.example.edu/events/late",
    ]


def test_listing_failure_raises(web):
    with pytest.raises(httpx.HTTPStatusError):
        module.crawl_directory_links(_source())


@pytest.mark.parametrize(
    ("host_markup", "host"),
    [
        pytest.param(
            '<div aria-label="Hosted By Chess Club"><strong>Chess Club</strong></div>',
            "Chess Club",
            id="campusgroups",
        ),
        pytest.param(
            '<p><span>Hosted by:</span> <a href="/clubs/chess">Chess Club</a></p>',
            "Chess Club",
            id="hosted-by-label",
        ),
        pytest.param(
            '<script type="application/ld+json">'
            '{"@type": "Event", "organizer": {"name": "Chess &amp; Go Club"}}</script>',
            "Chess & Go Club",
            id="json-ld-organizer",
        ),
        pytest.param("", None, id="no-host"),
    ],
)
def test_scrape_event_page_prefixes_the_named_host(web, host_markup, host):
    url = "https://clubs.example.edu/events/1"
    web.pages[url] = (
        "text/html",
        f"<html><body><nav>Menu</nav>{host_markup}"
        "<article><h1>Spring Social</h1>\n\n<p>April 3, 6 PM</p></article></body></html>",
    )

    text, _images = module.scrape_event_page(url, _source())

    body = "Spring Social\nApril 3, 6 PM"
    assert text == (f"Hosted by {host}\n{body}" if host else body)


def test_scrape_event_page_collects_event_artwork_in_priority_order(web):
    url = "https://clubs.example.edu/events/1"
    web.pages[url] = (
        "text/html",
        """
        <script type="application/ld+json">
          [{"@type": "Event", "url": "/events/1/", "image": [{"url": "/media/hero.jpg"}]},
           {"@type": "Event", "url": "/events/2", "image": "/media/other-event.jpg"}]
        </script>
        <div class="banner"><img data-src="/media/banner.jpg" src="/media/spinner.gif"></div>
        <div class="body">
          <p>Spring Social details</p>
          <img src="/media/hero.jpg">
          <img src="/media/club-logo.png">
          <img src="http://clubs.example.edu/media/insecure.jpg">
          <aside><img src="/media/sidebar.jpg"></aside>
          <img src="/media/poster.jpg">
        </div>
        """,
    )

    text, images = module.scrape_event_page(
        url, _source(content_selector=".body", image_selector=".banner img")
    )

    assert text == "Spring Social details"
    assert images == [
        "https://clubs.example.edu/media/hero.jpg",
        "https://clubs.example.edu/media/banner.jpg",
        "https://clubs.example.edu/media/poster.jpg",
    ]


def test_scrape_event_page_returns_nothing_for_failed_or_empty_pages(web):
    web.pages["https://clubs.example.edu/events/empty"] = (
        "text/html",
        "<html><body></body></html>",
    )

    assert module.scrape_event_page("https://clubs.example.edu/events/gone", _source()) == ("", [])
    assert module.scrape_event_page("https://clubs.example.edu/events/empty", _source()) == (
        "",
        [],
    )


def test_scrape_directories_queues_only_new_pages_with_their_source(monkeypatch, tmp_path):
    good = _source()
    broken = _source(id=5, name="Broken")
    known_event = "https://clubs.example.edu/events/known-event"
    known_position = "https://clubs.example.edu/events/known-role"
    new_page = "https://clubs.example.edu/events/new"
    empty_page = "https://clubs.example.edu/events/empty"
    monkeypatch.setattr(module, "list_sources", lambda: [broken, good])

    def crawl(source):
        if source is broken:
            raise httpx.ConnectError("offline")
        return [known_event, known_position, new_page, empty_page]

    monkeypatch.setattr(module, "crawl_directory_links", crawl)
    lookups = []

    def existing_urls(urls, *, table=EVENTS):
        lookups.append(table)
        return urls & {known_event if table == EVENTS else known_position}

    monkeypatch.setattr(module, "existing_urls", existing_urls)
    scraped = []
    monkeypatch.setattr(
        module,
        "scrape_event_page",
        lambda url, source: (
            scraped.append(url)
            or (("", []) if url == empty_page else ("Hosted by Chess Club\nSocial", ["a.jpg"]))
        ),
    )
    queue = IngestionQueue(tmp_path)

    stats = module.scrape_directories(queue)

    assert stats == {"sources": 2, "discovered": 4, "queued": 1, "failed": 1}
    assert lookups == [EVENTS, POSITIONS]
    assert scraped == [new_page, empty_page]
    item = queue.claim()
    assert item.school == "upenn"
    assert item.directory_source_id == good.id
    assert item.post == {
        "url": new_page,
        "caption": "Hosted by Chess Club\nSocial",
        "images": ["a.jpg"],
    }
    assert queue.claim() is None
    assert module.scrape_directories(queue)["queued"] == 0


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


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://ssmu.ca/events/?mo=9&yr=2026", False),
        ("https://ssmu.ca/events?page=2", False),
        ("https://ssmu.ca/events/winter-general-assembly/", True),
        ("https://ssmu.ca/event/winter-general-assembly/", True),
    ],
)
def test_listing_query_variants_are_not_event_pages(url, expected):
    source = _source(
        url="https://ssmu.ca/events/", event_url_patterns=["ssmu.ca/event/", "ssmu.ca/events/"]
    )
    assert module.matches_event_url(url, source) is expected
