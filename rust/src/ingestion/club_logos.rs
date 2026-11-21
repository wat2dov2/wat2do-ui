//! Club logos and names from the public Instagram profiles of clubs that still
//! need them (`services/ingestion/club_logos.py`), rendered logged out by Lightpanda
//! (`controlbox/ingestion.json` `profile_renderer`).
//!
//! One handle is read at a time, `club_logo_read_delay_seconds` apart, to fill a
//! missing logo and to replace a placeholder "@handle" name with the real one.
//! Handles never read go first, newest club first, then the longest unread. A handle
//! is read again only after `club_logo_retry_days`, or after
//! `club_logo_failed_retry_hours` when Lightpanda did not render its page. The list
//! is built again every `club_logo_relist_minutes`, so a club that is new or just got
//! a handle never waits behind the clubs listed before it.
//!
//! A page without a profile is Instagram's login wall, unless a control profile
//! (`CONTROL_HANDLE`) renders right after it: then only that handle has no public
//! profile and it waits its retry days like a gone one. A real refusal pauses these
//! reads with the post fetches and gives the handle back, due as before, to be read
//! first once reads resume. Instagram's picture links expire, so each one is copied
//! to media storage right away.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use indexmap::IndexMap;
use regex::Regex;
use sqlx::PgPool;

use super::fetch::{FetchBlocked, fetch_profile, profile_renderer};
use crate::constants::{BUCKET_CLUB_LOGOS, MAX_CLUB_NAME_LENGTH};
use crate::controlbox::INGESTION;
use crate::images::fetch_image;
use crate::revalidation::revalidate_schools;
use crate::storage::store_image;

static HANDLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9._]{1,30}$").expect("valid regex"));

/// A public profile that always exists, rendered to tell Instagram's login wall
/// from a handle that alone shows no profile.
const CONTROL_HANDLE: &str = "instagram";

