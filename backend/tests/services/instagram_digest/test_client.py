import json

import httpx
import pytest

from services.instagram_digest import client
from services.instagram_digest.sessions import InstagramSession, SessionHealthStatus


def _session() -> InstagramSession:
    return InstagramSession(
        intended_recipient_id="12345",
        sessionid="12345%3Asecret-session",
        csrftoken="secret-csrf",
        ds_user_id="12345",
        user_agent="matching-browser-agent",
        account_username="ubc.wat2do.io",
        mid="secret-mid",
        ig_did="secret-device",
        rur="secret-region",
    )


def _response(
    media_ids: list[str],
    *,
    more_available: bool,
    max_id: str | None,
    chain_to_discover: dict | None = None,
) -> httpx.Response:
    feed = {
        "items": [{"media": {"id": media_id}} for media_id in media_ids],
        "paging_info": {
            "more_available": more_available,
            "max_id": max_id,
        },
    }
    if chain_to_discover is not None:
        feed["chain_to_discover"] = chain_to_discover
    return httpx.Response(
        200,
        json={"data": {"subscription_digest_feed": feed}},
        request=httpx.Request("POST", "https://i.instagram.com/graphql/query"),
    )


def test_rejects_invalid_web_app_id() -> None:
    with pytest.raises(client.InstagramDigestError) as raised:
        client.InstagramDigestClient(
            _session(),
            endpoint_url="https://i.instagram.com/graphql/query",
            operation_name="SubscriptionDigestFeedQuery",
            client_doc_id="123456",
            web_app_id="not-an-app-id",
            timeout_seconds=15,
            max_pages=5,
        )

    assert raised.value.status is SessionHealthStatus.CONFIGURATION_ERROR


def test_initial_query_sends_exact_operation_contract_and_json_null(monkeypatch):
    requests = []

    class _Client:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.cookies = httpx.Cookies(kwargs["cookies"])
            self.headers = kwargs["headers"].copy()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url, data):
            requests.append((url, data, self.kwargs))
            return _response(["media-1"], more_available=False, max_id=None)

    monkeypatch.setattr(client.httpx, "Client", _Client)
    digest = client.InstagramDigestClient(
        _session(),
        endpoint_url="https://i.instagram.com/graphql/query",
        operation_name="SubscriptionDigestFeedQuery",
        client_doc_id="20099285643937437306465362209",
        web_app_id="936619743392459",
        timeout_seconds=15,
        max_pages=5,
    ).fetch_media("cache-123")

    assert digest.media == ({"id": "media-1"},)
    assert digest.page_count == 1
    assert digest.session == _session()
    url, data, kwargs = requests[0]
    assert url == "https://i.instagram.com/graphql/query"
    assert data == {
        "signed_body": "SIGNATURE.",
        "vc_policy": "default",
        "locale": "en_US",
        "client_doc_id": "20099285643937437306465362209",
        "variables": data["variables"],
        "strip_nulls": "true",
        "strip_defaults": "true",
    }
    assert kwargs["headers"] | {"X-IG-Timezone-Offset": "dynamic"} == {
        "User-Agent": "matching-browser-agent",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.instagram.com/",
        "Origin": "https://www.instagram.com",
        "X-CSRFToken": "secret-csrf",
        "X-Client-Doc-Id": "20099285643937437306465362209",
        "X-FB-Friendly-Name": "SubscriptionDigestFeedQuery",
        "X-IG-Timezone-Offset": "dynamic",
        "x-graphql-client-library": "minimal",
    }
    assert kwargs["headers"]["X-IG-Timezone-Offset"].lstrip("-").isdigit()
    assert {cookie.name: cookie.value for cookie in kwargs["cookies"].jar} == (_session().cookies)
    assert {cookie.domain for cookie in kwargs["cookies"].jar} == {".instagram.com"}
    variables = json.loads(data["variables"])
    assert variables == {
        "request": {"cache_ent_id": "cache-123", "max_id": None},
        "enable_audience_in_light_media": False,
        "enable_clips_metadata_in_light_media": False,
        "enable_likers_in_full_media": False,
        "enable_thumbnails_in_light_media": False,
        "enable_video_versions_in_light_media": False,
        "exclude_caption_user_field": False,
        "exclude_main_user_field": False,
        "include_attribution_ui_data": False,
    }
    assert '"max_id":null' in data["variables"]


