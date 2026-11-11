//! Haiku club directory agents reading each school's official club directory
//! (`controlbox/ingestion.json` `club_directories`), so every club it lists is
//! followed even when the follow crawl never meets it.
//!
//! Every `club_directory_scan_days` an agent reads each page of a directory's
//! listing and reports the clubs on it: the Instagram account the page shows,
//! or else the club's own page on the directory. On every directory run, code
//! reads up to `club_directory_pages_per_run` of those club pages one at a time,
//! `club_directory_page_delay_seconds` apart, each again only after
//! `club_directory_recheck_days`, and takes the Instagram accounts it links.
//! Every account its school has no row for yet joins
//! `public.instagram_follow_candidates` as a pending `directory` row naming the
//! directory, and the follow scorer decides it. The club pages and when each
//! was read are kept in the ingestion state directory.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, TimeDelta, Utc};
use futures_util::{StreamExt, stream};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sqlx::PgPool;
use tokio::sync::Mutex;

use super::club_logos::normalize_handle;
use super::directories::{Counts, add, extension, plausible};
use super::page_image::{download, post_json};
use super::state_directory;
use crate::claude::{self, Agent, Limited, claude_environment, remove_leftovers};
use crate::constants::FOLLOW_SOURCE_DIRECTORY;
use crate::controlbox::{ClubDirectory, ClubDirectoryListing, INGESTION};
use crate::schools;
use crate::urls::urlsplit;

pub const WORKDIR_PREFIX: &str = "wat2do-club-directory-";
const PROMPT: &str = include_str!("../../../backend/services/ingestion/club_directory_prompt.md");
const STATE_FILE: &str = "club-directories.json";
const PAGE_PLACEHOLDER: &str = "{page}";
const MAX_CLUB_PAGE_BYTES: usize = 2_000_000;

static REPORT_SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["clubs"],
        "properties": {
            "clubs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["name"],
                    "properties": {
                        "school": {"type": "string"},
                        "name": {"type": "string"},
                        "instagram": {"type": "string"},
                        "page": {"type": "string"},
                    },
                },
            }
        },
    })
});

/// An Instagram link in a page, JSON's escaped slashes already undone.
static INSTAGRAM_LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)instagram\.com/([A-Za-z0-9_.]+)").expect("valid regex"));

/// Instagram paths that are never an account.
const NOT_ACCOUNTS: [&str; 10] = [
    "p", "reel", "reels", "explore", "accounts", "stories", "tv", "about", "legal", "direct",
];

/// What the run remembers about each directory, by its name.
#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    directories: BTreeMap<String, Remembered>,
}

/// One directory: when its listing was last read in full, and its club pages.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
struct Remembered {
    scanned_at: Option<DateTime<Utc>>,
    pages: BTreeMap<String, ClubPage>,
}

/// A club's own page on its directory, and when code last read it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct ClubPage {
    school: String,
    name: String,
    read_at: Option<DateTime<Utc>>,
}

impl State {
    fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn save(&self, path: &Path) {
        let written = serde_json::to_vec_pretty(self)
            .map_err(anyhow::Error::from)
            .and_then(|text| Ok(std::fs::write(path, text)?));
        if let Err(error) = written {
            tracing::warn!("Could not save the club directory state ({error})");
        }
    }
}

/// Read every club directory, a few at a time, unless Claude's usage limit
/// already turned an agent away this run.
pub async fn scrape_club_directories(pool: &PgPool, limited: &AtomicBool) -> Counts {
    remove_leftovers(WORKDIR_PREFIX);
    let path = state_path();
    let mut loaded = State::load(&path);
    // A directory taken out of the control box is forgotten.
    loaded.directories.retain(|name, _| {
        INGESTION
            .club_directories
            .iter()
            .any(|directory| &directory.name == name)
    });
    let state = Mutex::new(loaded);
    let mut results = stream::iter(&INGESTION.club_directories)
        .map(|directory| async {
            let remembered = state
                .lock()
                .await
                .directories
                .get(&directory.name)
                .cloned()
                .unwrap_or_default();
            let (counts, remembered) = read_directory(pool, directory, remembered, limited).await;
            let mut state = state.lock().await;
            state.directories.insert(directory.name.clone(), remembered);
            state.save(&path);
            counts
        })
        .buffer_unordered(INGESTION.directory_agents);
    let mut totals = Counts::new();
    while let Some(counts) = results.next().await {
        add(&mut totals, counts);
    }
    totals
}

