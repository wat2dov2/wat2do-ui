def test_create_club_requires_auth(client):
    response = client.post("/clubs/", json={"club_name": "Test Club", "club_type": "WUSA"})
    assert response.status_code == 401


def test_delete_club_requires_auth(client):
    response = client.delete("/clubs/1")
    assert response.status_code == 401
