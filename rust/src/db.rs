//! Postgres access through `DATABASE_URL`.

use std::str::FromStr;

use anyhow::{Context, Result};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};

// Supabase's pooler serves session mode on 5432 and transaction mode on 6543.
const SUPABASE_POOLER_SUFFIX: &str = ".pooler.supabase.com";
const SESSION_MODE_PORT: u16 = 5432;

/// Connect to `DATABASE_URL`.
///
/// `DATABASE_URL` names Supabase's transaction-mode pooler, which may route a
/// statement's describe and bind round trips to different server connections
/// ("bind message supplies 3 parameters, but prepared statement requires 2").
/// sqlx needs both on one connection, so it uses the same pooler's session mode,
/// which pins a server connection to each of ours for as long as it is open.
pub async fn connect(max_connections: u32) -> Result<PgPool> {
    let url = &crate::settings::settings()?.database_url;
    let mut options = PgConnectOptions::from_str(url)
        .context("DATABASE_URL is not a valid Postgres URL")?
        .application_name("wat2do-rust");
    if options.get_host().ends_with(SUPABASE_POOLER_SUFFIX) {
        options = options.port(SESSION_MODE_PORT);
    }
    PgPoolOptions::new()
        .max_connections(max_connections)
        .connect_with(options)
        .await
        .context("could not connect to the database")
}
