//! Instagram notification processing on the Mac: the Brave worker that expands digest
//! notifications, lists profiles and engages with carousel sources, the
//! `process-notification` job GitHub runs, and the ledger it records into
//! (`backend/services/instagram_notifications` in Python).
//!
//! AGENTS.md "Instagram notification ingestion direction" is the contract: two worker
//! tabs (account switching and serialized engagement on the first, digest queries and
//! profile listings on the second), credentials that never leave Brave, and a failed
//! expansion that stops before anything is recorded.

pub mod account_login;
pub mod browser_digest;
pub mod browser_engagement;
pub mod browser_ingestion;
pub mod browser_queue;
pub mod browser_session;
pub mod browser_worker;
pub mod carousel_engagement;
pub mod cli;
pub mod errors;
pub mod ledger;
pub mod process_notification;
pub mod profile_retrieval;
pub mod scripts;

#[cfg(test)]
pub(crate) mod test_support;
