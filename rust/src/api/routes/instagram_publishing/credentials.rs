//! The connected accounts' encrypted Graph API tokens
//! (`services/instagram_publishing/credentials.py`): the publish claim checks
//! an account can still post, and the carousel jobs (`crate::instagram_publishing`)
//! decrypt, refresh and store its token.
//!
//! Tokens are Fernet tokens (`INSTAGRAM_TOKEN_ENCRYPTION_KEY`), read and
//! written exactly as `cryptography.fernet.Fernet` does.

use aws_lc_rs::cipher::{
    AES_128, DecryptionContext, EncryptionContext, PaddedBlockDecryptingKey,
    PaddedBlockEncryptingKey, UnboundCipherKey,
};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::PgPool;

use crate::api::errors::ApiError;
use crate::api::messages::{
    INSTAGRAM_PUBLISHING_NOT_CONFIGURED, INSTAGRAM_REAUTHORIZATION_REQUIRED,
};
use crate::db::read_with_retry;
use crate::text::{python_b64decode, python_strip};

const KEY_INVALID: &str = "Instagram token encryption key is invalid";
const TOKEN_UNREADABLE: &str = "Stored Instagram access token could not be decrypted";
const TOKEN_EXPIRED: &str = "Instagram access token expired before it could be refreshed";
/// `refresh_error` keeps at most this many characters.
const ERROR_LENGTH: usize = 2000;

#[derive(sqlx::FromRow)]
struct AccountRow {
    instagram_user_id: String,
    instagram_username: String,
    encrypted_access_token: String,
    expires_at: DateTime<Utc>,
    requires_reauthorization: bool,
}

/// One connected account with its decrypted token (`InstagramAccountCredentials`).
pub struct AccountCredentials {
    pub account_key: String,
    pub instagram_user_id: String,
    pub instagram_username: String,
    pub access_token: String,
    pub expires_at: DateTime<Utc>,
}

impl std::fmt::Debug for AccountCredentials {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The token is never printed.
        formatter
            .debug_struct("AccountCredentials")
            .field("account_key", &self.account_key)
            .field("instagram_user_id", &self.instagram_user_id)
            .field("instagram_username", &self.instagram_username)
            .field("expires_at", &self.expires_at)
            .finish_non_exhaustive()
    }
}

/// `load_account_credentials`: the account's token, once it is known to be
/// authorized, unexpired and decryptable. An expired token marks the account
/// for reauthorization.
pub async fn load_account_credentials(
    db: &PgPool,
    encryption_key: &str,
    account_key: &str,
    now: DateTime<Utc>,
) -> Result<AccountCredentials, ApiError> {
    let row: Option<AccountRow> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT instagram_user_id, instagram_username, encrypted_access_token, expires_at, \
             requires_reauthorization FROM public.instagram_publishing_accounts \
             WHERE account_key = $1 LIMIT 1",
        )
        .bind(account_key)
        .fetch_optional(db)
    })
    .await?;
    let row = row.ok_or_else(|| ApiError::validation(INSTAGRAM_PUBLISHING_NOT_CONFIGURED))?;
    if row.requires_reauthorization {
        return Err(ApiError::validation(INSTAGRAM_REAUTHORIZATION_REQUIRED));
    }
    if row.expires_at <= now {
        mark_reauthorization_required(db, account_key, TOKEN_EXPIRED, now).await?;
        return Err(ApiError::validation(INSTAGRAM_REAUTHORIZATION_REQUIRED));
    }
    Ok(AccountCredentials {
        account_key: account_key.to_owned(),
        access_token: decrypt_token(encryption_key, &row.encrypted_access_token)?,
        instagram_user_id: row.instagram_user_id,
        instagram_username: row.instagram_username,
        expires_at: row.expires_at,
    })
}

/// `_mark_reauthorization_required`: the account stops publishing until a
/// person connects it again; `error` says why.
pub async fn mark_reauthorization_required(
    db: &PgPool,
    account_key: &str,
    error: &str,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    let error: String = error.chars().take(ERROR_LENGTH).collect();
    sqlx::query(
        "UPDATE public.instagram_publishing_accounts SET requires_reauthorization = true, \
         refresh_error = $2, refresh_failed_at = $3, updated_at = $3 WHERE account_key = $1",
    )
    .bind(account_key)
    .bind(error)
    .bind(now)
    .execute(db)
    .await?;
    Ok(())
}

/// `_decrypt`: the stored token's plaintext.
pub fn decrypt_token(encryption_key: &str, encrypted: &str) -> Result<String, ApiError> {
    let key = fernet_key(encryption_key)?;
    decrypt(&key, encrypted).ok_or_else(|| ApiError::validation(TOKEN_UNREADABLE))
}

/// `_encrypt`: a new Fernet token for `access_token`, stamped now.
pub fn encrypt_token(encryption_key: &str, access_token: &str) -> Result<String, ApiError> {
    let key = fernet_key(encryption_key)?;
    let mut iv = [0u8; 16];
    aws_lc_rs::rand::fill(&mut iv)
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("no random IV for a Fernet token")))?;
    let seconds = u64::try_from(Utc::now().timestamp()).unwrap_or_default();
    encrypt(&key, access_token.as_bytes(), iv, seconds)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("Fernet encryption failed")))
}

