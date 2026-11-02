//! Postgres access through `DATABASE_URL`.

use std::str::FromStr;

use anyhow::{Context, Result};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};

/// Connect to `DATABASE_URL`. Production points at Supabase's transaction
/// pooler, which cannot keep prepared statements between transactions, so
/// statements are never cached.
pub async fn connect(max_connections: u32) -> Result<PgPool> {
    let url = &crate::settings::settings()?.database_url;
    let options = PgConnectOptions::from_str(url)
        .context("DATABASE_URL is not a valid Postgres URL")?
        .statement_cache_capacity(0)
        .application_name("wat2do-rust");
    PgPoolOptions::new()
        .max_connections(max_connections)
        .connect_with(options)
        .await
        .context("could not connect to the database")
}
