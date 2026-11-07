//! `/outreach`: the unclaimed clubs the daily sweep (`jobs/find_outreach_leads.py`)
//! found emails for, served to the admin page. Each lead's claim email and
//! follow-up are written from `claim_email.md` and the club as the page reads
//! them, so the copy always matches the club's current page.

use std::collections::HashMap;
use std::sync::LazyLock;

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Serialize;
use sqlx::Row;
use sqlx::postgres::PgRow;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::AdminUser;
use crate::api::body::{Body, Extra, Input, Str, json_first, merge_issues};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::OUTREACH_LEAD_NOT_FOUND;
use crate::api::pagination::{Paginated, Pagination};
use crate::api::routes::qr::school_id;
use crate::api::validation::{Length, PathParams, QueryParams, Validator};
use crate::constants::MAX_SEARCH_QUERY_LENGTH;
use crate::controlbox::OUTREACH;
use crate::db::read_with_retry;
use crate::text::{python_strip, sanitize_postgrest_value};

const STATUSES: &[&str] = &[
    "new",
    "contacted",
    "replied",
    "claimed",
    "not_interested",
    "dismissed",
];
const SORTS: &[&str] = &["newest", "formality"];
const SCHOOL_PATTERN: &str = "^[a-z0-9-]{1,80}$";
static SCHOOL: LazyLock<Regex> = LazyLock::new(|| Regex::new(SCHOOL_PATTERN).expect("pattern"));
const MAX_NOTES_LENGTH: usize = 4000;

/// `claim_email.md`'s sections by heading: Subject, Body and Follow-up.
static TEMPLATE: LazyLock<HashMap<String, String>> =
    LazyLock::new(|| sections(include_str!("claim_email.md")));

/// Each `## Heading` and the text under it, stripped.
fn sections(markdown: &str) -> HashMap<String, String> {
    let heading = Regex::new(r"(?m)^## (.+)$").expect("heading pattern");
    let headings: Vec<_> = heading.captures_iter(markdown).collect();
    headings
        .iter()
        .enumerate()
        .map(|(index, captures)| {
            let start = captures.get(0).expect("match").end();
            let end = headings
                .get(index + 1)
                .map_or(markdown.len(), |next| next.get(0).expect("match").start());
            (
                captures[1].to_owned(),
                python_strip(&markdown[start..end]).to_owned(),
            )
        })
        .collect()
}

/// Fill each `{{key}}` in turn, as `str.replace` does one key after another.
fn fill(text: &str, values: &[(&str, &str)]) -> String {
    values.iter().fold(text.to_owned(), |text, (key, value)| {
        text.replace(&format!("{{{{{key}}}}}"), value)
    })
}

#[derive(ToSchema)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
enum LeadStatus {
    New,
    Contacted,
    Replied,
    Claimed,
    NotInterested,
    Dismissed,
}

#[derive(ToSchema)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
enum LeadSort {
    Newest,
    Formality,
}

#[derive(ToSchema)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
enum EmailFoundBy {
    ClubPage,
    Research,
}

#[derive(ToSchema)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
enum FormalitySignal {
    DirectoryPage,
    OwnWebsite,
    SchoolEmail,
    OwnDomainEmail,
    FreeEmail,
    ManyListings,
    SomeListings,
    FewListings,
    Instagram,
    FormalName,
    InformalAccount,
}

/// One unclaimed club, its email, and what to send it to claim its page.
#[derive(Debug, Serialize, ToSchema)]
pub struct OutreachLeadResponse {
    #[schema(value_type = Uuid)]
    pub id: String,
    pub club_id: i64,
    pub club_name: String,
    pub club_url: String,
    pub listings: i64,
    pub school_slug: String,
    pub school_name: String,
    pub email: String,
    pub email_source_url: String,
    #[schema(value_type = EmailFoundBy, inline)]
    pub email_found_by: String,
    pub email_subject: String,
    pub email_body: String,
    pub follow_up: String,
    #[schema(value_type = LeadStatus, inline)]
    pub status: String,
    pub notes: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub found_at: DateTime<Utc>,
    // How official the club looks, out of 100; null until the next sweep scores it.
    #[schema(required = true)]
    pub formality: Option<i64>,
    #[schema(value_type = Vec<FormalitySignal>, inline)]
    pub formality_signals: Vec<String>,
}

crate::paginated_schema!(
    PaginatedOutreachLeads,
    PaginatedResponse_OutreachLeadResponse_,
    OutreachLeadResponse
);

