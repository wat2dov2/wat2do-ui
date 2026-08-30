"""Tests for the auth router (/auth/*)."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, status
from fastapi.testclient import TestClient

from core.config import settings
from core.errors import (
    EMAIL_NOT_ALLOWED,
    INVALID_OR_EXPIRED_TOKEN,
    NO_REFRESH_TOKEN,
    SESSION_REFRESH_FAILED,
)
from core.exceptions import AuthenticationError
from core.rate_limit import (
    auth_refresh_rate_limiter,
    send_otp_rate_limiter,
    verify_otp_rate_limiter,
)
from main import app
from schemas.auth import MessageResponse, TokenResponse
from services.auth_service import AuthResult, auth

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_rate_limiters():
    """Reset in-memory rate limiter state between tests so they don't 429."""
    send_otp_rate_limiter._requests.clear()
    verify_otp_rate_limiter._requests.clear()
    auth_refresh_rate_limiter._requests.clear()
    yield
    send_otp_rate_limiter._requests.clear()
    verify_otp_rate_limiter._requests.clear()
    auth_refresh_rate_limiter._requests.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_SEND_OTP = {
    "email": "student@uwaterloo.ca",
}

VALID_VERIFY_OTP = {
    "email": "student@uwaterloo.ca",
    "token": "some-otp-token",
}


def _verify_result(
    *,
    access_token="acc-tok",
    expires_in=3600,
    user_id="uid-001",
    refresh_token="ref-tok",
    school=None,
    onboarding_required=False,
):
    """Build an AuthResult that mimics a successful verification."""
    body = TokenResponse(
        access_token=access_token,
        expires_in=expires_in,
        user_id=user_id,
        school=school,
        onboarding_required=onboarding_required,
    )
    return AuthResult(body=body, refresh_token=refresh_token)


# ===========================================================================
# GET /auth/google and /auth/google/callback
# ===========================================================================


class TestGoogleOAuth:
    CALLBACK_URL = "http://localhost:3000/api/auth/google/callback"

    def test_start_google_oauth_sets_pkce_state_and_redirects(
        self,
        client,
        monkeypatch,
    ):
        monkeypatch.setattr(settings, "cookie_secure", False)
        monkeypatch.setattr(
            auth,
            "prepare_google_oauth",
            MagicMock(
                return_value=SimpleNamespace(
                    authorization_url="https://accounts.example/authorize",
                    code_verifier="verifier",
                )
            ),
        )

        response = client.get(
            "/auth/google",
            params={
                "callback_url": self.CALLBACK_URL,
                "return_to": "/positions?school=uwaterloo",
            },
            follow_redirects=False,
        )

        assert response.status_code == 302
        assert response.headers["location"] == "https://accounts.example/authorize"
        assert response.cookies.get("google_oauth_state")
        set_cookie = response.headers["set-cookie"].lower()
        assert "httponly" in set_cookie
        assert "path=/api/auth/google/callback" in set_cookie
        auth.prepare_google_oauth.assert_called_once_with(self.CALLBACK_URL)

    @pytest.mark.parametrize(
        "callback_url",
        [
            "https://evil.example/api/auth/google/callback",
            "http://localhost:3000/auth/google/callback",
            "http://localhost:3000/api/auth/google/callback?next=evil",
        ],
    )
    def test_start_google_oauth_rejects_untrusted_callback(
        self,
        client,
        monkeypatch,
        callback_url,
    ):
        mock_prepare = MagicMock()
        monkeypatch.setattr(auth, "prepare_google_oauth", mock_prepare)

        response = client.get(
            "/auth/google",
            params={"callback_url": callback_url},
            follow_redirects=False,
        )

        assert response.status_code == 422
        mock_prepare.assert_not_called()

    def test_complete_google_oauth_sets_refresh_cookie_and_returns_to_app(
        self,
        client,
        monkeypatch,
    ):
        monkeypatch.setattr(settings, "cookie_secure", False)
        monkeypatch.setattr(
            auth,
            "prepare_google_oauth",
            MagicMock(
                return_value=SimpleNamespace(
                    authorization_url="https://accounts.example/authorize",
                    code_verifier="verifier",
                )
            ),
        )
        start_response = client.get(
            "/auth/google",
            params={
                "callback_url": self.CALLBACK_URL,
                "return_to": "/positions?school=uwaterloo",
            },
            follow_redirects=False,
        )
        state_cookie = start_response.cookies["google_oauth_state"]
        client.cookies.set("google_oauth_state", state_cookie)
        result = _verify_result(
            school="uwaterloo",
            onboarding_required=False,
        )
        monkeypatch.setattr(
            auth,
            "verify_google_oauth",
            MagicMock(return_value=result),
        )

        response = client.get(
            "/auth/google/callback",
            params={"code": "auth-code"},
            follow_redirects=False,
        )

        assert response.status_code == 303
        location = response.headers["location"]
        assert location.startswith("http://localhost:3000/auth/callback?")
        assert "oauth=google" in location
        assert "school=uwaterloo" in location
        assert "returnTo=%2Fpositions%3Fschool%3Duwaterloo" in location
        assert response.cookies.get("refresh_token") == "ref-tok"
        auth.verify_google_oauth.assert_called_once_with(
            "auth-code",
            "verifier",
            self.CALLBACK_URL,
        )

    def test_complete_google_oauth_without_pkce_state_returns_to_login(self, client):
        response = client.get(
            "/auth/google/callback",
            params={"code": "auth-code"},
            follow_redirects=False,
        )

        assert response.status_code == 303
        assert response.headers["location"] == ("http://localhost:3000/login?oauthError=google")


