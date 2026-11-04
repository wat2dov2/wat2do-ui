//! `/contact/`: a visitor's message, emailed to the team after the response
//! (`routers/contact.py`, `services/contact_service.py`).

use std::sync::{Arc, LazyLock};

use axum::Json;
use axum::body::Bytes;
use axum::http::{HeaderMap, StatusCode};
use serde_json::json;
use utoipa::ToSchema;

use crate::api::body::{Body, Extra, Str};
use crate::api::client_ip::ClientIp;
use crate::api::errors::ApiError;
use crate::api::rate_limit::RateLimiter;
use crate::api::routes::auth::MessageResponse;
use crate::controlbox::CONTACT;
use crate::email::layout::{self, escape};
use crate::email::{self, EmailMessage};
use crate::text::{python_splitlines, python_strip};

/// Its own budget: a burst of contact messages never blocks sponsor nominations.
static LIMITER: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(CONTACT.rate_limit));

/// A validated `ContactCreate`: the normalized address and the stripped message.
#[derive(Debug, Clone, PartialEq)]
pub struct ContactMessage {
    pub email: String,
    pub message: String,
}

/// A required string that must not be blank once stripped (the schemas'
/// `strip_required` validators): the stripped text.
pub fn required_text(body: &mut Body, name: &'static str, max_length: usize) -> Option<String> {
    let value = body.required_string(name, &Str::new().min(1).max(max_length))?;
    let stripped = python_strip(&value);
    if stripped.is_empty() {
        body.field_error(name, json!(value), "value cannot be blank");
        return None;
    }
    Some(stripped.to_owned())
}

/// `ContactCreate`'s fields, in its order; `SponsorSubmissionCreate` adds its own after them.
pub fn read_contact_fields(body: &mut Body) -> (Option<String>, Option<String>) {
    let email = body.required_email("email");
    let message = required_text(body, "message", CONTACT.maximum_message_length);
    (email, message)
}

fn incomplete() -> ApiError {
    ApiError::Internal(anyhow::anyhow!("validated body is incomplete"))
}

/// `ContactCreate` (`extra="forbid"`).
fn parse_contact(mut body: Body) -> Result<ContactMessage, ApiError> {
    let (email, message) = read_contact_fields(&mut body);
    body.finish()?;
    match (email, message) {
        (Some(email), Some(message)) => Ok(ContactMessage { email, message }),
        _ => Err(incomplete()),
    }
}

/// `build_contact_email`: to the team, replying to the sender, with the
/// message escaped so it can never become markup.
pub fn contact_email(contact: &ContactMessage) -> EmailMessage {
    let message = python_splitlines(&escape(&contact.message)).join("<br>");
    EmailMessage {
        to: CONTACT.recipient_emails.clone(),
        reply_to: Some(contact.email.clone()),
        subject: "[Wat2Do contact] New message".to_owned(),
        body_html: layout::shell(
            "New contact message",
            &(layout::paragraph(
                &format!(
                    "From <strong>{}</strong>. Reply to answer them.",
                    escape(&contact.email)
                ),
                true,
            ) + &layout::quote(&message)),
            &[],
        ),
        body_text: format!(
            "New wat2do contact message\n\nFrom: {}\n{}",
            contact.email, contact.message
        ),
        inline_images: vec![Arc::clone(&layout::LOGO)],
        ..EmailMessage::default()
    }
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct ContactCreate {
    #[schema(format = Email)]
    email: String,
    #[schema(min_length = 1, max_length = 5000)]
    message: String,
}

#[utoipa::path(
    post,
    path = "/contact/",
    tag = "contact",
    operation_id = "submit_contact_message_contact__post",
    summary = "Submit Contact Message",
    request_body = ContactCreate,
    responses(
        (status = 202, description = "Successful Response", body = MessageResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn submit_contact_message(
    ClientIp(client_ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<(StatusCode, Json<MessageResponse>), ApiError> {
    LIMITER.check(&client_ip)?;
    let contact = parse_contact(Body::parse(&bytes, &headers, Extra::Forbid)?)?;
    email::send_in_background(contact_email(&contact));
    Ok((
        StatusCode::ACCEPTED,
        MessageResponse::json("Contact message accepted"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::validation::ValidationIssue;
    use serde_json::Value;

    fn parse(value: Value) -> Result<ContactMessage, ApiError> {
        parse_contact(Body::from_value(value, Extra::Forbid))
    }

    fn issues(value: Value) -> Vec<ValidationIssue> {
        match parse(value) {
            Err(ApiError::RequestValidation(issues)) => issues,
            other => panic!("expected a 422, got {other:?}"),
        }
    }

    #[test]
    fn invalid_input_and_removed_fields_are_rejected() {
        // test_submit_contact_message_rejects_invalid_input
        let both = issues(json!({"email": "not-an-email", "message": "   "}));
        assert_eq!(both.len(), 2);
        assert_eq!(both[1].msg, "Value error, value cannot be blank");
        // test_submit_contact_message_rejects_removed_name_field
        let extra =
            issues(json!({"name": "Student", "email": "student@uwaterloo.ca", "message": "Hello"}));
        assert_eq!(extra.len(), 1);
        assert_eq!(extra[0].msg, "Extra inputs are not permitted");
        assert_eq!(issues(json!({})).len(), 2);
        assert_eq!(
            issues(json!({"email": "a@b.ca", "message": "x".repeat(5001)}))[0].msg,
            "String should have at most 5000 characters"
        );
    }

    #[test]
    fn messages_are_stripped_and_addresses_normalized() {
        let contact =
            parse(json!({"email": "Student@UWaterloo.CA", "message": "  Hello\n"})).unwrap();
        assert_eq!(contact.message, "Hello");
        assert_eq!(contact.email, "Student@uwaterloo.ca");
    }

    #[test]
    fn contact_email_escapes_html() {
        // test_build_contact_email_escapes_html
        let message = contact_email(&ContactMessage {
            email: "student@uwaterloo.ca".into(),
            message: "Hello <strong>team</strong>\r\nBye".into(),
        });
        assert_eq!(message.to, ["e22han@uwaterloo.ca", "tqiu@uwaterloo.ca"]);
        assert_eq!(message.reply_to.as_deref(), Some("student@uwaterloo.ca"));
        assert_eq!(message.subject, "[Wat2Do contact] New message");
        assert!(!message.body_html.contains("<strong>team</strong>"));
        assert!(
            message
                .body_html
                .contains("Hello &lt;strong&gt;team&lt;/strong&gt;<br>Bye</div>")
        );
        assert!(
            message
                .body_html
                .contains("From <strong>student@uwaterloo.ca</strong>.")
        );
        assert_eq!(
            message.body_text,
            "New wat2do contact message\n\nFrom: student@uwaterloo.ca\nHello <strong>team</strong>\r\nBye"
        );
        assert_eq!(message.inline_images[0].content_id, "wat2do-logo");
    }
}
