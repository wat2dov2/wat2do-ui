"""Our own auth: email login codes, Google sign-in, and refreshable sessions.

Login codes and links are generated here and stored hashed in
``verification_tokens``; a verified login starts an ``auth_sessions`` row whose
refresh token lives in the browser's httpOnly cookie.  Access tokens are
short-lived ES256 JWTs from ``core.auth_tokens``.  Sync.
"""

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from html import escape
from urllib.parse import urlencode

import httpx
import jwt

from core.auth_tokens import (
    access_token_seconds,
    decode_access_token,
    issue_access_token,
    new_refresh_token,
    next_refresh_token,
    refresh_token_hash,
)
from core.config import settings
from core.controlbox import controlbox
from core.errors import (
    FAILED_TO_SAVE_TOKEN,
    INVALID_OR_EXPIRED_TOKEN,
    REGISTRATION_FAILED,
    SESSION_REFRESH_FAILED,
)
from core.exceptions import (
    AuthenticationError,
    ServiceError,
)
from core.logging import logger
from core.tables import AUTH_SESSIONS, USERS, VERIFICATION_TOKENS
from schemas.auth import (
    TokenResponse,
)
from services import school_service
from services.email_layout import (
    EMAIL_LOGO,
    EMAIL_THEME,
    email_button,
    email_note,
    email_paragraph,
    email_shell,
)
from services.email_service import EmailMessage
from services.school_context import school_from_frontend_url, school_frontend_url

GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
_GOOGLE_TIMEOUT_SECONDS = 10
_google_keys = jwt.PyJWKClient(GOOGLE_CERTS_URL, cache_keys=True, lifespan=3600)


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


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class AuthResult:
    """Carries the JSON response body *and* the raw refresh token for cookie setting."""

    def __init__(self, body, refresh_token: str | None = None):
        self.body = body
        self.refresh_token = refresh_token


class OAuthStartResult:
    """Authorization URL plus the one-time PKCE verifier and state bound to this browser."""

    def __init__(self, authorization_url: str, code_verifier: str, state: str):
        self.authorization_url = authorization_url
        self.code_verifier = code_verifier
        self.state = state


class _Session:
    """A session's access token, its lifetime and the refresh token for the cookie."""

    def __init__(self, access_token: str, refresh_token: str):
        self.access_token = access_token
        self.expires_in = access_token_seconds()
        self.refresh_token = refresh_token