/// A lead's columns, `l` being the lead, `c` its club and `s` the club's school.
const COLUMNS: &str = "l.id::text AS id, l.club_id, c.club_name::text AS club_name, \
     s.slug::text AS school_slug, s.name::text AS school_name, l.email, l.email_source_url, \
     l.email_found_by, l.status, l.notes, l.found_at, l.formality, l.formality_signals";
const CLUB_AND_SCHOOL: &str =
    "JOIN public.clubs c ON c.id = l.club_id LEFT JOIN public.schools s ON s.id = c.school_id";

/// A lead row before its listings are counted.
struct LeadRow {
    id: String,
    club_id: i32,
    club_name: String,
    school_slug: String,
    school_name: String,
    email: String,
    email_source_url: String,
    email_found_by: String,
    status: String,
    notes: String,
    found_at: DateTime<Utc>,
    formality: Option<i16>,
    formality_signals: Vec<String>,
}

impl LeadRow {
    fn from_row(row: &PgRow) -> Result<Self, ApiError> {
        let id: String = row.try_get("id")?;
        let school = |column: &str| -> Result<String, ApiError> {
            row.try_get::<Option<String>, _>(column)?.ok_or_else(|| {
                ApiError::Internal(anyhow::anyhow!("outreach lead {id} has no school"))
            })
        };
        Ok(Self {
            club_id: row.try_get("club_id")?,
            club_name: row.try_get("club_name")?,
            school_slug: school("school_slug")?,
            school_name: school("school_name")?,
            email: row.try_get("email")?,
            email_source_url: row.try_get("email_source_url")?,
            email_found_by: row.try_get("email_found_by")?,
            status: row.try_get("status")?,
            notes: row.try_get("notes")?,
            found_at: row.try_get("found_at")?,
            formality: row.try_get("formality")?,
            formality_signals: row.try_get("formality_signals")?,
            id,
        })
    }

    /// The lead as the page shows it, with its claim email written out.
    fn into_response(self, listings: i64) -> OutreachLeadResponse {
        let club_url = OUTREACH
            .club_url_template
            .replace("{school}", &self.school_slug)
            .replace("{club_id}", &self.club_id.to_string());
        let values = [
            ("club_name", self.club_name.as_str()),
            ("school_name", self.school_name.as_str()),
            ("club_url", club_url.as_str()),
            ("sender_name", OUTREACH.sender_name.as_str()),
        ];
        let section = |heading: &str| fill(&TEMPLATE[heading], &values);
        let (email_subject, email_body, follow_up) =
            (section("Subject"), section("Body"), section("Follow-up"));
        OutreachLeadResponse {
            id: self.id,
            club_id: self.club_id.into(),
            club_name: self.club_name,
            club_url,
            listings,
            school_slug: self.school_slug,
            school_name: self.school_name,
            email: self.email,
            email_source_url: self.email_source_url,
            email_found_by: self.email_found_by,
            email_subject,
            email_body,
            follow_up,
            status: self.status,
            notes: self.notes,
            found_at: self.found_at,
            formality: self.formality.map(i64::from),
            formality_signals: self.formality_signals,
        }
    }
}

/// The leads with each club's listings (events hosted or cohosted, and positions).
async fn with_listings(
    db: &sqlx::PgPool,
    leads: Vec<LeadRow>,
) -> Result<Vec<OutreachLeadResponse>, ApiError> {
    let club_ids: Vec<i32> = leads.iter().map(|lead| lead.club_id).collect();
    let counts: HashMap<i32, i64> = if club_ids.is_empty() {
        HashMap::new()
    } else {
        read_with_retry(|| {
            sqlx::query_as::<_, (i32, i64)>(
                "SELECT club_id, listings FROM public.club_listing_counts($1)",
            )
            .bind(&club_ids)
            .fetch_all(db)
        })
        .await?
        .into_iter()
        .collect()
    };
    Ok(leads
        .into_iter()
        .map(|lead| {
            let listings = counts.get(&lead.club_id).copied().unwrap_or(0);
            lead.into_response(listings)
        })
        .collect())
}

