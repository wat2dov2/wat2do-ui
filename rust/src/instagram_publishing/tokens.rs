//! The accounts' Graph API tokens (`credentials.py`): importing one a person
//! generated, and refreshing each before it expires. A token is stored only
//! encrypted and never printed; a failed refresh marks only its own account
//! for reauthorization, with the token cut out of the reason.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Result, bail};
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;

use super::meta::{GRAPH_HOST, Identity, MetaClient};
use super::{Refused, job_error};
use crate::api::routes::instagram_publishing::credentials::{
    decrypt_token, encrypt_token, mark_reauthorization_required,
};
use crate::controlbox::INSTAGRAM_PUBLISHING;

/// `_safe_error`: the error's message with the token cut out.
fn safe_error(error: &anyhow::Error, access_token: &str) -> String {
    let message = format!("{error:#}");
    let message = if access_token.is_empty() {
        message
    } else {
        message.replace(access_token, "[REDACTED]")
    };
    message.chars().take(2000).collect()
}

#[derive(sqlx::FromRow)]
pub(super) struct DueAccount {
    pub(super) account_key: String,
    pub(super) instagram_user_id: String,
    pub(super) encrypted_access_token: String,
}

/// `refresh_expiring_tokens`: refresh every healthy token that expires
/// within `token_refresh_lead_days`, counting what was due, refreshed and failed.
pub async fn refresh_expiring_tokens(
    db: &PgPool,
    encryption_key: &str,
    graph_host: &str,
    now: DateTime<Utc>,
) -> Result<BTreeMap<String, i64>> {
    let refresh_before = now + Duration::days(INSTAGRAM_PUBLISHING.token_refresh_lead_days);
    let due: Vec<DueAccount> = sqlx::query_as(
        "SELECT account_key, instagram_user_id, encrypted_access_token \
         FROM public.instagram_publishing_accounts \
         WHERE requires_reauthorization = false AND expires_at <= $1 ORDER BY expires_at",
    )
    .bind(refresh_before)
    .fetch_all(db)
    .await?;
    let mut counts = BTreeMap::from([
        ("due".to_owned(), due.len() as i64),
        ("refreshed".to_owned(), 0),
        ("failed".to_owned(), 0),
    ]);
    for account in due {
        let outcome = if refresh_account(db, encryption_key, graph_host, &account, now).await? {
            "refreshed"
        } else {
            "failed"
        };
        *counts.get_mut(outcome).expect("counted") += 1;
    }
    Ok(counts)
}

/// Refresh one due account; a refused refresh marks it for reauthorization.
/// Whether it was refreshed.
pub(super) async fn refresh_account(
    db: &PgPool,
    encryption_key: &str,
    graph_host: &str,
    account: &DueAccount,
    now: DateTime<Utc>,
) -> Result<bool> {
    let current = match decrypt_token(encryption_key, &account.encrypted_access_token) {
        Ok(token) => token,
        Err(error) => {
            tracing::error!(
                "Instagram token refresh configuration failed account_key={}: {:#}",
                account.account_key,
                job_error(error)
            );
            return Ok(false);
        }
    };
    match refresh(db, encryption_key, graph_host, account, &current, now).await {
        Ok(()) => Ok(true),
        Err(error) => {
            let error = safe_error(&error, &current);
            mark_reauthorization_required(db, &account.account_key, &error, now)
                .await
                .map_err(job_error)?;
            tracing::error!(
                "Instagram token refresh failed account_key={}: {error}",
                account.account_key
            );
            Ok(false)
        }
    }
}

/// A new token for one account, stored once it is known to be the same account.
async fn refresh(
    db: &PgPool,
    encryption_key: &str,
    graph_host: &str,
    account: &DueAccount,
    current: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    let refreshed = MetaClient::with_host(graph_host, current)?
        .refresh_access_token()
        .await?;
    let identity = MetaClient::with_host(graph_host, &refreshed.access_token)?
        .get_identity()
        .await?;
    // The numeric id is the account's identity; the handle may change.
    if identity.id != account.instagram_user_id {
        bail!("Refreshed Instagram token identity does not match account");
    }
    let encrypted = encrypt_token(encryption_key, &refreshed.access_token).map_err(job_error)?;
    sqlx::query(
        "UPDATE public.instagram_publishing_accounts SET instagram_user_id = $2, \
         instagram_username = $3, encrypted_access_token = $4, expires_at = $5, \
         requires_reauthorization = false, last_validated_at = $6, last_refreshed_at = $6, \
         refresh_error = NULL, refresh_failed_at = NULL, updated_at = $6 WHERE account_key = $1",
    )
    .bind(&account.account_key)
    .bind(&identity.id)
    .bind(&identity.username)
    .bind(encrypted)
    .bind(now + Duration::seconds(refreshed.expires_in))
    .bind(now)
    .execute(db)
    .await?;
    Ok(())
}

