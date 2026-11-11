//! The always-on ingestion processor: the `ingestion_items` queue turned into
//! events and positions by Claude Haiku agents, the directory agents that
//! add to it, and the club directory agents that queue clubs to follow.

pub mod agent;
pub mod changes;
pub mod club_directories;
pub mod club_logos;
pub mod directories;
pub mod fetch;
pub mod items;
pub mod notify;
pub mod page_image;
pub mod processor;
pub mod prompt;
pub mod schedule;
pub mod stop;
pub mod title_svgs;

#[cfg(test)]
mod database_tests;

use std::path::PathBuf;

/// `~/.local/state/wat2do/ingestion` (under `XDG_STATE_HOME` when set): locks,
/// the club logo state and the job logs.
pub fn state_directory() -> PathBuf {
    state_directory_under(std::env::var_os("XDG_STATE_HOME").map(PathBuf::from))
}

/// The state directory for a given `XDG_STATE_HOME`, or the default without one.
pub fn state_directory_under(xdg_state_home: Option<PathBuf>) -> PathBuf {
    xdg_state_home
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".local/state")
        })
        .join("wat2do/ingestion")
}
