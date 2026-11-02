//! Waking the processor whenever its Supabase queue changes
//! (`services/ingestion/realtime_listener.py`).
//!
//! Supabase Realtime streams every insert and update on the queue table, so a
//! notified post is fetched, and a ready row processed, as soon as it appears.
//! Realtime only delivers while connected, so every (re)subscription also wakes
//! the processor to catch up, and a broadcast the channel echoes back to itself
//! proves the connection still delivers; a missed echo reconnects.

use std::time::Duration;

use anyhow::{Result, bail};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::time::{Instant, interval};
use tokio_tungstenite::tungstenite::Message;

use super::stop::Stop;
use crate::controlbox::INGESTION;
use crate::settings::settings;

const PROBE_EVENT: &str = "probe";
const HEARTBEAT: Duration = Duration::from_secs(25);

/// Call `on_change` for each inserted or updated row and after every
/// (re)subscription, until `stopping` is set.
pub async fn listen_for_changes(table: &str, on_change: impl Fn(), stopping: Stop) {
    while !stopping.is_set() {
        if let Err(error) = listen(table, &on_change, &stopping).await {
            tracing::warn!("Ingestion queue listener disconnected ({error})");
        }
        stopping
            .sleep(Duration::from_secs_f64(
                INGESTION.realtime_reconnect_seconds,
            ))
            .await;
    }
}

/// Phoenix channel messages, numbered in the order they are sent.
struct Outgoing {
    topic: String,
    sent: u64,
}

impl Outgoing {
    fn message(&mut self, event: &str, phoenix: bool, payload: Value) -> (String, Message) {
        self.sent += 1;
        let reference = self.sent.to_string();
        let topic = if phoenix {
            "phoenix"
        } else {
            self.topic.as_str()
        };
        let text = json!({"topic": topic, "event": event, "payload": payload, "ref": reference});
        (reference, Message::text(text.to_string()))
    }
}

async fn listen(table: &str, on_change: &impl Fn(), stopping: &Stop) -> Result<()> {
    let settings = settings()?;
    let url = format!(
        "{}/realtime/v1/websocket?apikey={}&vsn=1.0.0",
        settings
            .supabase_url
            .replacen("https://", "wss://", 1)
            .trim_end_matches('/'),
        settings.supabase_secret_key
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(url).await?;
    let mut outgoing = Outgoing {
        topic: format!("realtime:wat2do-{table}"),
        sent: 0,
    };
    let (join_ref, join) = outgoing.message(
        "phx_join",
        false,
        json!({
            "config": {
                "broadcast": {"self": true},
                "presence": {"key": ""},
                "postgres_changes": [
                    {"event": "INSERT", "schema": "public", "table": table},
                    {"event": "UPDATE", "schema": "public", "table": table},
                ],
            },
            "access_token": settings.supabase_secret_key,
        }),
    );
    socket.send(join).await?;

    let probe_every = Duration::from_secs_f64(INGESTION.realtime_probe_seconds);
    let mut heartbeat = interval(HEARTBEAT);
    let mut probe_due = Instant::now() + probe_every;
    let mut probed: Option<Instant> = None;
    let mut echoed: Option<Instant> = None;
    loop {
        tokio::select! {
            _ = stopping.stopped() => {
                let _ = socket.close(None).await;
                return Ok(());
            }
            _ = heartbeat.tick() => {
                socket.send(outgoing.message("heartbeat", true, json!({})).1).await?;
            }
            _ = tokio::time::sleep_until(probe_due) => {
                // Each probe must echo before the next is due.
                if let Some(probed) = probed
                    && echoed.is_none_or(|echoed| echoed < probed)
                {
                    bail!("Realtime stopped echoing its probe");
                }
                probed = Some(Instant::now());
                probe_due = Instant::now() + probe_every;
                let probe = json!({"type": "broadcast", "event": PROBE_EVENT, "payload": {}});
                socket.send(outgoing.message("broadcast", false, probe).1).await?;
            }
            frame = socket.next() => {
                let Some(frame) = frame else { bail!("Realtime closed the connection") };
                let Message::Text(text) = frame? else { continue };
                let incoming: Value = serde_json::from_str(&text).unwrap_or_default();
                if incoming["topic"] != outgoing.topic.as_str() {
                    continue;
                }
                match incoming["event"].as_str().unwrap_or("") {
                    "phx_reply" if incoming["ref"] == join_ref.as_str() => {
                        if incoming["payload"]["status"] != "ok" {
                            bail!("Realtime refused the subscription");
                        }
                        tracing::info!("Subscribed to {table} changes");
                        on_change();
                    }
                    "postgres_changes" => on_change(),
                    "broadcast" if incoming["payload"]["event"] == PROBE_EVENT => {
                        echoed = Some(Instant::now());
                    }
                    "system" if incoming["payload"]["status"] == "error" => {
                        bail!("Realtime channel error");
                    }
                    "phx_error" | "phx_close" => bail!("Realtime channel closed"),
                    _ => {}
                }
            }
        }
    }
}