fn state_path() -> PathBuf {
    state_directory().join(STATE_FILE)
}

async fn read_directory(
    pool: &PgPool,
    directory: &ClubDirectory,
    mut remembered: Remembered,
    limited: &AtomicBool,
) -> (Counts, Remembered) {
    let mut counts = Counts::new();
    let schools = match school_ids(pool, directory).await {
        Ok(schools) => schools,
        Err(error) => {
            tracing::warn!("Club directory {} failed ({error})", directory.name);
            bump(&mut counts, "failed_club_directories");
            return (counts, remembered);
        }
    };
    let now = Utc::now();
    if scan_due(&remembered, now) && !limited.load(Ordering::Relaxed) {
        match scan(pool, directory, &schools, &mut counts).await {
            Ok(scanned) => remembered.merge(scanned, now),
            Err(error) => {
                limited.fetch_or(error.is::<Limited>(), Ordering::Relaxed);
                tracing::warn!("Club directory {} failed ({error})", directory.name);
                bump(&mut counts, "failed_club_directories");
            }
        }
    }
    if let Err(error) =
        read_club_pages(pool, directory, &schools, &mut remembered, &mut counts).await
    {
        tracing::warn!("Club pages of {} failed ({error})", directory.name);
        bump(&mut counts, "failed_club_directories");
    }
    (counts, remembered)
}

fn bump(counts: &mut Counts, key: &str) {
    *counts.entry(key.to_owned()).or_default() += 1;
}

/// Each of the directory's schools by slug, with its ID.
async fn school_ids(pool: &PgPool, directory: &ClubDirectory) -> Result<HashMap<String, i32>> {
    let mut ids = HashMap::new();
    for slug in &directory.schools {
        let school = schools::by_slug(pool, slug)
            .await?
            .ok_or_else(|| anyhow!("School {slug} is not registered"))?;
        ids.insert(slug.clone(), school.id);
    }
    Ok(ids)
}

fn scan_due(remembered: &Remembered, now: DateTime<Utc>) -> bool {
    remembered.scanned_at.is_none_or(|scanned| {
        now - scanned >= TimeDelta::days(INGESTION.club_directory_scan_days as i64)
    })
}

/// The club pages one reading of a directory's listing found.
struct Scanned {
    pages: BTreeMap<String, ClubPage>,
    /// Every listing page was read; only then are pages it no longer lists forgotten.
    complete: bool,
}

impl Remembered {
    /// Keep when each page still listed was read; forget the rest only after a
    /// complete reading, and only then count the listing as read.
    fn merge(&mut self, scanned: Scanned, now: DateTime<Utc>) {
        let old = std::mem::take(&mut self.pages);
        if !scanned.complete {
            self.pages.clone_from(&old);
        }
        for (url, mut page) in scanned.pages {
            page.read_at = old.get(&url).and_then(|known| known.read_at);
            self.pages.insert(url, page);
        }
        if scanned.complete {
            self.scanned_at = Some(now);
        }
    }
}

