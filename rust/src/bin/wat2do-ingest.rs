//! `wat2do-ingest`: event and position ingestion through the database queue
//! `public.ingestion_items`.
//!
//! Notified Instagram posts join the queue when GitHub records them; `enqueue`
//! adds one by hand. `process` is the Mac's always-on processor, and
//! `scrape-directories` runs the Haiku directory agents; `install-schedule`
//! installs both as macOS LaunchAgents.

use clap::{Parser, Subcommand};
use serde::Serialize;
use wat2do::ingestion::processor::process_queue;
use wat2do::ingestion::stop::Stop;
use wat2do::ingestion::{directories, items, schedule};

#[derive(Parser)]
#[command(about = "Turn queued sources into events and positions")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Stay running and turn queued sources into events and positions
    Process {
        /// Drain what is queued now, then exit
        #[arg(long)]
        once: bool,
    },
    /// Run the directory agents and queue what they find
    ScrapeDirectories,
    /// Queue Instagram post URLs for one school
    Enqueue {
        #[arg(long)]
        school: String,
        #[arg(long = "url", required = true)]
        urls: Vec<String>,
    },
    /// Show queue counts
    Status,
    /// Install both macOS LaunchAgents
    InstallSchedule,
}

/// One line of JSON with sorted keys, as the Python script printed it.
fn print_json(value: &impl Serialize) -> anyhow::Result<()> {
    println!(
        "{}",
        wat2do::pyjson::dumps(&serde_json::to_value(value)?, None)
    );
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    wat2do::install_tls();
    tracing_subscriber::fmt()
        .with_env_filter(
            // sqlx warns about every claim that waits on a row lock; only its errors matter.
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "warn,sqlx=error".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    match Cli::parse().command {
        Command::Process { once } => {
            // Database connections are scarce; queries are short, so lanes share a few.
            let pool = wat2do::db::connect(6).await?;
            let stopping = Stop::default();
            let on_signal = stopping.clone();
            tokio::spawn(async move {
                let _ = tokio::signal::ctrl_c().await;
                on_signal.set();
            });
            print_json(&process_queue(pool, !once, stopping).await?)
        }
        Command::ScrapeDirectories => {
            let pool = wat2do::db::connect(4).await?;
            print_json(&directories::scrape_directories(&pool).await?)
        }
        Command::Enqueue { school, urls } => {
            let pool = wat2do::db::connect(2).await?;
            let queued = items::queue_instagram(&pool, &urls, &school).await?;
            print_json(&serde_json::json!({ "queued": queued }))
        }
        Command::Status => {
            let pool = wat2do::db::connect(2).await?;
            print_json(&items::counts(&pool).await?)
        }
        Command::InstallSchedule => {
            for line in schedule::install_schedule(&schedule::launchctl())? {
                println!("{line}");
            }
            Ok(())
        }
    }
}
