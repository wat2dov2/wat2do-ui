//! `/events`: the public feed and detail, card stats, the admin list and
//! event writes (`routers/events.py`).

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use indexmap::IndexMap;
use serde::Serialize;

use crate::api::AppState;
use crate::api::auth::{AdminUser, DbUser};
use crate::api::body::{Body, Extra, json_first, merge_issues};
use crate::api::cache_control;
use crate::api::errors::ApiError;
use crate::api::events::store::{self, DateWindow, LatestAdded, ScanFilters};
use crate::api::events::{feed, requests, writes};
use crate::api::messages::EVENT_NOT_FOUND;
use crate::api::pagination::{Paginated, Pagination};
use crate::api::tickets::refunds;
use crate::api::validation::{FloatLimits, Length, PathParams, PyInt, QueryParams, Validator};

use crate::constants::{MAX_EVENT_PRICE, MAX_LIST_LIMIT, MAX_SEARCH_QUERY_LENGTH};
use crate::controlbox::API_CACHE;

/// The `school` filter's length bound (`MAX_EVENT_SCHOOL_LENGTH`).
const MAX_EVENT_SCHOOL_LENGTH: usize = 255;
const SORT_BY: [&str; 5] = ["date", "title", "location", "price", "added_at"];
const SORT_ORDER: [&str; 2] = ["asc", "desc"];

/// `EventFeedResponse`.
#[derive(Serialize)]
struct FeedResponse<'a> {
    #[serde(flatten)]
    page: Paginated<crate::api::events::model::EventSummaryResponse<'a>>,
    latest_added_event: Option<LatestAdded>,
}

/// `EventStatsResponse`.
#[derive(Serialize)]
struct StatsResponse {
    click_count: i64,
    going_count: i64,
}

/// A path's `{event_id}`: any Python int (huge ones fail in Postgres).
fn event_id(check: &mut Validator, path: &PathParams) -> PyInt {
    check.path(path, "event_id").unbounded_int()
}

#[utoipa::path(
    get,
    path = "/events/admin",
    tag = "events",
    operation_id = "list_admin_events_events_admin_get",
    summary = "List Admin Events"
)]
pub async fn list_admin_events(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    let category = check
        .query(&query, "category")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_EVENT_SCHOOL_LENGTH));
    check.finish()?;
    let (events, total) = store::admin_page(
        &state.db,
        "events",
        pagination,
        search.as_deref(),
        school.as_deref(),
        None,
        category.as_deref(),
    )
    .await?;
    let items = events.iter().map(|event| event.summary()).collect();
    Ok(Json(Paginated::new(items, total, pagination)).into_response())
}

#[utoipa::path(
    get,
    path = "/events/stats",
    tag = "events",
    operation_id = "get_event_stats_events_stats_get",
    summary = "Get Event Stats"
)]
pub async fn get_event_stats(
    State(state): State<AppState>,
    query: QueryParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let school = check
        .query(&query, "school")
        .string(Length::default().min(1).max(MAX_EVENT_SCHOOL_LENGTH));
    check.finish()?;
    let mut stats: IndexMap<String, StatsResponse> = IndexMap::new();
    let mut complete = true;
    let since = store::today_start_utc(
        &store::school_timezone(&state.db, Some(&school)).await?,
        Utc::now(),
    )?;
    if let Some(school_id) = store::school_id(&state.db, &school).await? {
        let read = store::event_stats(&state.db, since, school_id, MAX_LIST_LIMIT).await?;
        complete = read.complete;
        for (id, click_count, going_count) in read.counts {
            if click_count > 0 || going_count > 0 {
                stats.insert(
                    id.to_string(),
                    StatsResponse {
                        click_count,
                        going_count,
                    },
                );
            }
        }
    }
    Ok(stats_response(stats, complete))
}

/// A school's counts are the same for every visitor, signed in or not, so any
/// cache may keep them; never when a count could not be read and shows as zero.
fn stats_response(stats: IndexMap<String, StatsResponse>, complete: bool) -> Response {
    if complete {
        cache_control::shared(Json(stats), &API_CACHE.event_stats)
    } else {
        Json(stats).into_response()
    }
}

/// The feed's query parameters, in `list_events`' order.
struct FeedQuery {
    pagination: Pagination,
    school: Option<String>,
    search: Option<String>,
    categories: Option<Vec<String>>,
    locations: Option<Vec<String>>,
    foods: Option<Vec<String>>,
    days: Option<Vec<String>>,
    min_price: Option<f64>,
    max_price: Option<f64>,
    registration: Option<bool>,
    clubs: Option<Vec<String>>,
    club_ids: Option<Vec<PyInt>>,
    has_food: bool,
    added_within_24h: bool,
    ids: Option<Vec<PyInt>>,
    sort_by: String,
    sort_order: String,
    start_utc: Option<chrono::DateTime<Utc>>,
    end_utc: Option<chrono::DateTime<Utc>>,
    include_past: bool,
}

