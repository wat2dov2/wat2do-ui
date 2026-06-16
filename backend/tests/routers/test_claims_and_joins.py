from uuid import UUID, uuid4

from services import organization_service


def test_create_claim_success(authenticated_client, monkeypatch):
    mock_claim = {
        "id": str(uuid4()),
        "organization_id": 1,
        "user_id": str(uuid4()),
        "executive_role": "President",
        "proof_url": "http://example.com/proof.png",
        "status": "pending",
        "created_at": "2026-06-07T00:00:00Z",
        "updated_at": "2026-06-07T00:00:00Z",
    }

    monkeypatch.setattr(organization_service, "create_claim", lambda *a, **k: mock_claim)

    resp = authenticated_client.post(
        "/organizations/1/claims",
        json={"executive_role": "President", "proof_url": "http://example.com/proof.png"},
    )
    assert resp.status_code == 201
    assert resp.json()["executive_role"] == "President"
    assert resp.json()["status"] == "pending"


def test_create_join_request_success(authenticated_client, monkeypatch):
    mock_join = {
        "id": str(uuid4()),
        "organization_id": 1,
        "user_id": str(uuid4()),
        "pitch": "I love tech!",
        "status": "pending",
        "created_at": "2026-06-07T00:00:00Z",
        "updated_at": "2026-06-07T00:00:00Z",
    }

    monkeypatch.setattr(organization_service, "create_join_request", lambda *a, **k: mock_join)

    resp = authenticated_client.post(
        "/organizations/1/join-requests", json={"pitch": "I love tech!"}
    )
    assert resp.status_code == 201
    assert resp.json()["pitch"] == "I love tech!"
    assert resp.json()["status"] == "pending"


def test_update_claim_success(admin_client, monkeypatch):
    claim_id = str(uuid4())
    mock_claim = {
        "id": claim_id,
        "organization_id": 1,
        "user_id": str(uuid4()),
        "executive_role": "President",
        "proof_url": "http://example.com/proof.png",
        "status": "approved",
        "created_at": "2026-06-07T00:00:00Z",
        "updated_at": "2026-06-07T00:00:00Z",
    }

    monkeypatch.setattr(
        organization_service,
        "update_claim",
        lambda cid, status, reason: {
            **mock_claim,
            "id": str(cid),
            "status": status,
            "rejection_reason": reason,
        },
    )

    resp = admin_client.patch(f"/organizations/claims/{claim_id}", json={"status": "approved"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


def test_list_claims_success(admin_client, monkeypatch):
    mock_claims = [
        {
            "id": str(uuid4()),
            "organization_id": 1,
            "user_id": str(uuid4()),
            "executive_role": "President",
            "proof_url": "http://example.com/proof.png",
            "status": "pending",
            "rejection_reason": None,
            "created_at": "2026-06-07T00:00:00Z",
            "updated_at": "2026-06-07T00:00:00Z",
        }
    ]

    monkeypatch.setattr(
        organization_service, "list_claims", lambda status=None, school=None: mock_claims
    )

    resp = admin_client.get("/organizations/claims")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["executive_role"] == "President"

    resp_filtered = admin_client.get("/organizations/claims?status=pending")
    assert resp_filtered.status_code == 200
    assert resp_filtered.json()[0]["status"] == "pending"
