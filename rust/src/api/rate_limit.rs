//! `core/rate_limit.py`: an in-memory sliding-window limiter per endpoint.
//!
//! Each endpoint owns its own limiter (a `LazyLock<RateLimiter>` beside its
//! handler), built from its budget in `controlbox/rate_limits.json`, so one
//! endpoint's burst never blocks another. State lives in this process only:
//! every API task keeps its own counts, exactly as the Python app did.
//!
//! ```text
//! static QR_SCANS: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(RATE_LIMITS.qr_scans));
//! QR_SCANS.check(&client.ip)?;            // keyed by client IP
//! AI_PARSE.check(&auth_user.id)?;         // keyed by auth user
//! ```

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::errors::ApiError;
use super::messages::RATE_LIMIT_EXCEEDED;
use crate::controlbox::RateLimit;

/// How often every key is swept, bounding memory to active clients.
const PRUNE_INTERVAL: Duration = Duration::from_secs(300);

pub struct RateLimiter {
    pub maximum_requests: usize,
    pub window: Duration,
    state: Mutex<State>,
}

struct State {
    requests: HashMap<String, Vec<Instant>>,
    last_prune: Instant,
}

impl RateLimiter {
    pub fn new(budget: RateLimit) -> Self {
        Self {
            maximum_requests: budget.maximum_requests,
            window: Duration::from_secs(budget.window_seconds),
            state: Mutex::new(State {
                requests: HashMap::new(),
                last_prune: Instant::now(),
            }),
        }
    }

    /// Record one request for `key`, or fail with 429 and `Retry-After`.
    pub fn check(&self, key: &str) -> Result<(), ApiError> {
        self.check_at(key, Instant::now())
    }

    fn check_at(&self, key: &str, now: Instant) -> Result<(), ApiError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if now.saturating_duration_since(state.last_prune) >= PRUNE_INTERVAL {
            state.last_prune = now;
            let window = self.window;
            state.requests.retain(|_, times| {
                times
                    .last()
                    .is_some_and(|last| now.saturating_duration_since(*last) < window)
            });
        }
        let window = self.window;
        let times = state.requests.entry(key.to_owned()).or_default();
        times.retain(|time| now.saturating_duration_since(*time) < window);
        if times.len() >= self.maximum_requests {
            let oldest = times[0];
            let remaining = (oldest + window).saturating_duration_since(now);
            let retry_after = remaining.as_secs_f64().ceil().max(1.0) as u64;
            tracing::warn!(
                "Rate limit exceeded for {key} ({}/{} in {}s, retry_after={retry_after}s)",
                times.len(),
                self.maximum_requests,
                window.as_secs()
            );
            return Err(ApiError::RateLimited {
                detail: RATE_LIMIT_EXCEEDED.to_owned(),
                retry_after,
            });
        }
        times.push(now);
        Ok(())
    }

    #[cfg(test)]
    fn keys(&self) -> usize {
        self.state.lock().unwrap().requests.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limiter(maximum_requests: usize, window_seconds: u64) -> RateLimiter {
        RateLimiter::new(RateLimit {
            maximum_requests,
            window_seconds,
        })
    }

    #[test]
    fn allows_up_to_the_limit_then_refuses() {
        let limiter = limiter(2, 60);
        limiter.check("ip1").unwrap();
        limiter.check("ip1").unwrap();
        let error = limiter.check("ip1").unwrap_err();
        assert!(
            matches!(error, ApiError::RateLimited { retry_after, .. } if (59..=60).contains(&retry_after))
        );
    }

    #[test]
    fn keys_have_independent_buckets() {
        let limiter = limiter(1, 60);
        limiter.check("ip1").unwrap();
        limiter.check("ip2").unwrap();
    }

    #[test]
    fn limiters_are_independent_per_endpoint() {
        let send = limiter(5, 60);
        let verify = limiter(5, 60);
        for _ in 0..send.maximum_requests {
            send.check("shared-ip").unwrap();
        }
        assert!(send.check("shared-ip").is_err());
        verify.check("shared-ip").unwrap();
    }

    #[test]
    fn the_window_slides_and_retry_after_counts_down() {
        let limiter = limiter(1, 60);
        let start = Instant::now();
        limiter.check_at("ip", start).unwrap();
        let error = limiter
            .check_at("ip", start + Duration::from_millis(59_500))
            .unwrap_err();
        assert!(matches!(
            error,
            ApiError::RateLimited { retry_after: 1, .. }
        ));
        limiter
            .check_at("ip", start + Duration::from_secs(60))
            .unwrap();
    }

    #[test]
    fn stale_keys_are_pruned() {
        let limiter = limiter(1, 60);
        let start = Instant::now();
        limiter.check_at("old", start).unwrap();
        limiter.check_at("new", start + PRUNE_INTERVAL).unwrap();
        assert_eq!(limiter.keys(), 1);
    }
}
