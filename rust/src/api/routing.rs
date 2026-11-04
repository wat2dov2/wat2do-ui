//! Starlette's routing rules for the routes Rust serves, so moving a route
//! from FastAPI to Rust changes nothing a client can see:
//!
//! - routes match the percent-decoded path (`/site%2Dbanner` is `/site-banner`);
//! - a path that misses only by its trailing slash gets a 307 to the other form;
//! - a wrong method (HEAD included, since FastAPI routes never accept it) gets
//!   405 `{"detail":"Method Not Allowed"}` with the route's first method in `Allow`.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::LazyLock;

use axum::body::Body;
use axum::extract::{ConnectInfo, MatchedPath, Request, State};
use axum::http::header::{ALLOW, CONTENT_TYPE, HOST, LOCATION};
use axum::http::{HeaderValue, Method, StatusCode, Uri};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use percent_encoding::{
    AsciiSet, CONTROLS, NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode,
};

use super::AppState;
use super::client_ip::Peer;

/// The request URI as the client sent it, kept for the proxy.
#[derive(Clone, Debug)]
pub struct RawUri(pub Uri);

/// Characters re-encoded after decoding so axum can route on the decoded
/// path and decode each parameter exactly once.
const ROUTING_PATH: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}');

/// What Starlette's `RedirectResponse` leaves unquoted in a Location.
const REDIRECT_SAFE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'_')
    .remove(b'.')
    .remove(b'-')
    .remove(b'~')
    .remove(b':')
    .remove(b'/')
    .remove(b'%')
    .remove(b'#')
    .remove(b'?')
    .remove(b'=')
    .remove(b'@')
    .remove(b'[')
    .remove(b']')
    .remove(b'!')
    .remove(b'$')
    .remove(b'&')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')')
    .remove(b'*')
    .remove(b'+')
    .remove(b',')
    .remove(b';');

/// The path uvicorn gives Starlette: percent-decoded, invalid UTF-8 replaced.
pub fn decoded_path(uri: &Uri) -> String {
    percent_decode_str(uri.path())
        .decode_utf8_lossy()
        .into_owned()
}

/// Runs before routing: keep the raw URI and peer, and route on the decoded path.
pub fn prepare(mut request: Request) -> Request {
    let raw = request.uri().clone();
    request.extensions_mut().insert(RawUri(raw.clone()));
    if request.extensions().get::<Peer>().is_none()
        && let Some(ConnectInfo(address)) = request.extensions().get::<ConnectInfo<SocketAddr>>()
    {
        let peer = Peer(address.ip().to_canonical().to_string());
        request.extensions_mut().insert(peer);
    }
    let decoded = decoded_path(&raw);
    if decoded != raw.path() {
        let mut path_and_query = utf8_percent_encode(&decoded, ROUTING_PATH).to_string();
        if let Some(query) = raw.query() {
            path_and_query = format!("{path_and_query}?{query}");
        }
        let mut parts = raw.into_parts();
        if let Ok(rewritten) = path_and_query.parse() {
            parts.path_and_query = Some(rewritten);
            if let Ok(uri) = Uri::from_parts(parts) {
                *request.uri_mut() = uri;
            }
        }
    }
    request
}

/// The first method of each Rust route path, which Starlette names in `Allow`
/// (it reports the first route registered for the path).
static FIRST_METHODS: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    let api = super::openapi();
    let mut first: HashMap<String, String> = api
        .paths
        .paths
        .iter()
        .filter_map(|(path, item)| {
            let operations = [
                ("GET", item.get.is_some()),
                ("PUT", item.put.is_some()),
                ("POST", item.post.is_some()),
                ("DELETE", item.delete.is_some()),
                ("OPTIONS", item.options.is_some()),
                ("HEAD", item.head.is_some()),
                ("PATCH", item.patch.is_some()),
                ("TRACE", item.trace.is_some()),
            ];
            let first = operations.iter().find(|(_, present)| *present)?.0;
            Some((path.clone(), first.to_owned()))
        })
        .collect();
    // Ported routes keep FastAPI's registration order.
    for (path, methods) in super::contract::method_orders() {
        if let Some(method) = methods.first() {
            first.insert(path, method.clone());
        }
    }
    first
});