impl FeedQuery {
    fn read(query: &QueryParams) -> Result<Self, ApiError> {
        let mut check = Validator::default();
        let price = FloatLimits::default().ge(0.0).le(MAX_EVENT_PRICE);
        let parsed = Self {
            pagination: Pagination::read(&mut check, query),
            school: check
                .query(query, "school")
                .optional_string(Length::default().max(MAX_EVENT_SCHOOL_LENGTH)),
            search: check
                .query(query, "search")
                .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH)),
            categories: check.query_list(query, "categories").strings(),
            locations: check.query_list(query, "locations").strings(),
            foods: check.query_list(query, "foods").strings(),
            days: check.query_list(query, "days").strings(),
            min_price: check.query(query, "min_price").optional_float(price),
            max_price: check.query(query, "max_price").optional_float(price),
            registration: check.query(query, "registration").optional_bool(),
            clubs: check.query_list(query, "clubs").strings(),
            club_ids: check.query_list(query, "club_ids").ints(),
            has_food: check.query(query, "has_food").bool_or(false),
            added_within_24h: check.query(query, "added_within_24h").bool_or(false),
            ids: check.query_list(query, "ids").ints(),
            sort_by: check.query(query, "sort_by").choice_or("date", &SORT_BY),
            sort_order: check
                .query(query, "sort_order")
                .choice_or("asc", &SORT_ORDER),
            start_utc: check
                .query(query, "start_utc")
                .optional_datetime()
                .map(|value| value.to_utc()),
            end_utc: check
                .query(query, "end_utc")
                .optional_datetime()
                .map(|value| value.to_utc()),
            include_past: check.query(query, "include_past").bool_or(false),
        };
        check.finish()?;
        Ok(parsed)
    }

    /// `_can_use_lightweight_date_page`: the plain date-ordered feed.
    fn is_date_feed(&self) -> bool {
        let nonempty =
            |values: &Option<Vec<String>>| values.as_ref().is_some_and(|values| !values.is_empty());
        !self.added_within_24h
            && crate::text::python_strip(self.search.as_deref().unwrap_or_default()).is_empty()
            && !nonempty(&self.categories)
            && !nonempty(&self.locations)
            && !nonempty(&self.foods)
            && !nonempty(&self.days)
            && self.min_price.is_none()
            && self.max_price.is_none()
            && self.registration.is_none()
            && !nonempty(&self.clubs)
            && self.club_ids.as_ref().is_none_or(Vec::is_empty)
            && !self.has_food
            && self.ids.is_none()
            && self.sort_by == "date"
            && self.sort_order == "asc"
    }
}

#[utoipa::path(
    get,
    path = "/events/",
    tag = "events",
    operation_id = "list_events_events__get",
    summary = "List Events"
)]
pub async fn list_events(
    State(state): State<AppState>,
    query: QueryParams,
) -> Result<Response, ApiError> {
    let feed = FeedQuery::read(&query)?;
    let db = &state.db;
    let pagination = feed.pagination;
    let first_page = pagination.page == 1;
    let school = feed.school.as_deref().filter(|school| !school.is_empty());
    // `list_events`: an explicit start wins, then `include_past`, then today.
    let lower_bound = match (feed.start_utc, feed.include_past) {
        (Some(start), _) => Some(start),
        (None, true) => None,
        (None, false) => Some(store::today_start_utc(
            &store::school_timezone(db, school).await?,
            Utc::now(),
        )?),
    };
    let school_id = match school {
        Some(school) => match store::school_id(db, school).await? {
            Some(id) => Some(id),
            // An unknown school has no events and no newest event.
            None => return Ok(Json(empty_feed(pagination)).into_response()),
        },
        None => None,
    };
    let window = DateWindow {
        start_utc: lower_bound,
        end_utc: feed.end_utc,
        school_id,
    };
    let (events, total, latest) = if feed.is_date_feed() {
        let page = store::date_page(
            db,
            &window,
            pagination.offset(),
            pagination.page_size,
            MAX_LIST_LIMIT,
            first_page,
        )
        .await?;
        (page.events, page.total, page.latest)
    } else {
        filtered_feed(db, &feed, window, first_page).await?
    };
    let items = events.iter().map(|event| event.summary()).collect();
    Ok(Json(FeedResponse {
        page: Paginated::new(items, total, pagination),
        latest_added_event: latest,
    })
    .into_response())
}

