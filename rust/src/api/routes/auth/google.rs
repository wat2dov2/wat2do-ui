//! Google sign-in straight against Google (`auth_service.prepare_google_oauth`
//! and `_google_verified_email`): an authorization URL with PKCE and a state,
//! then the code traded for an ID token whose verified email signs the user in.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use jsonwebtoken::jwk::{Jwk, JwkSet};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde_json::{Map, Value};

use crate::api::errors::ApiError;
use crate::api::messages::INVALID_OR_EXPIRED_TOKEN;
use crate::controlbox::AUTHENTICATION;
use crate::settings::Settings;
use crate::urls::urlencode;

const AUTHORIZATION_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const CERTS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS: [&str; 2] = ["https://accounts.google.com", "accounts.google.com"];
/// `_GOOGLE_TIMEOUT_SECONDS`, for the code exchange.
const TOKEN_TIMEOUT: Duration = Duration::from_secs(10);
/// `PyJWKClient`'s default fetch timeout.
const CERTS_TIMEOUT: Duration = Duration::from_secs(30);
/// `PyJWKClient(lifespan=3600)`: Google's keys are reused for an hour.
const CERTS_LIFESPAN: Duration = Duration::from_secs(3600);
/// A token naming a key we have not seen refetches the set at most this
/// often (PyJWKClient refetched for every one).
const UNKNOWN_KID_REFETCH: Duration = Duration::from_secs(30);

/// `OAuthStartResult`: Google's consent URL, and the PKCE verifier and state
/// bound to this browser.
pub struct OAuthStart {
    pub authorization_url: String,
    pub code_verifier: String,
    pub state: String,
}

/// `prepare_google_oauth`: Google sends the code to `redirect_uri`.
pub fn prepare(redirect_uri: &str) -> OAuthStart {
    use sha2::Digest;
    let code_verifier = crate::api::secrets::token_urlsafe(64);
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(sha2::Sha256::digest(code_verifier.as_bytes()));
    let state = crate::api::secrets::token_urlsafe(32);
    let query = urlencode(&[
        ("client_id", AUTHENTICATION.google_client_id.as_str()),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", "openid email profile"),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
        ("state", &state),
    ]);
    OAuthStart {
        authorization_url: format!("{AUTHORIZATION_URL}?{query}"),
        code_verifier,
        state,
    }
}

/// Google's signing keys, fetched at most once an hour.
struct Certs {
    fetched: Option<(Instant, JwkSet)>,
    last_unknown_refetch: Option<Instant>,
}

/// Held only to read or store the cache, never across a fetch, so one slow
/// fetch does not queue every other Google sign-in behind it.
static CERTS: Mutex<Certs> = Mutex::new(Certs {
    fetched: None,
    last_unknown_refetch: None,
});

fn certs() -> std::sync::MutexGuard<'static, Certs> {
    CERTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

async fn fetch_certs() -> anyhow::Result<JwkSet> {
    let client = wreq::Client::builder().timeout(CERTS_TIMEOUT).build()?;
    let body = client
        .get(CERTS_URL)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    Ok(serde_json::from_slice(&body)?)
}

fn no_key(kid: &str) -> anyhow::Error {
    anyhow::anyhow!("Unable to find a signing key that matches: \"{kid}\"")
}

/// What the cache holds for `kid`.
enum Cached {
    Key(Box<Jwk>),
    /// The set is fresh but has no such key.
    Unknown,
    /// Nothing fetched yet, or the set is over an hour old.
    Stale,
}

fn cached(kid: &str) -> Cached {
    match &certs().fetched {
        Some((at, set)) if at.elapsed() < CERTS_LIFESPAN => match set.find(kid) {
            Some(jwk) => Cached::Key(Box::new(jwk.clone())),
            None => Cached::Unknown,
        },
        _ => Cached::Stale,
    }
}

/// Fetch the set (outside the lock), keep it, and find `kid` in it.
async fn refetch(kid: &str) -> anyhow::Result<Jwk> {
    let set = fetch_certs().await?;
    let jwk = set.find(kid).cloned();
    certs().fetched = Some((Instant::now(), set));
    jwk.ok_or_else(|| no_key(kid))
}

/// `_google_keys.get_signing_key_from_jwt`: the key the token names.
async fn signing_key(kid: &str) -> anyhow::Result<DecodingKey> {
    let jwk = match cached(kid) {
        Cached::Key(jwk) => *jwk,
        Cached::Stale => refetch(kid).await?,
        Cached::Unknown => {
            // Google may have rotated its keys since the set was fetched; a
            // key nobody has seen refetches the set at most this often.
            let may_refetch = {
                let mut certs = certs();
                let may = certs
                    .last_unknown_refetch
                    .is_none_or(|at| at.elapsed() >= UNKNOWN_KID_REFETCH);
                if may {
                    certs.last_unknown_refetch = Some(Instant::now());
                }
                may
            };
            if !may_refetch {
                return Err(no_key(kid));
            }
            refetch(kid).await?
        }
    };
    Ok(DecodingKey::from_jwk(&jwk)?)
}

