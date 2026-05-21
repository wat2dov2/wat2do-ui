"""Regression tests for retired API surfaces."""


def test_scraped_events_route_is_retired(admin_client):
    resp = admin_client.get("/scraped-events/")
    assert resp.status_code == 404
