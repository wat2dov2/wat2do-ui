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

use aws_lc_rs::encoding::AsBigEndian;
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

/// What `AUTH_SIGNING_KEY` gives `core/auth_tokens.py`: the keys that sign
/// and verify access tokens, the token header's `kid`, and the HMAC key that
/// derives a refresh token's successor.
struct SigningKeys {
    decoding: DecodingKey,
    encoding: jsonwebtoken::EncodingKey,
    /// `_key_id()`: the first 16 hex digits of the SHA-256 of the public key's
    /// SubjectPublicKeyInfo DER.
    kid: String,
    /// `_rotation_key()`.
    rotation: [u8; 32],
}

/// A P-256 public key's SubjectPublicKeyInfo DER, before its 65-byte point.
const P256_SPKI_PREFIX: [u8; 26] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
];

/// The canonical PKCS#8 DER of a P-256 key, as Python's `private_bytes(DER,
/// PKCS8)` writes it whatever form the setting held: the curve named once
/// in the algorithm, the 32-byte scalar, and always the public point.
fn canonical_pkcs8(scalar: &[u8], point: &[u8]) -> Vec<u8> {
    // SEQUENCE { 0, { id-ecPublicKey, prime256v1 }, OCTET STRING { ECPrivateKey
    // SEQUENCE { 1, OCTET STRING <scalar> ...
    const BEFORE_SCALAR: [u8; 36] = [
        0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d,
        0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x6d, 0x30,
        0x6b, 0x02, 0x01, 0x01, 0x04, 0x20,
    ];
    // ... [1] BIT STRING <uncompressed point> } } }
    const BEFORE_POINT: [u8; 5] = [0xa1, 0x44, 0x03, 0x42, 0x00];
    [&BEFORE_SCALAR[..], scalar, &BEFORE_POINT, point].concat()
}

fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    use sha2::Digest;
    let mut digest = sha2::Sha256::new();
    for part in parts {
        digest.update(part);
    }
    digest.finalize().into()
}

/// `_private_key()` and the keys derived from it: `AUTH_SIGNING_KEY` is a
/// base64 PKCS#8 (or RFC 5915) DER EC P-256 private key (`openssl genpkey
/// -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -outform DER | base64`).
fn signing_keys(encoded: &str) -> Result<SigningKeys, String> {
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
    let point = pair.public_key().as_ref();
    let scalar = pair
        .private_key()
        .as_be_bytes()
        .map_err(|_| "AUTH_SIGNING_KEY could not be read".to_owned())?;
    if scalar.as_ref().len() != 32 || point.len() != 65 {
        return Err("AUTH_SIGNING_KEY must be an EC P-256 private key".to_owned());
    }
    // Python derives from the key re-encoded as PKCS#8 with its public point,
    // even when the setting's DER left the point out.
    let pkcs8 = canonical_pkcs8(scalar.as_ref(), point);
    let kid = sha256(&[&P256_SPKI_PREFIX, point])
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(SigningKeys {
        // The uncompressed point, which is the form the ES256 verifier takes.
        decoding: DecodingKey::from_ec_der(point),
        encoding: jsonwebtoken::EncodingKey::from_ec_der(&pkcs8),
        kid,
        rotation: sha256(&[b"wat2do refresh token rotation\x00", &pkcs8]),
    })
}

/// `new_refresh_token()`: an opaque, unguessable refresh token.
pub fn new_refresh_token() -> String {
    super::secrets::token_urlsafe(32)
}

/// The hex SHA-256 of `text`: how refresh tokens and login codes are stored
/// (`refresh_token_hash`, `_token_digest`; Postgres'
/// `encode(sha256(convert_to(token, 'UTF8')), 'hex')`).
pub fn sha256_hex(text: &str) -> String {
    hex::encode(sha256(&[text.as_bytes()]))
}

/// Signs and verifies our access tokens (`core/auth_tokens.py`).
pub struct AccessTokens {
    keys: Result<SigningKeys, String>,
    /// `controlbox/authentication.json` `token_issuer`.
    issuer: &'static str,
}

impl AccessTokens {
    pub fn new(settings: &Settings) -> Self {
        Self {
            keys: signing_keys(&settings.auth_signing_key),
            issuer: &crate::controlbox::AUTHENTICATION.token_issuer,
        }
    }

    /// Whether `AUTH_SIGNING_KEY` gives working keys; the server refuses to
    /// start without them rather than answer every signed-in request with a 500.
    pub fn check(&self) -> anyhow::Result<()> {
        self.keys
            .as_ref()
            .map(|_| ())
            .map_err(|reason| anyhow::anyhow!(reason.clone()))
    }

    fn keys(&self) -> Result<&SigningKeys, ApiError> {
        self.keys
            .as_ref()
            .map_err(|reason| ApiError::Internal(anyhow::anyhow!(reason.clone())))
    }

    /// `access_token_seconds()`.
    pub fn lifetime_seconds() -> i64 {
        crate::controlbox::AUTHENTICATION.access_token_minutes * 60
    }

