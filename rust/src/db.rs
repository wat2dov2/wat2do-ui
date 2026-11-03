//! Postgres access through `DATABASE_URL`.

use std::str::FromStr;

use anyhow::{Context, Result};
use sqlx::postgres::{PgConnectOptions, PgListener, PgPool, PgPoolOptions};

// Supabase's pooler serves session mode on 5432 and transaction mode on 6543.
const SUPABASE_POOLER_SUFFIX: &str = ".pooler.supabase.com";
const SESSION_MODE_PORT: u16 = 5432;

/// Connect to `DATABASE_URL`.
pub async fn connect(max_connections: u32) -> Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .connect_with(connect_options()?)
        .await
        .context("could not connect to the database")
}

/// A `LISTEN`/`NOTIFY` listener on its own connection to `DATABASE_URL`.
pub async fn listener() -> Result<PgListener> {
    // One connection that is never retired, as `PgListener::connect` sets up.
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .max_lifetime(None)
        .idle_timeout(None)
        .connect_with(connect_options()?)
        .await
        .context("could not connect to the database")?;
    Ok(PgListener::connect_with(&pool).await?)
}

/// `DATABASE_URL`, moved to session mode when it names Supabase's pooler.
///
/// `DATABASE_URL` names Supabase's transaction-mode pooler, which may route a
/// statement's describe and bind round trips to different server connections
/// ("bind message supplies 3 parameters, but prepared statement requires 2"),
/// and hands the server connection holding a `LISTEN` to other clients once its
/// transaction ends. sqlx needs one server connection throughout, so it uses the
/// same pooler's session mode, which pins a server connection to each of ours
/// for as long as it is open.
fn connect_options() -> Result<PgConnectOptions> {
    let url = &crate::settings::settings()?.database_url;
    let options = PgConnectOptions::from_str(url)
        .context("DATABASE_URL is not a valid Postgres URL")?
        .application_name("wat2do-rust");
    Ok(if options.get_host().ends_with(SUPABASE_POOLER_SUFFIX) {
        options.port(SESSION_MODE_PORT)
    } else {
        options
    })
}
