//! The Postgres the database tests run against: CI's "Rust database tests"
//! job loads our schema (`backend/database/baseline.sql` and the migrations
//! after it) and names it in `WAT2DO_TEST_DATABASE_URL`. Without it each
//! database test returns at once, so a plain `cargo test` needs no database.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use sqlx::PgPool;

/// The test database, or `None` when this run has none.
pub fn database() -> Option<PgPool> {
    let Some(url) = std::env::var("WAT2DO_TEST_DATABASE_URL")
        .ok()
        .filter(|url| !url.is_empty())
    else {
        // CI's database job sets both, so a missing URL there is a failure.
        assert!(
            std::env::var_os("WAT2DO_DATABASE_TESTS_REQUIRED").is_none(),
            "WAT2DO_DATABASE_TESTS_REQUIRED is set but WAT2DO_TEST_DATABASE_URL is not"
        );
        return None;
    };
    Some(crate::db::connect_lazy(
        url.parse()
            .expect("WAT2DO_TEST_DATABASE_URL is a Postgres URL"),
        10,
        Duration::from_secs(30),
        Duration::from_secs(30),
        false,
    ))
}

/// A client IP nobody else uses, so the per-IP limiters never meet.
pub fn peer() -> String {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    format!("database-test-{}", NEXT.fetch_add(1, Ordering::SeqCst))
}