/// `import_access_token`: check a token a person generated for the school
/// `account_key` names, then store it encrypted. The handle is recorded as
/// Instagram reports it; only the numeric id is checked on later refreshes.
pub async fn import_access_token(
    db: &PgPool,
    encryption_key: &str,
    graph_host: &str,
    access_token: &str,
    account_key: &str,
    now: DateTime<Utc>,
) -> Result<Identity> {
    let token = crate::text::python_strip(access_token);
    if token.is_empty() {
        return Err(Refused("Instagram access token cannot be empty".into()).into());
    }
    let key = crate::text::python_strip(account_key);
    let school_id: Option<i32> =
        sqlx::query_scalar("SELECT id FROM public.schools WHERE slug = $1 LIMIT 1")
            .bind(crate::schools::normalize_slug(key))
            .fetch_optional(db)
            .await?;
    let Some(school_id) = school_id else {
        return Err(Refused(format!("No registered school matches account key '{key}'")).into());
    };
    let identity = MetaClient::with_host(graph_host, token)?
        .get_identity()
        .await?;
    let encrypted = encrypt_token(encryption_key, token).map_err(job_error)?;
    sqlx::query(
        "INSERT INTO public.instagram_publishing_accounts (account_key, school_id, \
             instagram_user_id, instagram_username, encrypted_access_token, expires_at, \
             requires_reauthorization, last_validated_at, last_refreshed_at, refresh_error, \
             refresh_failed_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, false, $7, NULL, NULL, NULL, $7) \
         ON CONFLICT (account_key) DO UPDATE SET school_id = EXCLUDED.school_id, \
             instagram_user_id = EXCLUDED.instagram_user_id, \
             instagram_username = EXCLUDED.instagram_username, \
             encrypted_access_token = EXCLUDED.encrypted_access_token, \
             expires_at = EXCLUDED.expires_at, requires_reauthorization = false, \
             last_validated_at = EXCLUDED.last_validated_at, last_refreshed_at = NULL, \
             refresh_error = NULL, refresh_failed_at = NULL, updated_at = EXCLUDED.updated_at",
    )
    .bind(key)
    .bind(school_id)
    .bind(&identity.id)
    .bind(&identity.username)
    .bind(encrypted)
    .bind(now + Duration::days(INSTAGRAM_PUBLISHING.token_lifetime_days))
    .bind(now)
    .execute(db)
    .await?;
    Ok(identity)
}

/// `parse_token_file`: the leading `account_key=token` lines of a private
/// file, up to the first blank line after them. Token values never appear
/// in an error.
pub fn parse_token_file(path: &Path) -> Result<Vec<(String, String)>> {
    let text = std::fs::read_to_string(path)?;
    let mut tokens: Vec<(String, String)> = Vec::new();
    for (index, raw) in crate::text::python_splitlines(&text)
        .into_iter()
        .enumerate()
    {
        let line_number = index + 1;
        let line = crate::text::python_strip(raw);
        if line.is_empty() {
            if !tokens.is_empty() {
                break;
            }
            continue;
        }
        let Some((account_key, token)) = line.split_once('=') else {
            bail!("Expected account_key=token on line {line_number}");
        };
        let (account_key, token) = (
            crate::text::python_strip(account_key),
            crate::text::python_strip(token),
        );
        if account_key.is_empty() || token.is_empty() {
            bail!("Expected non-empty account_key and token on line {line_number}");
        }
        if tokens.iter().any(|(key, _)| key == account_key) {
            bail!("Duplicate account key '{account_key}' on line {line_number}");
        }
        tokens.push((account_key.to_owned(), token.to_owned()));
    }
    if tokens.is_empty() {
        bail!("Token file did not contain any account_key=token entries");
    }
    Ok(tokens)
}

/// `import_instagram_tokens.py`: import each token in the file, printing
/// each account's handle and id.
pub async fn import_token_file(db: &PgPool, encryption_key: &str, path: &Path) -> Result<()> {
    let tokens = parse_token_file(path)?;
    for (account_key, token) in &tokens {
        let identity = import_access_token(
            db,
            encryption_key,
            GRAPH_HOST,
            token,
            account_key,
            Utc::now(),
        )
        .await
        .map_err(|error| anyhow::anyhow!(safe_error(&error, token)))?;
        println!("{account_key} -> @{} ({})", identity.username, identity.id);
    }
    println!("Imported {} Instagram account token(s)", tokens.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_never_carry_the_token() {
        // test_refresh_failure_marks_only_that_account_for_reauthorization
        assert_eq!(
            safe_error(
                &anyhow::anyhow!("revoked sensitive-token"),
                "sensitive-token"
            ),
            "revoked [REDACTED]"
        );
    }

    #[test]
    fn token_files_are_read_up_to_the_first_blank_line() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("tokens.txt");
        std::fs::write(
            &path,
            "\n uwaterloo = token-a\nutsg=token=b\n\nnotes below\n",
        )
        .unwrap();
        assert_eq!(
            parse_token_file(&path).unwrap(),
            [
                ("uwaterloo".to_owned(), "token-a".to_owned()),
                ("utsg".to_owned(), "token=b".to_owned())
            ]
        );
        for (content, message) in [
            ("uwaterloo token", "Expected account_key=token on line 1"),
            (
                "uwaterloo=",
                "Expected non-empty account_key and token on line 1",
            ),
            ("a=x\na=y", "Duplicate account key 'a' on line 2"),
            (
                "\n\n",
                "Token file did not contain any account_key=token entries",
            ),
        ] {
            std::fs::write(&path, content).unwrap();
            assert_eq!(parse_token_file(&path).unwrap_err().to_string(), message);
        }
    }
}
