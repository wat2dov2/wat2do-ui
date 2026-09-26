import httpx

from services import event_feed_revalidation as module


def test_revalidate_school_noops_without_url(monkeypatch):
    monkeypatch.setattr(module.settings, "event_feed_revalidation_url", "")

    def fail_post(*args, **kwargs):
        raise AssertionError("httpx.post should not be called without a revalidation URL")

    monkeypatch.setattr(module.httpx, "post", fail_post)

    module.event_feed_revalidation_service.revalidate_school(
        "uwaterloo", resources=("events", "clubs")
    )


def test_revalidate_school_posts_school_with_bearer_secret(monkeypatch):
    calls = []

    def fake_post(url, *, json, headers, timeout):
        calls.append(
            {
                "url": url,
                "json": json,
                "headers": headers,
                "timeout": timeout,
            }
        )
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(
        module.settings,
        "event_feed_revalidation_url",
        "https://wat2do.io/api/revalidate-events",
    )
    monkeypatch.setattr(module.settings, "event_feed_revalidation_secret", "secret")
    monkeypatch.setattr(module.settings, "event_feed_revalidation_timeout", 2.5)
    monkeypatch.setattr(module.httpx, "post", fake_post)

    module.event_feed_revalidation_service.revalidate_school(
        "uwaterloo", resources=("events", "clubs")
    )

    assert calls == [
        {
            "url": "https://wat2do.io/api/revalidate-events",
            "json": {"school": "uwaterloo", "resources": ["events", "clubs"]},
            "headers": {"Authorization": "Bearer secret"},
            "timeout": 2.5,
        }
    ]


def test_revalidate_school_does_not_raise_on_http_failure(monkeypatch):
    def fail_post(*args, **kwargs):
        raise httpx.ConnectError("offline", request=httpx.Request("POST", "https://wat2do.io"))

    monkeypatch.setattr(
        module.settings,
        "event_feed_revalidation_url",
        "https://wat2do.io/api/revalidate-events",
    )
    monkeypatch.setattr(module.settings, "event_feed_revalidation_secret", "")
    monkeypatch.setattr(module.httpx, "post", fail_post)

    module.event_feed_revalidation_service.revalidate_school(
        "uwaterloo", resources=("events", "clubs")
    )


def test_revalidation_preserves_scope_and_deduplicates_schools(monkeypatch):
    calls = []

    def fake_post(url, *, json, headers, timeout):
        calls.append(json)
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(
        module.settings, "event_feed_revalidation_url", "https://wat2do.io/api/revalidate-events"
    )
    monkeypatch.setattr(module.httpx, "post", fake_post)
    module.event_feed_revalidation_service.revalidate_schools(
        ["uwaterloo", None, "uwaterloo", "western"],
        resources=("positions", "clubs", "positions"),
    )
    assert calls == [
        {"school": school, "resources": ["positions", "clubs"]}
        for school in ("uwaterloo", "western")
    ]


def test_revalidation_ignores_missing_school(monkeypatch):
    calls = []

    def fake_post(url, *, json, headers, timeout):
        calls.append(json)
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(
        module.settings, "event_feed_revalidation_url", "https://wat2do.io/api/revalidate-events"
    )
    monkeypatch.setattr(module.httpx, "post", fake_post)
    module.event_feed_revalidation_service.revalidate_schools(
        [None],
        resources=("events", "clubs"),
    )
    assert calls == []
