//! A local HTTP stand-in for the Graph API and the slide renderer: it records
//! every request exactly as it arrived and answers through a test's closure,
//! so tests see the bytes the jobs send without reaching Meta or the website.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use tokio::net::TcpListener;

/// One request as the stand-in received it.
#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    /// The path with its query string.
    pub target: String,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|value| value.to_str().ok())
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).expect("a JSON body")
    }
}

/// What a stand-in answers: status, content type and body.
pub type Reply = (u16, &'static str, Vec<u8>);

pub fn json_reply(value: serde_json::Value) -> Reply {
    (200, "application/json", value.to_string().into_bytes())
}

/// A running stand-in and what it has received so far.
pub struct FakeServer {
    pub url: String,
    pub requests: Arc<Mutex<Vec<Recorded>>>,
}

impl FakeServer {
    pub fn recorded(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }
}

/// Serve on a free loopback port until the test's runtime stops.
pub async fn serve(respond: impl Fn(&Recorded) -> Reply + Send + Sync + 'static) -> FakeServer {
    let requests: Arc<Mutex<Vec<Recorded>>> = Arc::default();
    let respond = Arc::new(respond);
    let log = Arc::clone(&requests);
    let app = Router::new().fallback(move |request: Request| {
        let log = Arc::clone(&log);
        let respond = Arc::clone(&respond);
        async move {
            let (parts, body) = request.into_parts();
            let recorded = Recorded {
                method: parts.method.to_string(),
                target: parts
                    .uri
                    .path_and_query()
                    .map(ToString::to_string)
                    .unwrap_or_default(),
                headers: parts.headers,
                body: to_bytes(body, usize::MAX).await.unwrap().to_vec(),
            };
            let (status, content_type, body) = respond(&recorded);
            log.lock().unwrap().push(recorded);
            Response::builder()
                .status(StatusCode::from_u16(status).unwrap())
                .header("content-type", content_type)
                .body(Body::from(body))
                .unwrap()
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await });
    FakeServer { url, requests }
}