/// Run one agent per listing page, queue the accounts the pages show, and
/// return the club pages to read.
async fn scan(
    pool: &PgPool,
    directory: &ClubDirectory,
    schools: &HashMap<String, i32>,
    counts: &mut Counts,
) -> Result<Scanned> {
    let mut scanned = Scanned {
        pages: BTreeMap::new(),
        complete: true,
    };
    for listing in &directory.listings {
        let (pages, whole) = download_listing(listing).await;
        scanned.complete &= whole;
        for (url, page) in pages {
            bump(counts, "club_listing_pages");
            let reported = match run(directory, &url, &page).await {
                Ok(reported) => reported,
                Err(error) if error.is::<Limited>() => return Err(error),
                Err(error) => {
                    tracing::warn!("Club directory agent for {url} failed ({error})");
                    bump(counts, "failed_club_listing_pages");
                    scanned.complete = false;
                    continue;
                }
            };
            let listing_text = searchable(&page);
            for club in reported {
                match check(&club, directory, &url, &listing_text) {
                    Checked::Account { school, handle } => {
                        let queued = queue(
                            pool,
                            schools[&school],
                            &handle,
                            Some(&club.name),
                            &directory.name,
                            None,
                        )
                        .await?;
                        if queued {
                            bump(counts, "queued_club_accounts");
                        }
                    }
                    Checked::Page { school, url } => {
                        scanned.pages.insert(
                            url,
                            ClubPage {
                                school,
                                name: club.name.clone(),
                                read_at: None,
                            },
                        );
                    }
                    Checked::Invented => {
                        bump(counts, "invented_club_reports");
                    }
                    Checked::Nothing => {}
                }
            }
        }
    }
    Ok(scanned)
}

/// Every page of one listing, and whether the first page came back. A paged
/// listing stops at the first page that fails or repeats the one before it.
async fn download_listing(listing: &ClubDirectoryListing) -> (Vec<(String, Vec<u8>)>, bool) {
    let paged = listing.url.contains(PAGE_PLACEHOLDER)
        || listing
            .body
            .as_deref()
            .is_some_and(|body| body.contains(PAGE_PLACEHOLDER));
    let last = if paged {
        INGESTION.club_directory_max_listing_pages
    } else {
        1
    };
    let mut pages: Vec<(String, Vec<u8>)> = Vec::new();
    for number in 1..=last {
        let fill = |text: &str| text.replace(PAGE_PLACEHOLDER, &number.to_string());
        let url = fill(&listing.url);
        if number > 1 {
            pause().await;
        }
        let fetched = match &listing.body {
            Some(body) => post_json(&url, &fill(body), timeout(), max_listing_bytes()).await,
            None => download(&url, timeout(), max_listing_bytes()).await,
        };
        match fetched {
            Ok(page) if pages.last().is_some_and(|(_, previous)| *previous == page) => break,
            Ok(page) => pages.push((url, page)),
            Err(error) => {
                if number == 1 {
                    tracing::warn!("Club directory listing {url} failed ({error})");
                }
                break;
            }
        }
    }
    let whole = !pages.is_empty();
    (pages, whole)
}

fn timeout() -> Duration {
    Duration::from_secs_f64(INGESTION.fetch_timeout_seconds)
}

fn max_listing_bytes() -> usize {
    INGESTION.directory_listing_max_bytes
}

async fn pause() {
    tokio::time::sleep(Duration::from_secs_f64(
        INGESTION.club_directory_page_delay_seconds,
    ))
    .await;
}

/// A page's text as code searches it: lower case, JSON's escaped slashes undone.
fn searchable(page: &[u8]) -> String {
    htmlize::unescape(String::from_utf8_lossy(page))
        .replace("\\/", "/")
        .to_lowercase()
}

/// One club an agent reported.
#[derive(Debug, Deserialize)]
struct Reported {
    #[serde(default)]
    school: String,
    name: String,
    #[serde(default)]
    instagram: String,
    #[serde(default)]
    page: String,
}