/// `_fernet()`: the stripped key, 32 url-safe base64 bytes.
fn fernet_key(raw: &str) -> Result<[u8; 32], ApiError> {
    let raw = python_strip(raw);
    if raw.is_empty() {
        return Err(ApiError::validation(INSTAGRAM_PUBLISHING_NOT_CONFIGURED));
    }
    python_b64decode(raw)
        .filter(|_| raw.is_ascii())
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .ok_or_else(|| ApiError::validation(KEY_INVALID))
}

/// `Fernet(key).decrypt(token).decode("utf-8")`, without a TTL: `None` for
/// any token Python would refuse.
fn decrypt(key: &[u8; 32], token: &str) -> Option<String> {
    if !token.is_ascii() {
        return None;
    }
    let data = python_b64decode(token)?;
    // Version byte, 8-byte timestamp, 16-byte IV, ciphertext, 32-byte HMAC.
    if data.first() != Some(&0x80) || data.len() < 9 + 16 + 32 {
        return None;
    }
    let (signed, signature) = data.split_at(data.len() - 32);
    let mut mac = Hmac::<Sha256>::new_from_slice(&key[..16]).expect("any key length");
    mac.update(signed);
    mac.verify_slice(signature).ok()?;
    let iv: [u8; 16] = signed[9..25].try_into().ok()?;
    let mut ciphertext = signed[25..].to_vec();
    let cipher =
        PaddedBlockDecryptingKey::cbc_pkcs7(UnboundCipherKey::new(&AES_128, &key[16..]).ok()?)
            .ok()?;
    let plaintext = cipher
        .decrypt(&mut ciphertext, DecryptionContext::Iv128(iv.into()))
        .ok()?;
    String::from_utf8(plaintext.to_vec()).ok()
}

/// `Fernet(key)._encrypt_from_parts(plaintext, seconds, iv)`.
fn encrypt(key: &[u8; 32], plaintext: &[u8], iv: [u8; 16], seconds: u64) -> Option<String> {
    let cipher =
        PaddedBlockEncryptingKey::cbc_pkcs7(UnboundCipherKey::new(&AES_128, &key[16..]).ok()?)
            .ok()?;
    let mut ciphertext = plaintext.to_vec();
    cipher
        .less_safe_encrypt(&mut ciphertext, EncryptionContext::Iv128(iv.into()))
        .ok()?;
    let mut data = vec![0x80];
    data.extend_from_slice(&seconds.to_be_bytes());
    data.extend_from_slice(&iv);
    data.extend_from_slice(&ciphertext);
    let mut mac = Hmac::<Sha256>::new_from_slice(&key[..16]).expect("any key length");
    mac.update(&data);
    data.extend_from_slice(&mac.finalize().into_bytes());
    Some(URL_SAFE.encode(data))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    // Made with Python's cryptography: Fernet(KEY).encrypt(b"token-value").
    pub(crate) const KEY: &str = "Q2b2Yb6Qy5cZ8sV3mN1pL0tR4wX7aE9dF2gH6jK8lM0=";
    pub(crate) const TOKEN: &str = "gAAAAABq7p_hEAtCB3_TtqGZcc3UEBib0qLAb650BDNz9ZsB4k0sC0OOElHCS2PuGJr9ltGuFfX7IBbnB68I9ZfVfEs9CZ96RQ==";

    #[test]
    fn keys_must_be_thirty_two_url_safe_bytes() {
        assert!(fernet_key(&format!(" {KEY}\n")).is_ok());
        assert!(matches!(
            fernet_key("  "),
            Err(ApiError::Validation { detail, .. }) if detail == INSTAGRAM_PUBLISHING_NOT_CONFIGURED
        ));
        assert!(matches!(
            fernet_key("short"),
            Err(ApiError::Validation { detail, .. }) if detail == KEY_INVALID
        ));
    }

    #[test]
    fn tokens_python_wrote_decrypt_and_tampered_ones_do_not() {
        let key = fernet_key(KEY).unwrap();
        assert_eq!(decrypt(&key, TOKEN).as_deref(), Some("token-value"));
        let token = encrypt(&key, b"token-value", [7; 16], 1_700_000_000).unwrap();
        assert_eq!(decrypt(&key, &token).as_deref(), Some("token-value"));
        let mut tampered = token.clone().into_bytes();
        tampered[20] = if tampered[20] == b'A' { b'B' } else { b'A' };
        assert_eq!(decrypt(&key, &String::from_utf8(tampered).unwrap()), None);
        assert_eq!(decrypt(&key, "not a token"), None);
        let other = fernet_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").unwrap();
        assert_eq!(decrypt(&other, &token), None);
    }

    #[test]
    fn new_tokens_round_trip_without_showing_the_plaintext() {
        // test_import_validates_identity_and_stores_only_ciphertext
        let first = encrypt_token(KEY, "plaintext-token").unwrap();
        let second = encrypt_token(KEY, "plaintext-token").unwrap();
        assert_ne!(first, second);
        assert!(!first.contains("plaintext-token"));
        assert_eq!(decrypt_token(KEY, &first).unwrap(), "plaintext-token");
        assert!(matches!(
            decrypt_token(KEY, "gAAAAA"),
            Err(ApiError::Validation { detail, .. }) if detail == TOKEN_UNREADABLE
        ));
    }

    #[test]
    fn credentials_never_print_their_token() {
        let credentials = AccountCredentials {
            account_key: "dalhousie".into(),
            instagram_user_id: "37640733598873542".into(),
            instagram_username: "dalhousie.wat2do.io".into(),
            access_token: "sensitive-token".into(),
            expires_at: Utc::now(),
        };
        assert!(!format!("{credentials:?}").contains("sensitive-token"));
    }
}
