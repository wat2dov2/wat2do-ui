//! Stateless signed unsubscribe links (`services/notifications/unsubscribe.py`).
//!
//! The token is `base64url("1:<user uuid>:<type>" + "." + HMAC-SHA256)` without
//! padding. Python's event change emails sign it too, so the format must never
//! change: links in emails already sent have to keep working.

use anyhow::{Result, bail};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

use crate::constants::NOTIFICATION_TYPES;
use crate::text::python_b64decode_repadded;

const TOKEN_VERSION: &str = "1";

/// Who a valid token unsubscribes, and from what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnsubscribeTarget {
    pub user_id: Uuid,
    pub notification_type: &'static str,
}

/// `verify_unsubscribe_token`: the target of a token we signed, or `None`.
/// A missing secret is an error once a token is shaped like ours, as in Python.
pub fn verify_token(secret: &str, token: &str) -> Result<Option<UnsubscribeTarget>> {
    let Some(decoded) = python_b64decode_repadded(token) else {
        return Ok(None);
    };
    let signature_size = 32;
    if decoded.len() <= signature_size + 1 || decoded[decoded.len() - signature_size - 1] != b'.' {
        return Ok(None);
    }
    if secret.is_empty() {
        bail!("EMAIL_UNSUBSCRIBE_SECRET is required for email sends");
    }
    let (payload, rest) = decoded.split_at(decoded.len() - signature_size - 1);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("any key length");
    mac.update(payload);
    if mac.verify_slice(&rest[1..]).is_err() {
        return Ok(None);
    }
    Ok(target(payload))
}

fn target(payload: &[u8]) -> Option<UnsubscribeTarget> {
    let payload = std::str::from_utf8(payload).ok()?;
    let mut parts = payload.splitn(3, ':');
    let (version, user_id, notification_type) = (parts.next()?, parts.next()?, parts.next()?);
    let notification_type = NOTIFICATION_TYPES
        .into_iter()
        .find(|known| *known == notification_type)?;
    if version != TOKEN_VERSION {
        return None;
    }
    Some(UnsubscribeTarget {
        user_id: Uuid::parse_str(user_id).ok()?,
        notification_type,
    })
}

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
    fn signed_tokens_verify_and_tampered_ones_do_not() {
        // test_unsubscribe_token_round_trip and test_unsubscribe_rejects_tampered_tokens
        let user_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
        let token = create_token("test-secret", user_id, "morning_email").unwrap();
        let expected = Some(UnsubscribeTarget {
            user_id,
            notification_type: "morning_email",
        });
        assert_eq!(verify_token("test-secret", &token).unwrap(), expected);
        // Python's decoder skips characters outside the alphabet and padding.
        assert_eq!(
            verify_token("test-secret", &format!("{token}==")).unwrap(),
            expected
        );
        assert_eq!(
            verify_token("test-secret", &format!("{token}x")).unwrap(),
            None
        );
        assert_eq!(verify_token("other-secret", &token).unwrap(), None);
        assert_eq!(verify_token("test-secret", "signed-token").unwrap(), None);
        assert_eq!(verify_token("", "signed-token").unwrap(), None);
        assert!(verify_token("", &token).is_err());
        // test_unsubscribe_all_binary_signatures_round_trip
        for index in 0..128 {
            let secret = format!("test-secret-{index}");
            let token = create_token(&secret, user_id, "event_reminder").unwrap();
            assert!(verify_token(&secret, &token).unwrap().is_some(), "{secret}");
        }
    }

    #[test]
    fn retired_types_and_versions_do_not_verify() {
        let sign = |payload: &str| {
            let mut mac = Hmac::<Sha256>::new_from_slice(b"s").unwrap();
            mac.update(payload.as_bytes());
            let mut token = payload.as_bytes().to_vec();
            token.push(b'.');
            token.extend_from_slice(&mac.finalize().into_bytes());
            URL_SAFE_NO_PAD.encode(token)
        };
        let user = "11111111-1111-1111-1111-111111111111";
        assert!(
            verify_token("s", &sign(&format!("1:{user}:event_change")))
                .unwrap()
                .is_some()
        );
        for payload in [
            format!("1:{user}:daily_new_events"),
            format!("2:{user}:morning_email"),
            "1:not-a-uuid:morning_email".to_owned(),
            format!("1:{user}"),
        ] {
            assert_eq!(
                verify_token("s", &sign(&payload)).unwrap(),
                None,
                "{payload}"
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
