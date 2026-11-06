//! Tickets against a real Postgres loaded with our schema, so the seat locks,
//! the one-free-ticket-per-date index and the ingestion trigger run as they
//! do in production.
//!
//! They run only when `WAT2DO_TEST_DATABASE_URL` names that database (CI's
//! "Rust database tests" job); without it each test returns at once. Every
//! test makes its own club, event and people, so the tests run in parallel.

use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::model::CheckInResult;
use super::stripe::WebhookEvent;
use super::ticketing::{self, TicketingInput};
use super::{admission, door, store};
use crate::api::AppState;
use crate::api::auth::User;
use crate::api::errors::ApiError;
use crate::api::events::going;
use crate::api::messages::{
    EVENT_HAS_PAID_TICKETS, TICKET_ALREADY_USED, TICKET_CAPACITY_BELOW_ISSUED,
    TICKETED_DATE_IN_USE, TICKETS_ALREADY_TAKEN, TICKETS_SOLD_OUT,
};
use crate::settings::{Settings, test_settings};

/// The test database, or `None` when this run has none.
fn database() -> Option<PgPool> {
    let Some(url) = std::env::var("WAT2DO_TEST_DATABASE_URL")
        .ok()
        .filter(|url| !url.is_empty())
    else {
        assert!(
            std::env::var_os("WAT2DO_DATABASE_TESTS_REQUIRED").is_none(),
            "WAT2DO_DATABASE_TESTS_REQUIRED is set but WAT2DO_TEST_DATABASE_URL is not"
        );
        return None;
    };
    Some(crate::db::connect_lazy(
        url.parse()
            .expect("WAT2DO_TEST_DATABASE_URL is a Postgres URL"),
        20,
        Duration::from_secs(30),
        Duration::from_secs(30),
        false,
    ))
}

fn state(db: PgPool) -> AppState {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(&[])));
    AppState::new(settings, db, None).unwrap()
}

async fn person(db: &PgPool, label: &str) -> User {
    let id = Uuid::new_v4();
    let email = format!("{label}-{}@example.com", id.simple());
    sqlx::query("INSERT INTO public.users (id, email, auth_id, full_name) VALUES ($1, $2, $3, $4)")
        .bind(id)
        .bind(&email)
        .bind(id.to_string())
        .bind(format!("{label} Tester"))
        .execute(db)
        .await
        .unwrap();
    User {
        id,
        email,
        role: "user".into(),
        school_id: None,
        school: None,
    }
}

/// A club whose team is `officer`, with an event on two dates a week apart:
/// (event id, its date ids).
async fn club_event(db: &PgPool, officer: &User) -> (i64, Vec<Uuid>) {
    let school: i32 = sqlx::query_scalar("SELECT id FROM public.schools WHERE slug = 'uwaterloo'")
        .fetch_one(db)
        .await
        .unwrap();
    let club: i32 = sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, school_id, status) \
         VALUES ($1, $2, 'approved') RETURNING id",
    )
    .bind(format!("Ticket Club {}", Uuid::new_v4().simple()))
    .bind(school)
    .fetch_one(db)
    .await
    .unwrap();
    sqlx::query("INSERT INTO public.club_members (club_id, user_id) VALUES ($1, $2)")
        .bind(club)
        .bind(officer.id)
        .execute(db)
        .await
        .unwrap();
    let event: i32 = sqlx::query_scalar(
        "INSERT INTO public.events (title, location, club, school_id, club_id) \
         VALUES ('Board Games Night', 'SLC', 'Ticket Club', $1, $2) RETURNING id",
    )
    .bind(school)
    .bind(club)
    .fetch_one(db)
    .await
    .unwrap();
    let mut dates = Vec::new();
    for days in [7, 14] {
        let start: DateTime<Utc> = Utc::now() + chrono::Duration::days(days);
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc) \
             VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(event)
        .bind(start)
        .bind(start + chrono::Duration::hours(3))
        .fetch_one(db)
        .await
        .unwrap();
        dates.push(id);
    }
    (i64::from(event), dates)
}

fn free(capacity: Option<i32>) -> TicketingInput {
    TicketingInput {
        price_cents: 0,
        capacity,
        paused: false,
    }
}

