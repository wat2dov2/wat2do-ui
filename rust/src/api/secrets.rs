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

/// `nbytes` random bytes as unpadded RFC 4648 base32: capital letters and the
/// digits 2 to 7, so a person can read one aloud or type it without ambiguity.
pub fn token_base32(nbytes: usize) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bytes = vec![0u8; nbytes];
    aws_lc_rs::rand::fill(&mut bytes).expect("the system random source works");
    let mut token = String::with_capacity(nbytes.div_ceil(5) * 8);
    let (mut buffer, mut bits) = (0u16, 0u32);
    for byte in bytes {
        buffer = (buffer << 8) | u16::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            token.push(char::from(ALPHABET[usize::from((buffer >> bits) & 31)]));
        }
    }
    if bits > 0 {
        token.push(char::from(
            ALPHABET[usize::from((buffer << (5 - bits)) & 31)],
        ));
    }
    token
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base32_tokens_use_only_unambiguous_characters() {
        let token = token_base32(15);
        // 15 bytes are exactly 24 characters, with no padding.
        assert_eq!(token.len(), 24);
        assert!(
            token
                .bytes()
                .all(|c| matches!(c, b'A'..=b'Z' | b'2'..=b'7'))
        );
        assert_ne!(token, token_base32(15));
        assert_eq!(token_base32(1).len(), 2);
    }

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