    /// `issue_access_token`: a short-lived token for one session.
    pub fn issue(
        &self,
        subject: &str,
        email: Option<&str>,
        session_id: &str,
    ) -> Result<String, ApiError> {
        let keys = self.keys()?;
        let now = chrono::Utc::now().timestamp();
        let claims = serde_json::json!({
            "iss": self.issuer,
            "aud": AUDIENCE,
            "role": AUDIENCE,
            "sub": subject,
            "email": email,
            "session_id": session_id,
            "iat": now,
            "exp": now + Self::lifetime_seconds(),
        });
        let mut header = jsonwebtoken::Header::new(Algorithm::ES256);
        header.kid = Some(keys.kid.clone());
        jsonwebtoken::encode(&header, &claims, &keys.encoding).map_err(|error| {
            ApiError::Internal(anyhow::anyhow!("signing an access token: {error}"))
        })
    }

    /// `next_refresh_token`: the token that replaces `refresh_token` when it
    /// is rotated, the same every time, so a parallel refresh gets the same one.
    pub fn next_refresh_token(&self, refresh_token: &str) -> Result<String, ApiError> {
        use hmac::Mac;
        let keys = self.keys()?;
        let mut mac =
            hmac::Hmac::<sha2::Sha256>::new_from_slice(&keys.rotation).expect("HMAC takes any key");
        mac.update(refresh_token.as_bytes());
        Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
    }

    /// `decode_access_token`'s claims, for logout: `None` when the token is
    /// not one we signed (a missing key is still a server error).
    pub fn subject(&self, token: &str) -> Result<Option<String>, ApiError> {
        match self.decode(token) {
            // `claims["sub"]`: a string, as the claim checks require.
            Ok(claims) => Ok(claims.get("sub").and_then(Value::as_str).map(str::to_owned)),
            Err(VerifyError::NoKey(reason)) => Err(ApiError::Internal(anyhow::anyhow!(reason))),
            Err(VerifyError::Invalid(reason)) => {
                tracing::warn!("Logout with an invalid access token: {reason}");
                Ok(None)
            }
        }
    }

    /// `decode_access_token` followed by `_payload_to_user`.
    fn verify(&self, token: &str) -> Result<AuthUser, VerifyError> {
        user_from_claims(&self.decode(token)?)
    }

