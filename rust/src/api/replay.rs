//! `wat2do-api replay CASES`: run parity cases through the Rust router in
//! process, with no server, and print what each returned.
//!
//! `backend/scripts/api_parity.py` runs the same cases through FastAPI's
//! `TestClient` and compares the two. Signed-in cases carry an access token the
//! harness signed with a throwaway `AUTH_SIGNING_KEY` it gives both sides, so
//! each side verifies the token itself. The database connections are
//! read-only, with short statement timeouts, unless `--allow-writes` is given.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::body::Body;
use axum::http::{Method, Request};
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tower::ServiceExt;

use super::AppState;
use super::client_ip::Peer;
use super::proxy::NotServedByRust;

/// One request of a parity run (`docs/rust_api.md` describes the file).
#[derive(Debug, Deserialize)]
pub struct Case {
    pub name: String,
    #[serde(default = "default_method")]
    pub method: String,
    /// Path and query string, e.g. `/schools?q=water`.
    pub path: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// A JSON body (sets `content-type: application/json`).
    #[serde(default)]
    pub json: Option<Value>,
    /// A raw text body.
    #[serde(default)]
    pub body: Option<String>,
}

fn default_method() -> String {
    "GET".to_owned()
}

/// What a case returned, in the format `api_parity.py` compares.
#[derive(Debug, Serialize)]
pub struct Outcome {
    pub name: String,
    pub status: u16,
    /// Lower-case header names to every value, in order.
    pub headers: BTreeMap<String, Vec<String>>,
    pub body: String,
    pub served_by_rust: bool,
    /// Per-request latency over every iteration, in milliseconds.
    pub latency_ms: Latency,
}

#[derive(Debug, Default, Serialize)]
pub struct Latency {
    pub iterations: usize,
    pub mean: f64,
    pub median: f64,
    pub p95: f64,
    pub min: f64,
    pub max: f64,
}

impl Latency {
    fn of(mut samples: Vec<f64>) -> Self {
        samples.sort_by(f64::total_cmp);
        let count = samples.len();
        if count == 0 {
            return Self::default();
        }
        let rank = |fraction: f64| {
            samples[((fraction * count as f64).ceil() as usize).clamp(1, count) - 1]
        };
        Self {
            iterations: count,
            mean: samples.iter().sum::<f64>() / count as f64,
            median: rank(0.5),
            p95: rank(0.95),
            min: samples[0],
            max: samples[count - 1],
        }
    }
}

/// `TestClient`'s view of the connection: the client and host it reports.
const TEST_PEER: &str = "testclient";
const TEST_HOST: &str = "testserver";

fn build_request(case: &Case) -> Result<Request<Body>> {
    let method = Method::from_bytes(case.method.to_uppercase().as_bytes())
        .with_context(|| format!("{}: invalid method", case.name))?;
    let mut builder = Request::builder()
        .method(method)
        .uri(&case.path)
        .header("host", TEST_HOST)
        .header("user-agent", "testclient");
    let body = match (&case.json, &case.body) {
        (Some(json), _) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(json)?)
        }
        (None, Some(text)) => Body::from(text.clone()),
        (None, None) => Body::empty(),
    };
    for (name, value) in &case.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    let mut request = builder
        .body(body)
        .with_context(|| format!("{}: invalid request", case.name))?;
    request.extensions_mut().insert(Peer(TEST_PEER.to_owned()));
    Ok(request)
}

/// The application, with no Python app behind it.
pub fn app_for(
    settings: &'static crate::settings::Settings,
    db: &sqlx::PgPool,
) -> Result<axum::Router> {
    Ok(super::router(AppState::new(settings, db.clone(), None)?))
}

/// Run one case through `app` and time it.
pub async fn run_case(app: axum::Router, case: &Case) -> Result<(Outcome, f64)> {
    let app = super::app(app);
    let request = build_request(case)?;
    let is_head = request.method() == Method::HEAD;
    let started = std::time::Instant::now();
    let response = app.oneshot(request).await?;
    let served_by_rust = response.extensions().get::<NotServedByRust>().is_none();
    let status = response.status().as_u16();
    let mut headers: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (name, value) in response.headers() {
        headers
            .entry(name.as_str().to_owned())
            .or_default()
            .push(String::from_utf8_lossy(value.as_bytes()).into_owned());
    }
    let bytes = response.into_body().collect().await?.to_bytes();
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    // A server never sends a body with a HEAD response.
    let body = if is_head {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    let outcome = Outcome {
        name: case.name.clone(),
        status,
        headers,
        body,
        served_by_rust,
        latency_ms: Latency::default(),
    };
    Ok((outcome, elapsed_ms))
}

/// Run every case in `path` and print the outcomes as one JSON list.
pub async fn replay(path: &std::path::Path, allow_writes: bool, iterations: usize) -> Result<()> {
    let cases: Vec<Case> = serde_json::from_slice(
        &std::fs::read(path).with_context(|| format!("could not read {}", path.display()))?,
    )
    .with_context(|| format!("{} is not a list of cases", path.display()))?;
    let settings = crate::settings::settings()?;
    let db = crate::db::connect_lazy(
        crate::db::connect_options()?,
        2,
        Duration::from_secs(60),
        Duration::from_secs(30),
        !allow_writes,
    );
    let app = app_for(settings, &db)?;
    let mut outcomes = Vec::with_capacity(cases.len());
    for case in &cases {
        // Extra iterations measure latency; the last outcome is reported.
        let mut samples = Vec::with_capacity(iterations);
        let mut last = None;
        for _ in 0..iterations.max(1) {
            let (outcome, elapsed_ms) = run_case(app.clone(), case).await?;
            samples.push(elapsed_ms);
            last = Some(outcome);
        }
        let mut outcome = last.expect("at least one iteration");
        outcome.latency_ms = Latency::of(samples);
        outcomes.push(outcome);
    }
    println!("{}", serde_json::to_string_pretty(&outcomes)?);
    Ok(())
}
