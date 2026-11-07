//! The admin's song list (`services/instagram_publishing/music.py`): songs
//! typed loosely, which the Mac's emulator worker tries on each published
//! carousel. The worker reads the list in Python; the API keeps it.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::{INSTAGRAM_SONG_EXISTS, INSTAGRAM_SONG_NOT_FOUND};
use crate::db::read_with_retry;
use crate::text::{casefold, python_space};

/// `InstagramSongResponse`.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Song {
    pub id: Uuid,
    pub query: String,
    pub asian_campuses_only: bool,
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
}

const COLUMNS: &str = "id, query, asian_campuses_only, created_at";

/// `list_songs`: newest first.
pub async fn list(db: &PgPool) -> Result<Vec<Song>, ApiError> {
    let sql = format!("SELECT {COLUMNS} FROM public.instagram_songs ORDER BY created_at DESC");
    Ok(read_with_retry(|| sqlx::query_as(&sql).fetch_all(db)).await?)
}

/// `" ".join(query.split())`.
fn normalize(query: &str) -> String {
    query
        .split(python_space)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `add_song`: a song is on the list once, however it is capitalized.
pub async fn add(db: &PgPool, query: &str, asian_campuses_only: bool) -> Result<Song, ApiError> {
    let query = normalize(query);
    let folded = casefold(&query);
    if list(db)
        .await?
        .iter()
        .any(|song| casefold(&song.query) == folded)
    {
        return Err(ApiError::conflict(INSTAGRAM_SONG_EXISTS));
    }
    Ok(sqlx::query_as(&format!(
        "INSERT INTO public.instagram_songs (query, asian_campuses_only) VALUES ($1, $2) \
         RETURNING {COLUMNS}"
    ))
    .bind(&query)
    .bind(asian_campuses_only)
    .fetch_one(db)
    .await?)
}

/// `delete_song`.
pub async fn delete(db: &PgPool, song_id: Uuid) -> Result<(), ApiError> {
    let deleted: Option<Uuid> =
        sqlx::query_scalar("DELETE FROM public.instagram_songs WHERE id = $1 RETURNING id")
            .bind(song_id)
            .fetch_optional(db)
            .await?;
    deleted
        .map(|_| ())
        .ok_or_else(|| ApiError::not_found(INSTAGRAM_SONG_NOT_FOUND))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn songs_are_stored_with_single_spaces() {
        // test_add_song_normalizes_whitespace
        assert_eq!(
            normalize("  the weeknd \t after\nhours "),
            "the weeknd after hours"
        );
        assert_eq!(normalize("\u{a0}Ditto\u{1f}NewJeans"), "Ditto NewJeans");
    }
}
