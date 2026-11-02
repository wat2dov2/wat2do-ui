//! The always-on ingestion processor: the `ingestion_items` queue turned into
//! events and positions by Claude Haiku agents, and the directory agents that
//! add to it.

pub mod agent;
pub mod changes;
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

use std::path::PathBuf;

/// `~/.local/state/wat2do/ingestion`: locks, the club logo state and the job logs.
pub fn state_directory() -> PathBuf {
    std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".local/state")
        })
        .join("wat2do/ingestion")
}
