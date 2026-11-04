//! Cookies the way Starlette reads and writes them, so a cookie set or read
//! by a Rust route is byte for byte what the Python route set or read.
//!
//! - `set` and `delete` write `Response.set_cookie` and `delete_cookie`'s
//!   header: `http.cookies` quoting, attributes sorted by name.
//! - `read` is `Request.cookies` (`starlette.requests.cookie_parser`).

use std::collections::HashMap;

use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue};
use chrono::{DateTime, Duration, Utc};

/// One `Set-Cookie`, with Starlette's defaults (`path="/"`, `samesite="lax"`).
#[derive(Debug, Clone)]
pub struct Cookie<'a> {
    pub name: &'a str,
    pub value: &'a str,
    pub max_age: Option<i64>,
    /// `expires=` as seconds from now, as Starlette's integer `expires`.
    pub expires_in: Option<i64>,
    pub path: &'a str,
    pub domain: Option<&'a str>,
    pub secure: bool,
    pub http_only: bool,
}

impl<'a> Cookie<'a> {
    pub fn new(name: &'a str, value: &'a str) -> Self {
        Self {
            name,
            value,
            max_age: None,
            expires_in: None,
            path: "/",
            domain: None,
            secure: false,
            http_only: false,
        }
    }

    /// The header value Starlette writes at `now`.
    pub fn header_value(&self, now: DateTime<Utc>) -> String {
        // `Morsel.OutputString`: the value, then the set attributes sorted by
        // key (domain, expires, httponly, max-age, path, samesite, secure).
        let mut parts = vec![format!("{}={}", self.name, quote(self.value))];
        if let Some(domain) = self.domain.filter(|domain| !domain.is_empty()) {
            parts.push(format!("Domain={domain}"));
        }
        if let Some(seconds) = self.expires_in {
            parts.push(format!(
                "expires={}",
                http_date(now + Duration::seconds(seconds))
            ));
        }
        if self.http_only {
            parts.push("HttpOnly".to_owned());
        }
        if let Some(max_age) = self.max_age {
            parts.push(format!("Max-Age={max_age}"));
        }
        if !self.path.is_empty() {
            parts.push(format!("Path={}", self.path));
        }
        parts.push("SameSite=lax".to_owned());
        if self.secure {
            parts.push("Secure".to_owned());
        }
        parts.join("; ")
    }
}

/// Append `cookie` to `headers` as Starlette's `set_cookie` would.
pub fn set(headers: &mut HeaderMap, cookie: &Cookie<'_>) {
    // Starlette encodes headers as latin-1; a value outside it fails the request
    // there, and is dropped here (every value written is ASCII).
    if let Ok(value) = HeaderValue::from_str(&cookie.header_value(Utc::now())) {
        headers.append(SET_COOKIE, value);
    }
}

/// `delete_cookie(name, path, domain)`: an empty, expired, non-secure cookie.
pub fn delete(headers: &mut HeaderMap, name: &str, path: &str, domain: Option<&str>) {
    set(
        headers,
        &Cookie {
            max_age: Some(0),
            expires_in: Some(0),
            path,
            domain,
            ..Cookie::new(name, "")
        },
    );
}

/// `email.utils.format_datetime(..., usegmt=True)` as `http.cookies._getdate` writes it.
fn http_date(at: DateTime<Utc>) -> String {
    at.format("%a, %d %b %Y %H:%M:%S GMT").to_string()
}

/// `http.cookies._LegalChars`: what a value may hold unquoted.
fn is_legal(character: char) -> bool {
    character.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~:".contains(character)
}

/// `http.cookies._quote`: the value as is when every character is legal, else
/// in double quotes with `"` and `\` escaped and other bytes below 256 that
/// are not legal (or one of ` ()/<=>?@[]{}`) written as `\ooo`.
fn quote(value: &str) -> String {
    if !value.is_empty() && value.chars().all(is_legal) {
        return value.to_owned();
    }
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    for character in value.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            _ if is_legal(character) || " ()/<=>?@[]{}".contains(character) => {
                quoted.push(character);
            }
            _ if (character as u32) < 256 => {
                quoted.push_str(&format!("\\{:03o}", character as u32));
            }
            _ => quoted.push(character),
        }
    }
    quoted.push('"');
    quoted
}

