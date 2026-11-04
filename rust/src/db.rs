//! Postgres access through `DATABASE_URL`.

use std::str::FromStr;

use anyhow::{Context, Result};
use sqlx::postgres::{PgConnectOptions, PgListener, PgPool, PgPoolOptions};

/// What every read-only connection runs first: no writes, and no statement or
/// idle transaction that can hold the database for long.
const READ_ONLY_SESSION: [&str; 3] = [
    "SET default_transaction_read_only = on",
    "SET statement_timeout = '10s'",
    "SET idle_in_transaction_session_timeout = '15s'",
];

/// Connect to `DATABASE_URL`.
pub async fn connect(max_connections: u32) -> Result<PgPool> {
    pool(max_connections, false).await
}

/// Connect like [`connect`], with every transaction read-only and short
/// statement timeouts, so a preview or comparison run cannot write even by
/// mistake, nor hold the production database.
pub async fn connect_read_only(max_connections: u32) -> Result<PgPool> {
    pool(max_connections, true).await
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

async fn pool(max_connections: u32, read_only: bool) -> Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        // Each pool connection is its own server session, so the settings hold
        // for as long as it is open.
        .after_connect(move |connection, _| {
            Box::pin(async move {
                if read_only {
                    for setting in READ_ONLY_SESSION {
                        sqlx::query(setting).execute(&mut *connection).await?;
                    }
                }
                Ok(())
            })
        })
        .connect_with(connect_options()?)
        .await
        .context("could not connect to the database")
}

/// `DATABASE_URL`, with this binary's application name.
fn connect_options() -> Result<PgConnectOptions> {
    let url = &crate::settings::settings()?.database_url;
    Ok(PgConnectOptions::from_str(url)
        .context("DATABASE_URL is not a valid Postgres URL")?
        .application_name("wat2do-rust"))
}
