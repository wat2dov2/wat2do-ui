//! `services/auth_service.py`: emailed login codes and links, Google sign-in
//! and refreshable sessions, all on our own tables.
//!
//! A login email carries a six-digit code and a link token; only their
//! SHA-256 digests are stored (`verification_tokens`). A verified login maps
//! onto one `users` row (created on first sign-in) and starts an
//! `auth_sessions` row whose refresh token lives in the browser's cookie.
//! Each step is its own statement, in Python's order, so a failure leaves the
//! same state behind.

use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

use super::google;
use crate::api::auth::{AccessTokens, new_refresh_token, sha256_hex};
use crate::api::errors::ApiError;
use crate::api::messages::{
    FAILED_TO_SAVE_TOKEN, INVALID_OR_EXPIRED_TOKEN, RATE_LIMIT_EXCEEDED, REGISTRATION_FAILED,
    SESSION_REFRESH_FAILED,
};
use crate::api::routes::clubs::get_club;
use crate::api::routes::clubs::members::{AddError, add_member};
use crate::controlbox::AUTHENTICATION;
use crate::db::read_with_retry;
use crate::email::EmailMessage;
use crate::email::layout::{self, escape};
use crate::schools::normalize_slug;
use crate::settings::Settings;
use crate::urls::{urlencode, urlsplit};

/// `_CODE_DIGITS`: the code a person types.
const CODE_DIGITS: usize = 6;

// `TokenResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct TokenResponse {
    pub access_token: String,
    #[schema(default = "bearer", required = false)]
    pub token_type: String,
    pub expires_in: i64,
    pub user_id: String,
    #[schema(max_length = 255)]
    pub school: Option<String>,
    #[schema(default = false, required = false)]
    pub onboarding_required: bool,
}

impl TokenResponse {
    fn new(access_token: String, auth_id: &str) -> Self {
        Self {
            access_token,
            token_type: "bearer".to_owned(),
            expires_in: AccessTokens::lifetime_seconds(),
            user_id: auth_id.to_owned(),
            school: None,
            onboarding_required: false,
        }
    }
}

/// `AuthResult`: the response body and the refresh token for the cookie.
#[derive(Debug)]
pub struct SignedIn {
    pub body: TokenResponse,
    pub refresh_token: String,
}

/// `_sanitize_for_log`: one log line, whatever the address holds.
fn loggable(value: &str) -> String {
    value.replace('\r', "\\r").replace('\n', "\\n")
}

/// At most 64 characters of a caller's value, for a log line (`{:?}` escapes it).
fn log_excerpt(value: &str) -> String {
    const LIMIT: usize = 64;
    let mut excerpt: String = value.chars().take(LIMIT).collect();
    if value.chars().nth(LIMIT).is_some() {
        excerpt.push_str("...");
    }
    excerpt
}

/// Python's `str.strip().lower()`.
pub fn clean_email(email: &str) -> String {
    crate::text::python_strip(email).to_lowercase()
}

fn service_error(detail: &str) -> ApiError {
    ApiError::Service {
        detail: detail.to_owned(),
        code: String::new(),
    }
}

/// `f"{secrets.randbelow(10**6):06d}"`: a uniformly random six-digit code.
fn new_code() -> String {
    const CODES: u32 = 1_000_000;
    // The largest multiple of CODES below 2^32: anything above it would favour low codes.
    const LIMIT: u32 = u32::MAX - (u32::MAX % CODES) - 1;
    loop {
        let mut bytes = [0u8; 4];
        aws_lc_rs::rand::fill(&mut bytes).expect("the system random source works");
        let value = u32::from_le_bytes(bytes);
        if value <= LIMIT {
            return format!("{:0width$}", value % CODES, width = CODE_DIGITS);
        }
    }
}

/// `school_service.get_school(slug)`: the registered school's id.
async fn registered_school(db: &PgPool, slug: Option<&str>) -> Result<Option<i32>, sqlx::Error> {
    let slug = normalize_slug(slug.unwrap_or_default());
    if slug.is_empty() {
        return Ok(None);
    }
    read_with_retry(|| {
        sqlx::query_scalar::<_, i32>("SELECT id FROM public.schools WHERE slug = $1 LIMIT 1")
            .bind(&slug)
            .fetch_optional(db)
    })
    .await
}

