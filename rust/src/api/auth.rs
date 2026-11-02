//! `core/auth.py`: Supabase access tokens verified locally against the
//! project's JWKS, and the extractors routes declare to require them.
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

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode, header};
use jsonwebtoken::jwk::Jwk;
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde_json::{Map, Value};
use uuid::Uuid;

use super::AppState;
use super::errors::ApiError;
use super::messages::{
    ADMIN_ACCESS_REQUIRED, AUTHENTICATION_ERROR, CLUB_MEMBER_OR_ADMIN_ACCESS_REQUIRED,
    CREDENTIALS_INVALID, INVALID_OR_EXPIRED_TOKEN, NOT_AUTHORIZED, USER_NOT_FOUND,
};
use crate::settings::Settings;

/// `core.constants.roles.ROLE_ADMIN`.
pub const ROLE_ADMIN: &str = "admin";

/// FastAPI's `HTTPBearer` answer to a missing or non-Bearer `Authorization` header.
const NOT_AUTHENTICATED: &str = "Not authenticated";
/// Only asymmetric algorithms: HS256 here would allow algorithm confusion.
const ALGORITHMS: [Algorithm; 3] = [Algorithm::RS256, Algorithm::ES256, Algorithm::EdDSA];
const AUDIENCE: &str = "authenticated";
/// `PyJWKClient(lifespan=600)`: the fetched key set is reused for ten minutes.
const JWKS_LIFESPAN: Duration = Duration::from_secs(600);
/// `PyJWKClient(cache_keys=True)`: up to 16 keys by `kid`, kept for the process.
const CACHED_KEYS: usize = 16;
/// A token naming an unknown `kid` refetches the key set at most this often;
/// in between, such tokens fail like any invalid token. (PyJWKClient refetched
/// for every one, which let anyone make the API hammer the key endpoint.)
const UNKNOWN_KID_REFETCH: Duration = Duration::from_secs(30);
/// `PyJWKClient`'s default fetch timeout.
const JWKS_TIMEOUT: Duration = Duration::from_secs(30);

/// The identity a verified token carries (`AuthUser`). `id` is the Supabase
/// auth id (`sub`), not `users.id`.
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
    /// 503: the key endpoint could not be reached, so the token is not proven bad.
    Unavailable(String),
    /// 500: the key endpoint answered with something that is not JSON.
    Malformed(String),
}

impl VerifyError {
    fn into_api_error(self) -> ApiError {
        match self {
            Self::Invalid(reason) => {
                tracing::warn!("JWKS verification failed: {reason}");
                if reason == CREDENTIALS_INVALID {
                    ApiError::authentication(CREDENTIALS_INVALID)
                } else {
                    ApiError::authentication(INVALID_OR_EXPIRED_TOKEN)
                }
            }
            Self::Unavailable(reason) => {
                tracing::warn!("JWKS endpoint unavailable: {reason}");
                ApiError::http(StatusCode::SERVICE_UNAVAILABLE, AUTHENTICATION_ERROR)
            }
            Self::Malformed(reason) => {
                ApiError::Internal(anyhow::anyhow!("JWKS response: {reason}"))
            }
        }
    }
}

struct KeySet {
    fetched: Instant,
    /// Signing keys (`use` absent or "sig", with a `kid`) that parsed.
    keys: Vec<(String, Jwk)>,
}

/// Verifies Supabase access tokens with the project's public keys.
pub struct JwksVerifier {
    url: String,
    issuer: String,
    key_set: tokio::sync::Mutex<Option<KeySet>>,
    keys: Mutex<HashMap<String, Jwk>>,
    last_refetch: Mutex<Option<Instant>>,
}

impl JwksVerifier {
    pub fn new(settings: &Settings) -> Self {
        let project = settings.supabase_url.trim_end_matches('/');
        let issuer = if settings.supabase_jwt_issuer.is_empty() {
            format!("{project}/auth/v1")
        } else {
            settings.supabase_jwt_issuer.clone()
        };
        Self {
            url: format!("{project}/auth/v1/.well-known/jwks.json"),
            issuer,
            key_set: tokio::sync::Mutex::new(None),
            keys: Mutex::new(HashMap::new()),
            last_refetch: Mutex::new(None),
        }
    }

