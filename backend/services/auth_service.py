"""Auth via Supabase (auth + users table). Sync."""

import uuid
from typing import NoReturn

from postgrest.exceptions import APIError
from supabase_auth.errors import AuthApiError

from core.allowed_emails import get_school_for_email, is_email_allowed
from core.config import settings
from core.constants import PG_UNIQUE_VIOLATION
from core.errors import (
    EMAIL_NOT_ALLOWED,
    EMAIL_OR_USERNAME_TAKEN,
    INVALID_EMAIL_OR_PASSWORD,
    INVALID_OR_EXPIRED_TOKEN,
    PASSWORD_RESET_FAILED,
    SESSION_REFRESH_FAILED,
    SIGNUP_FAILED,
)
from core.exceptions import (
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    ServiceError,
    ValidationError,
)
from core.logging import logger
from core.tables import USERS
from schemas.auth import (
    LoginRequest,
    ResetPasswordRequest,
    SignupRequest,
    SignupResponse,
    TokenResponse,
)
from supabase import create_client


def _sanitize_for_log(value: str | None) -> str:
    """Strip CR/LF from untrusted values before logging.

    E7: ``data.email`` flows into the logger via %s interpolation.  If a
    caller supplies ``"a@b\\nWARN [auth] admin logged in"`` (EmailStr now
    rejects that, but this helper is defence in depth for anywhere the raw
    address is logged) the logger would emit a fake second line that looks
    like a genuine event.  Neutralise CR/LF here so a single log call is
    guaranteed to emit a single line.
    """
    if value is None:
        return ""
    return value.replace("\r", "\\r").replace("\n", "\\n")


def _password_reset_redirect_url() -> str:
    base_url = settings.frontend_url.rstrip("/") or "http://localhost:5173"
    return f"{base_url}/reset-password"


class AuthResult:
    """Carries the JSON response body *and* the raw refresh token for cookie setting."""

    def __init__(self, body, refresh_token: str | None = None):
        self.body = body
        self.refresh_token = refresh_token