#[utoipa::path(
    get,
    path = "/outreach/leads/",
    tag = "outreach",
    operation_id = "list_leads_outreach_leads__get",
    summary = "List Leads",
    params(
        ("sort" = inline(Option<LeadSort>), Query),
        ("lead_status" = inline(Option<LeadStatus>), Query, nullable),
        ("school" = Option<String>, Query, nullable, pattern = "^[a-z0-9-]{1,80}$"),
        ("search" = Option<String>, Query, nullable, max_length = 200),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedOutreachLeads),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_leads(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<OutreachLeadResponse>>, ApiError> {
    let mut check = Validator::default();
    // FastAPI reports the pagination dependency's problems first.
    let pagination = Pagination::read(&mut check, &query);
    let sort = check.query(&query, "sort").choice_or("newest", SORTS);
    let status = check.query(&query, "lead_status").optional_choice(STATUSES);
    let school =
        check
            .query(&query, "school")
            .optional_pattern(Length::default(), SCHOOL_PATTERN, &SCHOOL);
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    check.finish()?;
    let school_id = match school {
        Some(school) => match school_id(&state.db, &school).await? {
            Some(id) => Some(id),
            // An unknown school has no leads.
            None => return Ok(Json(Paginated::new(Vec::new(), 0, pagination))),
        },
        None => None,
    };
    // The sanitized term never keeps an "@", so Python's email search never
    // ran: every search matches club names.
    let term = search
        .as_deref()
        .map(python_strip)
        .filter(|search| !search.is_empty())
        .map(sanitize_postgrest_value);
    let order = if sort == "formality" {
        "m.formality DESC NULLS LAST, m.found_at DESC, m.id ASC"
    } else {
        "m.found_at DESC, m.id ASC"
    };
    let sql = format!(
        "WITH matched AS ( \
             SELECT l.id, l.found_at, l.formality FROM public.outreach_leads l \
             JOIN public.clubs c ON c.id = l.club_id \
             WHERE l.email IS NOT NULL \
               AND ($3::text IS NULL OR l.status = $3) \
               AND ($4::int IS NULL OR c.school_id = $4) \
               AND ($5::text IS NULL OR c.club_name ILIKE '%' || $5 || '%')), \
         page AS ( \
             SELECT row_number() OVER (ORDER BY {order}) AS position, {COLUMNS} \
             FROM matched m JOIN public.outreach_leads l ON l.id = m.id {CLUB_AND_SCHOOL} \
             ORDER BY {order} LIMIT $1 OFFSET $2) \
         SELECT (SELECT count(*) FROM matched) AS total, page.* \
         FROM (SELECT 1) AS one LEFT JOIN page ON true \
         ORDER BY page.position"
    );
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(&status)
            .bind(school_id)
            .bind(&term)
            .fetch_all(&state.db)
    })
    .await?;
    let mut total = 0;
    let mut leads = Vec::new();
    for row in rows {
        total = row.try_get::<i64, _>("total")?;
        if row.try_get::<Option<String>, _>("id")?.is_some() {
            leads.push(LeadRow::from_row(&row)?);
        }
    }
    Ok(Json(Paginated::new(
        with_listings(&state.db, leads).await?,
        total,
        pagination,
    )))
}

#[allow(dead_code)]
#[derive(ToSchema)]
#[schema(as = OutreachLeadUpdate)]
pub struct OutreachLeadUpdate {
    #[schema(value_type = Option<LeadStatus>, inline, nullable)]
    status: Option<String>,
    #[schema(max_length = 4000, nullable)]
    notes: Option<String>,
}

/// A validated `OutreachLeadUpdate`; `None` (missing or null) keeps the column.
struct LeadChanges {
    status: Option<String>,
    notes: Option<String>,
}

fn read_changes(mut body: Body) -> Result<LeadChanges, ApiError> {
    let status = body.string("status", &Str::new().one_of(STATUSES));
    let notes = body.string("notes", &Str::new().max(MAX_NOTES_LENGTH));
    body.finish()?;
    Ok(LeadChanges {
        status: Input::value(status),
        notes: Input::value(notes),
    })
}

