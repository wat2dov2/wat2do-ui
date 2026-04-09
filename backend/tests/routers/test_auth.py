"""Tests for the auth router (/auth/*)."""

import pytest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, status
from fastapi.testclient import TestClient

from core.errors import (
    EMAIL_NOT_ALLOWED,
    EMAIL_OR_USERNAME_TAKEN,
    INVALID_EMAIL_OR_PASSWORD,
    INVALID_OR_EXPIRED_TOKEN,
    NO_REFRESH_TOKEN,
    PASSWORD_RESET_FAILED,
    SESSION_REFRESH_FAILED,
    SIGNUP_FAILED,
)
from core.rate_limit import (
    auth_rate_limiter,
    auth_refresh_rate_limiter,
    auth_sensitive_rate_limiter,
)
from main import app
from schemas.auth import SignupResponse, TokenResponse
from services.auth_service import AuthResult, auth


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_rate_limiters():
    """Reset in-memory rate limiter state between tests so they don't 429."""
    auth_rate_limiter._requests.clear()
    auth_refresh_rate_limiter._requests.clear()
    auth_sensitive_rate_limiter._requests.clear()
    yield
    auth_rate_limiter._requests.clear()
    auth_refresh_rate_limiter._requests.clear()
    auth_sensitive_rate_limiter._requests.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_SIGNUP = {
    "email": "student@uwaterloo.ca",
    "password": "Str0ngP@ss!",
    "username": "newstudent",
    "full_name": "New Student",
}

VALID_LOGIN = {
    "email": "student@uwaterloo.ca",
    "password": "Str0ngP@ss!",
}


def _signup_result(
    *, user_id="user-001", access_token="acc-tok", expires_in=3600, refresh_token="ref-tok",
    confirmation_required=False,
):
    """Build an AuthResult that mimics a successful signup."""
    body = SignupResponse(
        user_id=user_id,
        access_token=access_token if not confirmation_required else None,
        expires_in=expires_in if not confirmation_required else None,
        confirmation_required=confirmation_required,
    )
    return AuthResult(body=body, refresh_token=refresh_token if not confirmation_required else None)


def _login_result(
    *, access_token="acc-tok", expires_in=3600, user_id="uid-001", refresh_token="ref-tok",
):
    """Build an AuthResult that mimics a successful login."""
    body = TokenResponse(
        access_token=access_token,
        expires_in=expires_in,
        user_id=user_id,
    )
    return AuthResult(body=body, refresh_token=refresh_token)


def _refresh_result(
    *, access_token="new-acc-tok", expires_in=3600, user_id="uid-001", refresh_token="new-ref-tok",
):
    """Build an AuthResult that mimics a successful token refresh."""
    body = TokenResponse(
        access_token=access_token,
        expires_in=expires_in,
        user_id=user_id,
    )
    return AuthResult(body=body, refresh_token=refresh_token)


# ===========================================================================
# POST /auth/signup
# ===========================================================================