/// `http.cookies._unquote`.
fn unquote(value: &str) -> String {
    let characters: Vec<char> = value.chars().collect();
    if characters.len() < 2 || characters[0] != '"' || characters[characters.len() - 1] != '"' {
        return value.to_owned();
    }
    let inner = &characters[1..characters.len() - 1];
    let mut result = String::with_capacity(inner.len());
    let mut index = 0;
    while index < inner.len() {
        if inner[index] == '\\' && index + 1 < inner.len() {
            let octal = inner.get(index + 1..index + 4).filter(|digits| {
                matches!(digits[0], '0'..='3')
                    && matches!(digits[1], '0'..='7')
                    && matches!(digits[2], '0'..='7')
            });
            if let Some(digits) = octal {
                let code = digits
                    .iter()
                    .fold(0, |code, digit| code * 8 + digit.to_digit(8).unwrap_or(0));
                result.push(char::from_u32(code).unwrap_or('\u{fffd}'));
                index += 4;
            } else {
                result.push(inner[index + 1]);
                index += 2;
            }
        } else {
            result.push(inner[index]);
            index += 1;
        }
    }
    result
}

/// `Request.cookies`: the first `Cookie` header, split on `;` and unquoted,
/// a later name overriding an earlier one.
pub fn read(headers: &HeaderMap) -> HashMap<String, String> {
    let mut cookies = HashMap::new();
    let Some(header) = headers.get(COOKIE) else {
        return cookies;
    };
    // Starlette decodes headers as latin-1.
    let text: String = header
        .as_bytes()
        .iter()
        .map(|byte| char::from(*byte))
        .collect();
    for chunk in text.split(';') {
        let (key, value) = chunk.split_once('=').unwrap_or(("", chunk));
        let (key, value) = (
            crate::text::python_strip(key),
            crate::text::python_strip(value),
        );
        if !key.is_empty() || !value.is_empty() {
            cookies.insert(key.to_owned(), unquote(value));
        }
    }
    cookies
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 2, 18, 59, 40).unwrap()
    }

    #[test]
    fn set_cookie_matches_starlette() {
        // Starlette's own output for the same calls.
        let refresh = Cookie {
            max_age: Some(2_592_000),
            expires_in: Some(2_592_000),
            path: "/api/auth/refresh",
            domain: Some(".wat2do.io"),
            secure: true,
            http_only: true,
            ..Cookie::new("refresh_token", "abc")
        };
        assert_eq!(
            refresh.header_value(now()),
            "refresh_token=abc; Domain=.wat2do.io; expires=Wed, 02 Dec 2026 18:59:40 GMT; HttpOnly; Max-Age=2592000; Path=/api/auth/refresh; SameSite=lax; Secure"
        );
        let state = Cookie {
            max_age: Some(600),
            path: "/api/auth/google/callback",
            secure: true,
            http_only: true,
            ..Cookie::new("google_oauth_state", "eyJhIjoiYiJ9==")
        };
        assert_eq!(
            state.header_value(now()),
            r#"google_oauth_state="eyJhIjoiYiJ9=="; HttpOnly; Max-Age=600; Path=/api/auth/google/callback; SameSite=lax; Secure"#
        );
        let cleared = Cookie {
            max_age: Some(0),
            expires_in: Some(0),
            path: "/auth/refresh",
            ..Cookie::new("refresh_token", "")
        };
        assert_eq!(
            cleared.header_value(now()),
            r#"refresh_token=""; expires=Mon, 02 Nov 2026 18:59:40 GMT; Max-Age=0; Path=/auth/refresh; SameSite=lax"#
        );
    }

    #[test]
    fn values_are_quoted_like_http_cookies() {
        assert_eq!(quote("abc-._~"), "abc-._~");
        assert_eq!(quote(""), r#""""#);
        assert_eq!(quote("a b\"c\\;\u{e9}"), r#""a b\"c\\\073\351""#);
        assert_eq!(quote("\u{263a}="), "\"\u{263a}=\"");
        for value in ["abc", "a=b", "x y\"z\\;\u{e9}", "", "\u{263a}"] {
            assert_eq!(unquote(&quote(value)), value);
        }
    }

    #[test]
    fn cookies_are_read_like_starlette() {
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_static(r#" a=1; refresh_token = tok ; s="eyJ9==" ; bare; a=2; e="#),
        );
        let cookies = read(&headers);
        assert_eq!(cookies["a"], "2");
        assert_eq!(cookies["refresh_token"], "tok");
        assert_eq!(cookies["s"], "eyJ9==");
        assert_eq!(cookies[""], "bare");
        assert_eq!(cookies["e"], "");
        assert!(read(&HeaderMap::new()).is_empty());
        assert_eq!(unquote(r#""a\"b\\c\012""#), "a\"b\\c\n");
        assert_eq!(unquote(r#""x\"#), r#""x\"#);
        assert_eq!(unquote("\"\\"), "\"\\");
    }
}
