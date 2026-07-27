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
):
    """Build an AuthResult that mimics a successful verification."""
    body = TokenResponse(
        access_token=access_token,
        expires_in=expires_in,
        user_id=user_id,
    )
    return AuthResult(body=body, refresh_token=refresh_token)


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
        mock_send = MagicMock()
        monkeypatch.setattr(auth, "send_otp", mock_send)

        resp = client.post("/auth/send-otp", json=VALID_SEND_OTP)

        assert resp.status_code == 200
        body = resp.json()
        assert "message" in body
        mock_send.assert_called_once_with(
            "student@uwaterloo.ca",
            invitation_token=None,
            return_to=None,
        )

    def test_send_otp_forwards_safe_relative_return_path(self, client, monkeypatch):
        mock_send = MagicMock()
        monkeypatch.setattr(auth, "send_otp", mock_send)

        response = client.post(
            "/auth/send-otp",
            json={
                **VALID_SEND_OTP,
                "return_to": "/promote?school=uwaterloo",
            },
        )

        assert response.status_code == 200
        mock_send.assert_called_once_with(
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
        mock_send = MagicMock()
        monkeypatch.setattr(auth, "send_otp", mock_send)

        response = client.post(
            "/auth/send-otp",
            json={
                **VALID_SEND_OTP,
                "return_to": return_to,
            },
        )

        assert response.status_code == 422
        mock_send.assert_not_called()

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