async fn run(directory: &ClubDirectory, url: &str, page: &[u8]) -> Result<Vec<Reported>> {
    let workdir = tempfile::Builder::new().prefix(WORKDIR_PREFIX).tempdir()?;
    let listing_file = format!("listing{}", extension(page));
    std::fs::write(workdir.path().join(&listing_file), page)?;
    let answer = claude::run_agent(
        &render_prompt(directory, url, &listing_file),
        workdir.path(),
        Agent {
            name: "Club directory agent",
            model: &INGESTION.model,
            tools: &["Read", "Grep"],
            allowed_tools: &["Read(./**)", "Grep(./**)"],
            schema: &REPORT_SCHEMA,
            timeout: Duration::from_secs(INGESTION.directory_model_timeout_seconds),
            env: claude_environment(),
        },
    )
    .await?;
    reported_clubs(&answer)
}

fn render_prompt(directory: &ClubDirectory, url: &str, listing_file: &str) -> String {
    let notes = if directory.notes.is_empty() {
        "nothing more than the page says"
    } else {
        &directory.notes
    };
    [
        ("name", directory.name.as_str()),
        ("schools", &directory.schools.join(", ")),
        ("listing_url", url),
        ("listing_file", listing_file),
        ("notes", notes),
    ]
    .iter()
    .fold(PROMPT.to_owned(), |prompt, (key, value)| {
        prompt.replace(&format!("{{{{{key}}}}}"), value)
    })
}

fn reported_clubs(answer: &Map<String, Value>) -> Result<Vec<Reported>> {
    let Some(Value::Array(clubs)) = answer.get("clubs") else {
        bail!("Club directory agent gave no report");
    };
    Ok(clubs
        .iter()
        .filter_map(|club| serde_json::from_value(club.clone()).ok())
        .collect())
}

/// What code makes of one reported club.
#[derive(Debug, PartialEq)]
enum Checked {
    /// An account the listing page itself shows.
    Account { school: String, handle: String },
    /// The club's own page on the directory, to read for its account.
    Page { school: String, url: String },
    /// A school, account or page the listing does not back up.
    Invented,
    /// Neither an account nor a page.
    Nothing,
}

fn check(
    club: &Reported,
    directory: &ClubDirectory,
    listing_url: &str,
    listing_text: &str,
) -> Checked {
    let school = match directory.schools.as_slice() {
        [only] if club.school.trim().is_empty() => only.clone(),
        _ => club.school.trim().to_lowercase(),
    };
    if !directory.schools.contains(&school) {
        return Checked::Invented;
    }
    if !club.instagram.trim().is_empty() {
        return match instagram_handle(&club.instagram) {
            Some(handle) if listing_text.contains(&handle) => Checked::Account { school, handle },
            _ => Checked::Invented,
        };
    }
    let url = club.page.trim();
    if url.is_empty() {
        return Checked::Nothing;
    }
    let host = urlsplit(listing_url, "")
        .ok()
        .and_then(|split| split.hostname())
        .unwrap_or_default();
    if plausible(url, listing_text, &host) {
        Checked::Page {
            school,
            url: url.to_owned(),
        }
    } else {
        Checked::Invented
    }
}

/// The bare Instagram username in a handle (`@name`) or profile link, or None.
fn instagram_handle(value: &str) -> Option<String> {
    let value = value.trim().to_lowercase();
    let handle = match value.split_once("instagram.com/") {
        Some((_, path)) => path.split(['/', '?', '#']).next().unwrap_or_default(),
        None => &value,
    };
    let handle = normalize_handle(handle.trim_end_matches('.'))?;
    (!NOT_ACCOUNTS.contains(&handle.as_str())).then_some(handle)
}

/// Every Instagram account a page links, in the order it first links them.
fn linked_accounts(page: &str) -> Vec<String> {
    let page = page.replace("\\/", "/");
    let mut seen = HashSet::new();
    INSTAGRAM_LINK
        .captures_iter(&page)
        .filter_map(|link| instagram_handle(&link[1]))
        .filter(|handle| seen.insert(handle.clone()))
        .collect()
}

