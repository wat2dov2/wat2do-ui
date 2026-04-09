from unittest.mock import MagicMock, patch

from core.rate_limit import ai_rate_limiter


# ---------------------------------------------------------------------------
# Unauthenticated requests must be rejected
# ---------------------------------------------------------------------------


def test_generate_filters_requires_auth(client):
    resp = client.post("/ai/generate-filters", json={"prompt": "free tech events"})
    assert resp.status_code == 401


def test_generate_event_requires_auth(client):
    resp = client.post("/ai/generate-event", json={"prompt": "pizza social friday"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Prompt validation
# ---------------------------------------------------------------------------


def test_prompt_too_long_returns_422(authenticated_client):
    """Prompts exceeding 2000 chars are rejected before hitting OpenAI."""
    long_prompt = "a" * 2001
    resp = authenticated_client.post("/ai/generate-filters", json={"prompt": long_prompt})
    assert resp.status_code == 422


def test_empty_prompt_returns_422(authenticated_client):
    """Empty prompts are rejected."""
    resp = authenticated_client.post("/ai/generate-filters", json={"prompt": ""})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Authenticated requests succeed (OpenAI call mocked)
# ---------------------------------------------------------------------------

_FAKE_FILTER_JSON = '{"searchQuery":"","categories":["Technology"],"locations":[],"foods":[],"days":[],"priceRange":{"min":"0","max":"0"},"dateRange":"","addedSince":"","requiresRegistration":false}'

_FAKE_EVENT_JSON = '{"title":"Pizza Social","description":"A fun event","date":"2026-04-10","time":"18:00","location":"SLC","category":"Games","price":0,"food":["Pizza"],"requiresRegistration":false,"organization":"Fun Club"}'


def _mock_openai_response(content: str) -> MagicMock:
    """Build a fake OpenAI ChatCompletion response."""
    message = MagicMock()
    message.content = content
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


def test_generate_filters_authenticated(authenticated_client, monkeypatch):
    ai_rate_limiter._requests.clear()
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(_FAKE_FILTER_JSON)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    resp = authenticated_client.post("/ai/generate-filters", json={"prompt": "free tech events"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["categories"] == ["Technology"]
    assert data["priceRange"] == {"min": "0", "max": "0"}


def test_generate_event_authenticated(authenticated_client, monkeypatch):
    ai_rate_limiter._requests.clear()
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(_FAKE_EVENT_JSON)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    resp = authenticated_client.post("/ai/generate-event", json={"prompt": "pizza social friday"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Pizza Social"
    assert data["location"] == "SLC"
    assert data["food"] == ["Pizza"]


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


def test_rate_limit_filters_returns_429(authenticated_client, monkeypatch):
    """Exceeding the rate limit on /generate-filters returns 429."""
    ai_rate_limiter._requests.clear()
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(_FAKE_FILTER_JSON)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    # Use a tight limiter for the test
    original_max = ai_rate_limiter.max_requests
    ai_rate_limiter.max_requests = 2
    try:
        resp1 = authenticated_client.post("/ai/generate-filters", json={"prompt": "a"})
        resp2 = authenticated_client.post("/ai/generate-filters", json={"prompt": "b"})
        resp3 = authenticated_client.post("/ai/generate-filters", json={"prompt": "c"})
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp3.status_code == 429
        assert "Too many requests" in resp3.json()["detail"]
    finally:
        ai_rate_limiter.max_requests = original_max
        ai_rate_limiter._requests.clear()


def test_rate_limit_event_returns_429(authenticated_client, monkeypatch):
    """Exceeding the rate limit on /generate-event returns 429."""
    ai_rate_limiter._requests.clear()
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(_FAKE_EVENT_JSON)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    original_max = ai_rate_limiter.max_requests
    ai_rate_limiter.max_requests = 2
    try:
        resp1 = authenticated_client.post("/ai/generate-event", json={"prompt": "a"})
        resp2 = authenticated_client.post("/ai/generate-event", json={"prompt": "b"})
        resp3 = authenticated_client.post("/ai/generate-event", json={"prompt": "c"})
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp3.status_code == 429
        assert "Too many requests" in resp3.json()["detail"]
    finally:
        ai_rate_limiter.max_requests = original_max
        ai_rate_limiter._requests.clear()
