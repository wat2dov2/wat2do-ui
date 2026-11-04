//! `core/auth.py` and `core/auth_tokens.py`: our own ES256 access tokens,
//! verified locally with the public half of `AUTH_SIGNING_KEY`, and the
//! extractors routes declare to require them.
//!
//! | Python dependency | Rust extractor |
//! |---|---|
//! | `get_current_user` | `CurrentUser` |
//! | `get_optional_user` | `OptionalUser` |
//! | `get_db_user` | `DbUser` |
//! | `get_admin_user` | `AdminUser` |
//! | `get_club_owner_or_admin` | `ClubOwnerOrAdmin` |
//!
//! `require_owner_or_admin` and `authorized_resource` cover ownership checks.

use aws_lc_rs::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair, KeyPair};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{HeaderMap, header};
use base64::Engine;
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde_json::{Map, Value};
use uuid::Uuid;

use super::AppState;
use super::errors::ApiError;
use super::messages::{
    ADMIN_ACCESS_REQUIRED, CLUB_MEMBER_OR_ADMIN_ACCESS_REQUIRED, CREDENTIALS_INVALID,
    INVALID_OR_EXPIRED_TOKEN, NOT_AUTHORIZED, USER_NOT_FOUND,
};
use crate::settings::Settings;

/// `core.constants.roles.ROLE_ADMIN`.
pub const ROLE_ADMIN: &str = "admin";

/// FastAPI's `HTTPBearer` answer to a missing or non-Bearer `Authorization` header.
const NOT_AUTHENTICATED: &str = "Not authenticated";
/// `ACCESS_TOKEN_AUDIENCE`.
const AUDIENCE: &str = "authenticated";
/// `decode_access_token`'s `options={"require": [...]}`: present and not null.
const REQUIRED_CLAIMS: [&str; 4] = ["exp", "iat", "sub", "session_id"];

/// The identity a verified token carries (`AuthUser`). `id` is the auth id
/// (`sub`, `users.auth_id`), not `users.id`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthUser {
    pub id: String,
    pub email: Option<String>,
    pub aud: Option<String>,
    pub role: Option<String>,
}

/// The internal `users` row behind an `AuthUser` (the fields auth decisions read).
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub school_id: Option<i32>,
    /// The school's slug.
    pub school: Option<String>,
}

impl User {
    /// `is_admin`.
    pub fn is_admin(&self) -> bool {
        self.role == ROLE_ADMIN
    }
}

enum VerifyError {
    /// 401 `INVALID_OR_EXPIRED_TOKEN` (or `CREDENTIALS_INVALID` without a subject).
    Invalid(String),
    /// 500: `AUTH_SIGNING_KEY` is missing or not an EC P-256 private key, so no
    /// token can be checked (Python's `_private_key` raises `RuntimeError`).
    NoKey(String),
}

impl VerifyError {
    fn into_api_error(self) -> ApiError {
        match self {
            Self::Invalid(reason) => {
                tracing::warn!("Access token verification failed: {reason}");
                if reason == CREDENTIALS_INVALID {
                    ApiError::authentication(CREDENTIALS_INVALID)
                } else {
                    ApiError::authentication(INVALID_OR_EXPIRED_TOKEN)
                }
            }
            Self::NoKey(reason) => ApiError::Internal(anyhow::anyhow!(reason)),
        }
    }
}

/// `_public_key()`: the verifying half of `AUTH_SIGNING_KEY`, a base64 PKCS#8
/// DER EC P-256 private key (`openssl genpkey -algorithm EC -pkeyopt
/// ec_paramgen_curve:P-256 -outform DER | base64`).
fn verifying_key(encoded: &str) -> Result<DecodingKey, String> {
    if encoded.is_empty() {
        return Err(
            "AUTH_SIGNING_KEY is not set. Generate one with `openssl genpkey \
                    -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -outform DER | base64` \
                    and put it in your .env file."
                .to_owned(),
        );
    }
    // `base64.b64decode` skips characters outside the alphabet, such as line breaks.
    let alphabet: String = encoded
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || "+/=".contains(*character))
        .collect();
    let der = base64::engine::general_purpose::STANDARD
        .decode(alphabet)
        .map_err(|error| format!("AUTH_SIGNING_KEY is not base64: {error}"))?;
    // PKCS#8, or the RFC 5915 form `load_der_private_key` also reads; any other
    // curve is refused like Python's `secp256r1` check.
    let pair = EcdsaKeyPair::from_private_key_der(&ECDSA_P256_SHA256_FIXED_SIGNING, &der)
        .map_err(|_| "AUTH_SIGNING_KEY must be an EC P-256 private key".to_owned())?;
    // The uncompressed point, which is the form the ES256 verifier takes.
    Ok(DecodingKey::from_ec_der(pair.public_key().as_ref()))
}