def test_paginates_only_while_raw_more_available_is_true(monkeypatch):
    responses = [
        _response(["media-1"], more_available=True, max_id="next-page"),
        _response(
            ["media-2"],
            more_available=False,
            max_id="discover-cursor",
            chain_to_discover={"more_available": True, "max_id": "must-not-follow"},
        ),
    ]
    cursors = []
    csrf_headers = []
    csrf_cookie_counts = []
    client_count = 0

    class _Client:
        def __init__(self, **kwargs):
            nonlocal client_count
            client_count += 1
            self.cookies = httpx.Cookies(kwargs["cookies"])
            self.headers = kwargs["headers"].copy()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, _url, data):
            cursors.append(json.loads(data["variables"])["request"]["max_id"])
            csrf_headers.append(self.headers["X-CSRFToken"])
            if len(cursors) == 1:
                self.cookies.set("csrftoken", "rotated-csrf", domain=".instagram.com")
            csrf_cookie_counts.append(
                sum(cookie.name == "csrftoken" for cookie in self.cookies.jar)
            )
            return responses.pop(0)

    monkeypatch.setattr(client.httpx, "Client", _Client)
    result = client.InstagramDigestClient(
        _session(),
        endpoint_url="https://i.instagram.com/graphql/query",
        operation_name="SubscriptionDigestFeedQuery",
        client_doc_id="123456",
        web_app_id="936619743392459",
        timeout_seconds=15,
        max_pages=5,
    ).fetch_media("cache-123")

    assert result.media == ({"id": "media-1"}, {"id": "media-2"})
    assert result.page_count == 2
    assert client_count == 1
    assert cursors == [None, "next-page"]
    assert csrf_headers == ["secret-csrf", "rotated-csrf"]
    assert csrf_cookie_counts == [1, 1]
    assert result.session.csrftoken == "rotated-csrf"
    assert not responses


