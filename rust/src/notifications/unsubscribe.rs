//! Stateless signed unsubscribe links (`services/notifications/unsubscribe.py`).
//!
//! The token is `base64url("1:<user uuid>:<type>" + "." + HMAC-SHA256)` without
//! padding. The Python API verifies it, so the format must never change: links
//! in emails already sent have to keep working.

use anyhow::{Result, bail};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

const TOKEN_VERSION: &str = "1";

pub fn create_token(secret: &str, user_id: Uuid, notification_type: &str) -> Result<String> {
    if secret.is_empty() {
        bail!("EMAIL_UNSUBSCRIBE_SECRET is required for email sends");
    }
    let payload = format!(
        "{TOKEN_VERSION}:{}:{notification_type}",
        user_id.hyphenated()
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("any key length");
    mac.update(payload.as_bytes());
    let mut token = payload.into_bytes();
    token.push(b'.');
    token.extend_from_slice(&mac.finalize().into_bytes());
    Ok(URL_SAFE_NO_PAD.encode(token))
}

/// The one-click unsubscribe link on the school's own site.
pub fn unsubscribe_url(
    secret: &str,
    school_frontend_url: &str,
    user_id: Uuid,
    notification_type: &str,
) -> Result<String> {
    Ok(format!(
        "{school_frontend_url}/api/notification-preferences/unsubscribe?token={}",
        create_token(secret, user_id, notification_type)?
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_match_the_python_api_byte_for_byte() {
        // From services.notifications.unsubscribe.create_unsubscribe_token with
        // EMAIL_UNSUBSCRIBE_SECRET=test-secret.
        let cases = [
            (
                "11111111-1111-1111-1111-111111111111",
                "morning_email",
                "MToxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTE6bW9ybmluZ19lbWFpbC48G6dSrn-5iD86KA999FGdbyejZ9AfVggSFFnbnFP8Jg",
            ),
            (
                "ABCDEF01-2345-6789-abcd-ef0123456789",
                "event_reminder",
                "MTphYmNkZWYwMS0yMzQ1LTY3ODktYWJjZC1lZjAxMjM0NTY3ODk6ZXZlbnRfcmVtaW5kZXIuSDIjpht3OGZeFmIM-6NaRumszJQlI-T-rnT1AI2HWeA",
            ),
        ];
        for (user_id, notification_type, expected) in cases {
            let user_id = Uuid::parse_str(user_id).unwrap();
            assert_eq!(
                create_token("test-secret", user_id, notification_type).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn a_missing_secret_stops_the_send() {
        let error = create_token("", Uuid::nil(), "morning_email").unwrap_err();
        assert!(error.to_string().contains("EMAIL_UNSUBSCRIBE_SECRET"));
    }

    #[test]
    fn links_point_at_the_school_api() {
        let url = unsubscribe_url(
            "s",
            "https://uwaterloo.wat2do.io",
            Uuid::nil(),
            "morning_email",
        )
        .unwrap();
        assert!(url.starts_with(
            "https://uwaterloo.wat2do.io/api/notification-preferences/unsubscribe?token=MTowMDAw"
        ));
    }
}
