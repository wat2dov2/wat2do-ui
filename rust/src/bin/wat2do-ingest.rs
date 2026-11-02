//! `wat2do-ingest process`: the Mac's always-on ingestion processor.
//! `scripts/ingest.py install-schedule` installs it as `io.wat2do.ingestion.process`.

use clap::{Parser, Subcommand};
use wat2do::ingestion::processor::process_queue;
use wat2do::ingestion::stop::Stop;

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
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    wat2do::install_tls();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "warn".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    let Command::Process { once } = Cli::parse().command;
    let pool = wat2do::db::connect(16).await?;
    let stopping = Stop::default();
    let on_signal = stopping.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        on_signal.set();
    });
    let stats = process_queue(pool, !once, stopping).await?;
    println!("{}", serde_json::to_string(&stats)?);
    Ok(())
}