    /// `decode_access_token`: the claims of a token we signed.
    fn decode(&self, token: &str) -> Result<Map<String, Value>, VerifyError> {
        // Python reads the key before it parses the token, so a missing key
        // fails every presented token, well formed or not.
        let key = &self
            .keys
            .as_ref()
            .map_err(|reason| VerifyError::NoKey(reason.clone()))?
            .decoding;
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
        Ok(claims)
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
pub(crate) fn bearer_token(headers: &HeaderMap) -> Option<&str> {
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
        require_club_owner_or_admin(&state.db, &user).await?;
        Ok(Self(user))
    }
}

/// `get_club_owner_or_admin` called on a user a route already has: 403
/// unless an admin or a member of at least one club.
pub async fn require_club_owner_or_admin(db: &sqlx::PgPool, user: &User) -> Result<(), ApiError> {
    if user.is_admin() {
        return Ok(());
    }
    let is_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM public.club_members \
         JOIN public.clubs ON clubs.id = club_members.club_id \
         WHERE club_members.user_id = $1)",
    )
    .bind(user.id)
    .fetch_one(db)
    .await
    // As in `list_clubs_by_owner`, a failed lookup reads as no clubs.
    .unwrap_or_else(|error| {
        tracing::warn!(
            "Failed to query club_members for owner_id {}: {error}",
            user.id
        );
        false
    });
    if is_member {
        Ok(())
    } else {
        Err(ApiError::authorization(
            CLUB_MEMBER_OR_ADMIN_ACCESS_REQUIRED,
        ))
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
            assert!(tokens.keys.is_err(), "{key}");
            assert!(tokens.check().is_err(), "{key}");
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

    /// `core/auth_tokens.py` with a fixed PKCS#8 key (cryptography's form).
    const PYTHON_KEY: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgHy49TFtqeYgXJjVEU2JxgKm4x9bl9AMSITBPXm18i5qhRANCAAS4X5B7zMC1NVUdsbdkG2qWnxdB2S9VPxAAQyGvBqHJoBTWaryq0dGYpwcP221176dbWSA6E/CqbahI96rfOsI9";
    /// `PYTHON_KEY` as a PKCS#8 that leaves the public point out; Python reads
    /// it, re-encodes it with the point and derives exactly what it derives
    /// from `PYTHON_KEY` (checked with cryptography 50).
    const PYTHON_KEY_WITHOUT_POINT: &str = "MEECAQAwEwYHKoZIzj0CAQYIKoZIzj0DAQcEJzAlAgEBBCAfLj1MW2p5iBcmNURTYnGAqbjH1uX0AxIhME9ebXyLmg==";
    /// The same module with the RFC 5915 form `openssl genpkey` writes here.
    const OPENSSL_KEY: &str = "MHcCAQEEIOuOMAukw52wX4gM8+KE9eP8yf8An+9mWHUUY0JC8gHwoAoGCCqGSM49AwEHoUQDQgAEOL/C01c6c6PhIJv0nVx4lDsGSxfD00O3MdOdI7WFGO0WS+8x3qX1KdXejosMZ7y+IFq5HxTwtStHHsrxvTVhPg==";

    #[test]
    fn signing_keys_derive_like_python() {
        // _key_id(), next_refresh_token("refresh-token-1") and refresh_token_hash(...)
        for (key, kid, next) in [
            (
                PYTHON_KEY,
                "267049282c57741a",
                "oH6KXG9BJltdEAlw2zZ4eXSTvB2lH5PlPqsSjPga2-8",
            ),
            (
                PYTHON_KEY_WITHOUT_POINT,
                "267049282c57741a",
                "oH6KXG9BJltdEAlw2zZ4eXSTvB2lH5PlPqsSjPga2-8",
            ),
            (
                OPENSSL_KEY,
                "74d5edf4270cf8c6",
                "BJch-CegKOCUdljEJeIcNuqcb3DtYQe5ZmllWIhbN2o",
            ),
        ] {
            let tokens = AccessTokens::new(&test_settings(&[("AUTH_SIGNING_KEY", key)]));
            assert_eq!(tokens.keys.as_ref().unwrap().kid, kid);
            assert_eq!(tokens.next_refresh_token("refresh-token-1").unwrap(), next);
        }
        // cryptography's own PKCS#8 of PYTHON_KEY is the canonical form, byte for byte.
        let der = base64::engine::general_purpose::STANDARD
            .decode(PYTHON_KEY)
            .unwrap();
        let pair =
            EcdsaKeyPair::from_private_key_der(&ECDSA_P256_SHA256_FIXED_SIGNING, &der).unwrap();
        let scalar = pair.private_key().as_be_bytes().unwrap();
        assert_eq!(
            canonical_pkcs8(scalar.as_ref(), pair.public_key().as_ref()),
            der
        );
        assert_eq!(
            sha256_hex("refresh-token-1"),
            "154f43e8c9b56a01e25dcba6f7aef62d23a3e91264e818124f6adf721d6a8e33"
        );
        assert_eq!(new_refresh_token().len(), 43);
        assert_ne!(new_refresh_token(), new_refresh_token());
    }

    #[test]
    fn python_and_rust_tokens_verify_each_other() {
        let tokens = AccessTokens::new(&test_settings(&[("AUTH_SIGNING_KEY", PYTHON_KEY)]));
        // issue_access_token's claims, signed by PyJWT with the key above (exp 2100).
        let python = "eyJhbGciOiJFUzI1NiIsImtpZCI6IjI2NzA0OTI4MmM1Nzc0MWEiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJ3YXQyZG8iLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJzdWIiOiJhdXRoLWlkLTEiLCJlbWFpbCI6InN0dWRlbnRAZXhhbXBsZS5jb20iLCJzZXNzaW9uX2lkIjoic2Vzc2lvbi0xIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.2T5ParPBOUv4CW50-QzCU7OZskkV27nSVUevaCwvAoy6ChZ_7njmWYji7s4jrZKEuCa7-VOO3VFk7R1IXSYl9g";
        assert_eq!(tokens.current(&bearer(python)).unwrap().id, "auth-id-1");
        let ours = tokens
            .issue("auth-id-2", Some("a@b.ca"), "session-2")
            .unwrap();
        let header = jsonwebtoken::decode_header(&ours).unwrap();
        assert_eq!(header.alg, Algorithm::ES256);
        assert_eq!(header.kid.as_deref(), Some("267049282c57741a"));
        let claims = tokens.decode(&ours).ok().unwrap();
        assert_eq!(claims["sub"], "auth-id-2");
        assert_eq!(claims["email"], "a@b.ca");
        assert_eq!(claims["session_id"], "session-2");
        assert_eq!(claims["iss"], "wat2do");
        assert_eq!(claims["aud"], "authenticated");
        assert_eq!(claims["role"], "authenticated");
        assert_eq!(
            claims["exp"].as_i64().unwrap() - claims["iat"].as_i64().unwrap(),
            AccessTokens::lifetime_seconds()
        );
        assert_eq!(AccessTokens::lifetime_seconds(), 900);
        assert_eq!(tokens.subject(&ours).unwrap().as_deref(), Some("auth-id-2"));
        assert_eq!(tokens.subject("not-a-jwt").unwrap(), None);
        let unkeyed = AccessTokens::new(&test_settings(&[("AUTH_SIGNING_KEY", "")]));
        assert!(unkeyed.issue("a", None, "s").is_err());
        assert!(unkeyed.subject(&ours).is_err());
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
