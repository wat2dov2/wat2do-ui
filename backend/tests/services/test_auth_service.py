import base64
import hashlib
import re
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from core import auth_tokens
from core.controlbox import controlbox
from core.errors import INVALID_OR_EXPIRED_TOKEN, SESSION_REFRESH_FAILED
from core.exceptions import AuthenticationError
from core.tables import AUTH_SESSIONS, USERS, VERIFICATION_TOKENS
from services import auth_service
from services.auth_service import AuthService

GOOGLE_REDIRECT = "https://wat2do.io/api/auth/google/callback"
SCHOOL_CALLBACK = "https://uwaterloo.wat2do.io/api/auth/google/callback"


def _moment(value):
    return datetime.fromisoformat(value) if isinstance(value, str) else value


class _Query:
    """The slice of the PostgREST builder auth uses, over in-memory rows."""

    def __init__(self, rows: list[dict], table: str):
        self._rows = rows
        self._table = table
        self._filters = []
        self._action = ("select", None)

    def select(self, *_columns):
        self._action = ("select", None)
        return self

    def insert(self, payload):
        self._action = ("insert", payload)
        return self

    def update(self, values):
        self._action = ("update", values)
        return self

    def delete(self):
        self._action = ("delete", None)
        return self

    def eq(self, column, value):
        self._filters.append(lambda row: row.get(column) == value)
        return self

    def gt(self, column, value):
        self._filters.append(
            lambda row: row.get(column) is not None and _moment(row[column]) > _moment(value)
        )
        return self

    def is_(self, column, value):
        assert value == "null"
        self._filters.append(lambda row: row.get(column) is None)
        return self

    def execute(self):
        action, payload = self._action
        if action == "insert":
            added = []
            for row in payload if isinstance(payload, list) else [payload]:
                row = dict(row)
                if self._table == AUTH_SESSIONS:
                    row.setdefault("id", str(uuid.uuid4()))
                    row.setdefault("previous_refresh_token_hash", None)
                    row.setdefault("rotated_at", None)
                    row.setdefault("revoked_at", None)
                self._rows.append(row)
                added.append(dict(row))
            return SimpleNamespace(data=added)
        matched = [row for row in self._rows if all(test(row) for test in self._filters)]
        if action == "update":
            for row in matched:
                row.update(payload)
        if action == "delete":
            for row in matched:
                self._rows.remove(row)
        return SimpleNamespace(data=[dict(row) for row in matched])


class _Database:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}

    def table(self, name):
        return _Query(self.tables.setdefault(name, []), name)


@pytest.fixture(autouse=True)
def registered_school(monkeypatch):
    monkeypatch.setattr(
        auth_service.school_service,
        "get_school",
        lambda school: SimpleNamespace(id=1) if school else None,
    )


@pytest.fixture
def db():
    return _Database()


@pytest.fixture
def service(db):
    return AuthService(db_client=db)


def _existing_user(db, email="student@uwaterloo.ca", school="uwaterloo"):
    db.tables.setdefault(USERS, []).append(
        {
            "id": "db-user-id",
            "supabase_auth_id": "auth-id-1",
            "email": email,
            "school_record": {"slug": school} if school else None,
        }
    )


def _login_code(message) -> str:
    return re.search(r"login code: (\d{6})", message.body_text).group(1)


def _login_link_token(message) -> str:
    link = re.search(r"sign in: (\S+)", message.body_text).group(1)
    return parse_qs(urlparse(link).query)["token"][0]


# ── Email codes and links ───────────────────────────────────────────


def test_login_email_carries_a_code_and_link_that_are_stored_only_hashed(service, db):
    message = service.prepare_otp_email("New@Gmail.com")

    code, link_token = _login_code(message), _login_link_token(message)
    stored = {row["token"] for row in db.tables[VERIFICATION_TOKENS]}
    assert message.to == "new@gmail.com"
    assert stored == {
        hashlib.sha256(code.encode()).hexdigest(),
        hashlib.sha256(link_token.encode()).hexdigest(),
    }
    assert code not in stored and link_token not in stored


def test_prepare_otp_email_preserves_safe_return_path(service, db, monkeypatch):
    _existing_user(db)
    monkeypatch.setattr("services.school_context.settings.frontend_url", "https://wat2do.io")

    message = service.prepare_otp_email(
        "student@uwaterloo.ca",
        return_to="/promote?school=uwaterloo",
    )

    assert "https://uwaterloo.wat2do.io/auth/callback" in message.body_html
    assert "returnTo=%2Fpromote%3Fschool%3Duwaterloo" in message.body_html
    assert "email=student%40uwaterloo.ca" in message.body_text
    assert f">{_login_code(message)}</div>" in message.body_html
    assert '<img src="cid:wat2do-logo"' in message.body_html
    assert message.body_html.index("cid:wat2do-logo") > message.body_html.index("expire in 15")
    assert [image.content_id for image in message.inline_images] == ["wat2do-logo"]
    assert "expire in 15 minutes" in message.body_text


