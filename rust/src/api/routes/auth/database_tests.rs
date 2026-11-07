//! The auth routes against a real Postgres loaded with our schema
//! (`backend/database/baseline.sql` and the migrations after it), so every
//! session statement runs as it does in production.
//!
//! They run only when `WAT2DO_TEST_DATABASE_URL` names that database
//! (`api::test_database`). Every test works on its own fresh addresses and
//! its own client IPs, so the tests can run in parallel.

use axum::body::{Body as HttpBody, Bytes};
use axum::extract::Request;
use axum::http::{HeaderMap, Method, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use super::session;
use crate::api::client_ip::Peer;
use crate::api::test_database::{database, peer};
use crate::api::{AppState, router};
use crate::controlbox::AUTHENTICATION;
use crate::settings::{Settings, test_settings};

const ORIGIN: &str = "http://localhost:3000";
const SCHOOL_ORIGIN: &str = "http://uwaterloo.wat2do.localhost:3000";

fn state(db: PgPool) -> AppState {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(&[(
        "CORS_ORIGINS",
        &format!(r#"["{ORIGIN}", "{SCHOOL_ORIGIN}"]"#),
    )])));
    AppState::new(settings, db, None).unwrap()
}

/// A fresh address for one test.
fn address(label: &str) -> String {
    format!("{label}-{}@example.com", Uuid::new_v4().simple())
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Value,
}

impl Reply {
    /// The `refresh_token` cookie this response set (empty when it cleared it).
    fn refresh_cookie(&self) -> Option<String> {
        self.headers
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .find_map(|cookie| cookie.strip_prefix("refresh_token="))
            .map(|rest| rest.split(';').next().unwrap_or_default().to_owned())
    }

    fn text(&self, name: &str) -> String {
        self.body[name].as_str().unwrap_or_default().to_owned()
    }
}

async fn call(
    state: &AppState,
    method: Method,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> Reply {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "testserver");
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let body = match body {
        Some(json) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            HttpBody::from(json.to_string())
        }
        None => HttpBody::empty(),
    };
    let mut request = builder.body(body).unwrap();
    request.extensions_mut().insert(Peer(peer()));
    let response = crate::api::app(router(state.clone()))
        .oneshot(request)
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes: Bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

/// What the latest login email to `email` carries: the code and the link token.
fn login_email(email: &str) -> (String, String) {
    let sent = crate::email::SENT_IN_BACKGROUND.lock().unwrap();
    let message = sent
        .iter()
        .rev()
        .find(|message| message.to == [email])
        .unwrap_or_else(|| panic!("no login email to {email}"));
    let after = |marker: &str| {
        message
            .body_text
            .split_once(marker)
            .unwrap_or_else(|| panic!("no {marker:?} in the email"))
            .1
            .to_owned()
    };
    let code = after("login code: ")[..6].to_owned();
    let link = after("sign in: ");
    let query = link.lines().next().unwrap().split_once('?').unwrap().1;
    let token = form_urlencoded::parse(query.as_bytes())
        .find(|(name, _)| name == "token")
        .unwrap()
        .1
        .into_owned();
    (code, token)
}

async fn send_otp(state: &AppState, email: &str, origin: &str) -> Reply {
    call(
        state,
        Method::POST,
        "/auth/send-otp",
        &[("origin", origin)],
        Some(json!({ "email": email })),
    )
    .await
}

async fn verify(state: &AppState, email: &str, token: &str, origin: &str) -> Reply {
    call(
        state,
        Method::POST,
        "/auth/verify-otp",
        &[("origin", origin)],
        Some(json!({ "email": email, "token": token })),
    )
    .await
}

async fn refresh(state: &AppState, token: &str) -> Reply {
    let cookie = format!("refresh_token={token}");
    call(
        state,
        Method::POST,
        "/auth/refresh",
        &[("origin", ORIGIN), ("cookie", &cookie)],
        None,
    )
    .await
}

/// Send a login email to `email` and sign in with its code.
async fn sign_in(state: &AppState, email: &str, origin: &str) -> Reply {
    assert_eq!(send_otp(state, email, origin).await.status, StatusCode::OK);
    let (code, _) = login_email(email);
    let reply = verify(state, email, &code, origin).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    reply
}