/// Verifies the access tokens `services/auth_service.py` issues.
pub struct AccessTokens {
    key: Result<DecodingKey, String>,
    /// `controlbox/authentication.json` `token_issuer`.
    issuer: &'static str,
}

impl AccessTokens {
    pub fn new(settings: &Settings) -> Self {
        Self {
            key: verifying_key(&settings.auth_signing_key),
            issuer: &crate::controlbox::AUTHENTICATION.token_issuer,
        }
    }

    /// `decode_access_token` followed by `_payload_to_user`.
    fn verify(&self, token: &str) -> Result<AuthUser, VerifyError> {
        // Python reads the key before it parses the token, so a missing key
        // fails every presented token, well formed or not.
        let key = self
            .key
            .as_ref()
            .map_err(|reason| VerifyError::NoKey(reason.clone()))?;
        let header = jsonwebtoken::decode_header(token)
            .map_err(|error| VerifyError::Invalid(error.to_string()))?;
        if header.alg != Algorithm::ES256 {
            return Err(VerifyError::Invalid(
                "The specified alg value is not allowed".into(),
            ));
        }
        let mut validation = Validation::new(Algorithm::ES256);
        // Claims are checked below exactly as PyJWT checks them.
        validation.validate_exp = false;
        validation.validate_aud = false;
        validation.required_spec_claims.clear();
        let claims = jsonwebtoken::decode::<Map<String, Value>>(token, key, &validation)
            .map_err(|error| VerifyError::Invalid(error.to_string()))?
            .claims;
        validate_claims(&claims, self.issuer, now_seconds())?;
        user_from_claims(&claims)
    }
}

fn now_seconds() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .unwrap_or_default()
}

/// Python's `int(value)` for a numeric claim.
fn claim_integer(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64().map(f64::trunc),
        Value::Bool(flag) => Some(f64::from(u8::from(*flag))),
        Value::String(text) => text.trim().parse::<i64>().ok().map(|number| number as f64),
        _ => None,
    }
}

/// Python's truthiness of a JSON value.
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(values) => !values.is_empty(),
        Value::Object(fields) => !fields.is_empty(),
    }
}

/// PyJWT's `_validate_claims` for `decode_access_token`: the required claims,
/// `audience="authenticated"`, our issuer and no leeway.
fn validate_claims(claims: &Map<String, Value>, issuer: &str, now: f64) -> Result<(), VerifyError> {
    let invalid = |reason: &str| Err(VerifyError::Invalid(reason.to_owned()));
    for claim in REQUIRED_CLAIMS {
        if claims.get(claim).is_none_or(Value::is_null) {
            return invalid(&format!("Token is missing the \"{claim}\" claim"));
        }
    }
    if let Some(iat) = claims.get("iat") {
        match claim_integer(iat) {
            None => return invalid("Issued At claim (iat) must be an integer."),
            Some(iat) if iat > now => return invalid("The token is not yet valid (iat)"),
            Some(_) => {}
        }
    }
    if let Some(nbf) = claims.get("nbf") {
        match claim_integer(nbf) {
            None => return invalid("Not Before claim (nbf) must be an integer."),
            Some(nbf) if nbf > now => return invalid("The token is not yet valid (nbf)"),
            Some(_) => {}
        }
    }
    if let Some(exp) = claims.get("exp") {
        match claim_integer(exp) {
            None => return invalid("Expiration Time claim (exp) must be an integer."),
            Some(exp) if exp <= now => return invalid("Signature has expired"),
            Some(_) => {}
        }
    }
    match claims.get("iss") {
        None => return invalid("Token is missing the \"iss\" claim"),
        Some(Value::String(value)) if value == issuer => {}
        Some(Value::String(_)) => return invalid("Invalid issuer"),
        Some(_) => return invalid("Payload Issuer (iss) must be a string"),
    }
    let audiences: Vec<&Value> = match claims.get("aud") {
        Some(value) if !is_truthy(value) => return invalid("Token is missing the \"aud\" claim"),
        None => return invalid("Token is missing the \"aud\" claim"),
        Some(Value::Array(values)) => values.iter().collect(),
        Some(value @ Value::String(_)) => vec![value],
        Some(_) => return invalid("Invalid claim format in token"),
    };
    if !audiences.iter().all(|value| value.is_string()) {
        return invalid("Invalid claim format in token");
    }
    if !audiences
        .iter()
        .any(|value| value.as_str() == Some(AUDIENCE))
    {
        return invalid("Audience doesn't match");
    }
    if claims.get("sub").is_some_and(|sub| !sub.is_string()) {
        return invalid("Subject must be a string");
    }
    if claims.get("jti").is_some_and(|jti| !jti.is_string()) {
        return invalid("JWT ID must be a string");
    }
    Ok(())
}