    async fn fetch(&self) -> Result<Vec<(String, Jwk)>, VerifyError> {
        let client = wreq::Client::builder()
            .timeout(JWKS_TIMEOUT)
            .build()
            .map_err(|error| VerifyError::Unavailable(error.to_string()))?;
        let body = client
            .get(&self.url)
            .send()
            .await
            .and_then(wreq::Response::error_for_status)
            .map_err(|error| VerifyError::Unavailable(error.to_string()))?
            .bytes()
            .await
            .map_err(|error| VerifyError::Unavailable(error.to_string()))?;
        let document: Value = serde_json::from_slice(&body)
            .map_err(|error| VerifyError::Malformed(error.to_string()))?;
        signing_keys(&document)
    }

    async fn signing_keys(&self, refresh: bool) -> Result<Vec<(String, Jwk)>, VerifyError> {
        let mut key_set = self.key_set.lock().await;
        if !refresh
            && let Some(cached) = key_set.as_ref()
            && cached.fetched.elapsed() < JWKS_LIFESPAN
        {
            return Ok(cached.keys.clone());
        }
        let keys = self.fetch().await?;
        *key_set = Some(KeySet {
            fetched: Instant::now(),
            keys: keys.clone(),
        });
        Ok(keys)
    }

    async fn key(&self, kid: Option<&str>) -> Result<Jwk, VerifyError> {
        let kid = kid.unwrap_or_default();
        if let Some(key) = self.keys.lock().expect("key cache").get(kid) {
            return Ok(key.clone());
        }
        let find = |keys: Vec<(String, Jwk)>| {
            keys.into_iter()
                .find(|(key_id, _)| key_id == kid)
                .map(|(_, key)| key)
        };
        let unknown = || {
            VerifyError::Invalid(format!(
                "Unable to find a signing key that matches: \"{kid}\""
            ))
        };
        let key = match find(self.signing_keys(false).await?) {
            Some(key) => key,
            None => {
                if !self.may_refetch() {
                    return Err(unknown());
                }
                find(self.signing_keys(true).await?).ok_or_else(unknown)?
            }
        };
        let mut cache = self.keys.lock().expect("key cache");
        if cache.len() >= CACHED_KEYS {
            cache.clear();
        }
        cache.insert(kid.to_owned(), key.clone());
        Ok(key)
    }

    /// Whether an unknown `kid` may refetch the key set now (and record it if so).
    fn may_refetch(&self) -> bool {
        let mut last = self.last_refetch.lock().expect("refetch time");
        if last.is_some_and(|at| at.elapsed() < UNKNOWN_KID_REFETCH) {
            return false;
        }
        *last = Some(Instant::now());
        true
    }

    async fn verify(&self, token: &str) -> Result<AuthUser, VerifyError> {
        let header = jsonwebtoken::decode_header(token)
            .map_err(|error| VerifyError::Invalid(error.to_string()))?;
        let jwk = self.key(header.kid.as_deref()).await?;
        if !ALGORITHMS.contains(&header.alg) {
            return Err(VerifyError::Invalid(
                "The specified alg value is not allowed".into(),
            ));
        }
        let key =
            DecodingKey::from_jwk(&jwk).map_err(|error| VerifyError::Invalid(error.to_string()))?;
        let mut validation = Validation::new(header.alg);
        // Claims are checked below exactly as PyJWT checks them.
        validation.validate_exp = false;
        validation.validate_aud = false;
        validation.required_spec_claims.clear();
        let claims = jsonwebtoken::decode::<Map<String, Value>>(token, &key, &validation)
            .map_err(|error| VerifyError::Invalid(error.to_string()))?
            .claims;
        validate_claims(&claims, &self.issuer, now_seconds())?;
        user_from_claims(&claims)
    }
}

fn now_seconds() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .unwrap_or_default()
}

