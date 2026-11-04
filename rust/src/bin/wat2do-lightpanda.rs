//! `wat2do-lightpanda`: read Instagram digests with Lightpanda instead of Brave.
//!
//! `install` puts the pinned Lightpanda at `~/.local/libexec/wat2do/lightpanda`.
//! `login` logs one school account in to its own Lightpanda jar, within the daily
//! login budget it shares with Brave. `shadow` replays the digests Brave resolved
//! and compares the media IDs; nothing in production switches until
//! `instagram_digest.json`'s `digest_engine` says `"lightpanda"`.

use clap::{Parser, Subcommand};
use wat2do::instagram_notifications::browser_queue::{BrowserJobQueue, default_state_directory};
use wat2do::instagram_notifications::browser_session::Bridge;
use wat2do::lightpanda::login::{self, LoginResult};
use wat2do::lightpanda::{Lightpanda, install, shadow};

#[derive(Parser)]
#[command(about = "Read Instagram digests with Lightpanda")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Install the pinned Lightpanda release
    Install,
    /// Log one school account in to Lightpanda
    Login {
        #[arg(long)]
        account: String,
    },
    /// Let an account paused for a person log in again
    Resume {
        #[arg(long)]
        account: String,
    },
    /// Replay Brave's recent digests in Lightpanda and compare the media IDs
    Shadow {
        /// Accounts to compare (default: every account logged in to Lightpanda)
        #[arg(long = "account")]
        accounts: Vec<String>,
        /// Log accounts in first when their jar holds no login
        #[arg(long)]
        log_in: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    wat2do::install_tls();
    let bridge = Bridge::real();
    // The worker's queue holds the login budget and the pauses; it is opened only by
    // the commands that may write them.
    let queue = || BrowserJobQueue::open(None, bridge.host.clone());
    match Cli::parse().command {
        Command::Install => println!("{}", install::install().await?),
        Command::Login { account } => {
            let lightpanda = Lightpanda::installed().await?;
            let result = login::log_in(&lightpanda, &*queue()?, bridge.clone(), &account).await?;
            println!(
                "{account}: {}",
                match result {
                    LoginResult::AlreadyLoggedIn => "already logged in".to_owned(),
                    LoginResult::LoggedIn { new_device } =>
                        format!("logged in (new device: {new_device})"),
                    LoginResult::Skipped(reason) => format!("not attempted: {reason}"),
                    LoginResult::Paused(reason) => format!("paused for a person: {reason}"),
                }
            );
        }
        Command::Resume { account } => {
            login::resume(&*queue()?, &account)?;
            println!("{account} may log in to Lightpanda again");
        }
        Command::Shadow { accounts, log_in } => {
            let lightpanda = Lightpanda::installed().await?;
            let queue = if log_in { Some(queue()?) } else { None };
            let login = queue.as_deref().map(|queue| (queue, bridge.clone()));
            let database = default_state_directory().join("jobs.sqlite3");
            let report =
                shadow::run(&lightpanda, &database, &accounts, login, &|| bridge.time()).await?;
            let saved = shadow::save(&report)?;
            print!("{}", shadow::summary(&report));
            println!("Report: {}", saved.display());
        }
    }
    Ok(())
}