/// `_payload_to_user`.
fn user_from_claims(claims: &Map<String, Value>) -> Result<AuthUser, VerifyError> {
    let text = |name: &str| claims.get(name).and_then(Value::as_str).map(str::to_owned);
    let id = text("sub")
        .filter(|sub| !sub.is_empty())
        .ok_or_else(|| VerifyError::Invalid(CREDENTIALS_INVALID.to_owned()))?;
    let aud = match claims.get("aud") {
        Some(Value::Array(values)) => values.first().and_then(Value::as_str).map(str::to_owned),
        _ => text("aud"),
    };
    Ok(AuthUser {
        id,
        email: text("email"),
        aud,
        role: text("role"),
    })
}

/// `HTTPBearer`: the credentials of a `Bearer` authorization header.
fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let authorization = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, credentials) = authorization.split_once(' ').unwrap_or((authorization, ""));
    let credentials = credentials.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !credentials.is_empty()).then_some(credentials)
}

impl AccessTokens {
    fn current(&self, headers: &HeaderMap) -> Result<AuthUser, ApiError> {
        let token =
            bearer_token(headers).ok_or_else(|| ApiError::authentication(NOT_AUTHENTICATED))?;
        self.verify(token).map_err(VerifyError::into_api_error)
    }

    fn optional(&self, headers: &HeaderMap) -> Result<Option<AuthUser>, ApiError> {
        let Some(token) = bearer_token(headers) else {
            return Ok(None);
        };
        match self.verify(token) {
            Ok(user) => Ok(Some(user)),
            Err(error @ VerifyError::NoKey(_)) => Err(error.into_api_error()),
            Err(error) => {
                let detail = match error.into_api_error() {
                    ApiError::Authentication(detail) => detail,
                    other => format!("{other:?}"),
                };
                tracing::warn!(
                    "Optional auth failed with invalid token, continuing as anonymous: {detail}"
                );
                Ok(None)
            }
        }
    }
}

/// `get_current_user`: a valid Bearer token, else 401.
pub struct CurrentUser(pub AuthUser);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        state.auth.current(&parts.headers).map(Self)
    }
}

/// `get_optional_user`: the token's identity, or `None` when absent or invalid.
pub struct OptionalUser(pub Option<AuthUser>);

impl FromRequestParts<AppState> for OptionalUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        state.auth.optional(&parts.headers).map(Self)
    }
}

/// `resolve_db_user`: the `users` row of an auth id, read fresh.
pub async fn find_user(db: &sqlx::PgPool, auth_id: &str) -> Result<Option<User>, ApiError> {
    Ok(sqlx::query_as::<_, User>(
        "SELECT users.id, users.email, users.role, users.school_id, schools.slug AS school \
         FROM public.users LEFT JOIN public.schools ON schools.id = users.school_id \
         WHERE users.auth_id = $1 LIMIT 1",
    )
    .bind(auth_id)
    .fetch_optional(db)
    .await?)
}

