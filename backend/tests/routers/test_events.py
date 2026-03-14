def test_create_event_requires_auth(client):
    response = client.post("/events/", json={"title": "Test", "location": "Here"})
    assert response.status_code == 401


def test_delete_event_requires_auth(client):
    response = client.delete("/events/1")
    assert response.status_code == 401
