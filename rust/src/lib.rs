//! wat2do backend services ported from Python.
//!
//! A ported service reads the same `backend/controlbox` JSON, the same
//! `backend/.env` settings and the same Postgres tables as the Python code
//! around it, so the two languages share one database and one configuration.

pub mod api;
pub mod automate_logs;
pub mod claude;
pub mod constants;
pub mod controlbox;
pub mod db;
pub mod email;
pub mod host;
pub mod images;
pub mod ingestion;
pub mod instagram_notifications;
pub mod launch_agents;
pub mod logs;
pub mod map_locations;
pub mod notification_retry;
pub mod notifications;
pub mod poster_payouts;
pub mod pyjson;
pub mod revalidation;
pub mod schools;
pub mod settings;
pub mod storage;
pub mod svg_sanitize;
pub mod text;
pub mod urls;

/// Choose rustls' crypto provider once per process. Two are compiled in (ring
/// for Postgres, aws-lc for the AWS SDK), so rustls cannot pick one itself and
/// the first TLS connection would panic.
pub fn install_tls() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}
