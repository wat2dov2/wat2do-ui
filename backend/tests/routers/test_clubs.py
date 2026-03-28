def test_create_club_requires_auth(client):
    response = client.post("/clubs/", json={"club_name": "Test Club", "club_type": "WUSA"})
    assert response.status_code == 401


def test_delete_club_requires_auth(client):
    response = client.delete("/clubs/1")
    assert response.status_code == 401


def test_get_discord_integration_requires_auth(client):
    response = client.get("/clubs/1/integrations/discord")
    assert response.status_code == 401


def test_upsert_discord_integration_requires_auth(client):
    response = client.put(
        "/clubs/1/integrations/discord",
        json={
            "connected": True,
            "server_id": "1",
            "server_name": "Test Server",
            "channel_id": "101",
            "channel_name": "#events",
        },
    )
    assert response.status_code == 401


def test_get_slack_integration_requires_auth(client):
    response = client.get("/clubs/1/integrations/slack")
    assert response.status_code == 401


def test_upsert_instagram_integration_requires_auth(client):
    response = client.put(
        "/clubs/1/integrations/instagram",
        json={"connected": True, "name": "@testclub", "metadata": {"handle": "testclub"}},
    )
    assert response.status_code == 401