class TestSignup:
    """Tests for the signup endpoint."""

    def test_signup_success_with_session(self, client, monkeypatch):
        """Successful signup returns user_id, access_token, and sets refresh cookie."""
        result = _signup_result()
        monkeypatch.setattr(auth, "signup", MagicMock(return_value=result))

        resp = client.post("/auth/signup", json=VALID_SIGNUP)

        assert resp.status_code == 200
        body = resp.json()
        assert body["user_id"] == "user-001"
        assert body["access_token"] == "acc-tok"
        assert body["expires_in"] == 3600
        assert body["token_type"] == "bearer"
        assert body["confirmation_required"] is False

        # Refresh token must be set as a cookie
        cookie = resp.cookies.get("refresh_token")
        assert cookie == "ref-tok"

    def test_signup_confirmation_required(self, client, monkeypatch):
        """Signup that requires email confirmation returns no token and no cookie."""
        result = _signup_result(confirmation_required=True)
        monkeypatch.setattr(auth, "signup", MagicMock(return_value=result))

        resp = client.post("/auth/signup", json=VALID_SIGNUP)

        assert resp.status_code == 200
        body = resp.json()
        assert body["confirmation_required"] is True
        assert body["access_token"] is None
        assert body["expires_in"] is None
        # No refresh cookie when confirmation is required
        assert "refresh_token" not in resp.cookies

    def test_signup_disallowed_email(self, client, monkeypatch):
        """Signup with a non-university email is rejected by the service with 403."""
        monkeypatch.setattr(
            auth,
            "signup",
            MagicMock(
                side_effect=HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=EMAIL_NOT_ALLOWED,
                )
            ),
        )

        data = {**VALID_SIGNUP, "email": "user@gmail.com"}
        resp = client.post("/auth/signup", json=data)

        assert resp.status_code == 403
        assert resp.json()["detail"] == EMAIL_NOT_ALLOWED

    def test_signup_duplicate_email_or_username(self, client, monkeypatch):
        """Signup with an already-taken email or username returns 409."""
        monkeypatch.setattr(
            auth,
            "signup",
            MagicMock(
                side_effect=HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=EMAIL_OR_USERNAME_TAKEN,
                )
            ),
        )

        resp = client.post("/auth/signup", json=VALID_SIGNUP)

        assert resp.status_code == 409
        assert resp.json()["detail"] == EMAIL_OR_USERNAME_TAKEN

    def test_signup_auth_provider_failure(self, client, monkeypatch):
        """Upstream auth failure returns 400."""
        monkeypatch.setattr(
            auth,
            "signup",
            MagicMock(
                side_effect=HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=SIGNUP_FAILED,
                )
            ),
        )

        resp = client.post("/auth/signup", json=VALID_SIGNUP)

        assert resp.status_code == 400
        assert resp.json()["detail"] == SIGNUP_FAILED

    def test_signup_missing_email(self, client):
        """Missing email field returns 422 validation error."""
        data = {"password": "Str0ngP@ss!", "username": "x"}
        resp = client.post("/auth/signup", json=data)
        assert resp.status_code == 422

    def test_signup_missing_password(self, client):
        """Missing password field returns 422 validation error."""
        data = {"email": "student@uwaterloo.ca"}
        resp = client.post("/auth/signup", json=data)
        assert resp.status_code == 422

    def test_signup_optional_fields_omitted(self, client, monkeypatch):
        """Username and full_name are optional -- signup works without them."""
        result = _signup_result()
        monkeypatch.setattr(auth, "signup", MagicMock(return_value=result))

        data = {"email": "student@uwaterloo.ca", "password": "Str0ngP@ss!"}
        resp = client.post("/auth/signup", json=data)

        assert resp.status_code == 200
        assert resp.json()["user_id"] == "user-001"


# ===========================================================================
# POST /auth/login
# ===========================================================================


class TestLogin:
    """Tests for the login endpoint."""

    def test_login_success(self, client, monkeypatch):
        """Successful login returns tokens and sets refresh cookie."""
        result = _login_result()
        monkeypatch.setattr(auth, "login", MagicMock(return_value=result))

        resp = client.post("/auth/login", json=VALID_LOGIN)

        assert resp.status_code == 200
        body = resp.json()
        assert body["access_token"] == "acc-tok"
        assert body["expires_in"] == 3600
        assert body["user_id"] == "uid-001"
        assert body["token_type"] == "bearer"

        cookie = resp.cookies.get("refresh_token")
        assert cookie == "ref-tok"

    def test_login_invalid_credentials(self, client, monkeypatch):
        """Wrong password returns 401."""
        monkeypatch.setattr(
            auth,
            "login",
            MagicMock(
                side_effect=HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=INVALID_EMAIL_OR_PASSWORD,
                )
            ),
        )

        resp = client.post("/auth/login", json=VALID_LOGIN)

        assert resp.status_code == 401
        assert resp.json()["detail"] == INVALID_EMAIL_OR_PASSWORD

    def test_login_missing_email(self, client):
        """Missing email field returns 422."""
        resp = client.post("/auth/login", json={"password": "x"})
        assert resp.status_code == 422

    def test_login_missing_password(self, client):
        """Missing password field returns 422."""
        resp = client.post("/auth/login", json={"email": "a@uwaterloo.ca"})
        assert resp.status_code == 422

    def test_login_empty_body(self, client):
        """Empty JSON body returns 422."""
        resp = client.post("/auth/login", json={})
        assert resp.status_code == 422


# ===========================================================================
# POST /auth/refresh
# ===========================================================================


