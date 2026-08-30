"""Auth via Supabase (auth + users table). Sync."""

import hashlib
from typing import NoReturn
from urllib.parse import urlencode

from supabase_auth import SyncMemoryStorage
from supabase_auth.errors import AuthApiError

from core.allowed_emails import get_school_for_email
from core.config import settings
from core.controlbox import controlbox
from core.errors import (
    EMAIL_NOT_ALLOWED,
    FAILED_TO_GENERATE_TOKEN,
    FAILED_TO_SAVE_TOKEN,
    INVALID_OR_EXPIRED_TOKEN,
    REGISTRATION_FAILED,
    SESSION_REFRESH_FAILED,
)
from core.exceptions import (
    AuthenticationError,
    AuthorizationError,
    ServiceError,
)
from core.logging import logger
from core.tables import USERS, VERIFICATION_TOKENS
from schemas.auth import (
    TokenResponse,
)
from services import school_service
from services.email_service import EmailMessage
from services.school_context import school_frontend_url


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


class AuthResult:
    """Carries the JSON response body *and* the raw refresh token for cookie setting."""

    def __init__(self, body, refresh_token: str | None = None):
        self.body = body
        self.refresh_token = refresh_token


class OAuthStartResult:
    """Authorization URL plus the one-time PKCE verifier bound to this browser."""

    def __init__(self, authorization_url: str, code_verifier: str):
        self.authorization_url = authorization_url
        self.code_verifier = code_verifier