async fn count(db: &PgPool, sql: &str, value: &str) -> i64 {
    sqlx::query_scalar(sql)
        .bind(value)
        .fetch_one(db)
        .await
        .unwrap()
}

async fn live_sessions(db: &PgPool, auth_id: &str) -> i64 {
    count(
        db,
        "SELECT count(*) FROM public.auth_sessions WHERE auth_id = $1 AND revoked_at IS NULL",
        auth_id,
    )
    .await
}

async fn sessions(db: &PgPool, auth_id: &str) -> i64 {
    count(
        db,
        "SELECT count(*) FROM public.auth_sessions WHERE auth_id = $1",
        auth_id,
    )
    .await
}

async fn misses(db: &PgPool, email: &str) -> i64 {
    count(
        db,
        "SELECT count(*) FROM public.verification_failures WHERE identifier = $1",
        email,
    )
    .await
}

async fn tokens_held(db: &PgPool, email: &str) -> i64 {
    count(
        db,
        "SELECT count(*) FROM public.verification_tokens WHERE identifier = $1",
        email,
    )
    .await
}

/// A wrong six-digit code (never the one that was sent).
fn wrong_code(code: &str, index: usize) -> String {
    let value = (code.parse::<u32>().unwrap() + 1 + index as u32) % 1_000_000;
    format!("{value:06}")
}

