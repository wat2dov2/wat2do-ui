"""Regression tests for retired API surfaces."""


def test_event_submissions_route_is_retired(authenticated_client):
    resp = authenticated_client.post("/submissions/", json={"event_data": {"title": "Nope"}})
    assert resp.status_code == 404


def test_scraped_events_route_is_retired(admin_client):
    resp = admin_client.get("/scraped-events/")
    assert resp.status_code == 404
