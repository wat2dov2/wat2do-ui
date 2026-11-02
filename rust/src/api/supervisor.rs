//! `wat2do-api serve`: the container's main process.
//!
//! It listens where uvicorn used to (port 8000) and runs the Python app as a
//! child on loopback (`controlbox/api_server.json` `python_port`) for the
//! routes Rust does not serve yet.
//!
//! - `/health` fails until the Python app answers, and whenever it stops answering.
//! - If the Python app exits, the server exits non-zero so ECS replaces the task.
//! - On SIGTERM or SIGINT the server stops accepting, lets in-flight requests
//!   finish, then asks the Python app to stop the same way (its lifespan
//!   shutdown runs) and exits 0.

use std::net::SocketAddr;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tokio::process::{Child, Command};
use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::Notify;

use super::AppState;
use super::proxy::Upstream;
use crate::controlbox::API_SERVER;

/// The uvicorn command for the Python app on loopback.
fn python_command(reload: bool) -> Command {
    let mut command = Command::new("uvicorn");
    command
        .args(["main:app", "--host", "127.0.0.1", "--port"])
        .arg(API_SERVER.python_port.to_string())
        .arg("--no-access-log")
        .arg("--timeout-keep-alive")
        .arg(API_SERVER.python_keep_alive_seconds.to_string());
    if reload {
        command.arg("--reload");
    }
    command.stdin(Stdio::null()).kill_on_drop(true);
    command
}

async fn wait_until_ready(upstream: Arc<Upstream>) {
    let started = Instant::now();
    let interval = Duration::from_millis(API_SERVER.python_probe_interval_milliseconds);
    let timeout = Duration::from_secs_f64(API_SERVER.python_probe_timeout_seconds);
    while !upstream.probe(timeout).await {
        tokio::time::sleep(interval).await;
    }
    upstream.set_ready();
    tracing::info!(
        "Python app is ready after {:.1}s",
        started.elapsed().as_secs_f64()
    );
}

async fn termination() -> &'static str {
    let mut terminate = signal(SignalKind::terminate()).expect("SIGTERM handler");
    let mut interrupt = signal(SignalKind::interrupt()).expect("SIGINT handler");
    tokio::select! {
        _ = terminate.recv() => "SIGTERM",
        _ = interrupt.recv() => "SIGINT",
    }
}

/// Ask the child to stop gracefully, then force it after the grace period.
async fn stop_python(child: &mut Child) {
    if let Some(pid) = child.id() {
        // SAFETY: kill(2) on our own child's pid has no memory effects.
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
    }
    let grace = Duration::from_secs(API_SERVER.python_shutdown_seconds);
    match tokio::time::timeout(grace, child.wait()).await {
        Ok(Ok(status)) => tracing::info!("Python app stopped: {status}"),
        Ok(Err(error)) => tracing::warn!("Could not wait for the Python app: {error}"),
        Err(_) => {
            tracing::warn!("Python app did not stop within {grace:?}; killing it");
            let _ = child.kill().await;
        }
    }
}

/// Run the server and the Python app until a signal or a failure; returns the exit code.
pub async fn serve(port: u16, reload: bool) -> Result<i32> {
    let settings = crate::settings::settings()?;
    let db = crate::db::connect_lazy(
        crate::db::connect_options()?,
        API_SERVER.database_connections,
        Duration::from_secs(API_SERVER.database_idle_seconds),
        Duration::from_secs_f64(API_SERVER.database_acquire_seconds),
        false,
    );
    let upstream = Arc::new(Upstream::new(
        API_SERVER.python_port,
        Duration::from_secs(API_SERVER.upstream_idle_seconds),
    ));
    let state = AppState::new(settings, db, None, Some(upstream.clone()))?;
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .with_context(|| format!("could not listen on port {port}"))?;
    let mut child = python_command(reload)
        .spawn()
        .context("could not start the Python app (uvicorn)")?;
    tracing::info!(
        "Listening on port {port}; Python app on 127.0.0.1:{}",
        API_SERVER.python_port
    );
    let readiness = tokio::spawn(wait_until_ready(upstream));

    let app = super::app(super::router(state));
    let stop_accepting = Arc::new(Notify::new());
    let stopped = stop_accepting.clone();
    let mut server = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::ServiceExt::<axum::extract::Request>::into_make_service_with_connect_info::<
                SocketAddr,
            >(app),
        )
        .with_graceful_shutdown(async move { stopped.notified().await })
        .await
    });

    let drain = Duration::from_secs(API_SERVER.shutdown_drain_seconds);
    let exit_code = tokio::select! {
        status = child.wait() => {
            // Without the Python app most routes fail: let ECS replace the task.
            let status = status.context("could not wait for the Python app")?;
            tracing::error!("Python app exited unexpectedly ({status}); stopping");
            stop_accepting.notify_one();
            let _ = tokio::time::timeout(drain, &mut server).await;
            status.code().filter(|code| *code != 0).unwrap_or(1)
        }
        signal = termination() => {
            tracing::info!("{signal} received; draining requests");
            stop_accepting.notify_one();
            if tokio::time::timeout(drain, &mut server).await.is_err() {
                tracing::warn!("Requests still open after {drain:?}; stopping anyway");
            }
            stop_python(&mut child).await;
            0
        }
        result = &mut server => {
            tracing::error!("API server stopped: {result:?}");
            stop_python(&mut child).await;
            1
        }
    };
    readiness.abort();
    Ok(exit_code)
}