/// `normalize_handle`: the bare Instagram username, or None when it is not one.
pub fn normalize_handle(value: &str) -> Option<String> {
    let handle = value.trim().trim_start_matches('@').to_lowercase();
    HANDLE.is_match(&handle).then_some(handle)
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct Club {
    id: i32,
    club_name: String,
    logo_url: Option<String>,
    school: String,
}

/// A handle taken to read, with its clubs and when it was last read before, to give it back.
pub struct Taken {
    pub handle: String,
    clubs: Vec<Club>,
    previous: Option<f64>,
}

/// How a handle's read went, when Instagram did not refuse it.
#[derive(Debug, PartialEq)]
pub enum Read {
    /// Its profile (or that it is gone) is known; it waits `club_logo_retry_days`.
    Done,
    /// Its page showed no profile while the control profile rendered: only a login
    /// could see it, so it waits `club_logo_retry_days` like a gone one.
    NoPublicProfile,
    /// Lightpanda did not render its page; it is read again soon.
    NotRendered,
}

pub struct ClubLogos {
    state_path: PathBuf,
    read_at: HashMap<String, f64>,
    waiting: IndexMap<String, Vec<Club>>,
    listed_at: Option<Instant>,
    /// Handles whose page did not render, and when; listed again after the failed retry hours.
    failed_at: HashMap<String, Instant>,
    renderer_missing_logged: bool,
}

fn epoch_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

impl ClubLogos {
    pub fn new(state_path: PathBuf) -> Self {
        let read_at = std::fs::read_to_string(&state_path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self {
            state_path,
            read_at,
            waiting: IndexMap::new(),
            listed_at: None,
            failed_at: HashMap::new(),
            renderer_missing_logged: false,
        }
    }

    /// The next handle to read, marked as read now; None when none is due.
    pub async fn take_next(&mut self, pool: &PgPool) -> Result<Option<Taken>> {
        // Without the renderer every read would fail; wait for it instead.
        if !profile_renderer().is_file() {
            if !self.renderer_missing_logged {
                tracing::warn!(renderer = %profile_renderer().display(), "club logo reads wait: the profile renderer is not installed");
                self.renderer_missing_logged = true;
            }
            return Ok(None);
        }
        let backoff = Duration::from_secs(INGESTION.retry_backoff_seconds);
        let relist = Duration::from_secs(INGESTION.club_logo_relist_minutes * 60);
        if self.listed_at.is_none_or(|listed| {
            listed.elapsed() >= relist || (self.waiting.is_empty() && listed.elapsed() >= backoff)
        }) {
            self.listed_at = Some(Instant::now());
            let failed_retry = Duration::from_secs(INGESTION.club_logo_failed_retry_hours * 3600);
            self.failed_at.retain(|_, at| at.elapsed() < failed_retry);
            let failed: HashSet<String> = self.failed_at.keys().cloned().collect();
            let due_before = epoch_seconds() - (INGESTION.club_logo_retry_days * 86400) as f64;
            self.waiting = reading_order(
                clubs_needing_profile(pool).await?,
                &self.read_at,
                due_before,
                &failed,
            );
        }
        let Some((handle, clubs)) = self.waiting.shift_remove_index(0) else {
            return Ok(None);
        };
        let previous = self.read_at.insert(handle.clone(), epoch_seconds());
        self.save()?;
        Ok(Some(Taken {
            handle,
            clubs,
            previous,
        }))
    }

    /// Instagram refused the read: the handle goes back to the front, due as before.
    pub fn give_back(&mut self, taken: Taken) -> Result<()> {
        self.restore(&taken);
        self.waiting.shift_insert(0, taken.handle, taken.clubs);
        self.save()
    }

    /// The page did not render: due as before, but listed again only after
    /// `club_logo_failed_retry_hours`.
    pub fn retry_soon(&mut self, taken: Taken) -> Result<()> {
        self.restore(&taken);
        self.failed_at.insert(taken.handle, Instant::now());
        self.save()
    }

    fn restore(&mut self, taken: &Taken) {
        match taken.previous {
            Some(read_at) => self.read_at.insert(taken.handle.clone(), read_at),
            None => self.read_at.remove(&taken.handle),
        };
    }

    fn save(&self) -> Result<()> {
        if let Some(parent) = self.state_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self.state_path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec(&self.read_at)?)?;
        std::fs::rename(&temporary, &self.state_path)?;
        Ok(())
    }
}

/// Read a taken handle's profile and fill its clubs' missing logos and placeholder names.
/// An error that is `FetchBlocked` (see `is_blocked`) is Instagram refusing reads.
pub async fn read_handle(pool: &PgPool, taken: &Taken) -> Result<Read> {
    let profile = match fetch_profile(&taken.handle).await {
        Ok(Some(profile)) => profile,
        Ok(None) => return Ok(Read::NotRendered),
        Err(blocked) => {
            return match fetch_profile(CONTROL_HANDLE).await {
                // Instagram serves profiles: only this handle has none to show logged out.
                Ok(Some(_)) => Ok(Read::NoPublicProfile),
                _ => Err(anyhow::Error::new(blocked)),
            };
        }
    };
    let clubs = &taken.clubs;
    let name = profile.name.as_deref().unwrap_or("").trim().to_owned();
    let logo_url = match &profile.picture_url {
        Some(picture) if clubs.iter().any(|club| club.logo_url.is_none()) => {
            match fetch_image(picture, false).await {
                Some((data, content_type)) => {
                    store_image(data, &content_type, BUCKET_CLUB_LOGOS).await
                }
                None => None,
            }
        }
        _ => None,
    };
    for club in clubs {
        let logo = logo_url.as_deref().filter(|_| club.logo_url.is_none());
        let rename =
            (!name.is_empty() && !name.starts_with('@') && club.club_name.starts_with('@'))
                .then(|| name.chars().take(MAX_CLUB_NAME_LENGTH).collect::<String>());
        if logo.is_none() && rename.is_none() {
            continue;
        }
        sqlx::query(
            "UPDATE public.clubs SET logo_url = coalesce($2, logo_url), club_name = coalesce($3, club_name) \
             WHERE id = $1",
        )
        .bind(club.id)
        .bind(logo)
        .bind(rename)
        .execute(pool)
        .await?;
        // Logos and names are embedded in event and position cards.
        revalidate_schools(
            std::slice::from_ref(&club.school),
            &["events", "positions", "clubs"],
        )
        .await;
    }
    Ok(Read::Done)
}

/// The handles due a read (last read before `due_before`, and not `failed` recently) in
/// reading order: never read first, newest club first, then the longest unread first.
fn reading_order(
    clubs: IndexMap<String, Vec<Club>>,
    read_at: &HashMap<String, f64>,
    due_before: f64,
    failed: &HashSet<String>,
) -> IndexMap<String, Vec<Club>> {
    let newest = |clubs: &[Club]| clubs.iter().map(|club| club.id).max().unwrap_or(0);
    let mut due: Vec<(String, Vec<Club>)> = clubs
        .into_iter()
        .filter(|(handle, _)| {
            read_at.get(handle).copied().unwrap_or(0.0) < due_before && !failed.contains(handle)
        })
        .collect();
    due.sort_by(
        |(a, a_clubs), (b, b_clubs)| match (read_at.get(a), read_at.get(b)) {
            (None, None) => newest(b_clubs).cmp(&newest(a_clubs)),
            (None, Some(_)) => std::cmp::Ordering::Less,
            (Some(_), None) => std::cmp::Ordering::Greater,
            (Some(a_read), Some(b_read)) => a_read.total_cmp(b_read),
        },
    );
    due.into_iter().collect()
}

/// By Instagram handle, the clubs still missing a logo or still named "@handle".
async fn clubs_needing_profile(pool: &PgPool) -> Result<IndexMap<String, Vec<Club>>> {
    let rows: Vec<(String, Club)> =
        sqlx::query_as::<_, (String, i32, String, Option<String>, String)>(
            "SELECT club.ig, club.id, club.club_name, club.logo_url, school.slug \
         FROM public.clubs AS club JOIN public.schools AS school ON school.id = club.school_id \
         WHERE club.ig IS NOT NULL AND (club.logo_url IS NULL OR club.club_name LIKE '@%') \
         ORDER BY club.id",
        )
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|(ig, id, club_name, logo_url, school)| {
            (
                ig,
                Club {
                    id,
                    club_name,
                    logo_url,
                    school,
                },
            )
        })
        .collect();
    let mut clubs: IndexMap<String, Vec<Club>> = IndexMap::new();
    for (ig, club) in rows {
        if let Some(handle) = normalize_handle(&ig) {
            clubs.entry(handle).or_default().push(club);
        }
    }
    Ok(clubs)
}