/// `PyJWKSet` and `get_signing_keys`: usable signing keys with a `kid`.
fn signing_keys(document: &Value) -> Result<Vec<(String, Jwk)>, VerifyError> {
    let entries = document
        .get("keys")
        .and_then(Value::as_array)
        .filter(|keys| !keys.is_empty())
        .ok_or_else(|| VerifyError::Invalid("The JWK Set did not contain any keys".into()))?;
    let usable: Vec<(Option<String>, Option<String>, Jwk)> = entries
        .iter()
        .filter_map(|entry| {
            let jwk: Jwk = serde_json::from_value(entry.clone()).ok()?;
            DecodingKey::from_jwk(&jwk).ok()?;
            let text = |name: &str| entry.get(name).and_then(Value::as_str).map(str::to_owned);
            Some((text("kid"), text("use"), jwk))
        })
        .collect();
    if usable.is_empty() {
        return Err(VerifyError::Invalid(
            "The JWK Set did not contain any usable keys".into(),
        ));
    }
    let keys: Vec<(String, Jwk)> = usable
        .into_iter()
        .filter(|(kid, key_use, _)| {
            kid.as_deref().is_some_and(|kid| !kid.is_empty())
                && key_use.as_deref().is_none_or(|key_use| key_use == "sig")
        })
        .map(|(kid, _, jwk)| (kid.unwrap_or_default(), jwk))
        .collect();
    if keys.is_empty() {
        return Err(VerifyError::Invalid(
            "The JWKS endpoint did not contain any signing keys".into(),
        ));
    }
    Ok(keys)
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

/// PyJWT's `_validate_claims` with `audience="authenticated"`, the expected
/// issuer and no leeway.
fn validate_claims(claims: &Map<String, Value>, issuer: &str, now: f64) -> Result<(), VerifyError> {
    let invalid = |reason: &str| Err(VerifyError::Invalid(reason.to_owned()));
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
        Some(_) => return invalid("Invalid issuer"),
    }
    let audiences: Vec<&Value> = match claims.get("aud") {
        None | Some(Value::Null) => return invalid("Token is missing the \"aud\" claim"),
        Some(Value::Array(values)) => values.iter().collect(),
        Some(value) => vec![value],
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

/// Where identities come from: verified tokens, or one fixed identity that
/// stands in for every request (the parity replay's `dependency_overrides`).
pub struct Authenticator {
    pub jwks: JwksVerifier,
    pub fixed: Option<AuthUser>,
}

/// `HTTPBearer`: the credentials of a `Bearer` authorization header.
fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let authorization = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, credentials) = authorization.split_once(' ').unwrap_or((authorization, ""));
    let credentials = credentials.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !credentials.is_empty()).then_some(credentials)
}

impl Authenticator {
    async fn current(&self, headers: &HeaderMap) -> Result<AuthUser, ApiError> {
        if let Some(user) = &self.fixed {
            return Ok(user.clone());
        }
        let token =
            bearer_token(headers).ok_or_else(|| ApiError::authentication(NOT_AUTHENTICATED))?;
        self.jwks
            .verify(token)
            .await
            .map_err(VerifyError::into_api_error)
    }

