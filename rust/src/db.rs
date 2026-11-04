//! Postgres access through `DATABASE_URL`.

use std::str::FromStr;
use std::time::Duration;

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

/// How long a blocking caller waits for one database operation, connection included.
const OPERATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

fn pool_options(max_connections: u32) -> PgPoolOptions {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(OPERATION_TIMEOUT)
}

/// Postgres for synchronous services (the Brave worker and its jobs), which run
/// their own threads and call the database from any of them.
pub struct BlockingPool {
    runtime: tokio::runtime::Runtime,
    pool: PgPool,
}

impl BlockingPool {
    pub fn connect(max_connections: u32) -> Result<Self> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .context("could not start the database runtime")?;
        let pool = runtime.block_on(connect(max_connections))?;
        Ok(Self { runtime, pool })
    }

    /// A pool that connects on first use, so a database outage cannot stop a service
    /// whose other work needs no database.
    pub fn connect_lazy(max_connections: u32) -> Result<Self> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .context("could not start the database runtime")?;
        let options = connect_options()?;
        let pool = {
            let _entered = runtime.enter();
            pool_options(max_connections).connect_lazy_with(options)
        };
        Ok(Self { runtime, pool })
    }

    /// Run one database operation on the calling thread, giving up after `timeout`
    /// (the worker holds Brave's lock around some of them).
    pub fn run_within<T, E, F>(
        &self,
        timeout: std::time::Duration,
        operation: impl FnOnce(PgPool) -> F,
    ) -> Result<T>
    where
        F: std::future::Future<Output = Result<T, E>>,
        E: Into<anyhow::Error>,
    {
        let pool = self.pool.clone();
        self.runtime.block_on(async move {
            match tokio::time::timeout(timeout, operation(pool)).await {
                Ok(result) => result.map_err(Into::into),
                Err(_) => Err(anyhow::anyhow!(
                    "the database did not answer within {timeout:?}"
                )),
            }
        })
    }

    /// `run_within` the default 30 second budget.
    pub fn run<T, E, F>(&self, operation: impl FnOnce(PgPool) -> F) -> Result<T>
    where
        F: std::future::Future<Output = Result<T, E>>,
        E: Into<anyhow::Error>,
    {
        self.run_within(OPERATION_TIMEOUT, operation)
    }
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
    pool_options(max_connections)
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
pub fn connect_options() -> Result<PgConnectOptions> {
    let url = &crate::settings::settings()?.database_url;
    Ok(PgConnectOptions::from_str(url)
        .context("DATABASE_URL is not a valid Postgres URL")?
        .application_name("wat2do-rust"))
}

/// A pool that opens connections only when a query needs one and closes them
/// after `idle`, so a server holds no idle connections while quiet and starts
/// even while the database is unreachable. Connections are not pinged before
/// each use (a round trip per query); a read that meets a dead connection is
/// retried by `read_with_retry`.
///
/// With `read_only`, every connection runs [`READ_ONLY_SESSION`] and checks
/// that `default_transaction_read_only` took effect before its first query.
pub fn connect_lazy(
    options: PgConnectOptions,
    max_connections: u32,
    idle: Duration,
    acquire: Duration,
    read_only: bool,
) -> PgPool {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(0)
        .idle_timeout(idle)
        .acquire_timeout(acquire)
        .test_before_acquire(false)
        .after_connect(move |connection, _| {
            Box::pin(async move {
                if read_only {
                    for setting in READ_ONLY_SESSION {
                        sqlx::query(setting).execute(&mut *connection).await?;
                    }
                    let setting: String = sqlx::query_scalar("SHOW default_transaction_read_only")
                        .fetch_one(&mut *connection)
                        .await?;
                    if setting != "on" {
                        return Err(sqlx::Error::Protocol(format!(
                            "default_transaction_read_only is {setting}, not on"
                        )));
                    }
                }
                Ok(())
            })
        })
        .connect_lazy_with(options)
}

/// Whether a failed read may be retried: the connection failed, not the query.
/// A full pool is not retried; waiting longer would only queue more requests.
fn is_transient(error: &sqlx::Error) -> bool {
    matches!(
        error,
        sqlx::Error::Io(_) | sqlx::Error::Tls(_) | sqlx::Error::Protocol(_)
    )
}

/// Run a read, retrying connection failures with `controlbox/database.json`'s
/// backoff (`core/retry.py` does the same for PostgREST table reads). Only
/// reads: a write may have reached the database before its connection failed.
pub async fn read_with_retry<T, F, Fut>(mut read: F) -> Result<T, sqlx::Error>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, sqlx::Error>>,
{
    let control = &*crate::controlbox::DATABASE;
    let mut attempt = 1;
    loop {
        match read().await {
            Err(error) if is_transient(&error) && attempt < control.read_attempts => {
                // tenacity's wait_exponential_jitter: initial * 2^n plus jitter, capped.
                let exponential =
                    control.read_backoff_initial_seconds * 2f64.powi(attempt as i32 - 1);
                let wait = (exponential + fastrand::f64() * control.read_backoff_jitter_seconds)
                    .min(control.read_backoff_max_seconds);
                tokio::time::sleep(Duration::from_secs_f64(wait)).await;
                attempt += 1;
                tracing::warn!("Retrying database read attempt={attempt}: {error}");
            }
            result => return result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[tokio::test]
    async fn connection_failures_are_retried_up_to_the_attempt_limit() {
        let calls = AtomicU32::new(0);
        let result: Result<(), _> = read_with_retry(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err(sqlx::Error::Io(std::io::ErrorKind::ConnectionReset.into())) }
        })
        .await;
        assert!(result.is_err());
        assert_eq!(
            calls.load(Ordering::SeqCst),
            crate::controlbox::DATABASE.read_attempts
        );
    }

    #[tokio::test]
    async fn query_errors_and_a_full_pool_are_not_retried() {
        let calls = AtomicU32::new(0);
        let result: Result<(), _> = read_with_retry(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err(sqlx::Error::PoolTimedOut) }
        })
        .await;
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