#[tokio::test]
async fn a_new_user_signs_in_refreshes_and_logs_out() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let email = address("new");

    // send-otp stores two digests and sends the code and the link.
    let sent = send_otp(&state, &email, SCHOOL_ORIGIN).await;
    assert_eq!(sent.status, StatusCode::OK, "{}", sent.body);
    assert_eq!(tokens_held(&db, &email).await, 2);
    let (code, link) = login_email(&email);
    assert_eq!(code.len(), 6);

    // The code creates the user at the signup site's school and starts a session.
    let signed_in = verify(&state, &email, &code, SCHOOL_ORIGIN).await;
    assert_eq!(signed_in.status, StatusCode::OK, "{}", signed_in.body);
    assert_eq!(signed_in.text("school"), "uwaterloo");
    assert_eq!(signed_in.body["onboarding_required"], true);
    let auth_id = signed_in.text("user_id");
    let school: Option<String> = sqlx::query_scalar(
        "SELECT s.slug FROM public.users u JOIN public.schools s ON s.id = u.school_id \
         WHERE u.auth_id = $1",
    )
    .bind(&auth_id)
    .fetch_optional(&db)
    .await
    .unwrap();
    assert_eq!(school.as_deref(), Some("uwaterloo"));
    assert_eq!(live_sessions(&db, &auth_id).await, 1);
    // The code and the link are used up, and so are the address's misses.
    assert_eq!(tokens_held(&db, &email).await, 0);
    assert_eq!(misses(&db, &email).await, 0);
    for used in [&code, &link] {
        assert_eq!(
            verify(&state, &email, used, SCHOOL_ORIGIN).await.status,
            StatusCode::UNAUTHORIZED
        );
    }
    let access = signed_in.text("access_token");
    let user = state.auth.subject(&access).unwrap();
    assert_eq!(user.as_deref(), Some(auth_id.as_str()));

    // Refresh rotates the token; the replaced one, sent again at once (a
    // parallel tab), gets the same successor.
    let first = signed_in.refresh_cookie().unwrap();
    let rotated = refresh(&state, &first).await;
    assert_eq!(rotated.status, StatusCode::OK, "{}", rotated.body);
    assert_eq!(rotated.text("user_id"), auth_id);
    let second = rotated.refresh_cookie().unwrap();
    assert_ne!(second, first);
    let again = refresh(&state, &first).await;
    assert_eq!(again.status, StatusCode::OK, "{}", again.body);
    assert_eq!(again.refresh_cookie().unwrap(), second);
    assert_eq!(live_sessions(&db, &auth_id).await, 1);

    // The successor rotates on; the token before it, sent after the reuse
    // window, means it leaked, and the session ends.
    let third = refresh(&state, &second).await.refresh_cookie().unwrap();
    sqlx::query(
        "UPDATE public.auth_sessions SET rotated_at = rotated_at - make_interval(secs => $2) \
         WHERE auth_id = $1",
    )
    .bind(&auth_id)
    .bind((AUTHENTICATION.refresh_token_reuse_seconds + 5) as f64)
    .execute(&db)
    .await
    .unwrap();
    let late = refresh(&state, &second).await;
    assert_eq!(late.status, StatusCode::UNAUTHORIZED, "{}", late.body);
    assert_eq!(live_sessions(&db, &auth_id).await, 0);
    assert_eq!(
        refresh(&state, &third).await.status,
        StatusCode::UNAUTHORIZED
    );

    // Signing in again finds the user (no onboarding now that it has a school).
    let back = sign_in(&state, &email, ORIGIN).await;
    assert_eq!(back.text("user_id"), auth_id);
    assert_eq!(back.text("school"), "uwaterloo");
    assert_eq!(back.body["onboarding_required"], false);
    let other = sign_in(&state, &email, ORIGIN).await;
    assert_eq!(live_sessions(&db, &auth_id).await, 2);

    // Logout ends every session of the account and clears the cookie.
    let bearer = format!("Bearer {}", back.text("access_token"));
    let out = call(
        &state,
        Method::POST,
        "/auth/logout",
        &[("authorization", &bearer)],
        None,
    )
    .await;
    assert_eq!(out.status, StatusCode::OK, "{}", out.body);
    assert_eq!(out.refresh_cookie().as_deref(), Some(r#""""#));
    assert_eq!(live_sessions(&db, &auth_id).await, 0);
    assert_eq!(
        refresh(&state, &other.refresh_cookie().unwrap())
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn refreshing_for_a_deleted_user_ends_the_session() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let email = address("deleted");
    let signed_in = sign_in(&state, &email, ORIGIN).await;
    let auth_id = signed_in.text("user_id");
    // No school site: the user still needs onboarding.
    assert_eq!(signed_in.body["onboarding_required"], true);
    assert_eq!(signed_in.body["school"], Value::Null);
    sqlx::query("DELETE FROM public.users WHERE auth_id = $1")
        .bind(&auth_id)
        .execute(&db)
        .await
        .unwrap();
    let reply = refresh(&state, &signed_in.refresh_cookie().unwrap()).await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{}", reply.body);
    assert_eq!(live_sessions(&db, &auth_id).await, 0);
    assert_eq!(sessions(&db, &auth_id).await, 1);
}

#[tokio::test]
async fn an_invited_address_joins_the_club_on_first_sign_in() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let school_id: i32 =
        sqlx::query_scalar("SELECT id FROM public.schools WHERE slug = 'uwaterloo'")
            .fetch_one(&db)
            .await
            .unwrap();
    let inviter = Uuid::new_v4();
    sqlx::query("INSERT INTO public.users (id, auth_id, email) VALUES ($1, $2, $3)")
        .bind(inviter)
        .bind(Uuid::new_v4().to_string())
        .bind(address("inviter"))
        .execute(&db)
        .await
        .unwrap();
    let club_id: i32 = sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, school_id) VALUES ($1, $2) RETURNING id",
    )
    .bind(format!("Database test club {}", Uuid::new_v4().simple()))
    .bind(school_id)
    .fetch_one(&db)
    .await
    .unwrap();
    let email = address("invited");
    let (invitation_id, token): (Uuid, Uuid) = sqlx::query_as(
        "INSERT INTO public.club_invitations (club_id, email, invited_by, expires_at) \
         VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id, token",
    )
    .bind(club_id)
    .bind(&email)
    .bind(inviter)
    .fetch_one(&db)
    .await
    .unwrap();

    // The invitation token sends the link to the club's school site.
    let sent = call(
        &state,
        Method::POST,
        "/auth/send-otp",
        &[("origin", ORIGIN)],
        Some(json!({ "email": email, "token": token.to_string() })),
    )
    .await;
    assert_eq!(sent.status, StatusCode::OK, "{}", sent.body);
    let (_, link) = login_email(&email);
    {
        let sent = crate::email::SENT_IN_BACKGROUND.lock().unwrap();
        let message = sent
            .iter()
            .rev()
            .find(|message| message.to == [email.as_str()])
            .unwrap();
        assert!(
            message
                .body_text
                .contains("http://uwaterloo.wat2do.localhost:3000/auth/callback?"),
            "{}",
            message.body_text
        );
    }
    // A bad invitation token is only logged.
    let odd = call(
        &state,
        Method::POST,
        "/auth/send-otp",
        &[("origin", ORIGIN)],
        Some(json!({ "email": address("odd"), "token": "not-a-uuid\nFAKE LOG LINE" })),
    )
    .await;
    assert_eq!(odd.status, StatusCode::OK, "{}", odd.body);

    // The link signs in a new user, who joins the club.
    let signed_in = verify(&state, &email, &link, ORIGIN).await;
    assert_eq!(signed_in.status, StatusCode::OK, "{}", signed_in.body);
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM public.users WHERE email = $1")
        .bind(&email)
        .fetch_one(&db)
        .await
        .unwrap();
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM public.club_members WHERE club_id = $1 AND user_id = $2)",
    )
    .bind(club_id)
    .bind(user_id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(member);
    let status: String =
        sqlx::query_scalar("SELECT status FROM public.club_invitations WHERE id = $1")
            .bind(invitation_id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(status, "accepted");
}

#[tokio::test]
async fn concurrent_wrong_codes_never_get_more_than_the_limit() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let email = address("guesses");
    assert_eq!(
        send_otp(&state, &email, ORIGIN).await.status,
        StatusCode::OK
    );
    let (code, link) = login_email(&email);
    let limit = AUTHENTICATION.code_guess_limit;

    // A burst of wrong codes at once: no more than `limit` are even checked.
    let burst = 4 * limit;
    let guesses: Vec<String> = (0..burst).map(|index| wrong_code(&code, index)).collect();
    let replies = futures_util::future::join_all(
        guesses
            .iter()
            .map(|guess| verify(&state, &email, guess, ORIGIN)),
    )
    .await;
    let checked = replies
        .iter()
        .filter(|reply| reply.status == StatusCode::UNAUTHORIZED)
        .count();
    let refused = replies
        .iter()
        .filter(|reply| reply.status == StatusCode::TOO_MANY_REQUESTS)
        .count();
    assert_eq!(checked + refused, burst);
    assert!(checked <= limit, "{checked} wrong codes were checked");
    assert_eq!(misses(&db, &email).await, checked as i64);
    for reply in replies
        .iter()
        .filter(|reply| reply.status == StatusCode::TOO_MANY_REQUESTS)
    {
        assert!(reply.headers.contains_key(header::RETRY_AFTER));
    }

    // One by one, the rest of the allowance, then the lock, even for the right code.
    let mut index = burst;
    while (misses(&db, &email).await as usize) < limit {
        let reply = verify(&state, &email, &wrong_code(&code, index), ORIGIN).await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{}", reply.body);
        index += 1;
    }
    let locked = verify(&state, &email, &code, ORIGIN).await;
    assert_eq!(
        locked.status,
        StatusCode::TOO_MANY_REQUESTS,
        "{}",
        locked.body
    );
    assert_eq!(misses(&db, &email).await, limit as i64);
    // The link is not a guessable code, so it still signs in, and clears the misses.
    let signed_in = verify(&state, &email, &link, ORIGIN).await;
    assert_eq!(signed_in.status, StatusCode::OK, "{}", signed_in.body);
    assert_eq!(misses(&db, &email).await, 0);
}