/// The ID token's claims, checked as `jwt.decode` checks them: RS256, our
/// client id as the audience, a Google issuer, an unexpired token.
async fn id_token_claims(id_token: &str) -> anyhow::Result<Map<String, Value>> {
    let header = jsonwebtoken::decode_header(id_token)?;
    anyhow::ensure!(
        header.alg == Algorithm::RS256,
        "The specified alg value is not allowed"
    );
    let key = signing_key(header.kid.as_deref().unwrap_or_default()).await?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.leeway = 0;
    validation.set_audience(&[AUTHENTICATION.google_client_id.as_str()]);
    validation.set_issuer(&ISSUERS);
    Ok(jsonwebtoken::decode::<Map<String, Value>>(id_token, &key, &validation)?.claims)
}

/// Trade Google's code for its ID token (the client secret stays on the server).
async fn exchange(
    settings: &Settings,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> anyhow::Result<Map<String, Value>> {
    let client = wreq::Client::builder().timeout(TOKEN_TIMEOUT).build()?;
    let form = urlencode(&[
        ("code", code),
        ("code_verifier", code_verifier),
        ("client_id", AUTHENTICATION.google_client_id.as_str()),
        (
            "client_secret",
            settings.google_oauth_client_secret.as_str(),
        ),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
    ]);
    let body = client
        .post(TOKEN_URL)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    let response: Value = serde_json::from_slice(&body)?;
    let id_token = response
        .get("id_token")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("'id_token'"))?;
    id_token_claims(id_token).await
}

/// `_google_verified_email`: the lower-cased email Google has verified, or
/// the `AuthenticationError` every failure becomes.
pub async fn verified_email(
    settings: &Settings,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<String, ApiError> {
    let claims = exchange(settings, code, code_verifier, redirect_uri)
        .await
        .map_err(|error| {
            tracing::warn!("Google sign-in verification failed: {error}");
            ApiError::authentication(INVALID_OR_EXPIRED_TOKEN)
        })?;
    verified(&claims).ok_or_else(|| ApiError::authentication(INVALID_OR_EXPIRED_TOKEN))
}

/// The claims' email, when Google says it is verified (`is True`).
fn verified(claims: &Map<String, Value>) -> Option<String> {
    let email = claims.get("email").filter(|email| match email {
        Value::Null | Value::Bool(false) => false,
        Value::String(text) => !text.is_empty(),
        _ => true,
    })?;
    if claims.get("email_verified") != Some(&Value::Bool(true)) {
        return None;
    }
    // `str(email).strip().lower()`.
    let text = match email {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    Some(crate::text::python_strip(&text).to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_consent_url_carries_pkce_and_the_state() {
        let start = prepare("https://wat2do.io/api/auth/google/callback");
        assert_eq!(start.code_verifier.len(), 86);
        assert_eq!(start.state.len(), 43);
        let (base, query) = start.authorization_url.split_once('?').unwrap();
        assert_eq!(base, AUTHORIZATION_URL);
        let pairs: Vec<(String, String)> = form_urlencoded::parse(query.as_bytes())
            .into_owned()
            .collect();
        let names: Vec<&str> = pairs.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(
            names,
            [
                "client_id",
                "redirect_uri",
                "response_type",
                "scope",
                "code_challenge",
                "code_challenge_method",
                "state"
            ]
        );
        let value = |name: &str| pairs.iter().find(|(n, _)| n == name).unwrap().1.clone();
        assert_eq!(value("client_id"), AUTHENTICATION.google_client_id);
        assert_eq!(
            value("redirect_uri"),
            "https://wat2do.io/api/auth/google/callback"
        );
        assert_eq!(value("scope"), "openid email profile");
        assert!(query.contains("scope=openid+email+profile"));
        assert_eq!(value("state"), start.state);
        use sha2::Digest;
        assert_eq!(
            value("code_challenge"),
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(sha2::Sha256::digest(start.code_verifier.as_bytes()))
        );
        assert_ne!(prepare("x").state, start.state);
    }

    #[test]
    fn only_a_verified_email_signs_in() {
        let claims = |value: Value| value.as_object().unwrap().clone();
        assert_eq!(
            verified(&claims(
                json!({"email": " Student@Example.com ", "email_verified": true})
            ))
            .as_deref(),
            Some("student@example.com")
        );
        for unverified in [
            json!({"email": "a@b.io", "email_verified": false}),
            json!({"email": "a@b.io", "email_verified": "true"}),
            json!({"email": "a@b.io"}),
            json!({"email": "", "email_verified": true}),
            json!({"email_verified": true}),
        ] {
            assert_eq!(verified(&claims(unverified.clone())), None, "{unverified}");
        }
    }
}
