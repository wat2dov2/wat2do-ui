def test_list_users_requires_auth(client):
    response = client.get("/users/")
    assert response.status_code == 401


def test_get_user_requires_auth(client):
    response = client.get("/users/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 401


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