#[tokio::test]
async fn a_code_or_link_signs_in_only_once_however_many_try_at_once() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    for use_link in [false, true] {
        let email = address(if use_link { "once-link" } else { "once-code" });
        assert_eq!(
            send_otp(&state, &email, ORIGIN).await.status,
            StatusCode::OK
        );
        let (code, link) = login_email(&email);
        // As many codes as the lockout lets through at once (more could all be
        // refused, which proves nothing); links have no lockout.
        let (secret, tries) = if use_link {
            (link, 8)
        } else {
            (code, AUTHENTICATION.code_guess_limit)
        };
        let replies = futures_util::future::join_all(
            (0..tries).map(|_| verify(&state, &email, &secret, ORIGIN)),
        )
        .await;
        let signed_in: Vec<_> = replies
            .iter()
            .filter(|reply| reply.status == StatusCode::OK)
            .collect();
        assert_eq!(signed_in.len(), 1, "use_link={use_link}");
        for reply in &replies {
            assert!(
                [
                    StatusCode::OK,
                    StatusCode::UNAUTHORIZED,
                    StatusCode::TOO_MANY_REQUESTS
                ]
                .contains(&reply.status),
                "{} {}",
                reply.status,
                reply.body
            );
        }
        let auth_id = signed_in[0].text("user_id");
        assert_eq!(sessions(&db, &auth_id).await, 1, "use_link={use_link}");
        assert_eq!(
            count(
                &db,
                "SELECT count(*) FROM public.users WHERE email = $1",
                &email
            )
            .await,
            1
        );
    }
}