/// `AuthService.revoke_sessions`: end every live session of one account.
pub async fn revoke_sessions(
    db: impl sqlx::PgExecutor<'_>,
    auth_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE public.auth_sessions SET revoked_at = now() \
         WHERE auth_id = $1 AND revoked_at IS NULL",
    )
    .bind(auth_id)
    .execute(db)
    .await?;
    Ok(())
}

/// `get_db_user`: authenticated, with a `users` row (404 before signup completes).
pub struct DbUser(pub User);

impl FromRequestParts<AppState> for DbUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let CurrentUser(auth_user) = CurrentUser::from_request_parts(parts, state).await?;
        find_user(&state.db, &auth_user.id)
            .await?
            .map(Self)
            .ok_or_else(|| ApiError::not_found(USER_NOT_FOUND))
    }
}

/// `get_admin_user`: a `DbUser` whose current role is admin, else 403.
pub struct AdminUser(pub User);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let DbUser(user) = DbUser::from_request_parts(parts, state).await?;
        if !user.is_admin() {
            return Err(ApiError::authorization(ADMIN_ACCESS_REQUIRED));
        }
        Ok(Self(user))
    }
}

/// `get_club_owner_or_admin`: an admin, or a member of at least one club.
pub struct ClubOwnerOrAdmin(pub User);

impl FromRequestParts<AppState> for ClubOwnerOrAdmin {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let DbUser(user) = DbUser::from_request_parts(parts, state).await?;
        if user.is_admin() {
            return Ok(Self(user));
        }
        let is_member = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM public.club_members \
             JOIN public.clubs ON clubs.id = club_members.club_id \
             WHERE club_members.user_id = $1)",
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        // As in `list_clubs_by_owner`, a failed lookup reads as no clubs.
        .unwrap_or_else(|error| {
            tracing::warn!(
                "Failed to query club_members for owner_id {}: {error}",
                user.id
            );
            false
        });
        if !is_member {
            return Err(ApiError::authorization(
                CLUB_MEMBER_OR_ADMIN_ACCESS_REQUIRED,
            ));
        }
        Ok(Self(user))
    }
}

/// `require_owner_or_admin`: 403 unless `user` owns the resource or is an admin.
/// An unowned resource (`None`) is admin-only.
pub fn require_owner_or_admin(user: &User, owner: Option<Uuid>) -> Result<(), ApiError> {
    if owner == Some(user.id) || user.is_admin() {
        Ok(())
    } else {
        Err(ApiError::authorization(NOT_AUTHORIZED))
    }
}

/// `get_authorized_resource`: 404 when missing, 403 unless owner or admin.
pub fn authorized_resource<T>(
    resource: Option<T>,
    not_found: &str,
    user: &User,
    owner: impl FnOnce(&T) -> Option<Uuid>,
) -> Result<T, ApiError> {
    let resource = resource.ok_or_else(|| ApiError::not_found(not_found))?;
    require_owner_or_admin(user, owner(&resource))?;
    Ok(resource)
}

/// A throwaway signing key and tokens signed with it, for tests anywhere in
/// the crate (`test_settings` sets `AUTH_SIGNING_KEY` to this key).
#[cfg(test)]
pub(crate) mod test_tokens {
    use std::sync::LazyLock;