/// Read the club pages due a reading and queue the accounts each links that
/// the directory's own site does not link from its home page too.
async fn read_club_pages(
    pool: &PgPool,
    directory: &ClubDirectory,
    schools: &HashMap<String, i32>,
    remembered: &mut Remembered,
    counts: &mut Counts,
) -> Result<()> {
    let now = Utc::now();
    let due = due_pages(remembered, now, INGESTION.club_directory_pages_per_run);
    let mut site_accounts: HashMap<String, HashSet<String>> = HashMap::new();
    for url in due {
        let page = remembered.pages[&url].clone();
        let host = urlsplit(&url, "")
            .ok()
            .and_then(|split| split.hostname())
            .unwrap_or_default();
        if !site_accounts.contains_key(&host) {
            pause().await;
            let home = download(&format!("https://{host}/"), timeout(), MAX_CLUB_PAGE_BYTES)
                .await
                .map(|home| linked_accounts(&String::from_utf8_lossy(&home)))
                .unwrap_or_default();
            site_accounts.insert(host.clone(), home.into_iter().collect());
        }
        pause().await;
        let read = download(&url, timeout(), MAX_CLUB_PAGE_BYTES).await;
        // A page that fails is read again after the recheck days, like any other.
        if let Some(entry) = remembered.pages.get_mut(&url) {
            entry.read_at = Some(Utc::now());
        }
        let text = match read {
            Ok(text) => String::from_utf8_lossy(&text).into_owned(),
            Err(error) => {
                tracing::debug!("Club page {url} failed ({error})");
                bump(counts, "failed_club_pages");
                continue;
            }
        };
        bump(counts, "read_club_pages");
        let accounts: Vec<String> = linked_accounts(&text)
            .into_iter()
            .filter(|handle| !site_accounts[&host].contains(handle))
            .collect();
        // The club's name and page go only to its one account; several are named by
        // their profiles and linked to no club.
        let (name, club_page) = match accounts.as_slice() {
            [_] => (Some(page.name.as_str()), Some(url.as_str())),
            _ => (None, None),
        };
        // A page remembered for a school the directory no longer covers is skipped.
        let Some(&school_id) = schools.get(&page.school) else {
            continue;
        };
        for handle in &accounts {
            if queue(pool, school_id, handle, name, &directory.name, club_page).await? {
                bump(counts, "queued_club_accounts");
            }
        }
    }
    Ok(())
}

/// The club pages never read first, then the longest unread, each only once
/// `club_directory_recheck_days` have passed since its last reading.
fn due_pages(remembered: &Remembered, now: DateTime<Utc>, limit: usize) -> Vec<String> {
    let recheck = TimeDelta::days(INGESTION.club_directory_recheck_days as i64);
    let mut due: Vec<(&Option<DateTime<Utc>>, &String)> = remembered
        .pages
        .iter()
        .filter(|(_, page)| page.read_at.is_none_or(|read| now - read >= recheck))
        .map(|(url, page)| (&page.read_at, url))
        .collect();
    due.sort();
    due.into_iter()
        .take(limit)
        .map(|(_, url)| url.clone())
        .collect()
}

