//! `wat2do-send-notifications`: the scheduled notification emails.
//! The Mac mini's `io.wat2do.scheduled-emails` launchd timer runs it hourly for
//! the morning email.

use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use clap::{Parser, ValueEnum};
use wat2do::notifications::delivery_log::Outbox;
use wat2do::notifications::{event_reminder, morning_email};

#[derive(Parser)]
#[command(about = "Dispatch scheduled notification emails")]
struct Cli {
    /// Notification type to dispatch.
    #[arg(long, value_enum, default_value_t = Notification::All)]
    notification: Notification,
    /// Optional ISO-8601 UTC timestamp for deterministic manual runs.
    #[arg(long)]
    now: Option<String>,
    /// Claim and send nothing: write every email that would go out into this
    /// directory, reading the database read-only.
    #[arg(long, value_name = "DIRECTORY")]
    render_only: Option<PathBuf>,
}

#[derive(Clone, Copy, PartialEq, Eq, ValueEnum)]
enum Notification {
    All,
    #[value(name = "morning_email")]
    MorningEmail,
    #[value(name = "event_reminder")]
    EventReminder,
}

impl Notification {
    fn includes(self, notification: Notification) -> bool {
        self == Notification::All || self == notification
    }
}

/// Python's `datetime.fromisoformat`, read as UTC when it names no offset.
fn parse_now(value: &str) -> Result<DateTime<Utc>> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(&value.replacen(' ', "T", 1)) {
        return Ok(parsed.with_timezone(&Utc));
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
        if let Ok(parsed) = NaiveDateTime::parse_from_str(&value.replacen(' ', "T", 1), format) {
            return Ok(parsed.and_utc());
        }
    }
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .with_context(|| format!("--now is not an ISO-8601 timestamp: {value}"))?;
    Ok(date.and_hms_opt(0, 0, 0).expect("midnight").and_utc())
}

#[tokio::main]
async fn main() -> Result<ExitCode> {
    wat2do::install_tls();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn,aws=warn,aws_config=warn".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    let cli = Cli::parse();
    let now = match &cli.now {
        Some(value) => parse_now(value)?,
        None => Utc::now(),
    };
    let outbox = match cli.render_only {
        Some(directory) => Outbox::render_only(wat2do::db::connect_read_only(2).await?, directory),
        None => Outbox::live(wat2do::db::connect(2).await?),
    };
    let mut failed = false;
    if cli.notification.includes(Notification::MorningEmail) {
        tracing::info!("morning_email tick at {}", now.to_rfc3339());
        let stats = morning_email::dispatch(&outbox, now).await?;
        tracing::info!("morning_email result: {}", stats.describe("eligible"));
        failed |= stats.failed > 0;
    }
    if cli.notification.includes(Notification::EventReminder) {
        tracing::info!("event_reminder tick at {}", now.to_rfc3339());
        let stats = event_reminder::dispatch(&outbox, now).await?;
        tracing::info!("event_reminder result: {}", stats.describe("due"));
        failed |= stats.failed > 0;
    }
    Ok(if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::{Notification, parse_now};

    #[test]
    fn all_dispatches_both_types_and_a_type_only_itself() {
        let both = [Notification::MorningEmail, Notification::EventReminder];
        assert!(both.iter().all(|kind| Notification::All.includes(*kind)));
        assert!(Notification::MorningEmail.includes(Notification::MorningEmail));
        assert!(!Notification::MorningEmail.includes(Notification::EventReminder));
        assert!(!Notification::EventReminder.includes(Notification::MorningEmail));
    }

    #[test]
    fn now_reads_like_python_fromisoformat() {
        let expected = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 13, 0, 0).unwrap();
        for value in [
            "2026-05-01T13:00:00+00:00",
            "2026-05-01T13:00:00Z",
            "2026-05-01T09:00:00-04:00",
            "2026-05-01T13:00:00",
            "2026-05-01 13:00:00",
            "2026-05-01T13:00",
        ] {
            assert_eq!(parse_now(value).unwrap(), expected, "{value}");
        }
        assert_eq!(
            parse_now("2026-05-01").unwrap(),
            chrono::Utc.with_ymd_and_hms(2026, 5, 1, 0, 0, 0).unwrap()
        );
        assert!(parse_now("tomorrow").is_err());
    }
}
