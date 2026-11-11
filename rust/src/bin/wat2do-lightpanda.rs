//! `wat2do-lightpanda`: look after the school accounts' Lightpanda sessions, which the
//! `wat2do-browser` worker reads digests and Following lists in (`lightpanda::lane`).
//!
//! `install` puts the pinned Lightpanda at `~/.local/libexec/wat2do/lightpanda`.
//! `login` logs one school account in to its own Lightpanda jar, within the daily
//! login budget it shares with Brave, and `ramp` lists the order the worker logs the
//! rest in. `shadow` replays the digests Brave resolved and compares the media IDs,
//! and `following` reads one page of a Following list, to check a session by hand.

use clap::{Parser, Subcommand};
use wat2do::controlbox::INSTAGRAM_LIGHTPANDA;
use wat2do::instagram_notifications::browser_queue::{BrowserJobQueue, default_state_directory};
use wat2do::instagram_notifications::browser_session::Bridge;
use wat2do::lightpanda::login::{self, LoginResult};
use wat2do::lightpanda::{Lightpanda, following, install, ramp, shadow};

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
        /// How far back to take Brave's digests (default: `shadow_lookback_hours`)
        #[arg(long)]
        hours: Option<f64>,
    },
    /// List the accounts the worker's ramp logs in next, in order
    Ramp,
    /// Read one page of an account's Following list in a session, and time it
    Following {
        /// The school account whose session reads
        #[arg(long)]
        account: String,
        /// The account whose list is read, and its Instagram ID (Instagram answers a
        /// lookup by name only to a full browser)
        #[arg(long)]
        username: String,
        #[arg(long)]
        user_id: String,
        #[arg(long)]
        max_id: Option<String>,
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
        Command::Install => {
            println!("{}", install::install().await?);
            // The worker's lane starts once the binary and its jars' directory exist.
            Lightpanda::installed().await?;
        }
        Command::Login { account } => {
            let lightpanda = Lightpanda::installed().await?;
            let result =
                login::log_in(&lightpanda, &*queue()?, bridge.clone(), &account, 0).await?;
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
        Command::Shadow {
            accounts,
            log_in,
            hours,
        } => {
            let lightpanda = Lightpanda::installed().await?;
            let queue = if log_in { Some(queue()?) } else { None };
            let login = queue.as_deref().map(|queue| (queue, bridge.clone()));
            let database = default_state_directory().join("jobs.sqlite3");
            let hours = hours.unwrap_or(INSTAGRAM_LIGHTPANDA.shadow_lookback_hours);
            let report = shadow::run(&lightpanda, &database, &accounts, hours, login, &|| {
                bridge.time()
            })
            .await?;
            let saved = shadow::save(&report)?;
            print!("{}", shadow::summary(&report));
            println!("Report: {}", saved.display());
        }
        Command::Ramp => {
            let lightpanda = Lightpanda::installed().await?;
            let queue = queue()?;
            let now = bridge.time();
            let next = ramp::next(&queue, &lightpanda, now)?;
            println!("Logged in: {}", lightpanda.logged_in_accounts()?.join(", "));
            println!(
                "Next: {}",
                next.map_or("none today".to_owned(), |next| next.account)
            );
            for candidate in ramp::plan(&queue, &lightpanda, now)? {
                println!(
                    "  {} ({} digests{})",
                    candidate.account,
                    candidate.digests,
                    if candidate.relogin {
                        ", logs in again"
                    } else {
                        ""
                    }
                );
            }
        }
        Command::Following {
            account,
            username,
            user_id,
            max_id,
        } => {
            let lightpanda = Lightpanda::installed().await?;
            let started = std::time::Instant::now();
            let mut browser = lightpanda.open(&account).await?;
            let opened = started.elapsed().as_secs_f64();
            let read = match browser.user_id().await? {
                Some(session_user) => {
                    let started = std::time::Instant::now();
                    let page = following::read_page(
                        &mut browser,
                        &account,
                        &session_user,
                        &username,
                        Some(&user_id),
                        max_id.as_deref(),
                    )
                    .await;
                    page.map(|page| (page, started.elapsed().as_secs_f64()))
                        .map_err(anyhow::Error::from)
                }
                None => Err(anyhow::anyhow!("{account} is not logged in to Lightpanda")),
            };
            let peak = browser.peak_rss_kib() as f64 / 1024.0;
            browser.close().await?;
            let (page, seconds) = read?;
            let users = page["users"].as_array().map_or(0, Vec::len);
            let private = page["users"].as_array().map_or(0, |users| {
                users
                    .iter()
                    .filter(|user| user["is_private"] == true)
                    .count()
            });
            println!(
                "{username}: {users} accounts ({private} private), hidden {}, next page {}; \
                 startup {opened:.1} s, read {seconds:.1} s, peak {peak:.0} MB",
                page["hidden"] == true,
                !page["next_max_id"].is_null()
            );
        }
    }
    Ok(())
}