class TestRefresh:
    """Tests for the token refresh endpoint."""

    def test_refresh_success(self, client, monkeypatch):
        """Valid refresh token in cookie returns new tokens and rotates the cookie."""
        result = _refresh_result()
        monkeypatch.setattr(auth, "refresh", MagicMock(return_value=result))

        # Send the refresh token as a cookie
        resp = client.post(
            "/auth/refresh",
            cookies={"refresh_token": "old-ref-tok"},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["access_token"] == "new-acc-tok"
        assert body["expires_in"] == 3600
        assert body["user_id"] == "uid-001"

        # Cookie must be rotated to the new refresh token
        cookie = resp.cookies.get("refresh_token")
        assert cookie == "new-ref-tok"

        # Verify the service was called with the old token
        auth.refresh.assert_called_once_with("old-ref-tok")

    def test_refresh_no_cookie(self, client):
        """Missing refresh_token cookie returns 401 with NO_REFRESH_TOKEN."""
        resp = client.post("/auth/refresh")

        assert resp.status_code == 401
        assert resp.json()["detail"] == NO_REFRESH_TOKEN

    def test_refresh_expired_token(self, client, monkeypatch):
        """Expired/invalid refresh token returns 401."""
        monkeypatch.setattr(
            auth,
            "refresh",
            MagicMock(
                side_effect=HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=SESSION_REFRESH_FAILED,
                )
            ),
        )

        resp = client.post(
            "/auth/refresh",
            cookies={"refresh_token": "expired-tok"},
        )

        assert resp.status_code == 401
        assert resp.json()["detail"] == SESSION_REFRESH_FAILED


# ===========================================================================
# POST /auth/logout
# ===========================================================================


class TestLogout:
    """Tests for the logout endpoint."""

    def test_logout_success(self, client, monkeypatch):
        """Successful logout clears the refresh cookie and returns message."""
        monkeypatch.setattr(auth, "logout", MagicMock())

        resp = client.post(
            "/auth/logout",
            headers={"Authorization": "Bearer valid-access-tok"},
        )

        assert resp.status_code == 200
        assert resp.json()["message"] == "Logged out successfully"

        # The refresh cookie must be cleared (set with max_age=0 or deleted)
        set_cookie_header = resp.headers.get("set-cookie", "")
        assert "refresh_token" in set_cookie_header
        # Deletion sets the value to empty/null and max-age=0
        assert 'max-age=0' in set_cookie_header.lower() or '""' in set_cookie_header

        auth.logout.assert_called_once_with("valid-access-tok")

    def test_logout_missing_bearer_token(self, client):
        """Logout without Authorization header returns 401 (no credentials)."""
        resp = client.post("/auth/logout")
        assert resp.status_code in (401, 403)  # depends on FastAPI/Starlette version

    def test_logout_invalid_token(self, client, monkeypatch):
        """Logout with an invalid/expired access token returns 400."""
        monkeypatch.setattr(
            auth,
            "logout",
            MagicMock(
                side_effect=HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=INVALID_OR_EXPIRED_TOKEN,
                )
            ),
        )

        resp = client.post(
            "/auth/logout",
            headers={"Authorization": "Bearer bad-tok"},
        )

        assert resp.status_code == 400
        assert resp.json()["detail"] == INVALID_OR_EXPIRED_TOKEN


# ===========================================================================
# POST /auth/forgot-password
# ===========================================================================


class TestForgotPassword:
    """Tests for the forgot-password endpoint."""

    def test_forgot_password_success(self, client, monkeypatch):
        """Always returns generic message to prevent email enumeration."""
        monkeypatch.setattr(auth, "forgot_password", MagicMock())

        resp = client.post(
            "/auth/forgot-password",
            json={"email": "student@uwaterloo.ca"},
        )

        assert resp.status_code == 200
        assert "reset link" in resp.json()["message"].lower()
        auth.forgot_password.assert_called_once_with("student@uwaterloo.ca")

    def test_forgot_password_nonexistent_email(self, client, monkeypatch):
        """Non-existent email still returns 200 (no enumeration leak)."""
        monkeypatch.setattr(auth, "forgot_password", MagicMock())

        resp = client.post(
            "/auth/forgot-password",
            json={"email": "nobody@uwaterloo.ca"},
        )

        assert resp.status_code == 200
        assert "reset link" in resp.json()["message"].lower()

    def test_forgot_password_missing_email(self, client):
        """Missing email field returns 422."""
        resp = client.post("/auth/forgot-password", json={})
        assert resp.status_code == 422


# ===========================================================================
# POST /auth/reset-password
# ===========================================================================


