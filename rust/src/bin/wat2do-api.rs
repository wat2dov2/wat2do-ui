//! `wat2do-api`: the public API server, in front of the Python app until every
//! router is ported (`docs/rust_api.md`).

use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(about = "The wat2do API server")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Serve the API on PORT and run the Python app behind it
    Serve {
        #[arg(long, default_value_t = 8000)]
        port: u16,
        /// Restart the Python app when its code changes (local development)
        #[arg(long)]
        reload: bool,
    },
    /// Run parity cases through the Rust routes in process and print the results
    Replay {
        /// A JSON list of cases (see docs/rust_api.md)
        cases: PathBuf,
        /// Let cases write; only against a local database
        #[arg(long)]
        allow_writes: bool,
        /// Run each case this many times and report latency
        #[arg(long, default_value_t = 1)]
        iterations: usize,
    },
    /// Print the OpenAPI paths and schemas of the Rust routes
    Openapi,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    wat2do::install_tls();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    match Cli::parse().command {
        Command::Serve { port, reload } => {
            let code = wat2do::api::supervisor::serve(port, reload).await?;
            std::process::exit(code);
        }
        Command::Replay {
            cases,
            allow_writes,
            iterations,
        } => wat2do::api::replay::replay(&cases, allow_writes, iterations).await,
        Command::Openapi => {
            print!("{}", wat2do::api::openapi_json()?);
            Ok(())
        }
    }
}