class AuthService:
    def __init__(self, db_client=None):
        self._db_eager = db_client

    @property
    def _db(self):
        if self._db_eager is not None:
            return self._db_eager
        from core.database import get_sb

        return get_sb()

    def prepare_google_oauth(self, redirect_uri: str) -> OAuthStartResult:
        """Build Google's consent URL with PKCE; Google sends the code to *redirect_uri*."""
        code_verifier = secrets.token_urlsafe(64)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
            .rstrip(b"=")
            .decode("ascii")
        )
        state = secrets.token_urlsafe(32)
        query = urlencode(
            {
                "client_id": controlbox.authentication.google_client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": "openid email profile",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": state,
            }
        )
        return OAuthStartResult(f"{GOOGLE_AUTHORIZATION_URL}?{query}", code_verifier, state)

    def verify_google_oauth(
        self,
        code: str,
        code_verifier: str,
        redirect_uri: str,
        callback_url: str,
    ) -> AuthResult:
        """Exchange Google's code for a verified email and start a session."""
        email = _google_verified_email(code, code_verifier, redirect_uri)
        return self._complete_authenticated_session(
            email,
            datetime.now(timezone.utc).isoformat(),
            school_from_frontend_url(callback_url),
        )

    def prepare_otp_email(
        self,
        email: str,
        invitation_token: str | None = None,
        return_to: str | None = None,
        signup_school: str | None = None,
    ) -> EmailMessage:
        email_clean = email.strip().lower()
        recipient_school = signup_school
        if invitation_token:
            now_str = datetime.now(timezone.utc).isoformat()
            try:
                r_invite = (
                    self._db.table("club_invitations")
                    .select("*")
                    .eq("token", invitation_token)
                    .eq("email", email_clean)
                    .eq("status", "pending")
                    .gt("expires_at", now_str)
                    .execute()
                )
                if r_invite.data:
                    club_id = r_invite.data[0].get("club_id")
                    if club_id is not None:
                        from services import club_service

                        club = club_service.get_club(int(club_id))
                        recipient_school = recipient_school or (club.school if club else None)
            except Exception as e:
                logger.warning("Failed to check invitation token: %s", e)

        try:
            r_user = (
                self._db.table(USERS)
                .select(f"id,{school_service.SCHOOL_SLUG_EMBED}")
                .eq("email", email_clean)
                .execute()
            )
            if r_user.data:
                recipient_school = (
                    school_service.with_school_slug(r_user.data[0]).get("school")
                    or recipient_school
                )
        except Exception as e:
            logger.warning("Failed to check if user exists: %s", e)

        try:
            self._db.table(VERIFICATION_TOKENS).delete().eq("identifier", email_clean).execute()
        except Exception as e:
            logger.warning("Failed to delete old verification tokens: %s", e)

        expires_at = (
            datetime.now(timezone.utc)
            + timedelta(minutes=controlbox.authentication.verification_token_minutes)
        ).isoformat()

        # One six-digit code to type and one link token to click; only hashes are stored.
        code = f"{secrets.randbelow(1_000_000):06d}"
        link_token = secrets.token_urlsafe(32)

        try:
            self._db.table(VERIFICATION_TOKENS).insert(
                [
                    {
                        "identifier": email_clean,
                        "token": _token_digest(link_token),
                        "expires": expires_at,
                    },
                    {
                        "identifier": email_clean,
                        "token": _token_digest(code),
                        "expires": expires_at,
                    },
                ]
            ).execute()
        except Exception as e:
            logger.error("Failed to insert verification tokens: %s", e)
            raise ServiceError(FAILED_TO_SAVE_TOKEN)

        base_url = school_frontend_url(recipient_school)
        callback_params = {
            "token": link_token,
            "email": email_clean,
        }
        if return_to is not None:
            callback_params["returnTo"] = return_to
        callback_url = f"{base_url}/auth/callback?{urlencode(callback_params)}"

        return _login_email(email_clean, code, callback_url)

    def _complete_authenticated_session(
        self,
        email_clean: str,
        now_str: str,
        signup_school: str | None = None,
    ) -> AuthResult:
        """Map any verified login (code, link or Google) into Wat2Do's one user/session path."""
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
            if school and school_service.get_school(school) is None:
                logger.error("Existing user is not assigned to a registered school")
                raise ServiceError(REGISTRATION_FAILED)
            onboarding_required = school is None
            auth_id = db_user["supabase_auth_id"]
        else:
            school = signup_school
            school_record = school_service.get_school(school)
            if school and school_record is None:
                logger.error("Signup site resolved to an unregistered school")
                raise ServiceError(REGISTRATION_FAILED)

            onboarding_required = True
            user_id = str(uuid.uuid4())
            auth_id = str(uuid.uuid4())
            payload = {
                "id": user_id,
                "supabase_auth_id": auth_id,
                "email": email_clean,
                "school_id": school_record.id if school_record else None,
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
                    self._db.table("club_invitations")
                    .select("*")
                    .eq("email", email_clean)
                    .eq("status", "pending")
                    .gt("expires_at", now_str)
                    .execute()
                )
                for invite in r_invites.data or []:
                    from services.club_service import add_club_member

                    try:
                        add_club_member(invite["club_id"], uuid.UUID(user_id))
                    except Exception as exc:
                        logger.warning(
                            "Failed to auto-add user %s to club %s: %s",
                            user_id,
                            invite["club_id"],
                            exc,
                        )

                    self._db.table("club_invitations").update({"status": "accepted"}).eq(
                        "id", invite["id"]
                    ).execute()
            except Exception as exc:
                logger.warning("Failed to process auto-join for user %s: %s", user_id, exc)

        session = self._start_session(auth_id, email_clean)
        return AuthResult(
            body=TokenResponse(
                access_token=session.access_token,
                expires_in=session.expires_in,
                user_id=auth_id,
                school=school,
                onboarding_required=onboarding_required,
            ),
            refresh_token=session.refresh_token,
        )

    def verify_otp(self, email: str, token: str, signup_school: str | None = None) -> AuthResult:
        """Accept the six-digit code or the link token from the latest login email."""
        email_clean = email.strip().lower()
        now_str = datetime.now(timezone.utc).isoformat()

        try:
            r = (
                self._db.table(VERIFICATION_TOKENS)
                .select("identifier")
                .eq("identifier", email_clean)
                .eq("token", _token_digest(token.strip()))
                .gt("expires", now_str)
                .execute()
            )
        except Exception as e:
            logger.error("Failed to query verification token: %s", e)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)
        if not r.data:
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)

        try:
            self._db.table(VERIFICATION_TOKENS).delete().eq("identifier", email_clean).execute()
        except Exception as e:
            logger.warning("Failed to delete used verification tokens: %s", e)

        return self._complete_authenticated_session(email_clean, now_str, signup_school)

    def refresh(self, refresh_token: str) -> AuthResult:
        """Rotate the browser's refresh token and issue a new access token."""
        presented = refresh_token_hash(refresh_token)
        successor = next_refresh_token(refresh_token)
        now = datetime.now(timezone.utc)
        session = self._rotate(presented, successor, now)
        if session is None:
            session = self._recently_rotated(presented, successor, now)
        if session is None:
            raise AuthenticationError(SESSION_REFRESH_FAILED)

        auth_id = session["auth_id"]
        return AuthResult(
            body=TokenResponse(
                access_token=issue_access_token(
                    subject=auth_id, email=self._email_for(auth_id), session_id=session["id"]
                ),
                expires_in=access_token_seconds(),
                user_id=auth_id,
            ),
            refresh_token=successor,
        )

    def logout(self, access_token: str) -> None:
        """End every session of the token's user, like signing out everywhere."""
        try:
            claims = decode_access_token(access_token)
        except jwt.InvalidTokenError as exc:
            logger.warning("Logout with an invalid access token: %s", exc)
            raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)
        self._db.table(AUTH_SESSIONS).update(
            {"revoked_at": datetime.now(timezone.utc).isoformat()}
        ).eq("auth_id", claims["sub"]).is_("revoked_at", "null").execute()

    def _start_session(self, auth_id: str, email: str | None) -> _Session:
        refresh_token = new_refresh_token()
        try:
            row = (
                self._db.table(AUTH_SESSIONS)
                .insert(
                    {
                        "auth_id": auth_id,
                        "refresh_token_hash": refresh_token_hash(refresh_token),
                        "expires_at": _session_expiry(datetime.now(timezone.utc)),
                    }
                )
                .execute()
                .data[0]
            )
        except Exception as exc:
            logger.error("Failed to start a session: %s", exc)
            raise ServiceError(REGISTRATION_FAILED)
        access_token = issue_access_token(subject=auth_id, email=email, session_id=row["id"])
        return _Session(access_token, refresh_token)

    def _rotate(self, presented: str, successor: str, now: datetime) -> dict | None:
        """Swap the session's current token for its successor; None if it is not current."""
        rows = (
            self._db.table(AUTH_SESSIONS)
            .update(
                {
                    "refresh_token_hash": refresh_token_hash(successor),
                    "previous_refresh_token_hash": presented,
                    "rotated_at": now.isoformat(),
                    "expires_at": _session_expiry(now),
                }
            )
            .eq("refresh_token_hash", presented)
            .is_("revoked_at", "null")
            .gt("expires_at", now.isoformat())
            .execute()
            .data
        )
        return rows[0] if rows else None

    def _recently_rotated(self, presented: str, successor: str, now: datetime) -> dict | None:
        """A token rotated moments ago (a parallel refresh) still yields its successor.

        Sent any later, a replaced token means it leaked: the session is revoked.
        """
        rows = (
            self._db.table(AUTH_SESSIONS)
            .select("id,auth_id,refresh_token_hash,rotated_at")
            .eq("previous_refresh_token_hash", presented)
            .is_("revoked_at", "null")
            .execute()
            .data
        )
        if not rows:
            return None
        session = rows[0]
        reuse_window = timedelta(seconds=controlbox.authentication.refresh_token_reuse_seconds)
        rotated_at = datetime.fromisoformat(session["rotated_at"])
        if now - rotated_at <= reuse_window and hmac.compare_digest(
            session["refresh_token_hash"], refresh_token_hash(successor)
        ):
            return session
        logger.warning("Replaced refresh token reused; revoking session %s", session["id"])
        self._db.table(AUTH_SESSIONS).update({"revoked_at": now.isoformat()}).eq(
            "id", session["id"]
        ).execute()
        return None

    def _email_for(self, auth_id: str) -> str | None:
        rows = self._db.table(USERS).select("email").eq("supabase_auth_id", auth_id).execute().data
        return rows[0]["email"] if rows else None