fn method_not_allowed(path: Option<&MatchedPath>) -> Response {
    let mut response = (
        StatusCode::METHOD_NOT_ALLOWED,
        axum::Json(serde_json::json!({ "detail": "Method Not Allowed" })),
    )
        .into_response();
    let allow = path.and_then(|path| FIRST_METHODS.get(path.as_str()));
    if let Some(allow) = allow.and_then(|allow| HeaderValue::from_str(allow).ok()) {
        response.headers_mut().insert(ALLOW, allow);
    }
    response
}

/// Route layer giving matched routes Starlette's 405, for HEAD too (FastAPI
/// routes never accept HEAD).
pub async fn starlette_methods(request: Request, next: Next) -> Response {
    let path = request.extensions().get::<MatchedPath>().cloned();
    if request.method() == Method::HEAD {
        return method_not_allowed(path.as_ref());
    }
    let response = next.run(request).await;
    let generated_405 = response.status() == StatusCode::METHOD_NOT_ALLOWED
        && !response.headers().contains_key(CONTENT_TYPE);
    if generated_405 {
        method_not_allowed(path.as_ref())
    } else {
        response
    }
}

/// The other trailing-slash form of a route path, if Starlette would redirect to it.
pub fn slash_variant(path: &str) -> Option<String> {
    if path == "/" {
        return None;
    }
    Some(match path.strip_suffix('/') {
        Some(trimmed) => trimmed.to_owned(),
        None => format!("{path}/"),
    })
}

/// Starlette's `redirect_slashes`: 307 to the same URL with the slash toggled.
pub async fn redirect_slash(State(state): State<AppState>, request: Request) -> Response {
    let raw = request
        .extensions()
        .get::<RawUri>()
        .map_or_else(|| request.uri().clone(), |raw| raw.0.clone());
    let peer = request
        .extensions()
        .get::<Peer>()
        .map(|peer| peer.0.clone());
    let scheme = state.trust.scheme(peer.as_deref(), request.headers());
    let host = request
        .headers()
        .get(HOST)
        .and_then(|host| host.to_str().ok())
        .unwrap_or("127.0.0.1:8000")
        .to_owned();
    let path = decoded_path(&raw);
    let toggled = slash_variant(&path).unwrap_or(path);
    let mut url = format!("{scheme}://{host}{toggled}");
    if let Some(query) = raw.query() {
        url = format!("{url}?{query}");
    }
    redirect(StatusCode::TEMPORARY_REDIRECT, &url)
}

/// Starlette's `RedirectResponse(url, status)`: an empty body and the URL
/// quoted the way Starlette quotes a `Location`.
pub fn redirect(status: StatusCode, url: &str) -> Response {
    let location = utf8_percent_encode(url, REDIRECT_SAFE).to_string();
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    if let Ok(location) = HeaderValue::from_str(&location) {
        response.headers_mut().insert(LOCATION, location);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slash_variants_toggle_except_at_the_root() {
        assert_eq!(
            slash_variant("/site-banner").as_deref(),
            Some("/site-banner/")
        );
        assert_eq!(slash_variant("/clubs/").as_deref(), Some("/clubs"));
        assert_eq!(
            slash_variant("/items/{id}").as_deref(),
            Some("/items/{id}/")
        );
        assert_eq!(slash_variant("/"), None);
    }

    #[test]
    fn routing_uses_the_decoded_path_and_keeps_the_raw_uri() {
        let request = Request::builder()
            .uri("/site%2Dbanner?a=%20b")
            .body(Body::empty())
            .unwrap();
        let request = prepare(request);
        assert_eq!(request.uri().path(), "/site-banner");
        assert_eq!(request.uri().query(), Some("a=%20b"));
        assert_eq!(
            request.extensions().get::<RawUri>().unwrap().0,
            "/site%2Dbanner?a=%20b"
        );
        let spaced = prepare(
            Request::builder()
                .uri("/a%20b%25c")
                .body(Body::empty())
                .unwrap(),
        );
        assert_eq!(spaced.uri().path(), "/a%20b%25c");
    }
}
