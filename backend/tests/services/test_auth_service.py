from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from supabase_auth.errors import AuthApiError

from core.errors import INVALID_OR_EXPIRED_TOKEN
from core.exceptions import AuthenticationError
from services import auth_service
from services.auth_service import AuthResult, AuthService


@pytest.fixture(autouse=True)
def registered_school(monkeypatch):
    monkeypatch.setattr(
        auth_service.school_service,
        "get_school",
        lambda _school: SimpleNamespace(id=1),
    )


def test_send_otp_magic_link_preserves_safe_return_path(monkeypatch):
    mock_auth = MagicMock()
    mock_db = MagicMock()
    mock_db.table().select().eq().execute.return_value = MagicMock(data=[{"id": "user-id-123"}])
    link_result = MagicMock()
    link_result.properties.hashed_token = "hashed-token"
    link_result.properties.email_otp = "123456"
    mock_auth.admin.generate_link.return_value = link_result
    send = MagicMock(return_value=True)
    monkeypatch.setattr("services.email_service.email_service.send", send)
    service = AuthService(auth_client=mock_auth, db_client=mock_db)

    service.send_otp(
        "student@uwaterloo.ca",
        return_to="/promote?school=uwaterloo",
    )

    message = send.call_args.args[0]
    assert "returnTo=%2Fpromote%3Fschool%3Duwaterloo" in message.body_html
    assert "email=student%40uwaterloo.ca" in message.body_text


class TestAuthServiceVerifyOtp:
    def test_verify_otp_success_with_digit_token(self):
        """Verifies that numeric OTP codes (e.g. 6-digit or 8-digit) call verify_otp directly with the token."""
        mock_auth = MagicMock()
        mock_db = MagicMock()

        # Database mocks
        mock_query_res = MagicMock(
            data=[{"identifier": "student@uwaterloo.ca", "token": "hashed_val"}]
        )
        mock_db.table().select().eq().eq().gt().execute.return_value = mock_query_res

        # Supabase Auth response mock
        mock_session_res = MagicMock()
        mock_session_res.session.access_token = "access-token-xyz"
        mock_session_res.session.refresh_token = "refresh-token-abc"
        mock_session_res.session.expires_in = 3600
        mock_session_res.user.id = "user-id-123"
        mock_auth.verify_otp.return_value = mock_session_res

        # Mock public.users lookup
        mock_db.table().select().eq().execute.return_value = MagicMock(data=[{"id": "db-user-id"}])

        service = AuthService(auth_client=mock_auth, db_client=mock_db)

        # Act - using an 8-digit code
        res = service.verify_otp("student@uwaterloo.ca", "84928696")

        # Assert
        assert isinstance(res, AuthResult)
        assert res.body.access_token == "access-token-xyz"
        assert res.body.user_id == "user-id-123"
        assert res.refresh_token == "refresh-token-abc"

        # Verify it passed the digit check and called verify_otp with the code
        mock_auth.verify_otp.assert_called_once_with(
            {"email": "student@uwaterloo.ca", "token": "84928696", "type": "email"}
        )

    def test_verify_otp_success_with_hex_hash_token(self):
        """Verifies that non-numeric tokens (magic link hashes) call verify_otp with token_hash."""
        mock_auth = MagicMock()
        mock_db = MagicMock()

        # Database mocks
        mock_query_res = MagicMock(data=[{"identifier": "student@uwaterloo.ca", "token": "hash"}])
        mock_db.table().select().eq().eq().gt().execute.return_value = mock_query_res

        # Supabase Auth response mock
        mock_session_res = MagicMock()
        mock_session_res.session.access_token = "access-token-xyz"
        mock_session_res.session.refresh_token = "refresh-token-abc"
        mock_session_res.session.expires_in = 3600
        mock_session_res.user.id = "user-id-123"
        mock_auth.verify_otp.return_value = mock_session_res

        # Mock public.users lookup
        mock_db.table().select().eq().execute.return_value = MagicMock(data=[{"id": "db-user-id"}])

        service = AuthService(auth_client=mock_auth, db_client=mock_db)

        # Act - using a hex hash
        hex_hash = "d11d7ed56ea419565230232655b800c7d3f8ec0a02f71c34183f259e"
        res = service.verify_otp("student@uwaterloo.ca", hex_hash)

        # Assert
        assert res.body.access_token == "access-token-xyz"

        # Verify it passed token_hash instead of token since it is not digit-only
        mock_auth.verify_otp.assert_called_once_with({"token_hash": hex_hash, "type": "email"})

    def test_verify_otp_invalid_or_expired_in_db(self):
        """Verifies that if the token is missing/expired in the database, AuthenticationError is raised."""
        mock_auth = MagicMock()
        mock_db = MagicMock()

        # Database returns no matching verification tokens
        mock_db.table().select().eq().eq().gt().execute.return_value = MagicMock(data=[])

        service = AuthService(auth_client=mock_auth, db_client=mock_db)

        with pytest.raises(AuthenticationError) as exc_info:
            service.verify_otp("student@uwaterloo.ca", "123456")

        assert exc_info.value.detail == INVALID_OR_EXPIRED_TOKEN
        mock_auth.verify_otp.assert_not_called()

    def test_verify_otp_preserves_local_token_when_supabase_rejects(self):
        """Supabase failures should not consume the staged local token before retry/link fallback."""
        mock_auth = MagicMock()
        mock_db = MagicMock()

        mock_query_res = MagicMock(
            data=[{"identifier": "student@uwaterloo.ca", "token": "hashed_val"}]
        )
        mock_db.table().select().eq().eq().gt().execute.return_value = mock_query_res
        mock_auth.verify_otp.side_effect = AuthApiError("bad otp", 400, None)

        service = AuthService(auth_client=mock_auth, db_client=mock_db)

        with pytest.raises(AuthenticationError) as exc_info:
            service.verify_otp("student@uwaterloo.ca", "84928696")

        assert exc_info.value.detail == INVALID_OR_EXPIRED_TOKEN
        mock_db.table().delete.assert_not_called()

    def test_verify_otp_creates_tqiu_as_admin(self):
        """Verifies that verifying OTP for tqiu@uwaterloo.ca auto-promotes them to admin on creation."""
        mock_auth = MagicMock()
        mock_db = MagicMock()

        # Database mocks
        mock_query_res = MagicMock(
            data=[{"identifier": "tqiu@uwaterloo.ca", "token": "hashed_val"}]
        )
        mock_db.table().select().eq().eq().gt().execute.return_value = mock_query_res

        # Supabase Auth response mock
        mock_session_res = MagicMock()
        mock_session_res.session.access_token = "access-token-xyz"
        mock_session_res.session.refresh_token = "refresh-token-abc"
        mock_session_res.session.expires_in = 3600
        mock_session_res.user.id = "user-id-123"
        mock_auth.verify_otp.return_value = mock_session_res

        # Mock public.users lookup returns empty (user does not exist yet)
        mock_db.table().select().eq().execute.return_value = MagicMock(data=[])

        # Mock insert execution
        mock_insert = MagicMock()
        mock_db.table().insert.return_value = mock_insert

        service = AuthService(auth_client=mock_auth, db_client=mock_db)

        # Act
        service.verify_otp("tqiu@uwaterloo.ca", "84928696")

        # Assert
        # Verify the insert payload has role: admin
        insert_args = mock_db.table().insert.call_args[0][0]
        assert insert_args["email"] == "tqiu@uwaterloo.ca"
        assert insert_args["role"] == "admin"