def _refresh_result(
    *,
    access_token="new-acc-tok",
    expires_in=3600,
    user_id="uid-001",
    refresh_token="new-ref-tok",
):
    """Build an AuthResult that mimics a successful token refresh."""
    body = TokenResponse(
        access_token=access_token,
        expires_in=expires_in,
        user_id=user_id,
    )
    return AuthResult(body=body, refresh_token=refresh_token)


# ===========================================================================
# POST /auth/send-otp
# ===========================================================================


class TestSendOtp:
    """Tests for the send-otp endpoint."""

    def test_send_otp_success(self, client, monkeypatch):
        """Successful send-otp returns 200 message."""
        mock_prepare = MagicMock()
        mock_dispatch = MagicMock(return_value=True)
        monkeypatch.setattr(auth, "prepare_otp_email", mock_prepare)
        monkeypatch.setattr("routers.auth.email_service.send_safely", mock_dispatch)

        resp = client.post("/auth/send-otp", json=VALID_SEND_OTP)

        assert resp.status_code == 200
        body = resp.json()
        assert "message" in body
        mock_prepare.assert_called_once_with(
            "student@uwaterloo.ca",
            invitation_token=None,
            return_to=None,
        )
        mock_dispatch.assert_called_once_with(mock_prepare.return_value)

    def test_send_otp_forwards_safe_relative_return_path(self, client, monkeypatch):
        mock_prepare = MagicMock()
        monkeypatch.setattr(auth, "prepare_otp_email", mock_prepare)
        monkeypatch.setattr("routers.auth.email_service.send_safely", MagicMock())

        response = client.post(
            "/auth/send-otp",
            json={
                **VALID_SEND_OTP,
                "return_to": "/promote?school=uwaterloo",
            },
        )

        assert response.status_code == 200
        mock_prepare.assert_called_once_with(
            "student@uwaterloo.ca",
            invitation_token=None,
            return_to="/promote?school=uwaterloo",
        )

    @pytest.mark.parametrize(
        "return_to",
        [
            "https://evil.example",
            "//evil.example",
            r"/safe\evil",
            "/safe%0AHeader:value",
            "/safe\u0085Header:value",
            "%252F%252Fevil.example",
        ],
    )
    def test_send_otp_rejects_unsafe_return_path(
        self,
        client,
        monkeypatch,
        return_to,
    ):
        mock_prepare = MagicMock()
        monkeypatch.setattr(auth, "prepare_otp_email", mock_prepare)

        response = client.post(
            "/auth/send-otp",
            json={
                **VALID_SEND_OTP,
                "return_to": return_to,
            },
        )

        assert response.status_code == 422
        mock_prepare.assert_not_called()

    def test_send_otp_rejects_plain_non_email_string(self, client):
        resp = client.post("/auth/send-otp", json={"email": "not-an-email"})
        assert resp.status_code == 422

    def test_send_otp_empty_body(self, client):
        resp = client.post("/auth/send-otp", json={})
        assert resp.status_code == 422