fn detail(error: ApiError) -> String {
    match error {
        ApiError::Validation { detail, .. } | ApiError::Conflict(detail) => detail,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test]
async fn free_tickets_are_one_per_person_and_stop_at_capacity() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let officer = person(&db, "officer").await;
    let (event, dates) = club_event(&db, &officer).await;
    ticketing::configure(&state, event, free(Some(2)), &officer)
        .await
        .unwrap();
    let (ada, ben, cy) = (
        person(&db, "ada").await,
        person(&db, "ben").await,
        person(&db, "cy").await,
    );

    let first = admission::take_free(&state, event, dates[0], &ada)
        .await
        .unwrap();
    let again = admission::take_free(&state, event, dates[0], &ada)
        .await
        .unwrap();
    assert_eq!(
        first.code, again.code,
        "taking it twice gives the same ticket"
    );
    assert!(!first.paid && first.can_return);
    admission::take_free(&state, event, dates[0], &ben)
        .await
        .unwrap();
    let full = admission::take_free(&state, event, dates[0], &cy)
        .await
        .unwrap_err();
    assert_eq!(detail(full), TICKETS_SOLD_OUT);
    // The other date has its own seats.
    admission::take_free(&state, event, dates[1], &cy)
        .await
        .unwrap();

    // Taking a ticket marks the holder going; giving it back frees the seat.
    assert_eq!(
        going::occurrence_ids(&db, ada.id, event).await.unwrap(),
        [dates[0]]
    );
    admission::return_free(&state, &first.code, &ada)
        .await
        .unwrap();
    assert!(
        going::occurrence_ids(&db, ada.id, event)
            .await
            .unwrap()
            .is_empty()
    );
    admission::take_free(&state, event, dates[0], &cy)
        .await
        .unwrap();
}

#[tokio::test]
async fn people_racing_for_the_last_seats_never_overfill_a_date() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let officer = person(&db, "officer").await;
    let (event, dates) = club_event(&db, &officer).await;
    ticketing::configure(&state, event, free(Some(3)), &officer)
        .await
        .unwrap();
    let mut people = Vec::new();
    for index in 0..10 {
        people.push(person(&db, &format!("racer{index}")).await);
    }
    let takes = people.iter().map(|user| {
        let state = state.clone();
        let user = user.clone();
        let date = dates[0];
        async move { admission::take_free(&state, event, date, &user).await }
    });
    let results = futures_util::future::join_all(takes).await;
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 3);
    let taken = store::seats_taken(&db, dates[0], Utc::now()).await.unwrap();
    assert_eq!(taken, 3);
}

#[tokio::test]
async fn turning_free_tickets_on_hands_one_to_everyone_going() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let officer = person(&db, "officer").await;
    let (event, dates) = club_event(&db, &officer).await;
    let early = person(&db, "early").await;
    going::set_occurrences(&db, early.id, event, &dates)
        .await
        .unwrap();

    ticketing::configure(&state, event, free(None), &officer)
        .await
        .unwrap();
    let held = store::tickets_for_holder(&db, early.id).await.unwrap();
    assert_eq!(held.len(), 2, "one ticket per date they were going to");

    let desk = door::desk(&state, event, &officer).await.unwrap();
    assert_eq!(desk.issued, 2);
    assert_eq!(desk.revenue_cents, 0);
    // A capacity of one still fits the one ticket per date already handed out.
    ticketing::configure(&state, event, free(Some(1)), &officer)
        .await
        .unwrap();
    let crowded = person(&db, "crowded").await;
    assert_eq!(
        detail(
            admission::take_free(&state, event, dates[0], &crowded)
                .await
                .unwrap_err()
        ),
        TICKETS_SOLD_OUT
    );
    assert_eq!(
        detail(ticketing::stop(&state, event, &officer).await.unwrap_err()),
        TICKETS_ALREADY_TAKEN
    );
    // Ticket holders count toward Going but are never named.
    let attendees = going::attendees(&db, event).await.unwrap();
    assert_eq!(attendees.going_count, 1);
    assert!(attendees.attendees.is_empty());
}

