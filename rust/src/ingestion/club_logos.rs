//! Club logos and names from the public Instagram profiles of clubs that still
//! need them (`services/ingestion/club_logos.py`).
//!
//! One handle is read at a time, `club_logo_read_delay_seconds` apart, to fill a
//! missing logo and to replace a placeholder "@handle" name with the real one.
//! A handle is read again only after `club_logo_retry_days`. Instagram's picture
//! links expire, so each one is copied to S3 right away.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use indexmap::IndexMap;
use regex::Regex;
use sqlx::PgPool;

use super::fetch::{FetchBlocked, fetch_profile};
use crate::constants::{BUCKET_CLUB_LOGOS, MAX_CLUB_NAME_LENGTH};
use crate::controlbox::INGESTION;
use crate::images::fetch_image;
use crate::revalidation::revalidate_schools;
use crate::storage::store_image;

static HANDLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9._]{1,30}$").expect("valid regex"));

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

pub struct ClubLogos {
    state_path: PathBuf,
    read_at: HashMap<String, f64>,
    waiting: IndexMap<String, Vec<Club>>,
    listed_at: Option<Instant>,
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
        }
    }

    /// Read one handle's profile; false when none is due.
    pub async fn fill_next(&mut self, pool: &PgPool) -> Result<bool> {
        let Some(handle) = self.next_handle(pool).await? else {
            return Ok(false);
        };
        let clubs = self.waiting.shift_remove(&handle).unwrap_or_default();
        // Recorded before the read, so a refused or failing handle still waits its turn.
        self.read_at.insert(handle.clone(), epoch_seconds());
        self.save()?;
        let profile = fetch_profile(&handle).await.map_err(anyhow::Error::new)?;
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
        for club in &clubs {
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
        Ok(true)
    }

    async fn next_handle(&mut self, pool: &PgPool) -> Result<Option<String>> {
        let backoff = Duration::from_secs(INGESTION.retry_backoff_seconds);
        if self.waiting.is_empty()
            && self
                .listed_at
                .is_none_or(|listed| listed.elapsed() >= backoff)
        {
            self.listed_at = Some(Instant::now());
            let retry_after = epoch_seconds() - (INGESTION.club_logo_retry_days * 86400) as f64;
            self.waiting = clubs_needing_profile(pool)
                .await?
                .into_iter()
                .filter(|(handle, _)| {
                    self.read_at.get(handle).copied().unwrap_or(0.0) < retry_after
                })
                .collect();
        }
        Ok(self.waiting.keys().next().cloned())
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
    use super::normalize_handle;

    #[test]
    fn handles_are_bare_usernames() {
        assert_eq!(
            normalize_handle(" @Jianyi.Dance "),
            Some("jianyi.dance".into())
        );
        assert_eq!(normalize_handle("not a handle"), None);
        assert_eq!(normalize_handle(""), None);
    }
}
