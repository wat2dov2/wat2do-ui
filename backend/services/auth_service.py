"""Auth via Supabase (auth + users table). Sync."""

import uuid

from fastapi import HTTPException, status
from supabase_auth.errors import AuthApiError

from core.allowed_emails import get_school_for_email, is_email_allowed
from core.database import supabase, get_sb
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
                detail="Only student emails from allowed schools can sign up. Use a valid university email (e.g. @uwaterloo.ca).",
            )

        try:
            res = self._auth.sign_up({"email": data.email, "password": data.password})
        except AuthApiError as e:
            logger.warning("Signup failed for %s: %s", data.email, e.message)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)

        if not res.user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Signup failed — check email/password requirements",
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
        except Exception as e:
            if "duplicate" in str(e).lower() or "unique" in str(e).lower() or "23505" in str(e):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Email or username already taken",
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
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=e.message)

        if not res.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
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
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=e.message)

        if not res.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not refresh session — please log in again",
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
            self._auth.sign_out()
        except AuthApiError as e:
            logger.warning("Logout error: %s", e.message)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
            )

    def forgot_password(self, email: str) -> None:
        try:
            self._auth.reset_password_email(email)
        except AuthApiError as e:
            logger.warning("Password reset request failed for %s: %s", email, e.message)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
            )

    def reset_password(self, data: ResetPasswordRequest) -> None:
        try:
            self._auth.update_user(
                {"password": data.new_password},
            )
        except AuthApiError as e:
            logger.warning("Password reset failed: %s", e.message)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
            )


auth = AuthService(auth_client=supabase.auth, db_client=get_sb())