@pytest.mark.parametrize("use_link", [False, True], ids=["code", "link"])
def test_code_or_link_signs_in_once(service, db, use_link):
    _existing_user(db)
    message = service.prepare_otp_email("student@uwaterloo.ca")
    secret = _login_link_token(message) if use_link else _login_code(message)

    result = service.verify_otp("student@uwaterloo.ca", f" {secret} ")

    claims = auth_tokens.decode_access_token(result.body.access_token)
    assert claims["sub"] == "auth-id-1"
    assert claims["email"] == "student@uwaterloo.ca"
    assert result.body.user_id == "auth-id-1"
    assert result.body.school == "uwaterloo"
    assert result.body.onboarding_required is False
    assert db.tables[AUTH_SESSIONS][0]["id"] == claims["session_id"]
    assert db.tables[VERIFICATION_TOKENS] == []
    with pytest.raises(AuthenticationError):
        service.verify_otp("student@uwaterloo.ca", secret)


def test_wrong_or_expired_code_is_rejected_and_kept(service, db):
    message = service.prepare_otp_email("student@uwaterloo.ca")
    wrong = next(code for code in ("000000", "111111") if code != _login_code(message))
    with pytest.raises(AuthenticationError) as exc:
        service.verify_otp("student@uwaterloo.ca", wrong)
    assert exc.value.detail == INVALID_OR_EXPIRED_TOKEN
    assert len(db.tables[VERIFICATION_TOKENS]) == 2

    for row in db.tables[VERIFICATION_TOKENS]:
        row["expires"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    with pytest.raises(AuthenticationError):
        service.verify_otp("student@uwaterloo.ca", _login_code(message))


def test_first_login_creates_the_user_with_a_new_auth_id(service, db):
    message = service.prepare_otp_email("tqiu@uwaterloo.ca")

    result = service.verify_otp("tqiu@uwaterloo.ca", _login_code(message), signup_school="utsg")

    created = db.tables[USERS][0]
    assert created["email"] == "tqiu@uwaterloo.ca"
    assert created["role"] == "admin"
    assert created["school_id"] == 1
    assert created["supabase_auth_id"] == result.body.user_id
    assert created["id"] != created["supabase_auth_id"]
    assert result.body.onboarding_required is True


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://utsg.wat2do.io", "utsg"),
        ("https://wat2do.io", None),
        ("http://localhost:3000", None),
        ("https://utsg.wat2do.io.evil.com", None),
    ],
)
def test_signup_school_from_site(monkeypatch, url, expected):
    from services import school_context

    monkeypatch.setattr(
        school_context.settings, "cors_origin_regex", r"https://([a-z]+\.)?wat2do\.io"
    )
    assert school_context.school_from_frontend_url(url) == expected


# ── Sessions ────────────────────────────────────────────────────────


def _signed_in(service, db):
    _existing_user(db)
    message = service.prepare_otp_email("student@uwaterloo.ca")
    return service.verify_otp("student@uwaterloo.ca", _login_code(message))


def test_refresh_rotates_the_token_and_keeps_the_session(service, db):
    login = _signed_in(service, db)

    first = service.refresh(login.refresh_token)
    second = service.refresh(first.refresh_token)

    assert first.refresh_token not in {login.refresh_token, second.refresh_token}
    session = db.tables[AUTH_SESSIONS][0]
    assert session["refresh_token_hash"] == auth_tokens.refresh_token_hash(second.refresh_token)
    claims = auth_tokens.decode_access_token(second.body.access_token)
    assert claims["session_id"] == session["id"]
    assert claims["email"] == "student@uwaterloo.ca"
    assert second.body.user_id == "auth-id-1"


def test_parallel_refresh_with_the_old_token_gets_the_same_successor(service, db):
    login = _signed_in(service, db)

    first = service.refresh(login.refresh_token)
    again = service.refresh(login.refresh_token)

    assert again.refresh_token == first.refresh_token
    assert db.tables[AUTH_SESSIONS][0]["revoked_at"] is None


def test_an_old_token_reused_after_the_window_revokes_the_session(service, db):
    login = _signed_in(service, db)
    first = service.refresh(login.refresh_token)
    session = db.tables[AUTH_SESSIONS][0]
    reuse = controlbox.authentication.refresh_token_reuse_seconds
    session["rotated_at"] = (datetime.now(timezone.utc) - timedelta(seconds=reuse + 1)).isoformat()

    with pytest.raises(AuthenticationError) as exc:
        service.refresh(login.refresh_token)

    assert exc.value.detail == SESSION_REFRESH_FAILED
    assert session["revoked_at"] is not None
    with pytest.raises(AuthenticationError):
        service.refresh(first.refresh_token)


def test_unknown_or_expired_refresh_tokens_are_rejected(service, db):
    login = _signed_in(service, db)
    with pytest.raises(AuthenticationError):
        service.refresh("never-issued")

    db.tables[AUTH_SESSIONS][0]["expires_at"] = (
        datetime.now(timezone.utc) - timedelta(seconds=1)
    ).isoformat()
    with pytest.raises(AuthenticationError):
        service.refresh(login.refresh_token)


