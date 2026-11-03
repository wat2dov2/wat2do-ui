//! Postgres access through `DATABASE_URL`.

use std::str::FromStr;

use anyhow::{Context, Result};
use sqlx::postgres::{PgConnectOptions, PgListener, PgPool, PgPoolOptions};

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

/// `DATABASE_URL`, with this binary's application name.
fn connect_options() -> Result<PgConnectOptions> {
    let url = &crate::settings::settings()?.database_url;
    Ok(PgConnectOptions::from_str(url)
        .context("DATABASE_URL is not a valid Postgres URL")?
        .application_name("wat2do-rust"))
}