#[tokio::test]
async fn capacity_never_drops_below_the_tickets_taken() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let officer = person(&db, "officer").await;
    let (event, dates) = club_event(&db, &officer).await;
    ticketing::configure(&state, event, free(None), &officer)
        .await
        .unwrap();
    for name in ["a", "b"] {
        let user = person(&db, name).await;
        admission::take_free(&state, event, dates[0], &user)
            .await
            .unwrap();
    }
    let refused = ticketing::configure(&state, event, free(Some(1)), &officer)
        .await
        .unwrap_err();
    assert_eq!(detail(refused), TICKET_CAPACITY_BELOW_ISSUED);
}

#[tokio::test]
async fn a_ticket_is_admitted_once_and_only_at_its_own_event() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let officer = person(&db, "officer").await;
    let (event, dates) = club_event(&db, &officer).await;
    let (other_event, _) = club_event(&db, &officer).await;
    ticketing::configure(&state, event, free(None), &officer)
        .await
        .unwrap();
    let guest = person(&db, "guest").await;
    let ticket = admission::take_free(&state, event, dates[0], &guest)
        .await
        .unwrap();
    // Scanned as a link, from any phone camera.
    let link = format!("https://uwaterloo.wat2do.io/tickets/{}", ticket.code);

    let admit = |event: i64, code: String| {
        let state = state.clone();
        let officer = officer.clone();
        async move {
            door::set_check_in(&state, event, &code, true, &officer)
                .await
                .unwrap()
                .result
        }
    };
    assert_eq!(admit(event, link.clone()).await, CheckInResult::CheckedIn);
    assert_eq!(
        admit(event, link.clone()).await,
        CheckInResult::AlreadyCheckedIn
    );
    assert_eq!(
        admit(other_event, ticket.code.clone()).await,
        CheckInResult::NotForThisEvent
    );
    assert_eq!(admit(event, "NOPE".into()).await, CheckInResult::NotFound);
    // A used ticket can't be given back.
    assert_eq!(
        detail(
            admission::return_free(&state, &ticket.code, &guest)
                .await
                .unwrap_err()
        ),
        TICKET_ALREADY_USED
    );
}

/// A paid event on a club with a Stripe account, and one pending order of
/// two tickets on Checkout session `session`: (event, date, order).
async fn pending_order(
    db: &PgPool,
    officer: &User,
    buyer: &User,
    session: &str,
) -> (i64, Uuid, Uuid) {
    let (event, dates) = club_event(db, officer).await;
    let club: i32 = sqlx::query_scalar("SELECT club_id FROM public.events WHERE id = $1")
        .bind(event as i32)
        .fetch_one(db)
        .await
        .unwrap();
    let account = format!("acct_{}", Uuid::new_v4().simple());
    sqlx::query(
        "INSERT INTO public.club_payment_accounts (club_id, stripe_account_id, country, charges_enabled) \
         VALUES ($1, $2, 'CA', true)",
    )
    .bind(club)
    .bind(&account)
    .execute(db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO public.event_ticketing (event_id, price_cents, currency) VALUES ($1, 1500, 'cad')",
    )
    .bind(event as i32)
    .execute(db)
    .await
    .unwrap();
    let order: Uuid = sqlx::query_scalar(
        "INSERT INTO public.ticket_orders (event_id, event_date_id, club_id, buyer_user_id, \
         buyer_email, quantity, unit_amount_cents, currency, stripe_account_id, \
         stripe_checkout_session_id, reserved_until) \
         VALUES ($1, $2, $3, $4, $5, 2, 1500, 'cad', $6, $7, now() + interval '1 hour') RETURNING id",
    )
    .bind(event as i32)
    .bind(dates[0])
    .bind(club)
    .bind(buyer.id)
    .bind(&buyer.email)
    .bind(&account)
    .bind(session)
    .fetch_one(db)
    .await
    .unwrap();
    (event, dates[0], order)
}

