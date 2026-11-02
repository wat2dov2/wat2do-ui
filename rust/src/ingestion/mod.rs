//! The always-on ingestion processor: Supabase's `ingestion_items` queue turned
//! into events and positions by Claude Haiku agents.

pub mod agent;
pub mod changes;
pub mod club_logos;
pub mod fetch;
pub mod items;
pub mod processor;
pub mod prompt;
pub mod realtime;
pub mod stop;

use std::path::PathBuf;

/// `~/.local/state/wat2do/ingestion`, shared with the Python directory agents.
pub fn state_directory() -> PathBuf {
    std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".local/state")
        })
        .join("wat2do/ingestion")
}
