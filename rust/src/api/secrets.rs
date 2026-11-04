//! Python's `secrets` module: unpredictable tokens from the operating
//! system's random source (through aws-lc, which also signs our tokens).

use base64::Engine;

/// `secrets.token_urlsafe(nbytes)`: `nbytes` random bytes as unpadded
/// URL-safe base64.
pub fn token_urlsafe(nbytes: usize) -> String {
    let mut bytes = vec![0u8; nbytes];
    aws_lc_rs::rand::fill(&mut bytes).expect("the system random source works");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_url_safe_and_fresh() {
        let token = token_urlsafe(32);
        // ceil(32 * 4 / 3) characters, like Python.
        assert_eq!(token.len(), 43);
        assert!(
            token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
        assert_ne!(token, token_urlsafe(32));
        assert_eq!(token_urlsafe(64).len(), 86);
    }
}