/// Whether an error is Instagram refusing a logged-out read.
pub fn is_blocked(error: &anyhow::Error) -> Option<&FetchBlocked> {
    error.downcast_ref::<FetchBlocked>()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn club(id: i32) -> Club {
        Club {
            id,
            club_name: format!("Club {id}"),
            logo_url: None,
            school: "uwaterloo".into(),
        }
    }

    #[test]
    fn handles_are_bare_usernames() {
        assert_eq!(
            normalize_handle(" @Jianyi.Dance "),
            Some("jianyi.dance".into())
        );
        assert_eq!(normalize_handle("not a handle"), None);
        assert_eq!(normalize_handle(""), None);
    }

    #[test]
    fn never_read_handles_go_first_newest_club_first_then_the_longest_unread() {
        let clubs: IndexMap<String, Vec<Club>> = [
            ("readlongago", vec![club(1)]),
            ("oldclub", vec![club(2)]),
            ("readrecently", vec![club(3)]),
            ("readearlier", vec![club(4)]),
            ("failed", vec![club(5)]),
            ("newclub", vec![club(6), club(0)]),
        ]
        .into_iter()
        .map(|(handle, clubs)| (handle.to_owned(), clubs))
        .collect();
        let read_at: HashMap<String, f64> = [
            ("readlongago", 10.0),
            ("readrecently", 500.0),
            ("readearlier", 20.0),
        ]
        .into_iter()
        .map(|(handle, at)| (handle.to_owned(), at))
        .collect();
        let failed = HashSet::from(["failed".to_owned()]);
        let order = reading_order(clubs, &read_at, 100.0, &failed);
        assert_eq!(
            order.keys().map(String::as_str).collect::<Vec<_>>(),
            ["newclub", "oldclub", "readlongago", "readearlier"]
        );
    }

    #[test]
    fn a_refused_read_goes_back_first_and_due_as_before() {
        let path = std::env::temp_dir().join(format!("club-logos-{}.json", std::process::id()));
        let mut logos = ClubLogos::new(path.clone());
        logos.read_at.insert("readbefore".into(), 5.0);
        logos.waiting.insert("other".into(), vec![club(9)]);
        for (handle, previous) in [("readbefore", Some(5.0)), ("never", None)] {
            logos.read_at.insert(handle.into(), 1000.0);
            logos
                .give_back(Taken {
                    handle: handle.into(),
                    clubs: vec![club(1)],
                    previous,
                })
                .unwrap();
            assert_eq!(logos.waiting.get_index(0).unwrap().0, handle);
            assert_eq!(logos.read_at.get(handle).copied(), previous);
        }
        assert_eq!(logos.waiting.len(), 3);
        assert!(logos.failed_at.is_empty());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_page_that_did_not_render_is_due_as_before_after_the_failed_retry_hours() {
        let path =
            std::env::temp_dir().join(format!("club-logos-failed-{}.json", std::process::id()));
        let mut logos = ClubLogos::new(path.clone());
        for (handle, previous) in [("readbefore", Some(5.0)), ("never", None)] {
            logos.read_at.insert(handle.into(), 1000.0);
            logos
                .retry_soon(Taken {
                    handle: handle.into(),
                    clubs: vec![club(1)],
                    previous,
                })
                .unwrap();
            assert_eq!(logos.read_at.get(handle).copied(), previous);
            assert!(logos.failed_at.contains_key(handle));
        }
        // Not back in line until the next list leaves out its failed handles.
        assert!(logos.waiting.is_empty());
        let saved: HashMap<String, f64> =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved, HashMap::from([("readbefore".to_owned(), 5.0)]));
        let _ = std::fs::remove_file(path);
    }
}