/// The campus slug a trusted frontend origin (`https://<slug>.wat2do.io`)
/// names, before checking that it is registered. `urlsplit`'s `ValueError`
/// was uncaught in Python (a 500).
fn frontend_slug(settings: &Settings, url: &str) -> Result<Option<String>, ApiError> {
    let parsed = urlsplit(url, "")
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("ValueError: {error}")))?;
    let origin = format!("{}://{}", parsed.scheme, parsed.netloc);
    if !settings.is_allowed_origin(Some(&origin)) {
        return Ok(None);
    }
    let hostname = parsed.hostname().unwrap_or_default();
    Ok([".wat2do.io", ".wat2do.localhost"]
        .into_iter()
        .find_map(|suffix| hostname.strip_suffix(suffix))
        .map(str::to_owned))
}

/// `school_from_frontend_url`: the registered campus whose site `url` is.
pub async fn school_from_frontend_url(
    db: &PgPool,
    settings: &Settings,
    url: &str,
) -> Result<Option<String>, ApiError> {
    let Some(slug) = frontend_slug(settings, url)? else {
        return Ok(None);
    };
    Ok(registered_school(db, Some(&slug)).await?.map(|_| slug))
}

/// `prepare_otp_email`: stage a fresh code and link for `email` and build the
/// email that carries them. Nothing is sent here.
pub async fn prepare_otp_email(
    db: &PgPool,
    settings: &Settings,
    email: &str,
    invitation_token: Option<&str>,
    return_to: Option<&str>,
    signup_school: Option<String>,
) -> Result<EmailMessage, ApiError> {
    let email = clean_email(email);
    // Counted before anything else is looked up, so every address, known or
    // not, gets the same answer.
    LOGIN_EMAILS
        .admit(
            db,
            &email,
            Utc::now(),
            AUTHENTICATION.code_send_limit,
            Duration::minutes(AUTHENTICATION.code_send_window_minutes),
        )
        .await?;
    let mut recipient_school = signup_school;
    if let Some(token) = invitation_token.filter(|token| !token.is_empty()) {
        match invitation_school(db, &email, token).await {
            Ok(Some(school)) => recipient_school = recipient_school.or(school),
            Ok(None) => {}
            Err(error) => tracing::warn!("Failed to check invitation token: {error}"),
        }
    }
    let user_school = read_with_retry(|| {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT NULLIF(s.slug, '') FROM public.users u \
             LEFT JOIN public.schools s ON s.id = u.school_id WHERE u.email = $1 LIMIT 1",
        )
        .bind(&email)
        .fetch_optional(db)
    })
    .await;
    match user_school {
        Ok(Some(Some(school))) => recipient_school = Some(school),
        Ok(_) => {}
        Err(error) => tracing::warn!("Failed to check if user exists: {error}"),
    }

    if let Err(error) = sqlx::query("DELETE FROM public.verification_tokens WHERE identifier = $1")
        .bind(&email)
        .execute(db)
        .await
    {
        tracing::warn!("Failed to delete old verification tokens: {error}");
    }
    let expires = Utc::now() + Duration::minutes(AUTHENTICATION.verification_token_minutes);
    // One six-digit code to type and one link token to click; only digests are stored.
    let code = new_code();
    let link_token = crate::api::secrets::token_urlsafe(32);
    sqlx::query(
        "INSERT INTO public.verification_tokens (identifier, token, expires) \
         VALUES ($1, $2, $4), ($1, $3, $4)",
    )
    .bind(&email)
    .bind(sha256_hex(&link_token))
    .bind(sha256_hex(&code))
    .bind(expires)
    .execute(db)
    .await
    .map_err(|error| {
        tracing::error!("Failed to insert verification tokens: {error}");
        service_error(FAILED_TO_SAVE_TOKEN)
    })?;

    let base_url =
        crate::schools::frontend_url(&settings.frontend_url, recipient_school.as_deref())?;
    let mut params = vec![("token", link_token.as_str()), ("email", email.as_str())];
    if let Some(return_to) = return_to {
        params.push(("returnTo", return_to));
    }
    let callback_url = format!("{base_url}/auth/callback?{}", urlencode(&params));
    Ok(login_email(&email, &code, &callback_url))
}

