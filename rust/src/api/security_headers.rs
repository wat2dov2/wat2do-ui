//! `core/security_headers.py`: protective headers on every response the API
//! itself answers (preflights excepted, as there).

use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

use crate::settings::Settings;

/// Content-Security-Policy directives, in order.
const CSP_DIRECTIVES: [(&str, &str); 11] = [
    ("default-src", "'self'"),
    ("script-src", "'self'"),
    (
        "style-src",
        "'self' 'unsafe-inline' https://fonts.googleapis.com",
    ),
    ("font-src", "'self' https://fonts.gstatic.com"),
    (
        "img-src",
        "'self' data: blob: https://images.unsplash.com https://tiles.openfreemap.org",
    ),
    ("connect-src", "'self' https://tiles.openfreemap.org"),
    ("worker-src", "'self' blob:"),
    ("object-src", "'none'"),
    ("frame-ancestors", "'self'"),
    ("base-uri", "'self'"),
    ("form-action", "'self'"),
];

const SECURITY_HEADERS: [(&str, &str); 4] = [
    ("x-content-type-options", "nosniff"),
    ("x-frame-options", "SAMEORIGIN"),
    ("referrer-policy", "strict-origin-when-cross-origin"),
    ("permissions-policy", "interest-cohort=()"),
];

fn content_security_policy() -> String {
    CSP_DIRECTIVES
        .iter()
        .map(|(name, sources)| format!("{name} {sources}"))
        .collect::<Vec<_>>()
        .join("; ")
}

pub async fn security_headers(
    State(settings): State<&'static Settings>,
    request: Request,
    next: Next,
) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        "content-security-policy",
        HeaderValue::from_str(&content_security_policy()).expect("valid CSP"),
    );
    for (name, value) in SECURITY_HEADERS {
        headers.insert(
            HeaderName::from_static(name),
            HeaderValue::from_static(value),
        );
    }
    // HSTS only in production: on plain-HTTP localhost it would pin the browser to HTTPS.
    if settings.is_production() {
        headers.insert(
            "strict-transport-security",
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        );
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csp_matches_the_python_value() {
        assert_eq!(
            content_security_policy(),
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
             font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: \
             https://images.unsplash.com https://tiles.openfreemap.org; connect-src 'self' \
             https://tiles.openfreemap.org; worker-src 'self' blob:; object-src 'none'; \
             frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
        );
    }
}
