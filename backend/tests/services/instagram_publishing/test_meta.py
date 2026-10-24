import httpx

from services.instagram_publishing import meta


def test_get_identity_uses_instagram_login_host_and_bearer_token(monkeypatch):
    requests = []

    class _Client:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url, params):
            requests.append((url, params, self.kwargs))
            return httpx.Response(
                200,
                json={"id": "37640733598873542", "username": "dalhousie.wat2do.io"},
            )

    monkeypatch.setattr(meta.httpx, "Client", _Client)

    identity = meta.MetaInstagramClient("secret-token").get_identity()

    assert identity == {
        "id": "37640733598873542",
        "username": "dalhousie.wat2do.io",
    }
    url, params, kwargs = requests[0]
    assert url == "https://graph.instagram.com/v25.0/me"
    assert params == {"fields": "id,username"}
    assert kwargs["headers"] == {"Authorization": "Bearer secret-token"}


def test_refresh_access_token_uses_unversioned_refresh_endpoint(monkeypatch):
    requests = []

    class _Client:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url, params):
            requests.append((url, params, self.kwargs))
            return httpx.Response(
                200,
                json={
                    "access_token": "refreshed-token",
                    "token_type": "bearer",
                    "expires_in": 5_184_000,
                },
            )

    monkeypatch.setattr(meta.httpx, "Client", _Client)

    payload = meta.MetaInstagramClient("current-token").refresh_access_token()

    assert payload["access_token"] == "refreshed-token"
    assert requests == [
        (
            "https://graph.instagram.com/refresh_access_token",
            {
                "grant_type": "ig_refresh_token",
                "access_token": "current-token",
            },
            {"timeout": 30.0},
        )
    ]


def test_account_stats_read_profile_and_newest_media(monkeypatch):
    requests = []

    class _Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url, params):
            requests.append((url, params))
            if url.endswith("/me/media"):
                return httpx.Response(200, json={"data": [{"id": "1790"}]})
            return httpx.Response(200, json={"id": "1784", "followers_count": 12})

    monkeypatch.setattr(meta.httpx, "Client", _Client)
    client = meta.MetaInstagramClient("secret-token")

    assert client.get_profile()["followers_count"] == 12
    assert client.list_recent_media(25) == [{"id": "1790"}]
    assert requests == [
        ("https://graph.instagram.com/v25.0/me", {"fields": meta.PROFILE_FIELDS}),
        (
            "https://graph.instagram.com/v25.0/me/media",
            {"fields": meta.MEDIA_FIELDS, "limit": "25"},
        ),
    ]