    async fn optional(&self, headers: &HeaderMap) -> Result<Option<AuthUser>, ApiError> {
        if let Some(user) = &self.fixed {
            return Ok(Some(user.clone()));
        }
        let Some(token) = bearer_token(headers) else {
            return Ok(None);
        };
        match self.jwks.verify(token).await {
            Ok(user) => Ok(Some(user)),
            Err(VerifyError::Malformed(reason)) => {
                Err(VerifyError::Malformed(reason).into_api_error())
            }
            Err(error) => {
                let detail = match error.into_api_error() {
                    ApiError::Authentication(detail) | ApiError::Http { detail, .. } => detail,
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
        state.auth.current(&parts.headers).await.map(Self)
    }
}

/// `get_optional_user`: the token's identity, or `None` when absent or invalid.
pub struct OptionalUser(pub Option<AuthUser>);

impl FromRequestParts<AppState> for OptionalUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        state.auth.optional(&parts.headers).await.map(Self)
    }
}

/// `resolve_db_user`: the `users` row of a Supabase auth id, read fresh.
pub async fn find_user(
    db: &sqlx::PgPool,
    supabase_auth_id: &str,
) -> Result<Option<User>, ApiError> {
    Ok(sqlx::query_as::<_, User>(
        "SELECT users.id, users.email, users.role, users.school_id, schools.slug AS school \
         FROM public.users LEFT JOIN public.schools ON schools.id = users.school_id \
         WHERE users.supabase_auth_id = $1 LIMIT 1",
    )
    .bind(supabase_auth_id)
    .fetch_optional(db)
    .await?)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::test_settings;
    use serde_json::json;

    fn claims(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    const ISSUER: &str = "https://example.supabase.co/auth/v1";

    fn valid() -> Value {
        json!({"sub": "abc", "aud": "authenticated", "iss": ISSUER, "exp": 2000.0, "iat": 1000, "email": "a@b.ca", "role": "authenticated"})
    }

    fn reason(result: Result<(), VerifyError>) -> String {
        match result {
            Err(VerifyError::Invalid(reason)) => reason,
            Err(_) => "other".into(),
            Ok(()) => "ok".into(),
        }
    }

    #[test]
    fn issuer_defaults_to_the_project_auth_url() {
        let verifier = JwksVerifier::new(&test_settings(&[(
            "SUPABASE_URL",
            "https://example.supabase.co/",
        )]));
        assert_eq!(verifier.issuer, ISSUER);
        assert_eq!(
            verifier.url,
            "https://example.supabase.co/auth/v1/.well-known/jwks.json"
        );
        let custom = JwksVerifier::new(&test_settings(&[(
            "SUPABASE_JWT_ISSUER",
            "http://127.0.0.1:54321/auth/v1",
        )]));
        assert_eq!(custom.issuer, "http://127.0.0.1:54321/auth/v1");
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
        wrong.as_object_mut().unwrap().remove("exp");
        assert_eq!(
            reason(validate_claims(&claims(wrong), ISSUER, 1500.0)),
            "ok"
        );
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
    fn signing_keys_follow_pyjwkset() {
        // backend/tests/core/test_auth.py: an empty key set is an invalid token, not an outage.
        assert!(matches!(
            signing_keys(&json!({"keys": []})),
            Err(VerifyError::Invalid(_))
        ));
        assert!(matches!(
            signing_keys(&json!({})),
            Err(VerifyError::Invalid(_))
        ));
        let ec = json!({"kty": "EC", "crv": "P-256", "kid": "k1", "use": "sig", "alg": "ES256",
            "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"});
        let keys = signing_keys(&json!({"keys": [ec.clone(), {"kty": "unknown"}]}))
            .ok()
            .unwrap();
        assert_eq!(keys.len(), 1);
        let mut encryption = ec.clone();
        encryption["use"] = json!("enc");
        assert!(signing_keys(&json!({"keys": [encryption]})).is_err());
        let mut no_kid = ec;
        no_kid.as_object_mut().unwrap().remove("kid");
        assert!(signing_keys(&json!({"keys": [no_kid]})).is_err());
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

    #[tokio::test]
    async fn unreachable_keys_are_a_503_and_optional_auth_is_anonymous() {
        // backend/tests/core/test_auth.py::test_cold_process_key_fetch_failure_is_retryable
        let settings = test_settings(&[("SUPABASE_URL", "http://127.0.0.1:9")]);
        let authenticator = Authenticator {
            jwks: JwksVerifier::new(&settings),
            fixed: None,
        };
        let mut headers = HeaderMap::new();
        let header_token = "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImsxIn0.e30.c2ln";
        headers.insert(header::AUTHORIZATION, header_token.parse().unwrap());
        let error = authenticator.current(&headers).await.unwrap_err();
        assert!(
            matches!(error, ApiError::Http { status: StatusCode::SERVICE_UNAVAILABLE, ref detail } if detail == AUTHENTICATION_ERROR)
        );
        assert_eq!(authenticator.optional(&headers).await.unwrap(), None);
        assert!(matches!(
            authenticator.current(&HeaderMap::new()).await.unwrap_err(),
            ApiError::Authentication(detail) if detail == NOT_AUTHENTICATED
        ));
        let garbage = {
            let mut map = HeaderMap::new();
            map.insert(header::AUTHORIZATION, "Bearer not-a-jwt".parse().unwrap());
            map
        };
        assert!(matches!(
            authenticator.current(&garbage).await.unwrap_err(),
            ApiError::Authentication(detail) if detail == INVALID_OR_EXPIRED_TOKEN
        ));
    }

    #[tokio::test]
    async fn unknown_kids_refetch_the_key_set_at_most_every_30_seconds() {
        // Nothing listens on port 9, so any fetch fails as unavailable (503).
        let verifier = JwksVerifier::new(&test_settings(&[("SUPABASE_URL", "http://127.0.0.1:9")]));
        let ec = json!({"kty": "EC", "crv": "P-256", "kid": "k1", "use": "sig", "alg": "ES256",
            "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"});
        let keys = signing_keys(&json!({"keys": [ec]})).ok().unwrap();
        *verifier.key_set.lock().await = Some(KeySet {
            fetched: Instant::now(),
            keys,
        });
        assert!(verifier.key(Some("k1")).await.is_ok());
        // The first unknown kid refetches (and the fetch fails here).
        assert!(matches!(
            verifier.key(Some("rotated")).await,
            Err(VerifyError::Unavailable(_))
        ));
        // Within 30 seconds another unknown kid fails at once, like an invalid token.
        assert!(matches!(
            verifier.key(Some("forged")).await,
            Err(VerifyError::Invalid(_))
        ));
        *verifier.last_refetch.lock().unwrap() = Some(Instant::now() - UNKNOWN_KID_REFETCH);
        assert!(matches!(
            verifier.key(Some("forged")).await,
            Err(VerifyError::Unavailable(_))
        ));
        // Known keys never wait on a refetch.
        assert!(verifier.key(Some("k1")).await.is_ok());
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
