//! A shutdown flag every processor task can check, sleep on, or wait for.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::sync::Notify;

#[derive(Clone, Default)]
pub struct Stop {
    set: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl Stop {
    pub fn set(&self) {
        self.set.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_set(&self) -> bool {
        self.set.load(Ordering::SeqCst)
    }

    /// Wait until stopping begins.
    pub async fn stopped(&self) {
        loop {
            let notified = self.notify.notified();
            if self.is_set() {
                return;
            }
            notified.await;
        }
    }

    /// Sleep for `duration`, or less when stopping begins.
    pub async fn sleep(&self, duration: Duration) {
        let _ = tokio::time::timeout(duration, self.stopped()).await;
    }
}
