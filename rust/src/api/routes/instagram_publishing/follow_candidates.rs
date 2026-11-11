//! Accounts a school account might follow, and the admin's decisions about
//! them (`services/instagram_follow/candidates.py`).
//!
//! Approving creates the school's club for the handle unless one exists,
//! so the account is listed before it is even followed. The scorer's own
//! decisions and the follows themselves stay in the Python worker.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::api::errors::ApiError;
use crate::api::events::store;
use crate::api::json;
use crate::api::messages::FOLLOW_CANDIDATE_SCHOOL_NOT_FOUND;
use crate::api::pagination::Pagination;
use crate::constants::{CLUB_TYPE_INDEPENDENT, MAX_CLUB_NAME_LENGTH};
use crate::db::read_with_retry;
use crate::revalidation::revalidate_schools;
use crate::text::{casefold, python_strip};

pub const APPROVED: &str = "approved";
pub const REJECTED: &str = "rejected";
/// `FollowCandidateStatus`.
pub const STATUSES: &[&str] = &["pending", APPROVED, REJECTED, "followed", "unfollow"];
/// `FollowCandidateDecisionStatus`.
pub const DECISIONS: &[&str] = &[APPROVED, REJECTED];

/// `FollowCandidateResponse`.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Candidate {
    pub id: Uuid,
    pub school: String,
    pub handle: String,
    pub name: Option<String>,
    pub source: String,
    pub found_via: Vec<String>,
    pub status: String,
    pub read_status: Option<String>,
    pub followers_count: Option<i32>,
    pub is_private: Option<bool>,
    #[serde(serialize_with = "json::option_datetime")]
    pub last_posted_at: Option<DateTime<Utc>>,
    pub score: Option<i16>,
    pub verdict: Option<String>,
    pub reason: Option<String>,
    pub follow_error: Option<String>,
    #[serde(skip)]
    pub school_id: i32,
    /// The school's club the row was found for, when it had no account yet.
    #[serde(skip)]
    pub club_id: Option<i32>,
}

const COLUMNS: &str = "c.id, s.slug AS school, c.handle, c.name, c.source, c.found_via, c.status, \
     c.read_status, c.followers_count, c.is_private, c.last_posted_at, c.score, c.verdict, \
     c.reason, c.follow_error, c.school_id, c.club_id";

/// `list_candidates`: best scores first.
pub async fn list(
    db: &PgPool,
    school: Option<&str>,
    status: &str,
    pagination: Pagination,
) -> Result<(Vec<Candidate>, i64), ApiError> {
    let school_id = match school.filter(|school| !school.is_empty()) {
        Some(school) => Some(
            store::school_id(db, school)
                .await?
                .ok_or_else(|| ApiError::not_found(FOLLOW_CANDIDATE_SCHOOL_NOT_FOUND))?,
        ),
        None => None,
    };
    const FILTER: &str = "c.status = $1 AND ($2::int8 IS NULL OR c.school_id = $2)";
    let count = format!("SELECT count(*) FROM public.instagram_follow_candidates c WHERE {FILTER}");
    let total: i64 = read_with_retry(|| {
        sqlx::query_scalar(&count)
            .bind(status)
            .bind(school_id)
            .fetch_one(db)
    })
    .await?;
    let sql = format!(
        "SELECT {COLUMNS} FROM public.instagram_follow_candidates c \
         JOIN public.schools s ON s.id = c.school_id WHERE {FILTER} \
         ORDER BY c.score DESC NULLS LAST, c.handle LIMIT $3 OFFSET $4"
    );
    let rows: Vec<Candidate> = read_with_retry(|| {
        sqlx::query_as(&sql)
            .bind(status)
            .bind(school_id)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .fetch_all(db)
    })
    .await?;
    let total = if total > 0 { total } else { rows.len() as i64 };
    Ok((rows, total))
}

/// `FollowCandidateDecisionsResponse`.
#[derive(Debug, Default, Serialize, PartialEq)]
pub struct DecisionCounts {
    pub approved: i64,
    pub rejected: i64,
}

/// A handle as clubs store it, compared casefolded (`lookup_club_by_school_and_ig`).
fn handle_key(handle: &str) -> String {
    casefold(python_strip(handle).trim_start_matches('@'))
}

