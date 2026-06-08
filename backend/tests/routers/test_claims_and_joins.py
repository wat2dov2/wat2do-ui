import pytest
from uuid import uuid4, UUID
from services import club_service

def test_create_claim_success(authenticated_client, monkeypatch):
    mock_claim = {
        "id": str(uuid4()),
        "club_id": 1,
        "user_id": str(uuid4()),
        "executive_role": "President",
        "proof_url": "http://example.com/proof.png",
        "status": "pending",
        "created_at": "2026-06-07T00:00:00Z",
        "updated_at": "2026-06-07T00:00:00Z"
    }

    monkeypatch.setattr(club_service, "create_claim", lambda *a, **k: mock_claim)

    resp = authenticated_client.post("/clubs/1/claims", json={
        "executive_role": "President",
        "proof_url": "http://example.com/proof.png"
    })
    assert resp.status_code == 201
    assert resp.json()["executive_role"] == "President"
    assert resp.json()["status"] == "pending"

def test_create_join_request_success(authenticated_client, monkeypatch):
    mock_join = {
        "id": str(uuid4()),
        "club_id": 1,
        "user_id": str(uuid4()),
        "pitch": "I love tech!",
        "status": "pending",
        "created_at": "2026-06-07T00:00:00Z",
        "updated_at": "2026-06-07T00:00:00Z"
    }

    monkeypatch.setattr(club_service, "create_join_request", lambda *a, **k: mock_join)

    resp = authenticated_client.post("/clubs/1/join-requests", json={
        "pitch": "I love tech!"
    })
    assert resp.status_code == 201
    assert resp.json()["pitch"] == "I love tech!"
    assert resp.json()["status"] == "pending"