    use aws_lc_rs::rand::SystemRandom;
    use aws_lc_rs::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair};
    use base64::Engine;
    use jsonwebtoken::{Algorithm, EncodingKey, Header};
    use serde_json::{Value, json};

    fn new_key() -> Vec<u8> {
        EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
            .expect("a P-256 key")
            .as_ref()
            .to_vec()
    }

    static KEY: LazyLock<Vec<u8>> = LazyLock::new(new_key);

    /// `AUTH_SIGNING_KEY` for tests: base64 PKCS#8 DER, as `openssl` writes it.
    pub(crate) fn signing_key() -> String {
        base64::engine::general_purpose::STANDARD.encode(&*KEY)
    }

    /// The claims `issue_access_token` signs, now and for 15 minutes.
    pub(crate) fn claims(subject: &str) -> Value {
        let now = chrono::Utc::now().timestamp();
        json!({
            "iss": crate::controlbox::AUTHENTICATION.token_issuer,
            "aud": "authenticated",
            "role": "authenticated",
            "sub": subject,
            "email": "student@example.com",
            "session_id": "session-1",
            "iat": now,
            "exp": now + 900,
        })
    }

    fn sign_with(claims: &Value, key: &[u8]) -> String {
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some("test".into());
        jsonwebtoken::encode(&header, claims, &EncodingKey::from_ec_der(key)).expect("a token")
    }

    /// `claims` signed with the test key.
    pub(crate) fn sign(claims: &Value) -> String {
        sign_with(claims, &KEY)
    }

    /// `claims` signed with a key nobody configured.
    pub(crate) fn sign_with_another_key(claims: &Value) -> String {
        sign_with(claims, &new_key())
    }

    /// An access token for `subject`, as `issue_access_token` would sign it.
    pub(crate) fn access_token(subject: &str) -> String {
        sign(&claims(subject))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::test_settings;
    use base64::Engine;
    use serde_json::json;
    use test_tokens::{access_token, claims as token_claims, sign, sign_with_another_key};

    fn claims(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    const ISSUER: &str = "wat2do";

    fn valid() -> Value {
        json!({"sub": "abc", "aud": "authenticated", "iss": ISSUER, "exp": 2000.0, "iat": 1000,
            "session_id": "s", "email": "a@b.ca", "role": "authenticated"})
    }

    fn reason(result: Result<(), VerifyError>) -> String {
        match result {
            Err(VerifyError::Invalid(reason)) => reason,
            Err(_) => "other".into(),
            Ok(()) => "ok".into(),
        }
    }

    fn tokens() -> AccessTokens {
        AccessTokens::new(&test_settings(&[]))
    }

    fn bearer(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        );
        headers
    }

    fn rejection(result: Result<AuthUser, ApiError>) -> String {
        match result {
            Err(ApiError::Authentication(detail)) => detail,
            other => format!("{other:?}"),
        }
    }

    #[test]
    fn the_issuer_is_the_controlbox_one() {
        assert_eq!(tokens().issuer, "wat2do");
        assert_eq!(crate::controlbox::AUTHENTICATION.token_issuer, ISSUER);
    }

    #[test]
    fn our_access_token_resolves_to_its_user() {
        // test_auth.py::test_our_access_token_resolves_to_its_user
        let user = tokens()
            .current(&bearer(&access_token("auth-id-1")))
            .unwrap();
        assert_eq!(
            user,
            AuthUser {
                id: "auth-id-1".into(),
                email: Some("student@example.com".into()),
                aud: Some("authenticated".into()),
                role: Some("authenticated".into()),
            }
        );
    }

    #[test]
    fn tokens_we_did_not_sign_are_rejected() {
        // test_auth.py::test_tokens_we_did_not_sign_are_rejected
        let claims = token_claims("auth-id-1");
        let hmac = jsonwebtoken::encode(
            &jsonwebtoken::Header::new(Algorithm::HS256),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(b"shared-secret"),
        )
        .unwrap();
        let encode = |value: &Value| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value.to_string())
        };
        let unsigned = format!(
            "{}.{}.",
            encode(&json!({"alg": "none", "typ": "JWT"})),
            encode(&claims)
        );
        for token in [
            sign_with_another_key(&claims),
            hmac,
            unsigned,
            "not-a-jwt".to_owned(),
        ] {
            assert_eq!(
                rejection(tokens().current(&bearer(&token))),
                INVALID_OR_EXPIRED_TOKEN
            );
        }
    }

    #[test]
    fn expired_or_misaddressed_tokens_are_rejected() {
        // test_auth.py::test_expired_or_misaddressed_tokens_are_rejected
        let now = chrono::Utc::now().timestamp();
        for (name, value) in [
            ("exp", json!(now - 1)),
            ("aud", json!("anon")),
            ("iss", json!("https://other-issuer.example/auth/v1")),
            ("session_id", Value::Null),
            ("sub", Value::Null),
            ("iat", Value::Null),
        ] {
            let mut claims = token_claims("auth-id-1");
            if value.is_null() {
                claims.as_object_mut().unwrap().remove(name);
            } else {
                claims[name] = value;
            }
            assert_eq!(
                rejection(tokens().current(&bearer(&sign(&claims)))),
                INVALID_OR_EXPIRED_TOKEN,
                "{name}"
            );
        }
        // A null required claim counts as missing.
        let mut claims = token_claims("auth-id-1");
        claims["session_id"] = Value::Null;
        assert_eq!(
            rejection(tokens().current(&bearer(&sign(&claims)))),
            INVALID_OR_EXPIRED_TOKEN
        );
        // An empty subject passes PyJWT but names nobody.
        let mut claims = token_claims("auth-id-1");
        claims["sub"] = json!("");
        assert_eq!(
            rejection(tokens().current(&bearer(&sign(&claims)))),
            CREDENTIALS_INVALID
        );
    }

    #[test]
    fn optional_auth_treats_a_bad_token_as_anonymous() {
        // test_auth.py::test_optional_auth_treats_a_bad_token_as_anonymous
        assert_eq!(tokens().optional(&bearer("not-a-jwt")).unwrap(), None);
        assert_eq!(tokens().optional(&HeaderMap::new()).unwrap(), None);
        let mut claims = token_claims("auth-id-1");
        claims["sub"] = json!("");
        assert_eq!(tokens().optional(&bearer(&sign(&claims))).unwrap(), None);
        assert_eq!(
            tokens()
                .optional(&bearer(&access_token("auth-id-1")))
                .unwrap()
                .map(|user| user.id),
            Some("auth-id-1".to_owned())
        );
        assert!(matches!(
            tokens().current(&HeaderMap::new()),
            Err(ApiError::Authentication(detail)) if detail == NOT_AUTHENTICATED
        ));
    }

    #[test]
    fn without_a_signing_key_every_token_is_a_server_error() {
        // `_private_key` raises RuntimeError, which neither dependency catches.
        for key in [
            "",
            "bm90IGEga2V5",
            "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQ",
        ] {
            let tokens = AccessTokens::new(&test_settings(&[("AUTH_SIGNING_KEY", key)]));
            assert!(tokens.key.is_err(), "{key}");
            for token in ["not-a-jwt".to_owned(), access_token("auth-id-1")] {
                assert!(matches!(
                    tokens.current(&bearer(&token)),
                    Err(ApiError::Internal(_))
                ));
                assert!(matches!(
                    tokens.optional(&bearer(&token)),
                    Err(ApiError::Internal(_))
                ));
            }
            // No token at all never needs the key.
            assert_eq!(tokens.optional(&HeaderMap::new()).unwrap(), None);
        }
    }

    #[test]
    fn the_key_may_carry_line_breaks() {
        let key = test_tokens::signing_key();
        let wrapped = key
            .as_bytes()
            .chunks(76)
            .map(|line| std::str::from_utf8(line).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        let tokens = AccessTokens::new(&test_settings(&[("AUTH_SIGNING_KEY", &wrapped)]));
        assert!(tokens.current(&bearer(&access_token("a"))).is_ok());
    }

    #[test]
    fn claims_are_checked_like_pyjwt() {
        assert_eq!(
            reason(validate_claims(&claims(valid()), ISSUER, 1500.0)),
            "ok"
        );
        assert_eq!(
            reason(validate_claims(&claims(valid()), ISSUER, 2000.0)),
            "Signature has expired"
        );
        assert_eq!(
            reason(validate_claims(&claims(valid()), ISSUER, 999.0)),
            "The token is not yet valid (iat)"
        );
        let mut wrong = valid();
        wrong["aud"] = json!(["anon", "authenticated"]);
        assert_eq!(
            reason(validate_claims(&claims(wrong.clone()), ISSUER, 1500.0)),
            "ok"
        );
        wrong["aud"] = json!("anon");
        assert_eq!(
            reason(validate_claims(&claims(wrong.clone()), ISSUER, 1500.0)),
            "Audience doesn't match"
        );
        wrong["aud"] = json!("");
        assert!(reason(validate_claims(&claims(wrong.clone()), ISSUER, 1500.0)).contains("aud"));
        wrong["aud"] = json!(5);
        assert_eq!(
            reason(validate_claims(&claims(wrong.clone()), ISSUER, 1500.0)),
            "Invalid claim format in token"
        );
        wrong = valid();
        wrong.as_object_mut().unwrap().remove("aud");
        assert!(reason(validate_claims(&claims(wrong), ISSUER, 1500.0)).contains("aud"));
        wrong = valid();
        wrong["iss"] = json!("https://evil/auth/v1");
        assert_eq!(
            reason(validate_claims(&claims(wrong), ISSUER, 1500.0)),
            "Invalid issuer"
        );
        wrong = valid();
        wrong["iss"] = json!(["wat2do"]);
        assert_eq!(
            reason(validate_claims(&claims(wrong), ISSUER, 1500.0)),
            "Payload Issuer (iss) must be a string"
        );
        wrong = valid();
        wrong["sub"] = json!(5);
        assert_eq!(
            reason(validate_claims(&claims(wrong), ISSUER, 1500.0)),
            "Subject must be a string"
        );
        wrong = valid();
        wrong["nbf"] = json!(1600);
        assert_eq!(
            reason(validate_claims(&claims(wrong), ISSUER, 1500.0)),
            "The token is not yet valid (nbf)"
        );
        wrong = valid();
        wrong["iat"] = json!("1000");
        assert_eq!(
            reason(validate_claims(&claims(wrong), ISSUER, 1500.0)),
            "ok"
        );
        for required in REQUIRED_CLAIMS {
            wrong = valid();
            wrong.as_object_mut().unwrap().remove(required);
            assert_eq!(
                reason(validate_claims(&claims(wrong), ISSUER, 1500.0)),
                format!("Token is missing the \"{required}\" claim")
            );
        }
    }

    #[test]
    fn subject_is_required_for_an_identity() {
        let user = user_from_claims(&claims(valid())).ok().unwrap();
        assert_eq!(
            user,
            AuthUser {
                id: "abc".into(),
                email: Some("a@b.ca".into()),
                aud: Some("authenticated".into()),
                role: Some("authenticated".into()),
            }
        );
        let mut no_sub = valid();
        no_sub["sub"] = json!("");
        assert!(matches!(
            user_from_claims(&claims(no_sub)),
            Err(VerifyError::Invalid(reason)) if reason == CREDENTIALS_INVALID
        ));
    }

    #[test]
    fn bearer_parsing_matches_httpbearer() {
        let headers = |value: &str| {
            let mut map = HeaderMap::new();
            map.insert(header::AUTHORIZATION, value.parse().unwrap());
            map
        };
        assert_eq!(bearer_token(&headers("Bearer tok")), Some("tok"));
        assert_eq!(bearer_token(&headers("bearer   tok")), Some("tok"));
        assert_eq!(bearer_token(&headers("Basic abc")), None);
        assert_eq!(bearer_token(&headers("Bearer")), None);
        assert_eq!(bearer_token(&HeaderMap::new()), None);
    }

    fn user(role: &str) -> User {
        User {
            id: Uuid::from_u128(1),
            email: "a@b.ca".into(),
            role: role.into(),
            school_id: None,
            school: None,
        }
    }

    #[test]
    fn ownership_checks() {
        let owner = user("user");
        assert!(require_owner_or_admin(&owner, Some(owner.id)).is_ok());
        assert!(require_owner_or_admin(&owner, Some(Uuid::from_u128(2))).is_err());
        assert!(require_owner_or_admin(&owner, None).is_err());
        assert!(require_owner_or_admin(&user("admin"), None).is_ok());
        let missing = authorized_resource::<Uuid>(None, "Event not found", &owner, |id| Some(*id));
        assert!(matches!(missing, Err(ApiError::NotFound(detail)) if detail == "Event not found"));
        let foreign = authorized_resource(Some(Uuid::from_u128(2)), "x", &owner, |id| Some(*id));
        assert!(
            matches!(foreign, Err(ApiError::Authorization(detail)) if detail == NOT_AUTHORIZED)
        );
        assert!(authorized_resource(Some(owner.id), "x", &owner, |id| Some(*id)).is_ok());
    }
}