def test_login_redirect_requires_reauthorization(monkeypatch):
    class _Client:
        def __init__(self, **kwargs):
            self.cookies = httpx.Cookies(kwargs["cookies"])
            self.headers = kwargs["headers"].copy()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url, *, data):
            return httpx.Response(
                302,
                headers={"location": "https://www.instagram.com/accounts/login/"},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(client.httpx, "Client", _Client)
    digest_client = client.InstagramDigestClient(
        _session(),
        endpoint_url="https://i.instagram.com/graphql/query",
        operation_name="SubscriptionDigestFeedQuery",
        client_doc_id="123456",
        web_app_id="936619743392459",
        timeout_seconds=15,
        max_pages=5,
    )

    with pytest.raises(client.InstagramDigestError) as raised:
        digest_client.fetch_media("cache-123")

    assert raised.value.status is SessionHealthStatus.REAUTHORIZATION_REQUIRED


@pytest.mark.parametrize(
    ("status_code", "payload", "expected_status"),
    [
        (401, {"message": "session secret"}, SessionHealthStatus.REAUTHORIZATION_REQUIRED),
        (429, {"message": "slow down secret"}, SessionHealthStatus.TRANSIENT_ERROR),
        (500, {"message": "server secret"}, SessionHealthStatus.TRANSIENT_ERROR),
        (400, {"message": "bad secret"}, SessionHealthStatus.CONFIGURATION_ERROR),
        (
            200,
            {"errors": [{"message": "checkpoint secret"}]},
            SessionHealthStatus.REAUTHORIZATION_REQUIRED,
        ),
    ],
)
def test_http_failures_are_classified_without_leaking_upstream_details(
    monkeypatch,
    status_code,
    payload,
    expected_status,
):
    class _Client:
        def __init__(self, **kwargs):
            self.cookies = httpx.Cookies(kwargs["cookies"])
            self.headers = kwargs["headers"].copy()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url, *, data):
            return httpx.Response(
                status_code,
                json=payload,
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(client.httpx, "Client", _Client)
    digest_client = client.InstagramDigestClient(
        _session(),
        endpoint_url="https://i.instagram.com/graphql/query",
        operation_name="SubscriptionDigestFeedQuery",
        client_doc_id="123456",
        web_app_id="936619743392459",
        timeout_seconds=15,
        max_pages=5,
    )

    with pytest.raises(client.InstagramDigestError) as raised:
        digest_client.fetch_media("cache-123")

    assert raised.value.status is expected_status
    assert "secret" not in str(raised.value)


@pytest.mark.parametrize(
    ("status_code", "expected_status"),
    [
        (401, SessionHealthStatus.REAUTHORIZATION_REQUIRED),
        (429, SessionHealthStatus.TRANSIENT_ERROR),
        (503, SessionHealthStatus.TRANSIENT_ERROR),
    ],
)
def test_non_json_http_failures_keep_their_stable_category(
    monkeypatch,
    status_code,
    expected_status,
):
    class _Client:
        def __init__(self, **kwargs):
            self.cookies = httpx.Cookies(kwargs["cookies"])
            self.headers = kwargs["headers"].copy()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url, *, data):
            return httpx.Response(
                status_code,
                text="secret upstream body",
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(client.httpx, "Client", _Client)
    digest_client = client.InstagramDigestClient(
        _session(),
        endpoint_url="https://i.instagram.com/graphql/query",
        operation_name="SubscriptionDigestFeedQuery",
        client_doc_id="123456",
        web_app_id="936619743392459",
        timeout_seconds=15,
        max_pages=5,
    )

    with pytest.raises(client.InstagramDigestError) as raised:
        digest_client.fetch_media("cache-123")

    assert raised.value.status is expected_status
    assert "secret" not in str(raised.value)


def test_rejects_repeated_pagination_cursor(monkeypatch):
    responses = [
        _response([], more_available=True, max_id="same"),
        _response([], more_available=True, max_id="same"),
    ]

    class _Client:
        def __init__(self, **kwargs):
            self.cookies = httpx.Cookies(kwargs["cookies"])
            self.headers = kwargs["headers"].copy()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, _url, *, data):
            return responses.pop(0)

    monkeypatch.setattr(client.httpx, "Client", _Client)
    digest_client = client.InstagramDigestClient(
        _session(),
        endpoint_url="https://i.instagram.com/graphql/query",
        operation_name="SubscriptionDigestFeedQuery",
        client_doc_id="123456",
        web_app_id="936619743392459",
        timeout_seconds=15,
        max_pages=5,
    )

    with pytest.raises(client.InstagramDigestError, match="unusable cursor") as raised:
        digest_client.fetch_media("cache-123")

    assert raised.value.status is SessionHealthStatus.TRANSIENT_ERROR


def test_invalid_page_shape_is_sanitized(monkeypatch):
    class _Client:
        def __init__(self, **kwargs):
            self.cookies = httpx.Cookies(kwargs["cookies"])
            self.headers = kwargs["headers"].copy()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url, *, data):
            return httpx.Response(
                200,
                json={"data": {"subscription_digest_feed": {"secret": "hidden"}}},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(client.httpx, "Client", _Client)
    digest_client = client.InstagramDigestClient(
        _session(),
        endpoint_url="https://i.instagram.com/graphql/query",
        operation_name="SubscriptionDigestFeedQuery",
        client_doc_id="123456",
        web_app_id="936619743392459",
        timeout_seconds=15,
        max_pages=5,
    )

    with pytest.raises(client.InstagramDigestError) as raised:
        digest_client.fetch_media("cache-123")

    assert raised.value.status is SessionHealthStatus.TRANSIENT_ERROR
    assert "hidden" not in str(raised.value)