class _OAuthVerifierStorage(SyncMemoryStorage):
    """Capture the PKCE verifier without persisting a user session server-side."""

    def __init__(self) -> None:
        super().__init__()
        self.code_verifier: str | None = None

    def set_item(self, key: str, value: str) -> None:
        super().set_item(key, value)
        if key.endswith("-code-verifier"):
            self.code_verifier = value


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
    def _auth_admin(self):
        if self._auth_eager is not None:
            return self._auth_eager
        from core.database import supabase_admin as _sb_admin

        return _sb_admin.auth

    @property
    def _db(self):
        if self._db_eager is not None:
            return self._db_eager
        from core.database import get_sb

        return get_sb()

    @staticmethod
    def _new_oauth_auth(storage: SyncMemoryStorage | None = None):
        """Create an isolated PKCE client for one OAuth request."""
        from supabase import ClientOptions, create_client

        return create_client(
            settings.supabase_url,
            settings.supabase_key,
            ClientOptions(
                flow_type="pkce",
                storage=storage or SyncMemoryStorage(),
                persist_session=False,
                auto_refresh_token=False,
            ),
        ).auth

    def prepare_google_oauth(self, callback_url: str) -> OAuthStartResult:
        storage = _OAuthVerifierStorage()
        response = self._new_oauth_auth(storage).sign_in_with_oauth(
            {
                "provider": "google",
                "options": {"redirect_to": callback_url},
            }
        )
        if not response.url or not storage.code_verifier:
            raise ServiceError("Failed to start Google sign-in")
        return OAuthStartResult(response.url, storage.code_verifier)

    def verify_google_oauth(
        self,
        code: str,
        code_verifier: str,
        callback_url: str,
    ) -> AuthResult:
        try:
            response = self._new_oauth_auth().exchange_code_for_session(
                {
                    "auth_code": code,
                    "code_verifier": code_verifier,
                    "redirect_to": callback_url,
                }
            )
        except AuthApiError as exc:
            logger.warning("Supabase Google OAuth verification failed: %s", exc.message)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)
        except Exception as exc:
            logger.warning("Supabase Google OAuth verification failed: %s", exc)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        if not response.session or not response.user or not response.user.email:
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        from datetime import datetime, timezone

        return self._complete_authenticated_session(
            response,
            response.user.email.strip().lower(),
            datetime.now(timezone.utc).isoformat(),
        )

    @staticmethod
    def _handle_auth_error(
        exc: AuthApiError,
        log_message: str,
        domain_error_cls: type[ServiceError],
        error_detail: str,
    ) -> NoReturn:
        """Log an AuthApiError and raise the corresponding domain exception.

        E16: annotated ``NoReturn`` so type-checkers (mypy/pyright) know every
        call terminates in an exception - prevents latent ``UnboundLocalError``
        if this helper is ever refactored into a non-raising form.

        E7: the untrusted value is passed as a separate %s argument (not
        f-string-interpolated) and the caller is expected to pass pre-sanitised
        strings.
        """
        logger.warning("%s: %s", log_message, exc.message)
        raise domain_error_cls(error_detail)

    def prepare_otp_email(
        self,
        email: str,
        invitation_token: str | None = None,
        return_to: str | None = None,
    ) -> EmailMessage:
        email_clean = email.strip().lower()
        has_valid_invite = False
        recipient_school: str | None = None
        if invitation_token:
            from datetime import datetime, timezone

            now_str = datetime.now(timezone.utc).isoformat()
            try:
                r_invite = (
                    self._db.table("organization_invitations")
                    .select("*")
                    .eq("token", invitation_token)
                    .eq("email", email_clean)
                    .eq("status", "pending")
                    .gt("expires_at", now_str)
                    .execute()
                )
                if r_invite.data:
                    has_valid_invite = True
                    organization_id = r_invite.data[0].get("organization_id")
                    if organization_id is not None:
                        from services import organization_service

                        organization = organization_service.get_organization(int(organization_id))
                        recipient_school = organization.school if organization else None
            except Exception as e:
                logger.warning("Failed to check invitation token: %s", e)

        try:
            r_user = (
                self._db.table(USERS)
                .select(f"id,{school_service.SCHOOL_SLUG_EMBED}")
                .eq("email", email_clean)
                .execute()
            )
            exists = bool(r_user.data)
            if exists:
                recipient_school = (
                    school_service.with_school_slug(r_user.data[0]).get("school")
                    or recipient_school
                )
        except Exception as e:
            logger.warning("Failed to check if user exists: %s", e)
            exists = False

        if not exists:
            email_school = get_school_for_email(email_clean)
            recipient_school = recipient_school or email_school
            if not has_valid_invite and email_school is None:
                raise AuthorizationError(EMAIL_NOT_ALLOWED)

        safe_email = _sanitize_for_log(email_clean)

        # confirm=True so the Auth user is already confirmed when they verify OTP
        try:
            self._auth_admin.admin.create_user({"email": email_clean, "email_confirm": True})
            logger.info("Created new Supabase auth user for %s", safe_email)
        except AuthApiError as e:
            if "already exists" in getattr(e, "message", "").lower():
                logger.info("Supabase auth user already exists: %s", safe_email)
            else:
                logger.warning("Supabase auth user creation error: %s", e.message)
        except Exception as e:
            logger.info("Supabase auth user check/creation bypassed: %s", e)

        try:
            link_res = self._auth_admin.admin.generate_link(
                {
                    "type": "magiclink",
                    "email": email_clean,
                }
            )
        except Exception as e:
            logger.error("Failed to generate magic link from Supabase: %s", e)
            raise ServiceError(FAILED_TO_GENERATE_TOKEN)

        try:
            self._db.table(VERIFICATION_TOKENS).delete().eq("identifier", email_clean).execute()
        except Exception as e:
            logger.warning("Failed to delete old verification tokens: %s", e)

        from datetime import datetime, timedelta, timezone

        expires_at = (
            datetime.now(timezone.utc)
            + timedelta(minutes=controlbox.authentication.verification_token_minutes)
        ).isoformat()

        hashed_token = link_res.properties.hashed_token
        otp_hash = hashlib.sha256(link_res.properties.email_otp.encode("utf-8")).hexdigest()

        try:
            self._db.table(VERIFICATION_TOKENS).insert(
                [
                    {"identifier": email_clean, "token": hashed_token, "expires": expires_at},
                    {"identifier": email_clean, "token": otp_hash, "expires": expires_at},
                ]
            ).execute()
        except Exception as e:
            logger.error("Failed to insert verification tokens: %s", e)
            raise ServiceError(FAILED_TO_SAVE_TOKEN)

        base_url = school_frontend_url(recipient_school)
        callback_params = {
            "token": hashed_token,
            "email": email_clean,
        }
        if return_to is not None:
            callback_params["returnTo"] = return_to
        callback_url = f"{base_url}/auth/callback?{urlencode(callback_params)}"

        subject = "Your Wat2Do login code and link"
        body_html = f"""
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #1a202c; margin-bottom: 16px;">Log in to Wat2Do</h2>
            <p style="color: #4a5568; line-height: 1.5;">Here is your 6-digit login code:</p>
            <div style="background-color: #f7fafc; border: 1px solid #edf2f7; border-radius: 6px; padding: 12px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #2d3748; margin: 16px 0;">
                {link_res.properties.email_otp}
            </div>
            <p style="color: #4a5568; line-height: 1.5;">Or open this link and confirm to sign in:</p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{callback_url}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Open sign-in link</a>
            </div>
            <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 24px 0;" />
            <p style="color: #718096; font-size: 12px; line-height: 1.5;">This code and link will expire in 15 minutes. If you did not request this, you can safely ignore this email.</p>
        </div>
        """
        body_text = f"""
        Log in to Wat2Do

        Here is your 6-digit login code:
        {link_res.properties.email_otp}

        Or open this link and confirm to sign in:
        {callback_url}

        This code and link will expire in 15 minutes. If you did not request this, you can safely ignore this email.
        """

        return EmailMessage(
            to=email_clean, subject=subject, body_html=body_html, body_text=body_text
        )

    def _complete_authenticated_session(
        self,
        auth_response,
        email_clean: str,
        now_str: str,
    ) -> AuthResult:
        """Map any verified Supabase session into Wat2Do's one user/session path."""
        db_user = None
        try:
            r_user = (
                self._db.table(USERS)
                .select("*,school_record:schools(slug)")
                .eq("email", email_clean)
                .execute()
            )
            if r_user.data:
                db_user = r_user.data[0]
        except Exception as exc:
            logger.warning("Failed to look up DB user: %s", exc)

        onboarding_required = False
        if db_user:
            normalized_user = school_service.with_school_slug(db_user)
            school = normalized_user.get("school")
            if school_service.get_school(school) is None:
                logger.error("Existing user is not assigned to a registered school")
                raise ServiceError(REGISTRATION_FAILED)
        else:
            school = get_school_for_email(email_clean) or None
            school_record = school_service.get_school(school)
            if school_record is None:
                logger.error("Allowed email resolved to an unregistered school")
                raise ServiceError(REGISTRATION_FAILED)

            onboarding_required = True
            import uuid

            user_id = str(uuid.uuid4())
            payload = {
                "id": user_id,
                "supabase_auth_id": auth_response.user.id,
                "email": email_clean,
                "school_id": school_record.id,
            }
            if email_clean == "tqiu@uwaterloo.ca":
                payload["role"] = "admin"
            try:
                self._db.table(USERS).insert(payload).execute()
                logger.info("Created public.users record for %s (id=%s)", email_clean, user_id)
            except Exception as exc:
                logger.error("Failed to create public.users record: %s", exc)
                raise ServiceError(REGISTRATION_FAILED)

            try:
                r_invites = (
                    self._db.table("organization_invitations")
                    .select("*")
                    .eq("email", email_clean)
                    .eq("status", "pending")
                    .gt("expires_at", now_str)
                    .execute()
                )
                for invite in r_invites.data or []:
                    from services.organization_service import add_organization_member

                    try:
                        add_organization_member(invite["organization_id"], uuid.UUID(user_id))
                    except Exception as exc:
                        logger.warning(
                            "Failed to auto-add user %s to organization %s: %s",
                            user_id,
                            invite["organization_id"],
                            exc,
                        )

                    self._db.table("organization_invitations").update({"status": "accepted"}).eq(
                        "id", invite["id"]
                    ).execute()
            except Exception as exc:
                logger.warning("Failed to process auto-join for user %s: %s", user_id, exc)

        return AuthResult(
            body=TokenResponse(
                access_token=auth_response.session.access_token,
                expires_in=auth_response.session.expires_in,
                user_id=auth_response.user.id,
                school=school,
                onboarding_required=onboarding_required,
            ),
            refresh_token=auth_response.session.refresh_token,
        )

    def verify_otp(self, email: str, token: str) -> AuthResult:
        email_clean = email.strip().lower()
        token_clean = token.strip()

        hashed_token = hashlib.sha256(token_clean.encode("utf-8")).hexdigest()

        from datetime import datetime, timezone

        now_str = datetime.now(timezone.utc).isoformat()

        try:
            # Magic-link callback stores the hashed token as-is; OTP stores
            # sha256(code). Try the raw token first, then the hashed form.
            r = (
                self._db.table(VERIFICATION_TOKENS)
                .select("*")
                .eq("identifier", email_clean)
                .eq("token", token_clean)
                .gt("expires", now_str)
                .execute()
            )
            if not r.data:
                r = (
                    self._db.table(VERIFICATION_TOKENS)
                    .select("*")
                    .eq("identifier", email_clean)
                    .eq("token", hashed_token)
                    .gt("expires", now_str)
                    .execute()
                )

            if not r.data:
                raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        except AuthenticationError:
            raise
        except Exception as e:
            logger.error("Failed to query verification token: %s", e)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        try:
            if token_clean.isdigit():
                res = self._auth.verify_otp(
                    {"email": email_clean, "token": token_clean, "type": "email"}
                )
            else:
                res = self._auth.verify_otp({"token_hash": token_clean, "type": "email"})
        except AuthApiError as e:
            logger.warning("Supabase OTP verification failed: %s", e.message)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)
        except Exception as e:
            logger.warning("Supabase OTP verification failed: %s", e)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        if not res.session or not res.user:
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        try:
            self._db.table(VERIFICATION_TOKENS).delete().eq("identifier", email_clean).execute()
        except Exception as e:
            logger.warning("Failed to delete used verification tokens: %s", e)

        return self._complete_authenticated_session(res, email_clean, now_str)

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


auth = AuthService()