/// The school of the club a pending, unexpired invitation for `email` is to.
async fn invitation_school(
    db: &PgPool,
    email: &str,
    token: &str,
) -> anyhow::Result<Option<Option<String>>> {
    // PostgREST refused a token that is not a UUID; Python logged and went on.
    // The token is the caller's, so the log gets a short, escaped excerpt.
    let token: Uuid = token.parse().map_err(|_| {
        anyhow::anyhow!(
            "invalid input syntax for type uuid: {:?}",
            log_excerpt(token)
        )
    })?;
    let club_id = read_with_retry(|| {
        sqlx::query_scalar::<_, i32>(
            "SELECT club_id FROM public.club_invitations \
             WHERE token = $1 AND email = $2 AND status = 'pending' AND expires_at > $3 LIMIT 1",
        )
        .bind(token)
        .bind(email)
        .bind(Utc::now())
        .fetch_optional(db)
    })
    .await?;
    let Some(club_id) = club_id else {
        return Ok(None);
    };
    let club = get_club(db, i64::from(club_id))
        .await
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    Ok(Some(club.and_then(|club| club.school)))
}

/// `verify_otp`: accept the six-digit code or the link token from the latest
/// login email. Code attempts count toward the address's lockout; link
/// tokens carry 256 random bits and are exempt.
///
/// Two deliberate changes from Python, which had both gaps:
/// - A code attempt is recorded before the window is counted (Python counted
///   first and recorded only misses), so concurrent wrong codes cannot all
///   read a count under the limit.
/// - The matching token is consumed in the statement that finds it (Python
///   read it, then deleted the address's tokens), so two requests with the
///   same code or link cannot both sign in.
pub async fn verify_otp(
    db: &PgPool,
    tokens: &AccessTokens,
    email: &str,
    token: &str,
    signup_school: Option<String>,
) -> Result<SignedIn, ApiError> {
    let email = clean_email(email);
    let secret = crate::text::python_strip(token);
    let now = Utc::now();
    let is_code = secret.chars().count() == CODE_DIGITS;
    if is_code {
        CODE_GUESSES
            .admit(
                db,
                &email,
                now,
                AUTHENTICATION.code_guess_limit,
                guess_window(),
            )
            .await?;
    }
    let consumed = sqlx::query_scalar::<_, i32>(
        "DELETE FROM public.verification_tokens \
         WHERE identifier = $1 AND token = $2 AND expires > $3 RETURNING 1",
    )
    .bind(&email)
    .bind(sha256_hex(secret))
    .bind(now)
    .fetch_optional(db)
    .await;
    match consumed {
        Ok(Some(_)) => {}
        // A wrong code's attempt stays recorded: it is the miss.
        Ok(None) => return Err(ApiError::authentication(INVALID_OR_EXPIRED_TOKEN)),
        Err(error) => {
            // Nothing was checked, so the attempt is not a miss.
            tracing::error!("Failed to query verification token: {error}");
            if is_code {
                CODE_GUESSES.forget(db, &email, now).await;
            }
            return Err(ApiError::authentication(INVALID_OR_EXPIRED_TOKEN));
        }
    }
    if let Err(error) = clear_login_state(db, &email).await {
        tracing::warn!("Failed to delete used verification tokens: {error}");
    }
    complete_session(db, tokens, &email, now, signup_school).await
}

/// The address's other tokens and its recorded misses go with a sign-in.
async fn clear_login_state(db: &PgPool, email: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM public.verification_tokens WHERE identifier = $1")
        .bind(email)
        .execute(db)
        .await?;
    sqlx::query("DELETE FROM public.verification_failures WHERE identifier = $1")
        .bind(email)
        .execute(db)
        .await?;
    Ok(())
}

fn guess_window() -> Duration {
    Duration::minutes(AUTHENTICATION.code_guess_window_minutes)
}

/// Recent attempts per address, in a table of `(identifier, <column>)` rows.
struct Attempts {
    table: &'static str,
    column: &'static str,
}

/// `_check_code_guesses` and `_record_code_miss`: code attempts, kept as misses.
const CODE_GUESSES: Attempts = Attempts {
    table: "verification_failures",
    column: "failed_at",
};

/// Login emails sent, for the per-address cap (new in Rust).
const LOGIN_EMAILS: Attempts = Attempts {
    table: "verification_sends",
    column: "sent_at",
};

