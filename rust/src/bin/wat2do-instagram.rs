//! `wat2do-instagram`: the daily Instagram carousels' background jobs.
//!
//! `curate` has Claude draft every school's carousel; `publish` posts every
//! ready draft for today; `publish-batch` posts one batch the API already
//! claimed (the admin's Publish button starts it); `stats` refreshes expiring
//! tokens and reads every account's followers and posts; `install-schedule`
//! runs curate and publish daily through macOS LaunchAgents that keep no logs.

use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Context;
use chrono::Utc;
use clap::{Parser, Subcommand};
use fs2::FileExt;
use serde_json::{Value, json};
use wat2do::api::routes::instagram_publishing::batches;
use wat2do::instagram_publishing::meta::GRAPH_HOST;
use wat2do::instagram_publishing::publishing::Publisher;
use wat2do::instagram_publishing::selection::DraftSelection;
use wat2do::instagram_publishing::{
    curation, drafts, job_error, schedule, stats, temp_directory, tokens,
};

#[derive(Parser)]
#[command(about = "Draft, publish and measure the daily Instagram carousels")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Read every school's candidate packet without saving anything
    Candidates,
    /// Validate and save one account's editorial choices
    Save { selection_file: PathBuf },
    /// Have Claude draft every school's carousel for today
    Curate,
    /// Publish every school's ready draft for today
    Publish,
    /// Publish one batch the API claimed for publishing
    PublishBatch { batch_id: uuid::Uuid },
    /// Refresh expiring tokens, then read every account's followers and posts
    Stats,
    /// Validate and store the account_key=token lines of a private file
    ImportTokens { token_file: PathBuf },
    /// Run curate and publish daily through LaunchAgents
    InstallSchedule,
}

/// One line of JSON with sorted keys, as the Python job printed it.
fn print_json(value: &Value) {
    println!("{}", wat2do::pyjson::dumps_sorted(value, None));
}

fn has(counts: &std::collections::BTreeMap<String, i64>, key: &str) -> bool {
    counts.get(key).is_some_and(|count| *count > 0)
}

/// Curation and publishing take turns, so a publish run never misses a draft
/// that is still being written.
async fn carousel_lock() -> anyhow::Result<std::fs::File> {
    let path = temp_directory().join("wat2do-instagram-carousels.lock");
    tokio::task::spawn_blocking(move || {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("could not open {}", path.display()))?;
        file.lock_exclusive()?;
        anyhow::Ok(file)
    })
    .await?
}

#[tokio::main]
async fn main() -> anyhow::Result<ExitCode> {
    wat2do::install_tls();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=error".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    let command = Cli::parse().command;
    if let Command::InstallSchedule = command {
        schedule::install_schedule(&schedule::launchctl()?)?;
        return Ok(ExitCode::SUCCESS);
    }
    let settings = wat2do::settings::settings()?;
    let key = settings.instagram_token_encryption_key.as_str();
    let db = wat2do::db::connect(4).await?;
    let failed = match command {
        Command::InstallSchedule => unreachable!("handled above"),
        Command::Candidates => {
            let packets = drafts::list_draft_candidates(&db, Utc::now()).await?;
            print_json(&packets.iter().map(drafts::Packet::to_json).collect());
            false
        }
        Command::Save { selection_file } => {
            let selection = DraftSelection::from_json(&std::fs::read_to_string(selection_file)?)?;
            let (outcome, batch_id) = drafts::save_review_draft(&db, &selection).await?;
            let batch = batches::get_batch(&db, batch_id).await.map_err(job_error)?;
            print_json(
                &json!({"outcome": outcome.as_str(), "batch": serde_json::to_value(batch)?}),
            );
            false
        }
        Command::Curate => {
            let _lock = carousel_lock().await?;
            let outcomes = curation::curate_all(&db).await?;
            print_json(&json!(outcomes));
            has(&outcomes, "failed")
        }
        Command::Publish => {
            let _lock = carousel_lock().await?;
            let storage = wat2do::storage::shared()?;
            let outcomes = Publisher::new(&db, settings, storage)
                .publish_ready_drafts(Utc::now())
                .await?;
            print_json(&json!(outcomes));
            has(&outcomes, "failed") || has(&outcomes, "skipped")
        }
        Command::PublishBatch { batch_id } => {
            // A failed publish is recorded on the batch; a nonzero exit means a crash.
            let storage = wat2do::storage::shared()?;
            let status = Publisher::new(&db, settings, storage)
                .publish_batch(batch_id)
                .await?;
            print_json(&json!({"status": status}));
            false
        }
        Command::Stats => {
            let now = Utc::now();
            let tokens = tokens::refresh_expiring_tokens(&db, key, GRAPH_HOST, now).await?;
            let accounts = stats::snapshot_accounts(&db, key, GRAPH_HOST, now).await?;
            print_json(&json!({"tokens": tokens, "accounts": accounts}));
            has(&tokens, "failed") || has(&accounts, "failed")
        }
        Command::ImportTokens { token_file } => {
            tokens::import_token_file(&db, key, &token_file).await?;
            false
        }
    };
    Ok(if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}