# ===========================================================================
# POST /auth/verify-otp
# ===========================================================================


class TestVerifyOtp:
    """Tests for the verify-otp endpoint."""

    def test_verify_otp_success(self, client, monkeypatch):
        """Successful verify-otp returns tokens and sets refresh cookie."""
        result = _verify_result()
        monkeypatch.setattr(auth, "verify_otp", MagicMock(return_value=result))

        resp = client.post("/auth/verify-otp", json=VALID_VERIFY_OTP)

        assert resp.status_code == 200
        body = resp.json()
        assert body["access_token"] == "acc-tok"
        assert body["expires_in"] == 3600
        assert body["user_id"] == "uid-001"
        assert body["token_type"] == "bearer"

        cookie = resp.cookies.get("refresh_token")
        assert cookie == "ref-tok"

    def test_verify_otp_invalid_token(self, client, monkeypatch):
        """Invalid token returns 401."""
        monkeypatch.setattr(
            auth,
            "verify_otp",
            MagicMock(side_effect=AuthenticationError(INVALID_OR_EXPIRED_TOKEN)),
        )

        resp = client.post("/auth/verify-otp", json=VALID_VERIFY_OTP)

        assert resp.status_code == 401
        assert resp.json()["detail"] == INVALID_OR_EXPIRED_TOKEN

    def test_verify_otp_missing_email(self, client):
        resp = client.post("/auth/verify-otp", json={"token": "tok"})
        assert resp.status_code == 422

    def test_verify_otp_missing_token(self, client):
        resp = client.post("/auth/verify-otp", json={"email": "student@uwaterloo.ca"})
        assert resp.status_code == 422


# ===========================================================================
# POST /auth/refresh
# ===========================================================================