impl Attempts {
    /// Record one attempt at `now`, then count the window, this attempt
    /// included. Over `limit`, the attempt is refused (429 until the oldest
    /// ages out) and forgotten again; concurrent attempts each see the
    /// others' rows, so no more than `limit` get through. Rows older than the
    /// window are pruned.
    async fn admit(
        &self,
        db: &PgPool,
        identifier: &str,
        now: DateTime<Utc>,
        limit: usize,
        window: Duration,
    ) -> Result<(), ApiError> {
        let Self { table, column } = self;
        sqlx::query(&format!(
            "INSERT INTO public.{table} (identifier, {column}) VALUES ($1, $2)"
        ))
        .bind(identifier)
        .bind(now)
        .execute(db)
        .await?;
        let recent: Vec<DateTime<Utc>> = sqlx::query_scalar(&format!(
            "SELECT {column} FROM public.{table} WHERE identifier = $1 AND {column} > $2"
        ))
        .bind(identifier)
        .bind(now - window)
        .fetch_all(db)
        .await?;
        if let Some(retry_after) = over_limit(&recent, limit, window, now) {
            self.forget(db, identifier, now).await;
            return Err(ApiError::RateLimited {
                detail: RATE_LIMIT_EXCEEDED.to_owned(),
                retry_after,
            });
        }
        if let Err(error) = sqlx::query(&format!(
            "DELETE FROM public.{table} WHERE identifier = $1 AND {column} < $2"
        ))
        .bind(identifier)
        .bind(now - window)
        .execute(db)
        .await
        {
            tracing::warn!("Failed to prune old {table} rows: {error}");
        }
        Ok(())
    }

    /// Remove the one attempt recorded at `now`.
    async fn forget(&self, db: &PgPool, identifier: &str, now: DateTime<Utc>) {
        let Self { table, column } = self;
        if let Err(error) = sqlx::query(&format!(
            "DELETE FROM public.{table} WHERE ctid IN (SELECT ctid FROM public.{table} \
             WHERE identifier = $1 AND {column} = $2 LIMIT 1)"
        ))
        .bind(identifier)
        .bind(now)
        .execute(db)
        .await
        {
            tracing::warn!("Failed to forget a refused {table} row: {error}");
        }
    }
}

/// The seconds until the oldest of the window's attempts ages out, when the
/// window holds more than `limit` (`max(1, ceil(...))`).
fn over_limit(
    recent: &[DateTime<Utc>],
    limit: usize,
    window: Duration,
    now: DateTime<Utc>,
) -> Option<u64> {
    if recent.len() <= limit {
        return None;
    }
    let oldest = recent.iter().min()?;
    let wait = (*oldest + window - now).num_microseconds().unwrap_or(0) as f64 / 1e6;
    Some((wait.ceil() as i64).max(1) as u64)
}

/// `verify_google_oauth`: exchange Google's code for a verified email and
/// start a session at the school whose site the callback is on.
pub async fn verify_google_oauth(
    db: &PgPool,
    settings: &Settings,
    tokens: &AccessTokens,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
    callback_url: &str,
) -> Result<SignedIn, ApiError> {
    let email = google::verified_email(settings, code, code_verifier, redirect_uri).await?;
    let signup_school = school_from_frontend_url(db, settings, callback_url).await?;
    complete_session(db, tokens, &email, Utc::now(), signup_school).await
}

fn registration_failed() -> ApiError {
    service_error(REGISTRATION_FAILED)
}

/// The `users` row for `email`: its auth id and school slug.
async fn find_user_by_email(db: &PgPool, email: &str) -> Option<(String, Option<String>)> {
    read_with_retry(|| {
        sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT u.auth_id, NULLIF(s.slug, '') FROM public.users u \
             LEFT JOIN public.schools s ON s.id = u.school_id WHERE u.email = $1 LIMIT 1",
        )
        .bind(email)
        .fetch_optional(db)
    })
    .await
    .unwrap_or_else(|error| {
        tracing::warn!("Failed to look up DB user: {error}");
        None
    })
}

/// An existing user signs in at their own school (none yet means onboarding).
async fn existing_user(
    db: &PgPool,
    (auth_id, school): (String, Option<String>),
) -> Result<(String, Option<String>, bool), ApiError> {
    if school.is_some() && registered_school(db, school.as_deref()).await?.is_none() {
        tracing::error!("Existing user is not assigned to a registered school");
        return Err(registration_failed());
    }
    let onboarding_required = school.is_none();
    Ok((auth_id, school, onboarding_required))
}