auth = AuthService()


def _session_expiry(now: datetime) -> str:
    return (now + timedelta(days=controlbox.authentication.session_cookie_days)).isoformat()


def _google_verified_email(code: str, code_verifier: str, redirect_uri: str) -> str:
    """Trade Google's authorization code for its ID token and return the verified email."""
    try:
        response = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "code_verifier": code_verifier,
                "client_id": controlbox.authentication.google_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=_GOOGLE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        id_token = response.json()["id_token"]
        claims = jwt.decode(
            id_token,
            _google_keys.get_signing_key_from_jwt(id_token).key,
            algorithms=["RS256"],
            audience=controlbox.authentication.google_client_id,
            issuer=GOOGLE_ISSUERS,
        )
    except (httpx.HTTPError, KeyError, ValueError, jwt.PyJWTError) as exc:
        logger.warning("Google sign-in verification failed: %s", exc)
        raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)
    email = claims.get("email")
    if not email or claims.get("email_verified") is not True:
        raise AuthenticationError(INVALID_OR_EXPIRED_TOKEN)
    return str(email).strip().lower()


def _login_email(email: str, code: str, callback_url: str) -> EmailMessage:
    minutes = controlbox.authentication.verification_token_minutes
    expiry = (
        f"This code and link expire in {minutes} minutes. "
        "If you did not request this, you can safely ignore this email."
    )
    code_box = (
        f'<div style="margin:0 0 20px;padding:16px;background:{EMAIL_THEME["surface_elevated"]};'
        f"border:1px solid {EMAIL_THEME['border']};border-radius:12px;text-align:center;"
        f'color:{EMAIL_THEME["foreground"]};font:800 30px monospace;letter-spacing:8px;">'
        f"{escape(code)}</div>"
    )
    return EmailMessage(
        to=email,
        subject="Your wat2do login code and link",
        body_html=email_shell(
            heading="Log in to wat2do",
            content=(
                email_paragraph("Here is your 6-digit login code:", muted=True)
                + code_box
                + email_paragraph("Or open this link to sign in:", muted=True)
                + email_button(callback_url, "Open sign-in link")
                + email_note(escape(expiry))
            ),
        ),
        body_text="\n".join(
            [
                "Log in to wat2do",
                "",
                f"Here is your 6-digit login code: {code}",
                "",
                f"Or open this link to sign in: {callback_url}",
                "",
                expiry,
            ]
        ),
        inline_images=[EMAIL_LOGO],
    )