#[tokio::test]
async fn a_paid_checkout_becomes_tickets_exactly_once() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let officer = person(&db, "officer").await;
    let buyer = person(&db, "buyer").await;
    let session = format!("cs_test_{}", Uuid::new_v4().simple());
    let (event, date, order) = pending_order(&db, &officer, &buyer, &session).await;
    // Two seats are held while the buyer is on Checkout.
    assert_eq!(store::seats_taken(&db, date, Utc::now()).await.unwrap(), 2);

    let paid = || WebhookEvent {
        kind: "checkout.session.completed".into(),
        object: json!({
            "id": session,
            "client_reference_id": order.to_string(),
            "payment_status": "paid",
            "payment_intent": "pi_test",
        }),
    };
    admission::handle_webhook(&state, paid()).await.unwrap();
    admission::handle_webhook(&state, paid()).await.unwrap();
    let tickets = store::tickets_for_order(&db, order).await.unwrap();
    assert_eq!(tickets.len(), 2, "a repeated webhook issues nothing more");
    assert!(
        tickets
            .iter()
            .all(|ticket| ticket.holder_user_id == buyer.id)
    );
    assert_eq!(store::seats_taken(&db, date, Utc::now()).await.unwrap(), 2);
    assert_eq!(
        going::occurrence_ids(&db, buyer.id, event).await.unwrap(),
        [date]
    );

    // A paid event is cancelled, never deleted, and its sold dates stay.
    let mut connection = db.acquire().await.unwrap();
    let refused = ticketing::guard_delete(&mut connection, event, Utc::now())
        .await
        .unwrap_err();
    assert_eq!(detail(refused), EVENT_HAS_PAID_TICKETS);
    let event_row = crate::api::events::store::event_by_id(&db, event)
        .await
        .unwrap()
        .unwrap();
    let refused = ticketing::guard_edit(&mut connection, &event_row, None, Some(&[]), Utc::now())
        .await
        .unwrap_err();
    assert_eq!(detail(refused), TICKETED_DATE_IN_USE);
}

#[tokio::test]
async fn an_expired_checkout_frees_its_seats() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let officer = person(&db, "officer").await;
    let buyer = person(&db, "buyer").await;
    let session = format!("cs_test_{}", Uuid::new_v4().simple());
    let (_, date, order) = pending_order(&db, &officer, &buyer, &session).await;
    admission::handle_webhook(
        &state,
        WebhookEvent {
            kind: "checkout.session.expired".into(),
            object: json!({"id": session, "client_reference_id": order.to_string()}),
        },
    )
    .await
    .unwrap();
    assert_eq!(store::seats_taken(&db, date, Utc::now()).await.unwrap(), 0);
}

#[tokio::test]
async fn removing_a_date_or_the_event_takes_its_free_tickets_along() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let officer = person(&db, "officer").await;
    let (event, dates) = club_event(&db, &officer).await;
    ticketing::configure(&state, event, free(None), &officer)
        .await
        .unwrap();
    let guest = person(&db, "guest").await;
    admission::take_free(&state, event, dates[0], &guest)
        .await
        .unwrap();
    let event_row = crate::api::events::store::event_by_id(&db, event)
        .await
        .unwrap()
        .unwrap();

    let mut transaction = db.begin().await.unwrap();
    ticketing::guard_edit(
        &mut transaction,
        &event_row,
        None,
        Some(&[dates[1]]),
        Utc::now(),
    )
    .await
    .unwrap();
    sqlx::query("DELETE FROM public.event_dates WHERE id = $1")
        .bind(dates[0])
        .execute(&mut *transaction)
        .await
        .unwrap();
    transaction.commit().await.unwrap();
    assert!(
        store::tickets_for_holder(&db, guest.id)
            .await
            .unwrap()
            .is_empty()
    );

    admission::take_free(&state, event, dates[1], &guest)
        .await
        .unwrap();
    crate::api::events::writes::delete(&db, &event_row)
        .await
        .unwrap();
    assert!(
        store::tickets_for_holder(&db, guest.id)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn the_ingestion_agent_leaves_an_event_with_tickets_as_the_club_set_it() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let officer = person(&db, "officer").await;
    let (event, dates) = club_event(&db, &officer).await;
    ticketing::configure(&state, event, free(None), &officer)
        .await
        .unwrap();
    let mut transaction = db.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE wat2do_ingest_agent")
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("UPDATE public.events SET title = 'Renamed by the agent' WHERE id = $1")
        .bind(event as i32)
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("DELETE FROM public.event_dates WHERE id = $1")
        .bind(dates[0])
        .execute(&mut *transaction)
        .await
        .unwrap();
    transaction.commit().await.unwrap();
    let (title, dates_left): (String, i64) = sqlx::query_as(
        "SELECT title, (SELECT count(*) FROM public.event_dates WHERE event_id = $1) \
         FROM public.events WHERE id = $1",
    )
    .bind(event as i32)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(title, "Board Games Night");
    assert_eq!(dates_left, 2);
}