/// `_complete_authenticated_session`: the existing user's school, or a new
/// `users` row (at the signup site's school) that joins the clubs it was
/// invited to; then a new session.
pub(super) async fn complete_session(
    db: &PgPool,
    tokens: &AccessTokens,
    email: &str,
    now: DateTime<Utc>,
    signup_school: Option<String>,
) -> Result<SignedIn, ApiError> {
    let (auth_id, school, onboarding_required) = match find_user_by_email(db, email).await {
        Some(found) => existing_user(db, found).await?,
        None => {
            let school_id = registered_school(db, signup_school.as_deref()).await?;
            if signup_school
                .as_deref()
                .is_some_and(|school| !school.is_empty())
                && school_id.is_none()
            {
                tracing::error!("Signup site resolved to an unregistered school");
                return Err(registration_failed());
            }
            match create_user(db, email, school_id, now).await? {
                Some(auth_id) => (auth_id, signup_school, true),
                // Another first sign-in for this address created the row a
                // moment ago; this one signs in to it.
                None => match find_user_by_email(db, email).await {
                    Some(found) => existing_user(db, found).await?,
                    None => {
                        tracing::error!("No users row after a conflicting insert");
                        return Err(registration_failed());
                    }
                },
            }
        }
    };
    let refresh_token = new_refresh_token();
    let session_id = start_session(db, &auth_id, &refresh_token).await?;
    let access_token = tokens.issue(&auth_id, Some(email), &session_id.to_string())?;
    Ok(SignedIn {
        body: TokenResponse {
            school,
            onboarding_required,
            ..TokenResponse::new(access_token, &auth_id)
        },
        refresh_token,
    })
}

/// Insert the `users` row, then accept every pending invitation to its
/// address. Returns the new account's auth id, or `None` when a concurrent
/// sign-in inserted the address first (Python failed that sign-in).
async fn create_user(
    db: &PgPool,
    email: &str,
    school_id: Option<i32>,
    now: DateTime<Utc>,
) -> Result<Option<String>, ApiError> {
    let user_id = Uuid::new_v4();
    let auth_id = Uuid::new_v4().to_string();
    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO public.users (id, auth_id, email, school_id) VALUES ($1, $2, $3, $4) \
         ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(user_id)
    .bind(&auth_id)
    .bind(email)
    .bind(school_id)
    .fetch_optional(db)
    .await
    .map_err(|error| {
        tracing::error!("Failed to create public.users record: {error}");
        registration_failed()
    })?;
    if inserted.is_none() {
        return Ok(None);
    }
    tracing::info!(
        "Created public.users record for {} (id={user_id})",
        loggable(email)
    );
    if let Err(error) = accept_invitations(db, email, user_id, now).await {
        tracing::warn!("Failed to process auto-join for user {user_id}: {error}");
    }
    Ok(Some(auth_id))
}

async fn accept_invitations(
    db: &PgPool,
    email: &str,
    user_id: Uuid,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let invitations = read_with_retry(|| {
        sqlx::query_as::<_, (Uuid, i32)>(
            "SELECT id, club_id FROM public.club_invitations \
             WHERE email = $1 AND status = 'pending' AND expires_at > $2",
        )
        .bind(email)
        .bind(now)
        .fetch_all(db)
    })
    .await?;
    for (invitation_id, club_id) in invitations {
        match add_member(db, i64::from(club_id), user_id).await {
            Ok(_) => {}
            Err(AddError::AlreadyMember) => tracing::warn!(
                "Failed to auto-add user {user_id} to club {club_id}: User is already a member of this club"
            ),
            Err(AddError::Api(error)) => {
                tracing::warn!("Failed to auto-add user {user_id} to club {club_id}: {error:?}")
            }
        }
        sqlx::query("UPDATE public.club_invitations SET status = 'accepted' WHERE id = $1")
            .bind(invitation_id)
            .execute(db)
            .await?;
    }
    Ok(())
}

/// `_session_expiry`.
fn session_expiry(now: DateTime<Utc>) -> DateTime<Utc> {
    now + Duration::days(AUTHENTICATION.session_cookie_days)
}