/// Ask for the account to be followed; one the school already has a row for,
/// in any status, or that one of its clubs already names, is left alone.
/// When exactly one of the school's clubs without an account has the club's
/// directory page or name, the row is linked to it, so approving the row gives
/// that club its account instead of making a second club.
pub(super) async fn queue(
    pool: &PgPool,
    school_id: i32,
    handle: &str,
    name: Option<&str>,
    directory: &str,
    club_page: Option<&str>,
) -> Result<bool> {
    let added = sqlx::query(
        "INSERT INTO public.instagram_follow_candidates \
             (school_id, handle, name, source, found_via, status, club_id) \
         SELECT $1, $2, $3, $4, ARRAY[$5], 'pending', \
                (SELECT min(club.id) FROM public.clubs AS club \
                 WHERE club.school_id = $1 AND coalesce(btrim(club.ig), '') = '' \
                   AND (club.club_page = $6 \
                        OR lower(btrim(club.club_name)) = lower(btrim($3))) \
                 HAVING count(*) = 1) \
         WHERE NOT EXISTS ( \
             SELECT 1 FROM public.clubs AS club \
             WHERE club.school_id = $1 AND lower(ltrim(btrim(club.ig), '@')) = $2) \
         ON CONFLICT (school_id, handle) DO NOTHING",
    )
    .bind(school_id)
    .bind(handle)
    .bind(name.map(str::trim).filter(|name| !name.is_empty()))
    .bind(FOLLOW_SOURCE_DIRECTORY)
    .bind(directory)
    .bind(club_page)
    .execute(pool)
    .await
    .context("queueing a directory club's account")?;
    Ok(added.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory(schools: &[&str]) -> ClubDirectory {
        ClubDirectory {
            name: "Clubs".into(),
            schools: schools.iter().map(|school| (*school).to_owned()).collect(),
            listings: vec![ClubDirectoryListing {
                url: "https://clubs.example.edu/list?page={page}".into(),
                body: None,
            }],
            notes: String::new(),
        }
    }

    fn reported(school: &str, instagram: &str, page: &str) -> Reported {
        Reported {
            school: school.into(),
            name: "Chess Club".into(),
            instagram: instagram.into(),
            page: page.into(),
        }
    }

    const LISTING_URL: &str = "https://clubs.example.edu/list?page=1";

    #[test]
    fn handles_come_from_links_and_at_names() {
        for (value, expected) in [
            ("@UW_Chess", Some("uw_chess")),
            ("https://www.instagram.com/uw_chess/", Some("uw_chess")),
            ("instagram.com/UW_Chess?igsh=abc", Some("uw_chess")),
            ("https://instagram.com/uw.chess.", Some("uw.chess")),
            ("https://www.instagram.com/p/C0abc/", None),
            ("https://www.instagram.com/explore/tags/chess", None),
            ("Chess Club", None),
            ("", None),
        ] {
            assert_eq!(instagram_handle(value).as_deref(), expected, "{value}");
        }
    }

    #[test]
    fn a_page_links_each_account_once() {
        let page = r#"<a href="https://instagram.com/kurdsatuoft">x</a>
            {"url":"https:\/\/www.instagram.com\/KurdsAtUofT"} instagram.com/p/abc
            <a href='https://www.instagram.com/uoftsu/'>"#;
        assert_eq!(linked_accounts(page), ["kurdsatuoft", "uoftsu"]);
    }

    #[test]
    fn reports_are_checked_against_the_listing() {
        let one = directory(&["uwaterloo"]);
        let text =
            searchable(br#"[{"id": 7, "social_url": "https:\/\/www.instagram.com\/UW_Chess"}]"#);
        // The only school is assumed; the account must be on the page.
        assert_eq!(
            check(&reported("", "@uw_chess", ""), &one, LISTING_URL, &text),
            Checked::Account {
                school: "uwaterloo".into(),
                handle: "uw_chess".into()
            }
        );
        assert_eq!(
            check(&reported("", "@uw_go", ""), &one, LISTING_URL, &text),
            Checked::Invented
        );
        // A page on the directory's own site, built from the listing.
        assert_eq!(
            check(
                &reported("uwaterloo", "", "https://clubs.example.edu/api/clubs/7"),
                &one,
                LISTING_URL,
                &text
            ),
            Checked::Page {
                school: "uwaterloo".into(),
                url: "https://clubs.example.edu/api/clubs/7".into()
            }
        );
        assert_eq!(
            check(
                &reported("", "", "https://elsewhere.com/7"),
                &one,
                LISTING_URL,
                &text
            ),
            Checked::Invented
        );
        assert_eq!(
            check(&reported("", "", ""), &one, LISTING_URL, &text),
            Checked::Nothing
        );
        // A directory of several schools needs one of them named.
        let three = directory(&["utsg", "utm", "utsc"]);
        assert_eq!(
            check(&reported("", "@uw_chess", ""), &three, LISTING_URL, &text),
            Checked::Invented
        );
        assert_eq!(
            check(
                &reported("UTM", "@uw_chess", ""),
                &three,
                LISTING_URL,
                &text
            ),
            Checked::Account {
                school: "utm".into(),
                handle: "uw_chess".into()
            }
        );
    }

    fn page(read_days_ago: Option<i64>, now: DateTime<Utc>) -> ClubPage {
        ClubPage {
            school: "utsg".into(),
            name: "Club".into(),
            read_at: read_days_ago.map(|days| now - TimeDelta::days(days)),
        }
    }

    #[test]
    fn unread_pages_go_first_then_the_longest_unread() {
        let now = Utc::now();
        let recheck = INGESTION.club_directory_recheck_days as i64;
        let remembered = Remembered {
            scanned_at: None,
            pages: BTreeMap::from([
                ("https://a/1".to_owned(), page(Some(recheck + 1), now)),
                ("https://a/2".to_owned(), page(None, now)),
                ("https://a/3".to_owned(), page(Some(1), now)),
                ("https://a/4".to_owned(), page(Some(recheck + 5), now)),
            ]),
        };
        assert_eq!(
            due_pages(&remembered, now, 10),
            ["https://a/2", "https://a/4", "https://a/1"]
        );
        assert_eq!(due_pages(&remembered, now, 1), ["https://a/2"]);
    }

    #[test]
    fn a_reading_keeps_read_times_and_forgets_only_after_a_whole_listing() {
        let now = Utc::now();
        let mut remembered = Remembered {
            scanned_at: None,
            pages: BTreeMap::from([
                ("https://a/kept".to_owned(), page(Some(3), now)),
                ("https://a/gone".to_owned(), page(Some(3), now)),
            ]),
        };
        let scanned = |complete| Scanned {
            pages: BTreeMap::from([
                ("https://a/kept".to_owned(), page(None, now)),
                ("https://a/new".to_owned(), page(None, now)),
            ]),
            complete,
        };
        remembered.merge(scanned(false), now);
        assert_eq!(remembered.scanned_at, None);
        assert_eq!(remembered.pages.len(), 3);
        assert_eq!(
            remembered.pages["https://a/kept"].read_at,
            page(Some(3), now).read_at
        );
        remembered.merge(scanned(true), now);
        assert_eq!(remembered.scanned_at, Some(now));
        assert_eq!(
            remembered.pages.keys().collect::<Vec<_>>(),
            ["https://a/kept", "https://a/new"]
        );
        assert_eq!(
            remembered.pages["https://a/kept"].read_at,
            page(Some(3), now).read_at
        );
        assert!(!scan_due(&remembered, now));
        assert!(scan_due(
            &remembered,
            now + TimeDelta::days(INGESTION.club_directory_scan_days as i64)
        ));
    }

    #[test]
    fn the_prompt_fills_every_placeholder() {
        let prompt = render_prompt(&directory(&["utsg", "utm"]), LISTING_URL, "listing.json");
        assert!(prompt.contains("Schools it covers: utsg, utm"));
        assert!(prompt.contains("./listing.json"));
        assert!(!prompt.contains("{{"));
    }

    #[test]
    fn a_report_needs_a_clubs_list() {
        assert_eq!(REPORT_SCHEMA["required"], json!(["clubs"]));
        let answer =
            json!({"clubs": [{"name": "Chess", "page": "https://a/1"}, {"page": "no name"}]});
        let clubs = reported_clubs(answer.as_object().unwrap()).unwrap();
        assert_eq!(clubs.len(), 1);
        assert!(reported_clubs(&Map::new()).is_err());
    }
}
