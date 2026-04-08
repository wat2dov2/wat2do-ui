"""Auth via Supabase (auth + users table). Sync."""

import uuid

from fastapi import HTTPException, status
from postgrest.exceptions import APIError
from supabase_auth.errors import AuthApiError

from core.allowed_emails import get_school_for_email, is_email_allowed
from core.constants import PG_UNIQUE_VIOLATION
from core.database import supabase, supabase_admin, get_sb
from core.errors import (
    EMAIL_NOT_ALLOWED,
    EMAIL_OR_USERNAME_TAKEN,
    INVALID_EMAIL_OR_PASSWORD,
    INVALID_OR_EXPIRED_TOKEN,
    PASSWORD_RESET_FAILED,
    SESSION_REFRESH_FAILED,
    SIGNUP_FAILED,
)
from core.logging import logger
from core.tables import USERS
from schemas.auth import (
    SignupRequest,
    SignupResponse,
    LoginRequest,
    ResetPasswordRequest,
    TokenResponse,
)


class AuthResult:
    """Carries the JSON response body *and* the raw refresh token for cookie setting."""

    def __init__(self, body, refresh_token: str | None = None):
        self.body = body
        self.refresh_token = refresh_token


class AuthService:
    def __init__(self, auth_client, db_client):
        self._auth = auth_client
        self._db = db_client

    def signup(self, data: SignupRequest) -> AuthResult:
        if not is_email_allowed(data.email):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=EMAIL_NOT_ALLOWED,
            )

        try:
            res = self._auth.sign_up({"email": data.email, "password": data.password})
        except AuthApiError as e:
            logger.warning("Signup failed for %s: %s", data.email, e.message)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=SIGNUP_FAILED)

        if not res.user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=SIGNUP_FAILED,
            )

        school = get_school_for_email(data.email) or ""

        payload = {
            "id": str(uuid.uuid4()),
            "supabase_auth_id": res.user.id,
            "email": data.email,
            "username": data.username,
            "full_name": data.full_name,
            "school": school,
        }
        try:
            r = self._db.table(USERS).insert(payload).execute()
            row = r.data[0]
            user_id = row["id"]
        except APIError as e:
            if e.code == PG_UNIQUE_VIOLATION:
                logger.warning("Duplicate user signup for %s: %s", data.email, e.message)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=EMAIL_OR_USERNAME_TAKEN,
                )
            raise

        logger.info("Created DB user %s for supabase uid %s", user_id, res.user.id)

        if res.session:
            return AuthResult(
                body=SignupResponse(
                    user_id=str(user_id),
                    access_token=res.session.access_token,
                    expires_in=res.session.expires_in,
                ),
                refresh_token=res.session.refresh_token,
            )

        return AuthResult(
            body=SignupResponse(
                user_id=str(user_id),
                confirmation_required=True,
            ),
        )

    def login(self, data: LoginRequest) -> AuthResult:
        try:
            res = self._auth.sign_in_with_password(
                {"email": data.email, "password": data.password}
            )
        except AuthApiError as e:
            logger.warning("Login failed for %s: %s", data.email, e.message)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=INVALID_EMAIL_OR_PASSWORD,
            )

        if not res.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=INVALID_EMAIL_OR_PASSWORD,
            )

        return AuthResult(
            body=TokenResponse(
                access_token=res.session.access_token,
                expires_in=res.session.expires_in,
                user_id=res.user.id,
            ),
            refresh_token=res.session.refresh_token,
        )

    def refresh(self, refresh_token: str) -> AuthResult:
        try:
            res = self._auth.refresh_session(refresh_token)
        except AuthApiError as e:
            logger.warning("Token refresh failed: %s", e.message)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=SESSION_REFRESH_FAILED,
            )

        if not res.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=SESSION_REFRESH_FAILED,
            )

        return AuthResult(
            body=TokenResponse(
                access_token=res.session.access_token,
                expires_in=res.session.expires_in,
                user_id=res.user.id,
            ),
            refresh_token=res.session.refresh_token,
        )

    def logout(self, access_token: str) -> None:
        try:
            supabase_admin.auth.admin.sign_out(access_token)
        except AuthApiError as e:
            logger.warning("Logout error: %s", e.message)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=INVALID_OR_EXPIRED_TOKEN,
            )

    def forgot_password(self, email: str) -> None:
        try:
            self._auth.reset_password_email(email)
        except AuthApiError as e:
            # Swallow the error so the router always returns a generic
            # "If that email exists …" response — raising here would let
            # an attacker distinguish existing vs non-existing emails.
            logger.warning("Password reset request failed for %s: %s", email, e.message)

    def reset_password(self, data: ResetPasswordRequest) -> None:
        # Verify the access token and extract the user it belongs to
        try:
            res = supabase.auth.get_user(data.access_token)
        except Exception as e:
            logger.warning("Password reset token validation failed: %s", e)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=INVALID_OR_EXPIRED_TOKEN,
            )

        if not res or not res.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=INVALID_OR_EXPIRED_TOKEN,
            )

        # Use the admin client to update the specific user's password
        try:
            supabase_admin.auth.admin.update_user_by_id(
                res.user.id, {"password": data.new_password}
            )
        except AuthApiError as e:
            logger.warning("Password reset failed for user %s: %s", res.user.id, e.message)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=PASSWORD_RESET_FAILED,
            )

        # Revoke ALL existing sessions for this user so any stolen refresh
        # tokens (the reason the user is resetting) can no longer be used.
        try:
            supabase_admin.auth.admin.sign_out(data.access_token, scope="global")
        except AuthApiError as e:
            # Password was already changed — log but don't fail the request.
            logger.warning(
                "Failed to revoke sessions after password reset for user %s: %s",
                res.user.id,
                e.message,
            )


auth = AuthService(auth_client=supabase.auth, db_client=get_sb())
