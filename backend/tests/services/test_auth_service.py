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


def test_prepare_otp_email_preserves_safe_return_path(monkeypatch):
    mock_auth = MagicMock()
    mock_db = MagicMock()
    mock_db.table().select().eq().execute.return_value = MagicMock(
        data=[
            {
                "id": "user-id-123",
                "school_record": {"slug": "uwaterloo"},
            }
        ]
    )
    link_result = MagicMock()
    link_result.properties.hashed_token = "hashed-token"
    link_result.properties.email_otp = "123456"
    mock_auth.admin.generate_link.return_value = link_result
    monkeypatch.setattr(
        "services.school_context.settings.frontend_url",
        "https://wat2do.io",
    )
    service = AuthService(auth_client=mock_auth, db_client=mock_db)

    message = service.prepare_otp_email(
        "student@uwaterloo.ca",
        return_to="/promote?school=uwaterloo",
    )

    assert "https://uwaterloo.wat2do.io/auth/callback" in message.body_html
    assert "returnTo=%2Fpromote%3Fschool%3Duwaterloo" in message.body_html
    assert "email=student%40uwaterloo.ca" in message.body_text


def test_prepare_google_oauth_captures_request_pkce_verifier(monkeypatch):
    service = AuthService(auth_client=MagicMock(), db_client=MagicMock())
    oauth_client = MagicMock()
    oauth_client.sign_in_with_oauth.return_value = SimpleNamespace(
        url="https://accounts.example/authorize"
    )

    def create_oauth_client(storage=None):
        assert storage is not None
        storage.set_item("supabase.auth.token-code-verifier", "pkce-verifier")
        return oauth_client

    monkeypatch.setattr(service, "_new_oauth_auth", create_oauth_client)

    result = service.prepare_google_oauth("https://uwaterloo.wat2do.io/api/auth/google/callback")

    assert result.authorization_url == "https://accounts.example/authorize"
    assert result.code_verifier == "pkce-verifier"
    oauth_client.sign_in_with_oauth.assert_called_once_with(
        {
            "provider": "google",
            "options": {"redirect_to": ("https://uwaterloo.wat2do.io/api/auth/google/callback")},
        }
    )


def test_verify_google_oauth_uses_shared_user_completion(monkeypatch):
    mock_db = MagicMock()
    mock_db.table().select().eq().execute.return_value = MagicMock(
        data=[
            {
                "id": "db-user-id",
                "email": "student@uwaterloo.ca",
                "school_record": {"slug": "uwaterloo"},
            }
        ]
    )
    oauth_client = MagicMock()
    oauth_response = MagicMock()
    oauth_response.session.access_token = "google-access-token"
    oauth_response.session.refresh_token = "google-refresh-token"
    oauth_response.session.expires_in = 3600
    oauth_response.user.id = "supabase-user-id"
    oauth_response.user.email = "Student@UWaterloo.ca"
    oauth_client.exchange_code_for_session.return_value = oauth_response
    service = AuthService(auth_client=MagicMock(), db_client=mock_db)
    monkeypatch.setattr(service, "_new_oauth_auth", lambda storage=None: oauth_client)

    result = service.verify_google_oauth(
        "auth-code",
        "pkce-verifier",
        "https://uwaterloo.wat2do.io/api/auth/google/callback",
    )

    assert result.body.access_token == "google-access-token"
    assert result.body.school == "uwaterloo"
    assert result.body.onboarding_required is False
    assert result.refresh_token == "google-refresh-token"
    oauth_client.exchange_code_for_session.assert_called_once_with(
        {
            "auth_code": "auth-code",
            "code_verifier": "pkce-verifier",
            "redirect_to": ("https://uwaterloo.wat2do.io/api/auth/google/callback"),
        }
    )


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
        mock_db.table().select().eq().execute.return_value = MagicMock(
            data=[
                {
                    "id": "db-user-id",
                    "school_record": {"slug": "uwaterloo"},
                }
            ]
        )

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
        mock_db.table().select().eq().execute.return_value = MagicMock(
            data=[
                {
                    "id": "db-user-id",
                    "school_record": {"slug": "uwaterloo"},
                }
            ]
        )

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

    def test_verify_otp_uses_existing_users_assigned_school(self, monkeypatch):
        mock_auth = MagicMock()
        mock_db = MagicMock()
        mock_db.table().select().eq().eq().gt().execute.return_value = MagicMock(
            data=[{"identifier": "legacy@gmail.com", "token": "hashed_val"}]
        )
        mock_db.table().select().eq().execute.return_value = MagicMock(
            data=[
                {
                    "id": "db-user-id",
                    "school_record": {"slug": "uwaterloo"},
                }
            ]
        )

        session = MagicMock()
        session.session.access_token = "access-token-xyz"
        session.session.refresh_token = "refresh-token-abc"
        session.session.expires_in = 3600
        session.user.id = "auth-user-id"
        mock_auth.verify_otp.return_value = session
        monkeypatch.setattr(auth_service, "get_school_for_email", MagicMock(return_value=None))

        result = AuthService(auth_client=mock_auth, db_client=mock_db).verify_otp(
            "legacy@gmail.com",
            "84928696",
        )

        assert result.body.school == "uwaterloo"
        assert result.body.onboarding_required is False
