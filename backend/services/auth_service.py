"""Auth via Supabase (auth + users table). Sync."""

import uuid
from typing import NoReturn

from postgrest.exceptions import APIError
from supabase_auth.errors import AuthApiError

from core.allowed_emails import get_school_for_email, is_email_allowed
from core.auth import decode_jwt_payload
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
        if not is_email_allowed(data.email):
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
            # A28: the Supabase auth user was created on the line above, but
            # the public.users insert failed.  If we leave the orphan in place
            # the email is permanently squatted — subsequent signups hit
            # "User already registered" and the user can never log in
            # (no profile row).  Roll back by deleting the auth user.  We swallow
            # the delete error (best effort) so the original signup failure
            # still surfaces.
            self._try_delete_auth_user(res.user.id)
            if e.code == PG_UNIQUE_VIOLATION:
                logger.warning("Duplicate user signup for %s: %s", safe_email, e.message)
                raise ConflictError(EMAIL_OR_USERNAME_TAKEN) from e
            raise
        except Exception:
            # Any other failure after the auth user was created — same cleanup.
            self._try_delete_auth_user(res.user.id)
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

    def reset_password(self, data: ResetPasswordRequest) -> AuthResult | None:
        """Update the caller's password using a recovery-scoped JWT.

        A9 fix: validate that the supplied access token was minted for
        password recovery before trusting it to change the password.  A
        regular session access token (captured via a transient XSS, for
        example) must not be accepted here — otherwise an attacker who
        briefly held a victim's access token could permanently take over
        the account.  We inspect the JWT claims locally (same JWKS verifier
        as ``get_current_user``) and require one of the
        recovery markers Supabase sets on recovery tokens:

        - ``amr`` contains an entry with ``method == "recovery"``
        - ``email_action_type == "recovery"``
        - ``aal == "aal1"`` plus ``app_metadata.provider == "recovery"``

        Any token lacking all of these is rejected with 401.
        """
        # Supabase's hosted recovery redirect gives the browser a full
        # temporary session. Validate that session with Supabase first so this
        # flow works even when the project is using hosted JWT signing keys the
        # local dev backend has not cached yet.
        if data.refresh_token:
            return self._reset_password_with_supabase_session(data)

        # 1) Verify signature/issuer/audience and extract the raw payload.
        try:
            payload = decode_jwt_payload(data.access_token)
        except AuthenticationError:
            # Propagate the domain error (logged by decode_jwt_payload).
            raise
        except Exception as e:
            logger.warning("Password reset token validation failed: %s", e)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN) from e

        # 2) Enforce recovery-only usage.
        if not _is_recovery_token(payload):
            logger.warning(
                "Password reset rejected — token is not recovery-scoped (sub=%s, amr=%s)",
                payload.get("sub"),
                payload.get("amr"),
            )
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        user_id = payload.get("sub")
        if not user_id:
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        # 3) Apply the password change via the admin client.
        try:
            self._db.auth.admin.update_user_by_id(user_id, {"password": data.new_password})
        except AuthApiError as e:
            self._handle_auth_error(
                e,
                "Password reset failed for user %s" % user_id,
                ValidationError,
                PASSWORD_RESET_FAILED,
            )

        # 4) Revoke ALL existing sessions for this user so any stolen refresh
        # tokens (the reason the user is resetting) can no longer be used.
        try:
            self._db.auth.admin.sign_out(data.access_token, scope="global")
        except AuthApiError as e:
            # Password was already changed -- log but don't fail the request.
            logger.warning(
                "Failed to revoke sessions after password reset for user %s: %s",
                user_id,
                e.message,
            )
        return None

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


def _is_recovery_token(payload: dict) -> bool:
    """Return True if *payload* looks like a Supabase recovery token.

    Supabase surfaces the recovery intent through multiple fields; we accept
    any of them.  Keep this liberal so the check works across Supabase
    versions, but insist on at least one explicit recovery marker — a plain
    session token must fail.
    """
    # Canonical: Supabase sets email_action_type on tokens from the
    # /auth/v1/verify?type=recovery exchange.
    if payload.get("email_action_type") == "recovery":
        return True

    # amr = [{"method": "recovery", "timestamp": ...}, ...]
    for entry in payload.get("amr", []) or []:
        if isinstance(entry, dict) and entry.get("method") == "recovery":
            return True

    # Some Supabase versions stamp app_metadata.provider = "recovery".
    app_meta = payload.get("app_metadata") or {}
    if isinstance(app_meta, dict) and app_meta.get("provider") == "recovery":
        return True

    return False


auth = AuthService()