#[tokio::test]
async fn two_first_sign_ins_at_once_share_one_user() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    // The code and the link of one email, used at the same moment.
    let email = address("twice");
    assert_eq!(
        send_otp(&state, &email, ORIGIN).await.status,
        StatusCode::OK
    );
    let (code, link) = login_email(&email);
    let (by_code, by_link) = tokio::join!(
        verify(&state, &email, &code, ORIGIN),
        verify(&state, &email, &link, ORIGIN)
    );
    let ids: Vec<String> = [&by_code, &by_link]
        .iter()
        .filter(|reply| reply.status == StatusCode::OK)
        .map(|reply| reply.text("user_id"))
        .collect();
    assert!(!ids.is_empty(), "{} {}", by_code.body, by_link.body);
    assert!(ids.iter().all(|id| *id == ids[0]));
    assert_eq!(
        count(
            &db,
            "SELECT count(*) FROM public.users WHERE email = $1",
            &email
        )
        .await,
        1
    );

    // Two sign-ins racing to create the same new user both get it.
    let email = address("race");
    let start =
        || session::complete_session(&state.db, &state.auth, &email, chrono::Utc::now(), None);
    let (first, second) = tokio::join!(start(), start());
    let first = first.ok().unwrap().body.user_id;
    assert_eq!(second.ok().unwrap().body.user_id, first);
    assert_eq!(
        count(
            &db,
            "SELECT count(*) FROM public.users WHERE email = $1",
            &email
        )
        .await,
        1
    );
    assert_eq!(sessions(&db, &first).await, 2);
}

#[tokio::test]
async fn one_address_gets_a_limited_number_of_login_emails() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let limit = AUTHENTICATION.code_send_limit;

    // One by one: `limit` emails, then 429 until the oldest ages out, and
    // the last code sent still works.
    let email = address("sends");
    for _ in 0..limit {
        assert_eq!(
            send_otp(&state, &email, ORIGIN).await.status,
            StatusCode::OK
        );
    }
    let (code, _) = login_email(&email);
    let capped = send_otp(&state, &email, ORIGIN).await;
    assert_eq!(
        capped.status,
        StatusCode::TOO_MANY_REQUESTS,
        "{}",
        capped.body
    );
    let retry_after: u64 = capped.headers[header::RETRY_AFTER]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!(retry_after > 0 && retry_after <= 60 * AUTHENTICATION.code_send_window_minutes as u64);
    let sends = |email: String| {
        let db = db.clone();
        async move {
            count(
                &db,
                "SELECT count(*) FROM public.verification_sends WHERE identifier = $1",
                &email,
            )
            .await
        }
    };
    assert_eq!(sends(email.clone()).await, limit as i64);
    assert_eq!(tokens_held(&db, &email).await, 2);
    assert_eq!(
        verify(&state, &email, &code, ORIGIN).await.status,
        StatusCode::OK
    );

    // An address nobody has signed up with gets exactly the same answer.
    let unknown = address("sends-unknown");
    for _ in 0..limit {
        send_otp(&state, &unknown, ORIGIN).await;
    }
    let unknown_capped = send_otp(&state, &unknown, ORIGIN).await;
    assert_eq!(unknown_capped.status, capped.status);
    assert_eq!(unknown_capped.body, capped.body);

    // At once: no more than `limit` emails are sent.
    let email = address("sends-burst");
    let replies =
        futures_util::future::join_all((0..3 * limit).map(|_| send_otp(&state, &email, ORIGIN)))
            .await;
    let sent = replies
        .iter()
        .filter(|reply| reply.status == StatusCode::OK)
        .count();
    assert!(sent <= limit, "{sent} emails were sent");
    assert_eq!(sends(email.clone()).await, sent as i64);
    assert!(
        replies
            .iter()
            .all(|reply| [StatusCode::OK, StatusCode::TOO_MANY_REQUESTS].contains(&reply.status))
    );
}