class TestResetPassword:
    """Tests for the reset-password endpoint."""

    def test_reset_password_success(self, client, monkeypatch):
        """Successful reset clears the refresh cookie."""
        monkeypatch.setattr(auth, "reset_password", MagicMock())

        resp = client.post(
            "/auth/reset-password",
            json={"access_token": "reset-tok", "new_password": "N3wP@ss!"},
        )

        assert resp.status_code == 200
        assert "password updated" in resp.json()["message"].lower()

        # Refresh cookie must be cleared after password reset
        set_cookie_header = resp.headers.get("set-cookie", "")
        assert "refresh_token" in set_cookie_header
        assert 'max-age=0' in set_cookie_header.lower() or '""' in set_cookie_header

    def test_reset_password_invalid_token(self, client, monkeypatch):
        """Invalid/expired reset token returns 401."""
        monkeypatch.setattr(
            auth,
            "reset_password",
            MagicMock(
                side_effect=HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=INVALID_OR_EXPIRED_TOKEN,
                )
            ),
        )

        resp = client.post(
            "/auth/reset-password",
            json={"access_token": "bad-tok", "new_password": "N3wP@ss!"},
        )

        assert resp.status_code == 401
        assert resp.json()["detail"] == INVALID_OR_EXPIRED_TOKEN

    def test_reset_password_provider_failure(self, client, monkeypatch):
        """Upstream password update failure returns 400."""
        monkeypatch.setattr(
            auth,
            "reset_password",
            MagicMock(
                side_effect=HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=PASSWORD_RESET_FAILED,
                )
            ),
        )

        resp = client.post(
            "/auth/reset-password",
            json={"access_token": "valid-tok", "new_password": "N3wP@ss!"},
        )

        assert resp.status_code == 400
        assert resp.json()["detail"] == PASSWORD_RESET_FAILED

    def test_reset_password_missing_access_token(self, client):
        """Missing access_token returns 422."""
        resp = client.post(
            "/auth/reset-password",
            json={"new_password": "N3wP@ss!"},
        )
        assert resp.status_code == 422

    def test_reset_password_missing_new_password(self, client):
        """Missing new_password returns 422."""
        resp = client.post(
            "/auth/reset-password",
            json={"access_token": "reset-tok"},
        )
        assert resp.status_code == 422


# ===========================================================================
# Cookie behavior
# ===========================================================================


class TestCookieBehavior:
    """Cross-cutting tests for refresh token cookie handling."""

    def test_login_cookie_is_httponly(self, client, monkeypatch):
        """The refresh token cookie must be httpOnly to prevent XSS exfiltration."""
        result = _login_result()
        monkeypatch.setattr(auth, "login", MagicMock(return_value=result))

        resp = client.post("/auth/login", json=VALID_LOGIN)

        set_cookie = resp.headers.get("set-cookie", "")
        assert "httponly" in set_cookie.lower()

    def test_login_cookie_path_is_auth(self, client, monkeypatch):
        """Cookie path is restricted to /auth to limit exposure."""
        result = _login_result()
        monkeypatch.setattr(auth, "login", MagicMock(return_value=result))

        resp = client.post("/auth/login", json=VALID_LOGIN)

        set_cookie = resp.headers.get("set-cookie", "")
        assert "path=/auth" in set_cookie.lower()

    def test_login_cookie_samesite_lax(self, client, monkeypatch):
        """Cookie SameSite is lax for CSRF protection while allowing top-level navigations."""
        result = _login_result()
        monkeypatch.setattr(auth, "login", MagicMock(return_value=result))

        resp = client.post("/auth/login", json=VALID_LOGIN)

        set_cookie = resp.headers.get("set-cookie", "")
        assert "samesite=lax" in set_cookie.lower()

    def test_signup_also_sets_refresh_cookie(self, client, monkeypatch):
        """Signup with immediate session also sets refresh cookie."""
        result = _signup_result()
        monkeypatch.setattr(auth, "signup", MagicMock(return_value=result))

        resp = client.post("/auth/signup", json=VALID_SIGNUP)

        cookie = resp.cookies.get("refresh_token")
        assert cookie == "ref-tok"

    def test_refresh_rotates_cookie(self, client, monkeypatch):
        """After refresh, the old cookie is replaced with the new one."""
        result = _refresh_result(refresh_token="rotated-tok")
        monkeypatch.setattr(auth, "refresh", MagicMock(return_value=result))

        resp = client.post(
            "/auth/refresh",
            cookies={"refresh_token": "old-tok"},
        )

        cookie = resp.cookies.get("refresh_token")
        assert cookie == "rotated-tok"


# ===========================================================================
# Response shape validation
# ===========================================================================