fn empty_feed(pagination: Pagination) -> FeedResponse<'static> {
    FeedResponse {
        page: Paginated::new(Vec::new(), 0, pagination),
        latest_added_event: None,
    }
}

/// `load_events_page`'s filtered path: Postgres narrows and orders the first
/// 1000 occurrence rows; the text, food and day filters and the sort run here.
async fn filtered_feed(
    db: &sqlx::PgPool,
    feed: &FeedQuery,
    window: DateWindow,
    first_page: bool,
) -> Result<
    (
        Vec<crate::api::events::model::Event>,
        i64,
        Option<LatestAdded>,
    ),
    ApiError,
> {
    let school_id = window.school_id;
    // `_narrowed_event_ids`: each club must host or cohost the event; ids
    // Postgres cannot hold fail only when nothing else narrows them away.
    let club_ids: Vec<i64> = feed
        .club_ids
        .iter()
        .flatten()
        .map(|id| writes::int4(*id))
        .collect::<Result<_, _>>()?;
    let event_ids = match &feed.ids {
        None => None,
        Some(ids) if club_ids.is_empty() => Some(
            ids.iter()
                .map(|id| writes::int4(*id))
                .collect::<Result<Vec<_>, _>>()?,
        ),
        Some(ids) => Some(
            ids.iter()
                .filter_map(|id| match id {
                    PyInt::Small(id) if i32::try_from(*id).is_ok() => Some(*id),
                    _ => None,
                })
                .collect(),
        ),
    };
    let filters = ScanFilters {
        window,
        event_ids,
        club_ids,
        added_since: feed
            .added_within_24h
            .then(|| Utc::now() - chrono::Duration::hours(24)),
        categories: feed.categories.clone().unwrap_or_default(),
        club_terms: feed
            .clubs
            .iter()
            .flatten()
            .map(|club| crate::text::sanitize_postgrest_value(crate::text::python_strip(club)))
            .filter(|term| !term.is_empty())
            .collect(),
        registration: feed.registration,
        min_price: feed.min_price,
        max_price: feed.max_price,
    };
    let (rows, events) = store::scan(db, &filters).await?;
    let search = crate::text::sanitize_postgrest_value(feed.search.as_deref().unwrap_or_default());
    let candidates = feed::dedup(&rows, &events, MAX_LIST_LIMIT as usize);
    let mut candidates = feed::filter(
        candidates,
        &feed::Filters {
            search: &search,
            locations: feed.locations.as_deref().unwrap_or_default(),
            foods: feed.foods.as_deref().unwrap_or_default(),
            days: feed.days.as_deref().unwrap_or_default(),
            has_food: feed.has_food,
        },
    );
    feed::sort(&mut candidates, &feed.sort_by, feed.sort_order == "desc");
    let total = candidates.len() as i64;
    let page: Vec<i64> = candidates
        .iter()
        .skip(feed.pagination.offset() as usize)
        .take(feed.pagination.page_size as usize)
        .map(|candidate| candidate.event.id)
        .collect();
    if page.is_empty() && !first_page {
        return Ok((Vec::new(), total, None));
    }
    let (events, latest) = store::page_of(db, &page, first_page.then_some(school_id)).await?;
    Ok((events, total, latest))
}

#[utoipa::path(
    get,
    path = "/events/{event_id}",
    tag = "events",
    operation_id = "get_event_events__event_id__get",
    summary = "Get Event"
)]
pub async fn get_event(
    State(state): State<AppState>,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = event_id(&mut check, &path);
    check.finish()?;
    let event = store::event_by_id(&state.db, writes::int4(id)?)
        .await?
        .ok_or_else(|| ApiError::not_found(EVENT_NOT_FOUND))?;
    Ok(Json(event.public()).into_response())
}

#[utoipa::path(
    post,
    path = "/events/",
    tag = "events",
    operation_id = "create_event_events__post",
    summary = "Create Event"
)]
pub async fn create_event(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let DbUser(user) = DbUser::from_request_parts(&mut parts, &state).await?;
    let input = Body::parse(&bytes, &parts.headers, Extra::Forbid)
        .and_then(|body| requests::event(body, false))?;
    let club =
        writes::authorize_club(&state.db, input.club_id.unwrap_or(PyInt::Small(0)), &user).await?;
    let created = writes::create(&state.db, input, &club, &user.id.to_string()).await?;
    Ok((StatusCode::CREATED, Json(created.full())).into_response())
}

