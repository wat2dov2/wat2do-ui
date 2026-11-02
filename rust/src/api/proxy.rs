//! The Python app behind the Rust server: every request no Rust route claims
//! is forwarded to it unchanged, and its response comes back unchanged.
//!
//! Bodies stream both ways (uploads are never buffered), every header and
//! cookie passes through, and redirects are returned, not followed. Only
//! hop-by-hop headers, which describe one connection, are dropped.
//!
//! The Python app trusts forwarding headers from loopback peers (uvicorn's
//! `FORWARDED_ALLOW_IPS`), and the proxy connects over loopback. A request from
//! a peer uvicorn would not have trusted therefore has its `X-Forwarded-For`
//! replaced by that peer and its `X-Forwarded-Proto` removed, so Python still
//! sees the peer as its client, exactly as when it listened publicly.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{HeaderName, HeaderValue};
use axum::http::{HeaderMap, StatusCode, Uri, Version};
use axum::response::{IntoResponse, Response};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;

use super::AppState;
use super::client_ip::Peer;
use super::routing::RawUri;

/// Headers that describe one connection, not the request (RFC 9110 7.6.1).
const HOP_BY_HOP: [&str; 9] = [
    "connection",
    "keep-alive",
    "proxy-connection",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

/// The Python app on loopback, and whether it has finished starting.
pub struct Upstream {
    pub authority: String,
    client: Client<HttpConnector, Body>,
    ready: AtomicBool,
}

impl Upstream {
    pub fn new(port: u16, idle: Duration) -> Self {
        let mut connector = HttpConnector::new();
        connector.set_nodelay(true);
        let client = Client::builder(TokioExecutor::new())
            .pool_idle_timeout(idle)
            .build(connector);
        Self {
            authority: format!("127.0.0.1:{port}"),
            client,
            ready: AtomicBool::new(false),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Acquire)
    }

    pub fn set_ready(&self) {
        self.ready.store(true, Ordering::Release);
    }

    /// Whether the Python app answers HTTP right now. uvicorn accepts
    /// connections only after the app's startup finished, so any response
    /// below 500 proves the app is serving.
    pub async fn probe(&self, timeout: Duration) -> bool {
        let Ok(uri) = format!("http://{}/health", self.authority).parse::<Uri>() else {
            return false;
        };
        let request = Request::builder()
            .uri(uri)
            .body(Body::empty())
            .expect("valid probe request");
        match tokio::time::timeout(timeout, self.client.request(request)).await {
            Ok(Ok(response)) => !response.status().is_server_error(),
            _ => false,
        }
    }

    /// Forward one request and return the Python app's response as it is.
    pub async fn forward(&self, request: Request, uvicorn_trusts_peer: bool) -> Response {
        let (mut parts, body) = request.into_parts();
        let raw = parts
            .extensions
            .get::<RawUri>()
            .map_or_else(|| parts.uri.clone(), |raw| raw.0.clone());
        let path_and_query = raw.path_and_query().map_or("/", |value| value.as_str());
        let Ok(uri) = format!("http://{}{path_and_query}", self.authority).parse::<Uri>() else {
            return bad_gateway("invalid upstream URI");
        };
        let peer = parts.extensions.get::<Peer>().map(|peer| peer.0.clone());
        strip_hop_by_hop(&mut parts.headers);
        // Rust already answered `Expect: 100-continue` by reading the body.
        parts.headers.remove("expect");
        if !uvicorn_trusts_peer {
            parts.headers.remove("x-forwarded-proto");
            parts.headers.remove("x-forwarded-for");
            if let Some(peer) = peer.and_then(|peer| HeaderValue::from_str(&peer).ok()) {
                parts.headers.insert("x-forwarded-for", peer);
            }
        }
        let mut upstream = Request::from_parts(parts, body);
        *upstream.uri_mut() = uri;
        *upstream.version_mut() = Version::HTTP_11;
        match self.client.request(upstream).await {
            Ok(response) => {
                let (mut parts, body) = response.into_parts();
                strip_hop_by_hop(&mut parts.headers);
                Response::from_parts(parts, Body::new(body))
            }
            Err(error) => {
                tracing::warn!("Python app request failed: {error}");
                bad_gateway("Bad Gateway")
            }
        }
    }
}

fn strip_hop_by_hop(headers: &mut HeaderMap) {
    let named: Vec<HeaderName> = headers
        .get_all("connection")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .filter_map(|name| HeaderName::from_bytes(name.trim().as_bytes()).ok())
        .collect();
    for name in named {
        headers.remove(name);
    }
    for name in HOP_BY_HOP {
        headers.remove(name);
    }
}

fn bad_gateway(message: &'static str) -> Response {
    (StatusCode::BAD_GATEWAY, message).into_response()
}

/// Marks a response for a route Rust does not serve (no Python app attached).
#[derive(Clone, Copy, Debug)]
pub struct NotServedByRust;

/// The fallback: everything Rust does not serve goes to the Python app.
pub async fn to_python(State(state): State<AppState>, request: Request) -> Response {
    let Some(upstream) = state.upstream.as_ref() else {
        let mut response = (StatusCode::NOT_IMPLEMENTED, "Not served by Rust").into_response();
        response.extensions_mut().insert(NotServedByRust);
        return response;
    };
    let peer = request
        .extensions()
        .get::<Peer>()
        .map(|peer| peer.0.clone());
    let trusted = peer
        .as_deref()
        .is_some_and(|peer| state.trust.forwards(peer));
    upstream.forward(request, trusted).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hop_by_hop_headers_and_those_named_by_connection_are_dropped() {
        let mut headers = HeaderMap::new();
        headers.insert("connection", "keep-alive, x-private".parse().unwrap());
        headers.insert("keep-alive", "timeout=5".parse().unwrap());
        headers.insert("x-private", "1".parse().unwrap());
        headers.insert("transfer-encoding", "chunked".parse().unwrap());
        headers.append("set-cookie", "a=1".parse().unwrap());
        headers.append("set-cookie", "b=2".parse().unwrap());
        strip_hop_by_hop(&mut headers);
        assert!(headers.get("connection").is_none());
        assert!(headers.get("x-private").is_none());
        assert!(headers.get("transfer-encoding").is_none());
        assert_eq!(headers.get_all("set-cookie").iter().count(), 2);
    }
}
