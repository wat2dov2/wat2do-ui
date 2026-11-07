//! `load_account_credentials` (`services/instagram_publishing/credentials.py`)
//! as the publish claim uses it: the school's connected account must still be
//! authorized, unexpired and decryptable before a batch is claimed.
//!
//! The token itself is never kept: Python decrypts it again when it publishes.
//! Tokens are Fernet tokens (`INSTAGRAM_TOKEN_ENCRYPTION_KEY`), checked here
//! exactly as `cryptography.fernet.Fernet.decrypt` checks them.

use aws_lc_rs::cipher::{AES_128, DecryptionContext, PaddedBlockDecryptingKey, UnboundCipherKey};
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

#[derive(sqlx::FromRow)]
struct AccountRow {
    instagram_user_id: String,
    encrypted_access_token: String,
    expires_at: DateTime<Utc>,
    requires_reauthorization: bool,
}

/// The connected account's Instagram user id, once its token is known to be usable.
pub async fn usable_account_user_id(
    db: &PgPool,
    encryption_key: &str,
    account_key: &str,
) -> Result<String, ApiError> {
    let row: Option<AccountRow> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT instagram_user_id, encrypted_access_token, expires_at, requires_reauthorization \
             FROM public.instagram_publishing_accounts WHERE account_key = $1 LIMIT 1",
        )
        .bind(account_key)
        .fetch_optional(db)
    })
    .await?;
    let row = row.ok_or_else(|| ApiError::validation(INSTAGRAM_PUBLISHING_NOT_CONFIGURED))?;
    if row.requires_reauthorization {
        return Err(ApiError::validation(INSTAGRAM_REAUTHORIZATION_REQUIRED));
    }
    let now = Utc::now();
    if row.expires_at <= now {
        sqlx::query(
            "UPDATE public.instagram_publishing_accounts SET requires_reauthorization = true, \
             refresh_error = $2, refresh_failed_at = $3, updated_at = $3 WHERE account_key = $1",
        )
        .bind(account_key)
        .bind(TOKEN_EXPIRED)
        .bind(now)
        .execute(db)
        .await?;
        return Err(ApiError::validation(INSTAGRAM_REAUTHORIZATION_REQUIRED));
    }
    let key = fernet_key(encryption_key)?;
    decrypt(&key, &row.encrypted_access_token)
        .ok_or_else(|| ApiError::validation(TOKEN_UNREADABLE))?;
    Ok(row.instagram_user_id)
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

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    // Made with Python's cryptography: Fernet(KEY).encrypt(b"token-value").
    pub(in crate::api::routes::instagram_publishing) const KEY: &str =
        "Q2b2Yb6Qy5cZ8sV3mN1pL0tR4wX7aE9dF2gH6jK8lM0=";
    pub(in crate::api::routes::instagram_publishing) const TOKEN: &str = "gAAAAABq7p_hEAtCB3_TtqGZcc3UEBib0qLAb650BDNz9ZsB4k0sC0OOElHCS2PuGJr9ltGuFfX7IBbnB68I9ZfVfEs9CZ96RQ==";

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
        let token = fernet_fixture::encrypt(&key, b"token-value", [7; 16]);
        assert_eq!(decrypt(&key, &token).as_deref(), Some("token-value"));
        let mut tampered = token.clone().into_bytes();
        tampered[20] = if tampered[20] == b'A' { b'B' } else { b'A' };
        assert_eq!(decrypt(&key, &String::from_utf8(tampered).unwrap()), None);
        assert_eq!(decrypt(&key, "not a token"), None);
        let other = fernet_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").unwrap();
        assert_eq!(decrypt(&other, &token), None);
    }

    /// Fernet's encryption, so the test needs no Python.
    mod fernet_fixture {
        use super::*;
        use aws_lc_rs::cipher::{EncryptionContext, PaddedBlockEncryptingKey};
        use base64::Engine;
        use base64::engine::general_purpose::URL_SAFE;

        pub fn encrypt(key: &[u8; 32], plaintext: &[u8], iv: [u8; 16]) -> String {
            let cipher = PaddedBlockEncryptingKey::cbc_pkcs7(
                UnboundCipherKey::new(&AES_128, &key[16..]).unwrap(),
            )
            .unwrap();
            let mut ciphertext = plaintext.to_vec();
            cipher
                .less_safe_encrypt(&mut ciphertext, EncryptionContext::Iv128(iv.into()))
                .unwrap();
            let mut data = vec![0x80];
            data.extend_from_slice(&1_700_000_000u64.to_be_bytes());
            data.extend_from_slice(&iv);
            data.extend_from_slice(&ciphertext);
            let mut mac = Hmac::<Sha256>::new_from_slice(&key[..16]).unwrap();
            mac.update(&data);
            data.extend_from_slice(&mac.finalize().into_bytes());
            URL_SAFE.encode(data)
        }
    }
}
