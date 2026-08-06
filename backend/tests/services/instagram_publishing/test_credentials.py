from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from core.exceptions import ValidationError
from services.instagram_publishing import credentials


class _Query:
    def __init__(self, rows, calls):
        self._data = rows
        self._calls = calls

    def __getattr__(self, name):
        def chain(*args, **kwargs):
            self._calls.append((name, args, kwargs))
            if name == "upsert":
                self._data = [args[0]]
            return self

        return chain

    def execute(self):
        return SimpleNamespace(data=self._data, count=len(self._data))


class _Database:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.calls = []

    def table(self, name):
        self.calls.append(("table", (name,), {}))
        return _Query(self.rows, self.calls)


@pytest.fixture
def encryption_key(monkeypatch):
    key = Fernet.generate_key().decode("ascii")
    monkeypatch.setattr(credentials.settings, "instagram_token_encryption_key", key)
    return key


def test_import_validates_identity_and_stores_only_ciphertext(monkeypatch, encryption_key):
    database = _Database()

    class _MetaClient:
        def __init__(self, access_token):
            assert access_token == "plaintext-token"

        def get_identity(self):
            return {
                "id": "17841476154506771",
                "username": "uwaterloo.wat2do.io",
            }

    monkeypatch.setattr(credentials, "MetaInstagramClient", _MetaClient)
    monkeypatch.setattr(credentials, "get_sb", lambda: database)
    monkeypatch.setattr(
        credentials.school_service,
        "get_school",
        lambda _slug: SimpleNamespace(id=1),
    )
    now = datetime(2026, 7, 26, 12, tzinfo=timezone.utc)

    result = credentials.import_access_token("plaintext-token", "uwaterloo", now_utc=now)

    upsert = next(call for call in database.calls if call[0] == "upsert")
    stored = upsert[1][0]
    assert stored["account_key"] == "uwaterloo"
    assert stored["school_id"] == 1
    assert "school" not in stored
    assert stored["instagram_username"] == "uwaterloo.wat2do.io"
    assert stored["encrypted_access_token"] != "plaintext-token"
    assert credentials._decrypt(stored["encrypted_access_token"]) == "plaintext-token"
    assert stored["expires_at"] == (now + timedelta(days=60)).isoformat()
    assert "plaintext-token" not in repr(result)


def test_import_rejects_an_account_key_that_is_not_a_registered_school(
    monkeypatch,
    encryption_key,
):
    class _MetaClient:
        def __init__(self, _access_token):
            raise AssertionError("Instagram must not be called for an unknown school")

    monkeypatch.setattr(credentials, "MetaInstagramClient", _MetaClient)
    monkeypatch.setattr(credentials.school_service, "get_school", lambda _slug: None)

    with pytest.raises(ValidationError, match="No registered school"):
        credentials.import_access_token("wrong-token", "not-a-school")


def test_import_records_a_renamed_handle_without_complaint(
    monkeypatch,
    encryption_key,
):
    """The handle is observed, not asserted - only the account key routes."""
    database = _Database()

    class _MetaClient:
        def __init__(self, _access_token):
            pass

        def get_identity(self):
            return {"id": "28288284760757940", "username": "wat2do.ca"}

    monkeypatch.setattr(credentials, "MetaInstagramClient", _MetaClient)
    monkeypatch.setattr(credentials, "get_sb", lambda: database)
    monkeypatch.setattr(
        credentials.school_service,
        "get_school",
        lambda _slug: SimpleNamespace(id=1),
    )

    credentials.import_access_token("plaintext-token", "uwaterloo")

    stored = next(call for call in database.calls if call[0] == "upsert")[1][0]
    assert stored["account_key"] == "uwaterloo"
    assert stored["instagram_username"] == "wat2do.ca"
    assert stored["instagram_user_id"] == "28288284760757940"


def test_load_credentials_decrypts_only_the_requested_account(
    monkeypatch,
    encryption_key,
):
    now = datetime(2026, 7, 26, 12, tzinfo=timezone.utc)
    row = {
        "account_key": "dalhousie",
        "school": "dalhousie",
        "instagram_user_id": "37640733598873542",
        "instagram_username": "dalhousie.wat2do.io",
        "encrypted_access_token": credentials._encrypt("dalhousie-token"),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "requires_reauthorization": False,
    }
    database = _Database([row])
    monkeypatch.setattr(credentials, "get_sb", lambda: database)
    result = credentials.load_account_credentials("dalhousie", now_utc=now)

    assert result.account_key == "dalhousie"
    assert result.access_token == "dalhousie-token"
    assert ("eq", ("account_key", "dalhousie"), {}) in database.calls


def test_refresh_replaces_token_and_expiry_after_revalidating_identity(
    monkeypatch,
    encryption_key,
):
    now = datetime(2026, 7, 26, 12, tzinfo=timezone.utc)
    row = {
        "account_key": "dalhousie",
        "school": "dalhousie",
        "instagram_user_id": "37640733598873542",
        "instagram_username": "dalhousie.wat2do.io",
        "encrypted_access_token": credentials._encrypt("current-token"),
        "expires_at": (now + timedelta(days=2)).isoformat(),
        "requires_reauthorization": False,
    }
    database = _Database([row])

    class _MetaClient:
        def __init__(self, access_token):
            self.access_token = access_token

        def refresh_access_token(self):
            assert self.access_token == "current-token"
            return {"access_token": "refreshed-token", "expires_in": 5_184_000}

        def get_identity(self):
            assert self.access_token == "refreshed-token"
            return {
                "id": "37640733598873542",
                "username": "dalhousie.wat2do.io",
            }

    monkeypatch.setattr(credentials, "MetaInstagramClient", _MetaClient)
    monkeypatch.setattr(credentials, "get_sb", lambda: database)

    stats = credentials.refresh_expiring_tokens(now)

    assert stats == {"due": 1, "refreshed": 1, "failed": 0}
    update = next(call for call in database.calls if call[0] == "update")
    fields = update[1][0]
    assert credentials._decrypt(fields["encrypted_access_token"]) == "refreshed-token"
    assert fields["expires_at"] == (now + timedelta(seconds=5_184_000)).isoformat()
    assert fields["requires_reauthorization"] is False


def test_refresh_failure_marks_only_that_account_for_reauthorization(
    monkeypatch,
    encryption_key,
):
    now = datetime(2026, 7, 26, 12, tzinfo=timezone.utc)
    row = {
        "account_key": "dalhousie",
        "school": "dalhousie",
        "instagram_user_id": "37640733598873542",
        "instagram_username": "dalhousie.wat2do.io",
        "encrypted_access_token": credentials._encrypt("sensitive-token"),
        "expires_at": (now + timedelta(days=2)).isoformat(),
        "requires_reauthorization": False,
    }
    database = _Database([row])

    class _MetaClient:
        def __init__(self, _access_token):
            pass

        def refresh_access_token(self):
            raise RuntimeError("revoked sensitive-token")

    monkeypatch.setattr(credentials, "MetaInstagramClient", _MetaClient)
    monkeypatch.setattr(credentials, "get_sb", lambda: database)

    stats = credentials.refresh_expiring_tokens(now)

    assert stats == {"due": 1, "refreshed": 0, "failed": 1}
    update = next(call for call in database.calls if call[0] == "update")
    fields = update[1][0]
    assert fields["requires_reauthorization"] is True
    assert fields["refresh_error"] == "revoked [REDACTED]"
    assert "sensitive-token" not in str(database.calls)