def test_a_session_imported_from_supabase_refreshes(service, db):
    _existing_user(db)
    db.tables[AUTH_SESSIONS] = [
        {
            "id": "imported-session",
            "auth_id": "auth-id-1",
            # The import stores encode(sha256(convert_to(token, 'UTF8')), 'hex').
            "refresh_token_hash": hashlib.sha256(b"supabase-token").hexdigest(),
            "previous_refresh_token_hash": None,
            "rotated_at": None,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
            "revoked_at": None,
        }
    ]

    result = service.refresh("supabase-token")

    claims = auth_tokens.decode_access_token(result.body.access_token)
    assert claims["session_id"] == "imported-session"
    assert claims["sub"] == "auth-id-1"


def test_logout_ends_every_session_of_the_user(service, db):
    login = _signed_in(service, db)
    other = _signed_in(service, db)

    service.logout(login.body.access_token)

    assert all(row["revoked_at"] for row in db.tables[AUTH_SESSIONS])
    for token in (login.refresh_token, other.refresh_token):
        with pytest.raises(AuthenticationError):
            service.refresh(token)


def test_logout_with_a_token_we_did_not_sign_is_rejected(service):
    with pytest.raises(AuthenticationError) as exc:
        service.logout("not-a-jwt")
    assert exc.value.detail == INVALID_OR_EXPIRED_TOKEN


# ── Google ──────────────────────────────────────────────────────────


def test_google_consent_url_uses_pkce_and_state(service):
    start = service.prepare_google_oauth(GOOGLE_REDIRECT)

    url = urlparse(start.authorization_url)
    query = {key: values[0] for key, values in parse_qs(url.query).items()}
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(start.code_verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    assert f"{url.scheme}://{url.netloc}{url.path}" == auth_service.GOOGLE_AUTHORIZATION_URL
    assert query == {
        "client_id": controlbox.authentication.google_client_id,
        "redirect_uri": GOOGLE_REDIRECT,
        "response_type": "code",
        "scope": "openid email profile",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": start.state,
    }
    assert start.state != service.prepare_google_oauth(GOOGLE_REDIRECT).state


@pytest.fixture
def google(monkeypatch):
    """Google's token endpoint and signing keys, answering with an ID token we sign."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    state = SimpleNamespace(claims={}, requests=[])

    def post(url, data, timeout):
        state.requests.append((url, data))
        now = int(datetime.now(timezone.utc).timestamp())
        claims = {
            "iss": "https://accounts.google.com",
            "aud": controlbox.authentication.google_client_id,
            "iat": now,
            "exp": now + 300,
            **state.claims,
        }
        id_token = jwt.encode(claims, key, algorithm="RS256")
        return httpx.Response(200, json={"id_token": id_token}, request=httpx.Request("POST", url))

    monkeypatch.setattr(auth_service.httpx, "post", post)
    monkeypatch.setattr(
        auth_service._google_keys,
        "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=key.public_key()),
    )
    return state


def test_google_sign_in_finds_the_user_by_verified_email(service, db, google):
    _existing_user(db)
    google.claims = {"email": "Student@UWaterloo.ca", "email_verified": True}

    result = service.verify_google_oauth(
        "auth-code", "pkce-verifier", GOOGLE_REDIRECT, SCHOOL_CALLBACK
    )

    assert result.body.user_id == "auth-id-1"
    assert result.body.school == "uwaterloo"
    assert result.refresh_token
    url, form = google.requests[0]
    assert url == auth_service.GOOGLE_TOKEN_URL
    assert form["code"] == "auth-code"
    assert form["code_verifier"] == "pkce-verifier"
    assert form["redirect_uri"] == GOOGLE_REDIRECT
    assert form["grant_type"] == "authorization_code"


@pytest.mark.parametrize("school", [None, "utsg"])
def test_google_signup_accepts_personal_email_and_uses_site_school(
    service, db, google, monkeypatch, school
):
    google.claims = {"email": "new@gmail.com", "email_verified": True}
    monkeypatch.setattr(auth_service, "school_from_frontend_url", lambda url: school)

    result = service.verify_google_oauth("code", "verifier", GOOGLE_REDIRECT, SCHOOL_CALLBACK)

    assert result.body.school == school
    assert result.body.onboarding_required
    created = db.tables[USERS][0]
    assert created["email"] == "new@gmail.com"
    assert created["school_id"] == (1 if school else None)


@pytest.mark.parametrize(
    "claims",
    [
        {"email": "student@uwaterloo.ca", "email_verified": False},
        {"email_verified": True},
        {"email": "student@uwaterloo.ca", "email_verified": True, "aud": "someone-else"},
    ],
    ids=["unverified", "no-email", "other-client"],
)
def test_google_sign_in_without_a_verified_email_for_us_is_refused(service, db, google, claims):
    google.claims = claims

    with pytest.raises(AuthenticationError):
        service.verify_google_oauth("code", "verifier", GOOGLE_REDIRECT, SCHOOL_CALLBACK)

    assert db.tables.get(AUTH_SESSIONS, []) == []
