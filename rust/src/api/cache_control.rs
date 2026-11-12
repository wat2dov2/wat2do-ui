//! Responses that are the same for every visitor, marked so browsers and
//! shared caches may keep them for as long as `controlbox/api_cache.json`
//! says. The website reaches the API through CloudFront, which keeps a
//! proxied response by its URL and host and answers later requests with it,
//! signed in or not, so only a response with nothing per visitor may be marked.

use axum::http::HeaderValue;
use axum::http::header::CACHE_CONTROL;
use axum::response::{IntoResponse, Response};

use crate::controlbox::SharedCache;

/// `body`, which browsers and shared caches may keep as `policy` says.
pub fn shared(body: impl IntoResponse, policy: &SharedCache) -> Response {
    let mut response = body.into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, header_value(policy));
    response
}

fn header_value(policy: &SharedCache) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "public, max-age={}, s-maxage={}, stale-while-revalidate={}",
        policy.max_age_seconds,
        policy.shared_max_age_seconds,
        policy.stale_while_revalidate_seconds
    ))
    .expect("a Cache-Control of digits and directives is a valid header")
}

#[cfg(test)]
mod tests {
    use axum::Json;

    use super::*;
    use crate::controlbox::API_CACHE;

    #[test]
    fn shared_responses_tell_browsers_and_shared_caches_apart() {
        let response = shared(
            Json(serde_json::json!({})),
            &SharedCache {
                max_age_seconds: 0,
                shared_max_age_seconds: 30,
                stale_while_revalidate_seconds: 120,
            },
        );
        assert_eq!(
            response.headers()[CACHE_CONTROL],
            "public, max-age=0, s-maxage=30, stale-while-revalidate=120"
        );
        assert!(response.headers().get("set-cookie").is_none());
        assert_eq!(
            header_value(&API_CACHE.constants),
            "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"
        );
    }
}