/// `_start_session`: a new `auth_sessions` row holding the refresh token's digest.
async fn start_session(db: &PgPool, auth_id: &str, refresh_token: &str) -> Result<Uuid, ApiError> {
    sqlx::query_scalar(
        "INSERT INTO public.auth_sessions (auth_id, refresh_token_hash, expires_at) \
         VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(auth_id)
    .bind(sha256_hex(refresh_token))
    .bind(session_expiry(Utc::now()))
    .fetch_one(db)
    .await
    .map_err(|error| {
        tracing::error!("Failed to start a session: {error}");
        registration_failed()
    })
}

/// `refresh`: rotate the browser's refresh token and issue a new access token.
pub async fn refresh(
    db: &PgPool,
    tokens: &AccessTokens,
    refresh_token: &str,
) -> Result<SignedIn, ApiError> {
    let presented = sha256_hex(refresh_token);
    let successor = tokens.next_refresh_token(refresh_token)?;
    let now = Utc::now();
    let session = match rotate(db, &presented, &successor, now).await? {
        Some(session) => Some(session),
        None => recently_rotated(db, &presented, &successor, now).await?,
    };
    let Some((session_id, auth_id)) = session else {
        return Err(ApiError::authentication(SESSION_REFRESH_FAILED));
    };
    let email: Option<String> = read_with_retry(|| {
        sqlx::query_scalar("SELECT email FROM public.users WHERE auth_id = $1 LIMIT 1")
            .bind(&auth_id)
            .fetch_optional(db)
    })
    .await?;
    let Some(email) = email else {
        // The account was deleted, so its sessions end with it.
        crate::api::auth::revoke_sessions(db, &auth_id).await?;
        return Err(ApiError::authentication(SESSION_REFRESH_FAILED));
    };
    let access_token = tokens.issue(&auth_id, Some(&email), &session_id.to_string())?;
    Ok(SignedIn {
        body: TokenResponse::new(access_token, &auth_id),
        refresh_token: successor,
    })
}

/// `_rotate`: swap the session's current token for its successor, if the
/// presented token is the current one of a live session.
async fn rotate(
    db: &PgPool,
    presented: &str,
    successor: &str,
    now: DateTime<Utc>,
) -> Result<Option<(Uuid, String)>, ApiError> {
    Ok(sqlx::query_as(
        "UPDATE public.auth_sessions \
         SET refresh_token_hash = $2, previous_refresh_token_hash = $1, rotated_at = $3, \
             expires_at = $4 \
         WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > $3 \
         RETURNING id, auth_id",
    )
    .bind(presented)
    .bind(sha256_hex(successor))
    .bind(now)
    .bind(session_expiry(now))
    .fetch_optional(db)
    .await?)
}

/// `_recently_rotated`: a token rotated moments ago (a parallel refresh)
/// still yields its successor; sent any later, a replaced token means it
/// leaked, and the session is revoked.
async fn recently_rotated(
    db: &PgPool,
    presented: &str,
    successor: &str,
    now: DateTime<Utc>,
) -> Result<Option<(Uuid, String)>, ApiError> {
    let row: Option<(Uuid, String, String, Option<DateTime<Utc>>)> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT id, auth_id, refresh_token_hash, rotated_at FROM public.auth_sessions \
             WHERE previous_refresh_token_hash = $1 AND revoked_at IS NULL LIMIT 1",
        )
        .bind(presented)
        .fetch_optional(db)
    })
    .await?;
    let Some((id, auth_id, current_hash, rotated_at)) = row else {
        return Ok(None);
    };
    if reuse_allowed(rotated_at, now, &current_hash, successor) {
        return Ok(Some((id, auth_id)));
    }
    tracing::warn!("Replaced refresh token reused; revoking session {id}");
    sqlx::query("UPDATE public.auth_sessions SET revoked_at = $2 WHERE id = $1")
        .bind(id)
        .bind(now)
        .execute(db)
        .await?;
    Ok(None)
}

/// Whether a just-replaced token may still return its successor: the
/// session was rotated within `refresh_token_reuse_seconds`, to exactly the
/// successor this token derives (compared in constant time).
fn reuse_allowed(
    rotated_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
    current_hash: &str,
    successor: &str,
) -> bool {
    let reuse_window = Duration::seconds(AUTHENTICATION.refresh_token_reuse_seconds);
    let in_window = rotated_at.is_some_and(|rotated_at| now - rotated_at <= reuse_window);
    let same_successor = aws_lc_rs::constant_time::verify_slices_are_equal(
        current_hash.as_bytes(),
        sha256_hex(successor).as_bytes(),
    )
    .is_ok();
    in_window && same_successor
}