class TestResponseShapes:
    """Verify response bodies conform to schema contracts."""

    def test_login_response_has_all_token_fields(self, client, monkeypatch):
        """TokenResponse must include access_token, token_type, expires_in, user_id."""
        result = _login_result()
        monkeypatch.setattr(auth, "login", MagicMock(return_value=result))

        body = client.post("/auth/login", json=VALID_LOGIN).json()

        assert "access_token" in body
        assert "token_type" in body
        assert "expires_in" in body
        assert "user_id" in body

    def test_signup_response_has_all_fields(self, client, monkeypatch):
        """SignupResponse must include user_id, confirmation_required, and optionally tokens."""
        result = _signup_result()
        monkeypatch.setattr(auth, "signup", MagicMock(return_value=result))

        body = client.post("/auth/signup", json=VALID_SIGNUP).json()

        assert "user_id" in body
        assert "confirmation_required" in body
        assert "token_type" in body

    def test_logout_response_shape(self, client, monkeypatch):
        """Logout returns MessageResponse with 'message' key."""
        monkeypatch.setattr(auth, "logout", MagicMock())

        body = client.post(
            "/auth/logout",
            headers={"Authorization": "Bearer tok"},
        ).json()

        assert "message" in body
        assert isinstance(body["message"], str)

    def test_forgot_password_response_shape(self, client, monkeypatch):
        """Forgot-password returns MessageResponse."""
        monkeypatch.setattr(auth, "forgot_password", MagicMock())

        body = client.post(
            "/auth/forgot-password",
            json={"email": "student@uwaterloo.ca"},
        ).json()

        assert "message" in body

    def test_reset_password_response_shape(self, client, monkeypatch):
        """Reset-password returns MessageResponse."""
        monkeypatch.setattr(auth, "reset_password", MagicMock())

        body = client.post(
            "/auth/reset-password",
            json={"access_token": "tok", "new_password": "N3wP@ss!"},
        ).json()

        assert "message" in body


# ===========================================================================
# Service call verification
# ===========================================================================


class TestServiceCallArgs:
    """Verify the router passes the right arguments to the auth service."""

    def test_signup_passes_request_data_to_service(self, client, monkeypatch):
        """The router must forward the full SignupRequest to auth.signup."""
        result = _signup_result()
        mock_signup = MagicMock(return_value=result)
        monkeypatch.setattr(auth, "signup", mock_signup)

        client.post("/auth/signup", json=VALID_SIGNUP)

        mock_signup.assert_called_once()
        arg = mock_signup.call_args[0][0]
        assert arg.email == VALID_SIGNUP["email"]
        assert arg.password == VALID_SIGNUP["password"]
        assert arg.username == VALID_SIGNUP["username"]
        assert arg.full_name == VALID_SIGNUP["full_name"]

    def test_login_passes_request_data_to_service(self, client, monkeypatch):
        """The router must forward the full LoginRequest to auth.login."""
        result = _login_result()
        mock_login = MagicMock(return_value=result)
        monkeypatch.setattr(auth, "login", mock_login)

        client.post("/auth/login", json=VALID_LOGIN)

        mock_login.assert_called_once()
        arg = mock_login.call_args[0][0]
        assert arg.email == VALID_LOGIN["email"]
        assert arg.password == VALID_LOGIN["password"]

    def test_refresh_passes_cookie_token_to_service(self, client, monkeypatch):
        """The router must extract the cookie and pass the raw token string."""
        result = _refresh_result()
        mock_refresh = MagicMock(return_value=result)
        monkeypatch.setattr(auth, "refresh", mock_refresh)

        client.post("/auth/refresh", cookies={"refresh_token": "the-token"})

        mock_refresh.assert_called_once_with("the-token")

    def test_logout_passes_bearer_credentials_to_service(self, client, monkeypatch):
        """The router must extract the Bearer token and pass it to auth.logout."""
        monkeypatch.setattr(auth, "logout", MagicMock())

        client.post(
            "/auth/logout",
            headers={"Authorization": "Bearer my-access-tok"},
        )

        auth.logout.assert_called_once_with("my-access-tok")

    def test_forgot_password_passes_email_to_service(self, client, monkeypatch):
        """The router extracts the email from the body and passes it to the service."""
        monkeypatch.setattr(auth, "forgot_password", MagicMock())

        client.post(
            "/auth/forgot-password",
            json={"email": "student@uwaterloo.ca"},
        )

        auth.forgot_password.assert_called_once_with("student@uwaterloo.ca")

    def test_reset_password_passes_request_data_to_service(self, client, monkeypatch):
        """The router forwards the full ResetPasswordRequest to the service."""
        monkeypatch.setattr(auth, "reset_password", MagicMock())

        client.post(
            "/auth/reset-password",
            json={"access_token": "tok-123", "new_password": "NewP@ss1"},
        )

        auth.reset_password.assert_called_once()
        arg = auth.reset_password.call_args[0][0]
        assert arg.access_token == "tok-123"
        assert arg.new_password == "NewP@ss1"
