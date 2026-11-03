//! Waking the processor whenever its queue changes.
//!
//! A trigger on `public.ingestion_items` sends a Postgres notification on the
//! `ingestion_items` channel for every inserted or updated row, so a notified
//! post is fetched, and a ready row processed, as soon as it appears.
//! Notifications reach only a connected listener, so every (re)subscription also
//! wakes the processor to catch up. A connection can die without a word (a
//! dropped network route, a pooler restart), so the listener also notifies
//! itself every `listener_probe_seconds`; a probe that has not come back by the
//! next one means nothing is being delivered, and the listener reconnects.

use std::convert::Infallible;
use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use tokio::time::{Instant, MissedTickBehavior, interval_at, timeout};

use super::stop::Stop;
use crate::controlbox::INGESTION;
use crate::db;

/// The payload of the listener's own probe; the queue trigger sends ''.
const PROBE: &str = "probe";

/// Call `on_change` for each notification on `channel` and after every
/// (re)subscription, until `stopping` is set.
pub async fn listen_for_changes(channel: &str, on_change: impl Fn(), stopping: Stop) {
    while !stopping.is_set() {
        tokio::select! {
            result = listen(channel, &on_change) => {
                let Err(error) = result;
                tracing::warn!("Ingestion queue listener disconnected ({error:#})");
            }
            _ = stopping.stopped() => return,
        }
        stopping
            .sleep(Duration::from_secs_f64(INGESTION.database_retry_seconds))
            .await;
    }
}

/// Listen on a fresh connection until it fails.
async fn listen(channel: &str, on_change: &impl Fn()) -> Result<Infallible> {
    let mut listener = db::listener().await?;
    // A lost connection ends this listener; the caller starts a fresh one.
    listener.eager_reconnect(false);
    listener.listen(channel).await?;
    tracing::info!("Listening for {channel} changes");
    on_change();

    let probe_every = Duration::from_secs_f64(INGESTION.listener_probe_seconds);
    let mut probe_due = interval_at(Instant::now() + probe_every, probe_every);
    probe_due.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut probe = Probe::default();
    loop {
        tokio::select! {
            _ = probe_due.tick() => {
                probe.send()?;
                let sent = sqlx::query("SELECT pg_notify($1, $2)")
                    .bind(channel)
                    .bind(PROBE)
                    .execute(&mut listener);
                timeout(probe_every, sent).await.context("the probe timed out")??;
            }
            notification = listener.try_recv() => {
                let Some(notification) = notification? else {
                    bail!("the connection was lost");
                };
                if notification.payload() == PROBE {
                    probe.echoed();
                } else {
                    on_change();
                }
            }
        }
    }
}

/// Each probe must come back before the next is sent.
#[derive(Default)]
struct Probe {
    unanswered: bool,
}

impl Probe {
    fn send(&mut self) -> Result<()> {
        ensure!(!self.unanswered, "the last probe never came back");
        self.unanswered = true;
        Ok(())
    }

    fn echoed(&mut self) {
        self.unanswered = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_probe_must_come_back_before_the_next_is_sent() {
        let mut probe = Probe::default();
        assert!(probe.send().is_ok());
        assert!(probe.send().is_err());
        probe.echoed();
        assert!(probe.send().is_ok());
    }
}