#[utoipa::path(
    patch,
    path = "/events/{event_id}",
    tag = "events",
    operation_id = "update_event_events__event_id__patch",
    summary = "Update Event"
)]
pub async fn update_event(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let DbUser(user) = DbUser::from_request_parts(&mut parts, &state).await?;
    let path = PathParams::from_request_parts(&mut parts, &state).await?;
    let mut check = Validator::default();
    let id = event_id(&mut check, &path);
    let parsed = Body::parse(&bytes, &parts.headers, Extra::Forbid)
        .and_then(|body| requests::event(body, true));
    let input = merge_issues(check, parsed)?;
    let existing = writes::authorized_event(&state.db, id, &user).await?;
    // Reassigning the club needs the same right to publish as creating.
    let new_club = match input.club_id {
        Some(club_id) => Some(writes::authorize_club(&state.db, club_id, &user).await?),
        None => None,
    };
    let updated = writes::update(&state.db, existing.id, input, new_club.as_ref())
        .await?
        .ok_or_else(|| ApiError::not_found(EVENT_NOT_FOUND))?;
    if updated.cancelled && !existing.cancelled {
        // Everyone who paid for a ticket gets their money back, then an email.
        refunds::refund_cancelled_in_background(state.clone(), updated.id, Some(user.id));
    }
    Ok(Json(updated.full()).into_response())
}

#[utoipa::path(
    delete,
    path = "/events/{event_id}",
    tag = "events",
    operation_id = "delete_event_events__event_id__delete",
    summary = "Delete Event"
)]
pub async fn delete_event(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = event_id(&mut check, &path);
    check.finish()?;
    let existing = writes::authorized_event(&state.db, id, &user).await?;
    writes::delete(&state.db, &existing).await?;
    Ok(no_content())
}

/// FastAPI's empty 204, which keeps the JSON content type.
pub fn no_content() -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );
    response
}

#[cfg(test)]
mod tests {
    use axum::http::header::CACHE_CONTROL;

    use super::*;

    #[test]
    fn only_counts_read_in_full_may_be_kept_by_caches() {
        let counted = || {
            IndexMap::from([(
                "7".to_owned(),
                StatsResponse {
                    click_count: 3,
                    going_count: 1,
                },
            )])
        };
        assert_eq!(
            stats_response(counted(), true).headers()[CACHE_CONTROL],
            "public, max-age=0, s-maxage=30, stale-while-revalidate=120"
        );
        // A count that failed reads as zero: fine to show once, never to keep.
        assert!(
            stats_response(counted(), false)
                .headers()
                .get(CACHE_CONTROL)
                .is_none()
        );
    }
}

/// The stats route against a real Postgres loaded with our schema; it runs
/// only when `WAT2DO_TEST_DATABASE_URL` is set (CI's "Rust database tests" job).
#[cfg(test)]
mod database_tests {
    use axum::body::Body as HttpBody;
    use axum::http::{Request, header};
    use tower::ServiceExt;

    use super::*;
    use crate::api::auth::test_tokens::access_token;
    use crate::api::client_ip::Peer;
    use crate::api::router;
    use crate::api::test_database::{database, peer};
    use crate::settings::{Settings, test_settings};

    #[tokio::test]
    async fn a_schools_stats_may_be_kept_by_any_cache_signed_in_or_not() {
        let Some(db) = database() else { return };
        let settings: &'static Settings = Box::leak(Box::new(test_settings(&[])));
        let state = AppState::new(settings, db, None).unwrap();
        let bearer = format!("Bearer {}", access_token("stats-reader"));
        for authorization in [None, Some(bearer.as_str())] {
            let mut builder = Request::builder()
                .uri("/events/stats?school=uwaterloo")
                .header(header::HOST, "testserver");
            if let Some(value) = authorization {
                builder = builder.header(header::AUTHORIZATION, value);
            }
            let mut request = builder.body(HttpBody::empty()).unwrap();
            request.extensions_mut().insert(Peer(peer()));
            let response = crate::api::app(router(state.clone()))
                .oneshot(request)
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let headers = response.headers();
            assert_eq!(
                headers[header::CACHE_CONTROL],
                "public, max-age=0, s-maxage=30, stale-while-revalidate=120"
            );
            assert!(headers.get(header::SET_COOKIE).is_none());
            for vary in headers.get_all(header::VARY) {
                let vary = vary.to_str().unwrap().to_ascii_lowercase();
                assert!(
                    !vary.contains("cookie") && !vary.contains("authorization"),
                    "{vary}"
                );
            }
        }
    }
}