/// `logout`: end every session of the token's user, like signing out
/// everywhere. A token we did not sign is a 401.
pub async fn logout(
    db: &PgPool,
    tokens: &AccessTokens,
    access_token: &str,
) -> Result<(), ApiError> {
    let Some(auth_id) = tokens.subject(access_token)? else {
        return Err(ApiError::authentication(INVALID_OR_EXPIRED_TOKEN));
    };
    crate::api::auth::revoke_sessions(db, &auth_id).await?;
    Ok(())
}

/// `_login_email`: the six-digit code and the sign-in link.
pub fn login_email(email: &str, code: &str, callback_url: &str) -> EmailMessage {
    let minutes = AUTHENTICATION.verification_token_minutes;
    let expiry = format!(
        "This code and link expire in {minutes} minutes. \
         If you did not request this, you can safely ignore this email."
    );
    let code_box = format!(
        concat!(
            r#"<div class="w2d-elevated" style="margin:0 0 20px;padding:16px;background:{};"#,
            "border:1px solid {};border-radius:12px;text-align:center;",
            r#"color:{};font:800 30px monospace;letter-spacing:8px;">"#,
            "{}</div>",
        ),
        layout::SURFACE_ELEVATED,
        layout::BORDER,
        layout::FOREGROUND,
        escape(code)
    );
    EmailMessage {
        to: vec![email.to_owned()],
        subject: "Your wat2do login code and link".to_owned(),
        body_html: layout::shell(
            "Log in to wat2do",
            &(layout::paragraph("Here is your 6-digit login code:", true)
                + &code_box
                + &layout::paragraph("Or open this link to sign in:", true)
                + &layout::button(callback_url, "Open sign-in link")
                + &layout::note(&escape(&expiry))),
            &[],
        ),
        body_text: [
            "Log in to wat2do".to_owned(),
            String::new(),
            format!("Here is your 6-digit login code: {code}"),
            String::new(),
            format!("Or open this link to sign in: {callback_url}"),
            String::new(),
            expiry,
        ]
        .join("\n"),
        inline_images: vec![Arc::clone(&layout::LOGO)],
        ..EmailMessage::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_email_carries_the_code_and_link() {
        // test_prepare_otp_email_preserves_safe_return_path
        let callback = format!(
            "https://uwaterloo.wat2do.io/auth/callback?{}",
            urlencode(&[
                ("token", "link-token"),
                ("email", "student@uwaterloo.ca"),
                ("returnTo", "/promote?school=uwaterloo"),
            ])
        );
        let message = login_email("student@uwaterloo.ca", "123456", &callback);
        assert_eq!(message.to, ["student@uwaterloo.ca"]);
        assert_eq!(message.subject, "Your wat2do login code and link");
        assert!(
            message
                .body_html
                .contains("https://uwaterloo.wat2do.io/auth/callback")
        );
        assert!(
            message
                .body_html
                .contains("returnTo=%2Fpromote%3Fschool%3Duwaterloo")
        );
        assert!(message.body_text.contains("email=student%40uwaterloo.ca"));
        assert!(message.body_html.contains(">123456</div>"));
        assert!(message.body_html.contains(r#"<img src="cid:wat2do-logo""#));
        assert_eq!(message.inline_images.len(), 1);
        assert_eq!(message.inline_images[0].content_id, "wat2do-logo");
        assert!(message.body_text.contains("expire in 15 minutes"));
        assert!(message.sender.is_none());
    }

    #[test]
    fn codes_are_six_digits_and_digests_match_python() {
        for _ in 0..200 {
            let code = new_code();
            assert_eq!(code.len(), CODE_DIGITS);
            assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
        }
        assert_ne!(new_code(), new_code() + "x");
        // hashlib.sha256(b"123456").hexdigest()
        assert_eq!(
            sha256_hex("123456"),
            "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
        );
        assert_eq!(
            clean_email(" Student@UWaterloo.ca \n"),
            "student@uwaterloo.ca"
        );
        assert_eq!(loggable("a@b\nWARN x\r"), "a@b\\nWARN x\\r");
    }

    #[test]
    fn signup_school_comes_from_a_trusted_school_site() {
        // test_signup_school_from_site, test_school_from_frontend_url_shared_parent
        let settings = crate::settings::test_settings(&[
            (
                "CORS_ORIGINS",
                r#"["http://localhost:3000", "http://ualberta.wat2do.localhost:3000"]"#,
            ),
            ("CORS_ORIGIN_REGEX", r"https://([a-z]+\.)?wat2do\.io"),
        ]);
        for (url, expected) in [
            ("https://utsg.wat2do.io", Some("utsg")),
            ("https://utsg.wat2do.io/login?x=1", Some("utsg")),
            ("https://wat2do.io", None),
            ("http://localhost:3000", None),
            ("https://utsg.wat2do.io.evil.com", None),
            ("http://ualberta.wat2do.localhost:3000", Some("ualberta")),
            ("http://ualberta.wat2do.localhost:3000.evil.test", None),
            ("", None),
        ] {
            assert_eq!(
                frontend_slug(&settings, url).ok().unwrap().as_deref(),
                expected,
                "{url}"
            );
        }
        assert!(frontend_slug(&settings, "http://[::1").is_err());
    }

    #[test]
    fn five_misses_lock_codes_until_the_oldest_ages_out() {
        // test_code_misses_lock_the_address_but_not_the_link, test_code_misses_outside_the_window_are_pruned
        let now = "2026-11-04T00:30:00Z".parse::<DateTime<Utc>>().unwrap();
        let limit = AUTHENTICATION.code_guess_limit;
        let minutes = AUTHENTICATION.code_guess_window_minutes;
        let window = guess_window();
        let minutes_ago = |ago: i64| now - Duration::minutes(ago);
        // The window holds `limit` earlier misses and this attempt, recorded first.
        let attempts: Vec<_> = (0..limit as i64)
            .map(|minute| minutes_ago(minute + 1))
            .chain([now])
            .collect();
        // The oldest miss is `limit` minutes old, so the lock lasts `window - limit` minutes more.
        assert_eq!(
            over_limit(&attempts, limit, window, now),
            Some(((minutes - limit as i64) * 60) as u64)
        );
        // One miss fewer and this attempt is the last one allowed.
        assert_eq!(over_limit(&attempts[1..], limit, window, now), None);
        // A miss about to age out still leaves at least one second.
        let edge: Vec<_> = (0..limit)
            .map(|_| now - window + Duration::milliseconds(10))
            .chain([now])
            .collect();
        assert_eq!(over_limit(&edge, limit, window, now), Some(1));
        assert!(over_limit(&attempts, limit, window, now).unwrap() <= (minutes * 60) as u64);
        // The send cap counts the same way.
        let sends: Vec<_> = (0..=AUTHENTICATION.code_send_limit as i64)
            .map(minutes_ago)
            .collect();
        let send_window = Duration::minutes(AUTHENTICATION.code_send_window_minutes);
        assert!(over_limit(&sends, AUTHENTICATION.code_send_limit, send_window, now).is_some());
        assert_eq!(
            over_limit(
                &sends[1..],
                AUTHENTICATION.code_send_limit,
                send_window,
                now
            ),
            None
        );
        assert_eq!(
            log_excerpt(&"x".repeat(70)),
            format!("{}...", "x".repeat(64))
        );
        assert_eq!(format!("{:?}", log_excerpt("a\nb\"")), r#""a\nb\"""#);
    }

    #[test]
    fn a_replaced_token_reused_quickly_gets_the_same_successor() {
        // test_parallel_refresh_within_the_reuse_window_gets_the_same_successor and
        // test_a_replaced_token_reused_later_revokes_the_session
        let now = "2026-11-04T00:30:00Z".parse::<DateTime<Utc>>().unwrap();
        let reuse = AUTHENTICATION.refresh_token_reuse_seconds;
        let stored = sha256_hex("successor");
        let rotated = |seconds_ago: i64| Some(now - Duration::seconds(seconds_ago));
        assert!(reuse_allowed(rotated(0), now, &stored, "successor"));
        assert!(reuse_allowed(rotated(reuse), now, &stored, "successor"));
        assert!(!reuse_allowed(
            rotated(reuse + 1),
            now,
            &stored,
            "successor"
        ));
        assert!(!reuse_allowed(rotated(0), now, &stored, "another"));
        assert!(!reuse_allowed(None, now, &stored, "successor"));
    }
}