class TestRefresh:
    """Tests for the token refresh endpoint."""

    ALLOWED_ORIGIN = "http://localhost:3000"

    def test_refresh_success(self, client, monkeypatch):
        """Valid refresh token in cookie returns new tokens and rotates the cookie."""
        result = _refresh_result()
        monkeypatch.setattr(auth, "refresh", MagicMock(return_value=result))

        resp = client.post(
            "/auth/refresh",
            cookies={"refresh_token": "old-tok"},
            headers={"Origin": self.ALLOWED_ORIGIN},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["access_token"] == "new-acc-tok"
        assert body["expires_in"] == 3600

        cookie = resp.cookies.get("refresh_token")
        assert cookie == "new-ref-tok"

    def test_refresh_allows_regex_origin(self, client, monkeypatch):
        result = _refresh_result()
        monkeypatch.setattr(auth, "refresh", MagicMock(return_value=result))
        monkeypatch.setattr(
            settings,
            "cors_origin_regex",
            r"^https://([a-z0-9-]+\.)?wat2do\.io$",
        )

        resp = client.post(
            "/auth/refresh",
            cookies={"refresh_token": "old-tok"},
            headers={"Origin": "https://mit.wat2do.io"},
        )

        assert resp.status_code == 200
        assert resp.json()["access_token"] == "new-acc-tok"

    def test_refresh_expired_token(self, client, monkeypatch):
        """Expired refresh token returns 401."""
        monkeypatch.setattr(
            auth,
            "refresh",
            MagicMock(side_effect=AuthenticationError(SESSION_REFRESH_FAILED)),
        )

        resp = client.post(
            "/auth/refresh",
            cookies={"refresh_token": "expired-tok"},
            headers={"Origin": self.ALLOWED_ORIGIN},
        )

        assert resp.status_code == 401
        assert resp.json()["detail"] == SESSION_REFRESH_FAILED


# ===========================================================================
# POST /auth/logout
# ===========================================================================


class TestLogout:
    """Tests for the logout endpoint."""

    def test_logout_with_bearer_token(self, client, monkeypatch):
        """Logout with Bearer token calls service and clears the cookie."""
        monkeypatch.setattr(auth, "logout", MagicMock())

        resp = client.post(
            "/auth/logout",
            headers={"Authorization": "Bearer my-token"},
            cookies={"refresh_token": "ref-tok"},
        )

        assert resp.status_code == 200
        auth.logout.assert_called_once_with("my-token")

        # The cookie must be deleted (expires set to past)
        cookie_header = resp.headers.get("set-cookie", "")
        assert "refresh_token=" in cookie_header
        assert "Max-Age=0" in cookie_header or "expires=" in cookie_header


# ===========================================================================
# Cookie behavior
# ===========================================================================


class TestCookieBehavior:
    """Cross-cutting tests for refresh token cookie handling."""

    def test_verify_otp_cookie_is_httponly(self, client, monkeypatch):
        """The refresh token cookie must be httpOnly to prevent XSS exfiltration."""
        result = _verify_result()
        monkeypatch.setattr(auth, "verify_otp", MagicMock(return_value=result))

        resp = client.post("/auth/verify-otp", json=VALID_VERIFY_OTP)

        set_cookie = resp.headers.get("set-cookie", "")
        assert "httponly" in set_cookie.lower()

    def test_verify_otp_cookie_path_is_auth(self, client, monkeypatch):
        """Cookie path is restricted to /auth to limit exposure."""
        result = _verify_result()
        monkeypatch.setattr(auth, "verify_otp", MagicMock(return_value=result))

        resp = client.post("/auth/verify-otp", json=VALID_VERIFY_OTP)

        set_cookie = resp.headers.get("set-cookie", "")
        assert "path=/auth" in set_cookie.lower()

    def test_verify_otp_cookie_samesite_lax(self, client, monkeypatch):
        """Cookie SameSite is lax for CSRF protection."""
        result = _verify_result()
        monkeypatch.setattr(auth, "verify_otp", MagicMock(return_value=result))

        resp = client.post("/auth/verify-otp", json=VALID_VERIFY_OTP)

        set_cookie = resp.headers.get("set-cookie", "")
        assert "samesite=lax" in set_cookie.lower()

    def test_legacy_frontend_receives_host_only_refresh_cookie(self, client, monkeypatch):
        result = _verify_result()
        monkeypatch.setattr(auth, "verify_otp", MagicMock(return_value=result))
        monkeypatch.setattr(settings, "cookie_domain", ".wat2do.io")

        response = client.post(
            "/auth/verify-otp",
            json=VALID_VERIFY_OTP,
            headers={"Origin": "https://wat2do.ca"},
        )

        set_cookie = response.headers.get("set-cookie", "").lower()
        assert "refresh_token=" in set_cookie
        assert "domain=" not in set_cookie

    def test_v2_frontend_retains_shared_cookie_domain(self, client, monkeypatch):
        result = _verify_result()
        monkeypatch.setattr(auth, "verify_otp", MagicMock(return_value=result))
        monkeypatch.setattr(settings, "cookie_domain", ".wat2do.io")

        response = client.post(
            "/auth/verify-otp",
            json=VALID_VERIFY_OTP,
            headers={"Origin": "https://wat2do.io"},
        )

        assert "domain=.wat2do.io" in response.headers.get("set-cookie", "").lower()
