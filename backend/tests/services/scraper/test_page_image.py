from services.scraper.page_image import extract_poster

BASE = "https://events.example.edu/events/jam/"


def test_prefers_og_image_absolute():
    html = '<meta property="og:image" content="https://cdn.example.edu/poster.png">'
    assert extract_poster(html, BASE) == "https://cdn.example.edu/poster.png"


def test_resolves_relative_and_unescapes_entities():
    html = '<meta property="og:image" content="/img/p.png?a=1&amp;b=2">'
    assert extract_poster(html, BASE) == "https://events.example.edu/img/p.png?a=1&b=2"


def test_protocol_relative_becomes_https():
    html = '<meta name="og:image" content="//cdn.example.edu/p.png">'
    assert extract_poster(html, BASE) == "https://cdn.example.edu/p.png"


def test_attribute_order_does_not_matter():
    html = '<meta content="https://cdn.example.edu/p.png" property="og:image"/>'
    assert extract_poster(html, BASE) == "https://cdn.example.edu/p.png"


def test_og_image_wins_over_twitter_and_jsonld():
    html = (
        '<meta property="og:image" content="https://cdn.example.edu/og.png">'
        '<meta name="twitter:image" content="https://cdn.example.edu/t.png">'
        '<script type="application/ld+json">{"@type":"Event",'
        '"image":"https://cdn.example.edu/ld.png"}</script>'
    )
    assert extract_poster(html, BASE) == "https://cdn.example.edu/og.png"


def test_falls_back_to_twitter_image():
    html = '<meta name="twitter:image" content="https://cdn.example.edu/t.png">'
    assert extract_poster(html, BASE) == "https://cdn.example.edu/t.png"


def test_falls_back_to_jsonld_event_image_object():
    html = (
        '<script type="application/ld+json">'
        '{"@type":"Event","image":{"url":"https://cdn.example.edu/ld.png"}}</script>'
    )
    assert extract_poster(html, BASE) == "https://cdn.example.edu/ld.png"


def test_jsonld_graph_with_list_image():
    html = (
        '<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},'
        '{"@type":"Event","image":["https://cdn.example.edu/first.png","x"]}]}</script>'
    )
    assert extract_poster(html, BASE) == "https://cdn.example.edu/first.png"


def test_http_only_poster_is_rejected():
    html = '<meta property="og:image" content="http://insecure.example.edu/p.png">'
    assert extract_poster(html, BASE) is None


def test_no_poster_returns_none():
    assert extract_poster("<html><head><title>Jam</title></head></html>", BASE) is None


def test_malformed_jsonld_is_ignored():
    html = '<script type="application/ld+json">{not valid json}</script>'
    assert extract_poster(html, BASE) is None


def test_site_default_and_system_logos_are_rejected():
    # Sites serve these when an event has no image of its own.
    default = (
        '<meta property="og:image" '
        'content="https://www.concordia.ca/etc/designs/concordia/clientlibs/img/news-default.jpg">'
    )
    logo = '<meta property="og:image" content="https://www.wlu.ca/images/system/laurier-logo.jpg">'
    assert extract_poster(default, BASE) is None
    assert extract_poster(logo, BASE) is None


def test_event_upload_and_content_posters_are_kept():
    content = (
        '<meta property="og:image" '
        'content="https://www.concordia.ca/content/shared/en/events/x.img.png/1.jpg">'
    )
    upload = (
        '<meta property="og:image" '
        'content="https://cornell.campusgroups.com/upload/cornell/2026/poster.png">'
    )
    assert extract_poster(content, BASE) == (
        "https://www.concordia.ca/content/shared/en/events/x.img.png/1.jpg"
    )
    assert extract_poster(upload, BASE) == (
        "https://cornell.campusgroups.com/upload/cornell/2026/poster.png"
    )
