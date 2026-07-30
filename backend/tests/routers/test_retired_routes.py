"""Regression tests for retired API surfaces."""


def test_scraped_events_route_is_retired(admin_client):
    resp = admin_client.get("/scraped-events/")
    assert resp.status_code == 404


def test_ai_prompt_generation_routes_are_retired(client):
    for path in ("/ai/generate-filters", "/ai/generate-event"):
        resp = client.post(path, json={"prompt": "retired"})
        assert resp.status_code == 404