class AuthService:
    def __init__(self, auth_client=None, db_client=None):
        self._auth_eager = auth_client
        self._db_eager = db_client

    @property
    def _auth(self):
        if self._auth_eager is not None:
            return self._auth_eager
        from core.database import supabase as _sb

        return _sb.auth

    @property
    def _db(self):
        if self._db_eager is not None:
            return self._db_eager
        from core.database import get_sb

        return get_sb()

    @staticmethod
    def _handle_auth_error(
        exc: AuthApiError,
        log_message: str,
        domain_error_cls: type[ServiceError],
        error_detail: str,
    ) -> NoReturn:
        """Log an AuthApiError and raise the corresponding domain exception.

        E16: annotated ``NoReturn`` so type-checkers (mypy/pyright) know every
        call terminates in an exception — prevents latent ``UnboundLocalError``
        if this helper is ever refactored into a non-raising form.

        E7: the untrusted value is passed as a separate %s argument (not
        f-string-interpolated) and the caller is expected to pass pre-sanitised
        strings.
        """
        logger.warning("%s: %s", log_message, exc.message)
        raise domain_error_cls(error_detail)

    def signup(self, data: SignupRequest) -> AuthResult:
        has_valid_invite = False
        if data.token:
            from datetime import datetime, timezone

            now_str = datetime.now(timezone.utc).isoformat()
            try:
                r_invite = (
                    self._db.table("club_invitations")
                    .select("*")
                    .eq("token", data.token)
                    .eq("email", data.email.strip().lower())
                    .eq("status", "pending")
                    .gt("expires_at", now_str)
                    .execute()
                )
                if r_invite.data:
                    has_valid_invite = True
            except Exception as e:
                logger.warning("Failed to check invitation token: %s", e)

        if not has_valid_invite and not is_email_allowed(data.email):
            raise AuthorizationError(EMAIL_NOT_ALLOWED)

        safe_email = _sanitize_for_log(data.email)

        try:
            res = self._auth.sign_up({"email": data.email, "password": data.password})
        except AuthApiError as e:
            self._handle_auth_error(
                e,
                "Signup failed for %s" % safe_email,
                ValidationError,
                SIGNUP_FAILED,
            )

        if not res.user:
            raise ValidationError(SIGNUP_FAILED)

        school = get_school_for_email(data.email) or None

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
            # A28: rollback orphan Supabase auth user
            self._try_delete_auth_user(res.user.id)
            if e.code == PG_UNIQUE_VIOLATION:
                logger.warning("Duplicate user signup for %s: %s", safe_email, e.message)
                raise ConflictError(EMAIL_OR_USERNAME_TAKEN) from e
            raise
        except Exception:
            self._try_delete_auth_user(res.user.id)
            raise

        logger.info("Created DB user %s for supabase uid %s", user_id, res.user.id)

        # Auto-join user to any clubs they have pending invitations for
        try:
            from datetime import datetime, timezone

            now_str = datetime.now(timezone.utc).isoformat()
            r_invites = (
                self._db.table("club_invitations")
                .select("*")
                .eq("email", data.email.strip().lower())
                .eq("status", "pending")
                .gt("expires_at", now_str)
                .execute()
            )
            for invite in r_invites.data or []:
                from services.club_service import add_club_member

                try:
                    add_club_member(invite["club_id"], uuid.UUID(user_id))
                except Exception as e:
                    logger.warning(
                        "Failed to auto-add user %s to club %s: %s", user_id, invite["club_id"], e
                    )

                self._db.table("club_invitations").update({"status": "accepted"}).eq(
                    "id", invite["id"]
                ).execute()
        except Exception as e:
            logger.warning("Failed to process auto-join for user %s: %s", user_id, e)

        if res.session:
            return AuthResult(
                body=SignupResponse(
                    user_id=str(user_id),
                    access_token=res.session.access_token,
                    expires_in=res.session.expires_in,
                    school=school,
                ),
                refresh_token=res.session.refresh_token,
            )

        return AuthResult(
            body=SignupResponse(
                user_id=str(user_id),
                confirmation_required=True,
                school=school,
            ),
        )

    def _try_delete_auth_user(self, supabase_auth_id: str) -> None:
        """Best-effort cleanup of an orphaned Supabase auth user.

        Called only when a DB insert fails *after* Supabase has successfully
        created the auth user (see A28).  Any failure here is logged and
        swallowed — we still want the original signup error to propagate.
        """
        try:
            self._db.auth.admin.delete_user(supabase_auth_id)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(
                "Failed to delete orphan Supabase auth user %s: %s",
                supabase_auth_id,
                e,
            )

    def login(self, data: LoginRequest) -> AuthResult:
        try:
            res = self._auth.sign_in_with_password({"email": data.email, "password": data.password})
        except AuthApiError as e:
            self._handle_auth_error(
                e,
                "Login failed for %s" % _sanitize_for_log(data.email),
                AuthenticationError,
                INVALID_EMAIL_OR_PASSWORD,
            )

        if not res.session:
            raise AuthenticationError(INVALID_EMAIL_OR_PASSWORD)

        return AuthResult(
            body=TokenResponse(
                access_token=res.session.access_token,
                expires_in=res.session.expires_in,
                user_id=res.user.id,
                school=get_school_for_email(data.email) or None,
            ),
            refresh_token=res.session.refresh_token,
        )

    def refresh(self, refresh_token: str) -> AuthResult:
        try:
            res = self._auth.refresh_session(refresh_token)
        except AuthApiError as e:
            self._handle_auth_error(
                e,
                "Token refresh failed",
                AuthenticationError,
                SESSION_REFRESH_FAILED,
            )

        if not res.session:
            raise AuthenticationError(SESSION_REFRESH_FAILED)

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
            self._db.auth.admin.sign_out(access_token)
        except AuthApiError as e:
            self._handle_auth_error(
                e,
                "Logout error",
                AuthenticationError,
                INVALID_OR_EXPIRED_TOKEN,
            )

    def forgot_password(self, email: str) -> None:
        try:
            self._auth.reset_password_email(
                email,
                {"redirect_to": _password_reset_redirect_url()},
            )
        except AuthApiError as e:
            # Log but do not raise — the router always returns a generic
            # "If that email exists ..." response to prevent enumeration.
            logger.warning(
                "Password reset request failed for %s: %s",
                _sanitize_for_log(email),
                e.message,
            )

    def reset_password(self, data: ResetPasswordRequest) -> AuthResult:
        """Update the caller's password using Supabase's recovery session."""
        if not data.refresh_token:
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)
        return self._reset_password_with_supabase_session(data)

    def _reset_password_with_supabase_session(self, data: ResetPasswordRequest) -> AuthResult:
        auth_client = create_client(settings.supabase_url, settings.supabase_key).auth

        try:
            res = auth_client.set_session(data.access_token, data.refresh_token or "")
        except AuthApiError as e:
            logger.warning("Password reset session verification failed: %s", e.message)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN) from e
        except Exception as e:
            logger.warning("Password reset session verification failed: %s", e)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN) from e

        if not res.session:
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        try:
            auth_client.update_user({"password": data.new_password})
        except AuthApiError as e:
            self._handle_auth_error(
                e,
                "Password reset failed via recovery session",
                ValidationError,
                PASSWORD_RESET_FAILED,
            )

        try:
            auth_client.sign_out({"scope": "others"})
        except Exception as e:  # pragma: no cover - best effort cleanup
            logger.warning("Failed to revoke other sessions after password reset: %s", e)

        return AuthResult(
            body=TokenResponse(
                access_token=res.session.access_token,
                expires_in=res.session.expires_in,
                user_id=res.user.id,
            ),
            refresh_token=res.session.refresh_token,
        )


auth = AuthService()