/// `_club_for`: the club the row was found for (given the account when it has
/// none), else the school's one club with this handle, else a new approved club.
async fn club_for(db: &PgPool, candidate: &Candidate) -> Result<i32, ApiError> {
    if let Some(club_id) = candidate.club_id {
        let linked: Option<(i32, bool)> = sqlx::query_as(
            "WITH linked AS (SELECT id FROM public.clubs WHERE id = $1 AND school_id = $2), \
                  filled AS ( \
                      UPDATE public.clubs SET ig = $3 \
                      WHERE id IN (SELECT id FROM linked) AND coalesce(btrim(ig), '') = '' \
                      RETURNING id) \
             SELECT id, EXISTS (SELECT 1 FROM filled) FROM linked",
        )
        .bind(club_id)
        .bind(candidate.school_id)
        .bind(&candidate.handle)
        .fetch_optional(db)
        .await?;
        if let Some((id, filled)) = linked {
            if filled {
                // The account shows on the club's events and positions too.
                revalidate_schools(
                    std::slice::from_ref(&candidate.school),
                    &["events", "positions", "clubs"],
                )
                .await;
            }
            return Ok(id);
        }
    }
    let clubs: Vec<(i32, Option<String>)> = read_with_retry(|| {
        sqlx::query_as("SELECT id, ig FROM public.clubs WHERE school_id = $1 ORDER BY id")
            .bind(candidate.school_id)
            .fetch_all(db)
    })
    .await?;
    let target = handle_key(&candidate.handle);
    let matches: Vec<i32> = clubs
        .into_iter()
        .filter(|(_, ig)| handle_key(ig.as_deref().unwrap_or_default()) == target)
        .map(|(id, _)| id)
        .collect();
    if let [id] = matches.as_slice() {
        return Ok(*id);
    }
    // `ClubCreate`: the account's name (else its handle), stripped and non-blank.
    let name = candidate
        .name
        .as_deref()
        .filter(|name| !name.is_empty())
        .unwrap_or(&candidate.handle);
    let name = python_strip(name);
    if name.is_empty() || name.chars().count() > MAX_CLUB_NAME_LENGTH {
        return Err(ApiError::Internal(anyhow::anyhow!(
            "follow candidate {} has no usable club name",
            candidate.id
        )));
    }
    let id: i32 = sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, ig, club_type, school_id, created_by, submitted, status) \
         VALUES ($1, $2, $3, $4, NULL, true, 'approved') RETURNING id",
    )
    .bind(name)
    .bind(&candidate.handle)
    .bind(CLUB_TYPE_INDEPENDENT)
    .bind(candidate.school_id)
    .fetch_one(db)
    .await?;
    revalidate_schools(std::slice::from_ref(&candidate.school), &["clubs"]).await;
    Ok(id)
}

/// `decide`: apply an admin's staged approvals and rejections to accounts
/// still pending; a decision about any other account is skipped.
pub async fn decide(
    db: &PgPool,
    decisions: &[(Uuid, String)],
    decided_by: Uuid,
) -> Result<DecisionCounts, ApiError> {
    let ids: Vec<Uuid> = decisions.iter().map(|(id, _)| *id).collect();
    let sql = format!(
        "SELECT {COLUMNS} FROM public.instagram_follow_candidates c \
         JOIN public.schools s ON s.id = c.school_id WHERE c.id = ANY($1) AND c.status = 'pending'"
    );
    let pending: Vec<Candidate> =
        read_with_retry(|| sqlx::query_as(&sql).bind(&ids).fetch_all(db)).await?;
    let now = Utc::now();
    let mut counts = DecisionCounts::default();
    for (id, status) in decisions {
        let Some(candidate) = pending.iter().find(|candidate| candidate.id == *id) else {
            continue;
        };
        let club_id = if status == APPROVED {
            Some(club_for(db, candidate).await?)
        } else {
            None
        };
        sqlx::query(
            "UPDATE public.instagram_follow_candidates SET status = $2, decided_by = $3, \
             decided_at = $4, updated_at = $4, club_id = COALESCE($5, club_id) WHERE id = $1",
        )
        .bind(candidate.id)
        .bind(status)
        .bind(decided_by)
        .bind(now)
        .bind(club_id)
        .execute(db)
        .await?;
        if status == APPROVED {
            counts.approved += 1;
        } else {
            counts.rejected += 1;
        }
    }
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_match_clubs_however_they_were_typed() {
        assert_eq!(handle_key(" @UTMahjong "), "utmahjong");
        assert_eq!(handle_key("utmahjong"), handle_key("@UTMAHJONG"));
        assert_eq!(handle_key(""), "");
    }

    #[test]
    fn candidates_serialize_in_the_response_model_order() {
        // test_admin_pages_through_pending_candidates_of_a_school
        let candidate = Candidate {
            id: Uuid::from_u128(1),
            school: "utsg".into(),
            handle: "utmaclub".into(),
            name: Some("UTMAC".into()),
            source: "crawl".into(),
            found_via: vec!["rocsaut".into()],
            status: "pending".into(),
            read_status: Some("ok".into()),
            followers_count: Some(436),
            is_private: None,
            last_posted_at: None,
            score: Some(82),
            verdict: Some("approve".into()),
            reason: Some("Weekly mahjong nights".into()),
            follow_error: None,
            school_id: 7,
            club_id: Some(3),
        };
        assert_eq!(
            serde_json::to_string(&candidate).unwrap(),
            r#"{"id":"00000000-0000-0000-0000-000000000001","school":"utsg","handle":"utmaclub","name":"UTMAC","source":"crawl","found_via":["rocsaut"],"status":"pending","read_status":"ok","followers_count":436,"is_private":null,"last_posted_at":null,"score":82,"verdict":"approve","reason":"Weekly mahjong nights","follow_error":null}"#
        );
    }
}