#[utoipa::path(
    patch,
    path = "/outreach/leads/{lead_id}",
    tag = "outreach",
    operation_id = "update_lead_outreach_leads__lead_id__patch",
    summary = "Update Lead",
    params(("lead_id" = Uuid, Path)),
    request_body = OutreachLeadUpdate,
    responses(
        (status = 200, description = "Successful Response", body = OutreachLeadResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn update_lead(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<OutreachLeadResponse>, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    AdminUser::from_request_parts(&mut parts, &state).await?;
    let path = PathParams::from_request_parts(&mut parts, &state).await?;
    let mut check = Validator::default();
    let id = check.path(&path, "lead_id").uuid();
    let changes = merge_issues(
        check,
        Body::parse(&bytes, &parts.headers, Extra::Forbid).and_then(read_changes),
    )?;
    Ok(Json(update(&state.db, id, changes).await?))
}

/// `exclude_none` changes, then the lead as it now stands (only leads with an email).
async fn update(
    db: &sqlx::PgPool,
    id: Uuid,
    changes: LeadChanges,
) -> Result<OutreachLeadResponse, ApiError> {
    if changes.status.is_some() || changes.notes.is_some() {
        let updated = sqlx::query(
            "UPDATE public.outreach_leads SET status = coalesce($2, status), \
             notes = coalesce($3, notes) WHERE id = $1",
        )
        .bind(id)
        .bind(&changes.status)
        .bind(&changes.notes)
        .execute(db)
        .await?;
        if updated.rows_affected() == 0 {
            return Err(ApiError::not_found(OUTREACH_LEAD_NOT_FOUND));
        }
    }
    let sql = format!(
        "SELECT {COLUMNS} FROM public.outreach_leads l {CLUB_AND_SCHOOL} \
         WHERE l.id = $1 AND l.email IS NOT NULL"
    );
    let row = read_with_retry(|| sqlx::query(&sql).bind(id).fetch_optional(db))
        .await?
        .ok_or_else(|| ApiError::not_found(OUTREACH_LEAD_NOT_FOUND))?;
    let lead = LeadRow::from_row(&row)?;
    Ok(with_listings(db, vec![lead]).await?.remove(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn lead() -> LeadRow {
        LeadRow {
            id: "99999999-9999-4999-8999-999999999992".into(),
            club_id: 10,
            club_name: "Board Games Club".into(),
            school_slug: "uwaterloo".into(),
            school_name: "University of Waterloo".into(),
            email: "boardgames@example.com".into(),
            email_source_url: "https://example.com/clubs/board-games".into(),
            email_found_by: "club_page".into(),
            status: "new".into(),
            notes: String::new(),
            found_at: DateTime::parse_from_rfc3339("2026-10-28T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            formality: Some(72),
            formality_signals: vec!["directory_page".into(), "many_listings".into()],
        }
    }

    #[test]
    fn a_lead_invites_the_club_to_claim_the_page_we_made_for_it() {
        // tests/services/outreach/test_service.py
        let lead = lead().into_response(4);
        assert_eq!(lead.club_url, "https://uwaterloo.wat2do.io/clubs/10");
        assert_eq!(lead.listings, 4);
        assert!(lead.email_subject.contains("Board Games Club"));
        for text in [&lead.email_body, &lead.follow_up] {
            assert!(text.contains(&lead.club_url));
            assert!(text.contains("Claim club"));
            assert!(text.contains("University of Waterloo"));
            assert!(text.contains(&OUTREACH.sender_name));
            assert!(!text.contains("{{") && !text.contains('\u{2014}'));
        }
        assert!(
            lead.email_body
                .contains("made a page for you and added your events")
        );
        assert_eq!(
            lead.email_subject,
            "Board Games Club is on Wat2Do: your page is ready to claim"
        );
        assert!(lead.email_body.starts_with("Hi Board Games Club team,\n\n"));
        assert!(
            lead.follow_up
                .ends_with(&format!("\n\n{}", OUTREACH.sender_name))
        );
    }

    #[test]
    fn template_values_are_filled_one_after_another() {
        // Python's chained str.replace: a club name naming a later key is filled too.
        assert_eq!(
            fill(
                "{{club_name}} at {{school_name}}",
                &[("club_name", "{{school_name}}"), ("school_name", "UW")]
            ),
            "UW at UW"
        );
    }

    #[test]
    fn response_fields_follow_the_model_order() {
        let value: Value = serde_json::to_value(lead().into_response(4)).unwrap();
        let keys: Vec<&String> = value.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            [
                "id",
                "club_id",
                "club_name",
                "club_url",
                "listings",
                "school_slug",
                "school_name",
                "email",
                "email_source_url",
                "email_found_by",
                "email_subject",
                "email_body",
                "follow_up",
                "status",
                "notes",
                "found_at",
                "formality",
                "formality_signals"
            ]
        );
        assert_eq!(value["found_at"], "2026-10-28T00:00:00Z");
        assert_eq!(value["formality"], 72);
    }

    fn changes(value: Value) -> Result<LeadChanges, ApiError> {
        read_changes(Body::from_value(value, Extra::Forbid))
    }

    #[test]
    fn updates_take_a_known_status_and_short_notes_only() {
        let both = changes(json!({"status": "claimed", "notes": "Sent"})).unwrap();
        assert_eq!(both.status.as_deref(), Some("claimed"));
        assert_eq!(both.notes.as_deref(), Some("Sent"));
        let nulls = changes(json!({"status": null, "notes": null})).unwrap();
        assert!(nulls.status.is_none() && nulls.notes.is_none());
        for body in [
            json!({"status": "sold"}),
            json!({"notes": "x".repeat(4001)}),
            json!({"notes": 5}),
            json!({"owner": "me"}),
        ] {
            assert!(
                matches!(changes(body.clone()), Err(ApiError::RequestValidation(ref issues)) if issues.len() == 1),
                "{body}"
            );
        }
    }
}
