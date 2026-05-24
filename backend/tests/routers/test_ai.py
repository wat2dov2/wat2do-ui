from unittest.mock import MagicMock, patch

from core.rate_limit import (
    ai_generate_event_rate_limiter,
    ai_generate_filters_rate_limiter,
    ai_rate_limiter,
)

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

_FAKE_EVENT_JSON = '{"title":"Pizza Social","description":"A fun event","occurrences":[{"dtstart_local":"2026-04-10T18:00","dtend_local":""}],"location":"SLC","category":"Games","price":0,"food":["Pizza"],"requiresRegistration":false,"organization":"Fun Club"}'


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
    ai_generate_event_rate_limiter._requests.clear()
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(_FAKE_EVENT_JSON)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    original_max = ai_generate_event_rate_limiter.max_requests
    ai_generate_event_rate_limiter.max_requests = 2
    try:
        resp1 = authenticated_client.post("/ai/generate-event", json={"prompt": "a"})
        resp2 = authenticated_client.post("/ai/generate-event", json={"prompt": "b"})
        resp3 = authenticated_client.post("/ai/generate-event", json={"prompt": "c"})
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp3.status_code == 429
        assert "Too many requests" in resp3.json()["detail"]
    finally:
        ai_generate_event_rate_limiter.max_requests = original_max
        ai_generate_event_rate_limiter._requests.clear()


# ---------------------------------------------------------------------------
# M6 — JSON-mode is forced on every chat completion
# ---------------------------------------------------------------------------


def test_chat_completion_uses_json_response_format(authenticated_client, monkeypatch):
    """Both /generate-filters and /generate-event must pass response_format={'type': 'json_object'}.

    Guards against regression of audit M6 where relying on prompt
    instructions alone to coerce JSON caused frequent parse failures.
    """
    ai_rate_limiter._requests.clear()
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(_FAKE_FILTER_JSON)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    resp = authenticated_client.post("/ai/generate-filters", json={"prompt": "free"})
    assert resp.status_code == 200

    _, kwargs = mock_client.chat.completions.create.call_args
    assert kwargs["response_format"] == {"type": "json_object"}


# ---------------------------------------------------------------------------
# M7 — event response sanitization (price / occurrences / location)
# ---------------------------------------------------------------------------


def test_generate_event_clamps_negative_price(authenticated_client, monkeypatch):
    """Negative price from the model is clamped to 0 (audit M7)."""
    ai_rate_limiter._requests.clear()
    bad_json = '{"title":"x","description":"y","occurrences":[{"dtstart_local":"2026-04-10T18:00","dtend_local":""}],"location":"SLC","category":"Games","price":-50,"food":[],"requiresRegistration":false,"organization":"UW"}'
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(bad_json)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    resp = authenticated_client.post("/ai/generate-event", json={"prompt": "neg"})
    assert resp.status_code == 200
    assert resp.json()["price"] == 0.0


def test_generate_event_rejects_invalid_occurrence(authenticated_client, monkeypatch):
    """Invalid occurrence datetimes fall back to defaults (audit M7)."""
    ai_rate_limiter._requests.clear()
    bad_json = '{"title":"x","description":"y","occurrences":[{"dtstart_local":"2024-99-99T99:99","dtend_local":""}],"location":"SLC","category":"Games","price":0,"food":[],"requiresRegistration":false,"organization":"UW"}'
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(bad_json)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    resp = authenticated_client.post("/ai/generate-event", json={"prompt": "bad"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["occurrences"][0]["dtstart_local"] != "2024-99-99T99:99"
    assert data["occurrences"][0]["dtstart_local"]


def test_generate_event_drops_unknown_location(authenticated_client, monkeypatch):
    """Locations outside the canonical set are dropped (audit M7)."""
    ai_rate_limiter._requests.clear()
    bad_json = '{"title":"x","description":"y","occurrences":[{"dtstart_local":"2026-04-10T18:00","dtend_local":""}],"location":"<script>alert(1)</script>","category":"Games","price":0,"food":[],"requiresRegistration":false,"organization":"UW"}'
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(bad_json)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    resp = authenticated_client.post("/ai/generate-event", json={"prompt": "xss"})
    assert resp.status_code == 200
    assert resp.json()["location"] == ""


# ---------------------------------------------------------------------------
# M14 — OpenAI SDK exceptions are mapped to AIServiceError (no raw 500s)
# ---------------------------------------------------------------------------


def test_openai_rate_limit_error_returns_502(authenticated_client, monkeypatch):
    """openai.RateLimitError is mapped to a 502 (audit M14)."""
    import openai

    ai_rate_limiter._requests.clear()
    mock_client = MagicMock()
    # Construct a RateLimitError with the minimum arguments its __init__ needs.
    err = openai.RateLimitError.__new__(openai.RateLimitError)
    Exception.__init__(err, "too many requests")
    mock_client.chat.completions.create.side_effect = err
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    resp = authenticated_client.post("/ai/generate-filters", json={"prompt": "x"})
    assert resp.status_code == 502


def test_openai_timeout_error_returns_502(authenticated_client, monkeypatch):
    """openai.APITimeoutError is mapped to a 502 (audit M14)."""
    import openai

    ai_rate_limiter._requests.clear()
    mock_client = MagicMock()
    err = openai.APITimeoutError.__new__(openai.APITimeoutError)
    Exception.__init__(err, "timed out")
    mock_client.chat.completions.create.side_effect = err
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    resp = authenticated_client.post("/ai/generate-event", json={"prompt": "x"})
    assert resp.status_code == 502


# ---------------------------------------------------------------------------
# M8 — daily AI budget cap
# ---------------------------------------------------------------------------


def test_daily_ai_budget_exceeded_returns_502(authenticated_client, monkeypatch):
    """Exceeding the daily per-user AI budget raises AIServiceError (audit M8)."""
    from services import ai_service

    ai_rate_limiter._requests.clear()
    ai_service._daily_ai_cache.clear()

    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_openai_response(_FAKE_FILTER_JSON)
    monkeypatch.setattr("routers.ai._get_openai_client", lambda: mock_client)

    # Replace the budget gate with a version that rejects every call so
    # we can validate the 502 path without hammering the counter up to
    # the real DAILY_AI_LIMIT (100).
    def _always_block(user_id: str, limit: int = ai_service.DAILY_AI_LIMIT) -> None:
        from core.exceptions import AIServiceError

        raise AIServiceError(
            "Daily AI request limit reached. Please try again tomorrow.",
            error_kind="api",
        )

    monkeypatch.setattr(ai_service, "enforce_daily_ai_budget", _always_block)

    resp_blocked = authenticated_client.post("/ai/generate-filters", json={"prompt": "a"})
    # AIServiceError with error_kind="api" maps to 502 via the global
    # exception handler (the specific detail message is intentionally
    # generic to avoid leaking budget-counter state to clients).
    assert resp_blocked.status_code == 502
    # Clean up so other tests aren't affected.
    ai_service._daily_ai_cache.clear()
