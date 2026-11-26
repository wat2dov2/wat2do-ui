//! The emails club routes send: review decisions for a club, a claim or a
//! submitted event or position (`services/notifications/submission_review.py`,
//! also sent by the submissions routes) and management-team invitations.

use std::sync::Arc;

use sqlx::PgPool;

use crate::controlbox::{CLUB_MANAGEMENT, EMAIL_DELIVERY};
use crate::email::layout::{self, escape};
use crate::email::{self, EmailMessage};
use crate::notifications::inbox::{self, Notice, NotificationDetails, NotificationKind};
use crate::text::python_splitlines;

const CLOSING: &str = "Questions? Reply to this email and our team will get back to you.";

/// What a review decided on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reviewed {
    Club,
    Claim,
    Event,
    Position,
}

impl Reviewed {
    /// The word for it, in the email and in the inbox notification's details.
    pub fn noun(self) -> &'static str {
        match self {
            Self::Club => "club",
            Self::Claim => "claim",
            Self::Event => "event",
            Self::Position => "position",
        }
    }
}

/// The path of the club panel's `page` (`/club-panel`, `/club-panel/events/42`)
/// for one club. It names the club (the frontend's `CLUB_PANEL_CLUB_PARAM`), so
/// the panel opens that club even for someone who manages several.
pub fn club_panel_path(page: &str, club_id: i64) -> String {
    format!("{page}?club={club_id}")
}

/// `build_review_decision_email`.
pub fn review_decision(
    kind: Reviewed,
    title: &str,
    approved: bool,
    recipient: &str,
    url: &str,
    rejection_reason: Option<&str>,
) -> EmailMessage {
    let noun = kind.noun();
    let (subject, heading, intro, details_html, details_text) = if approved {
        let (subject, heading, intro, action) = match kind {
            Reviewed::Claim => (
                format!("You can now manage {title} on wat2do"),
                format!("Your claim for {title} is approved"),
                format!(
                    "We verified your role, so you can now edit {title}'s page and post its events and positions."
                ),
                "Open the club panel".to_owned(),
            ),
            Reviewed::Club | Reviewed::Event | Reviewed::Position => (
                format!("Your {noun} {title} is live on wat2do"),
                format!("{title} is approved"),
                format!(
                    "Thanks for submitting your {noun}. We reviewed it and it is now live on wat2do."
                ),
                format!("View your {noun}"),
            ),
        };
        let html = layout::button(url, &action);
        let text = format!("{action}: {url}");
        (subject, heading, intro, html, text)
    } else {
        let (subject, heading, intro) = match kind {
            Reviewed::Claim => (
                format!("We could not verify your claim for {title}"),
                format!("Your claim for {title} was not approved"),
                format!(
                    "We reviewed your request to manage {title} and could not verify your role this time."
                ),
            ),
            Reviewed::Club | Reviewed::Event | Reviewed::Position => (
                format!("We could not approve your {noun} {title}"),
                format!("{title} was not approved"),
                format!(
                    "Thanks for submitting your {noun}. We reviewed it and could not approve it this time."
                ),
            ),
        };
        let (html, text) = match rejection_reason {
            Some(reason) => (
                layout::paragraph("Reason:", true)
                    + &layout::quote(&python_splitlines(&escape(reason)).join("<br>")),
                format!("Reason: {reason}"),
            ),
            None => (String::new(), String::new()),
        };
        (subject, heading, intro, html, text)
    };
    let body_text = [intro.as_str(), details_text.as_str(), CLOSING]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    EmailMessage {
        to: vec![recipient.to_owned()],
        sender: Some(EMAIL_DELIVERY.team_sender.clone()),
        subject,
        body_html: layout::shell(
            &heading,
            &(layout::paragraph(&escape(&intro), false)
                + &details_html
                + &layout::paragraph(&escape(CLOSING), true)),
            &[],
        ),
        body_text,
        inline_images: vec![Arc::clone(&layout::LOGO)],
        ..EmailMessage::default()
    }
}

/// Where a review decision leads, as paths on the school's site.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionPages {
    /// What was approved, live: the approval email's button and notification.
    pub approved: String,
    /// A page that shows a rejection and what to do next, if one does; the
    /// rejection email has no button, so only its notification leads there.
    pub rejected: Option<String>,
}

/// `send_review_decision`: email an approval or rejection when there is a
/// recipient, and repeat it in their inbox. Delivery failures are logged,
/// never raised, so they cannot undo the review.
#[allow(clippy::too_many_arguments)]
pub async fn send_review_decision(
    db: &PgPool,
    kind: Reviewed,
    title: &str,
    status: &str,
    recipient: Option<&str>,
    school: Option<&str>,
    pages: &DecisionPages,
    rejection_reason: Option<&str>,
) {
    let Some(recipient) = recipient.filter(|recipient| !recipient.is_empty()) else {
        return;
    };
    if status != "approved" && status != "rejected" {
        return;
    }
    let reason = rejection_reason
        .map(crate::text::python_strip)
        .filter(|reason| !reason.is_empty());
    let approved = status == "approved";
    let sent = match school_url(school) {
        Ok(base) => {
            let url = format!("{base}{}", pages.approved);
            let message = review_decision(kind, title, approved, recipient, &url, reason);
            let notice = decision_notice(kind, title, approved, &base, pages);
            send_then_record(db, &message, recipient, &notice).await
        }
        Err(error) => Err(format!("{error:#}")),
    };
    if let Err(error) = sent {
        tracing::error!("Background email dispatch failed for a {kind:?} review decision: {error}");
    }
}

/// The inbox's copy of a review decision, leading to the decision's page on
/// the school's site `base`, if it has one.
fn decision_notice(
    kind: Reviewed,
    title: &str,
    approved: bool,
    base: &str,
    pages: &DecisionPages,
) -> Notice {
    let page = if approved {
        Some(&pages.approved)
    } else {
        pages.rejected.as_ref()
    };
    Notice {
        kind: NotificationKind::ReviewDecision,
        event_id: None,
        details: NotificationDetails {
            name: Some(title.to_owned()),
            reviewed: Some(kind.noun().to_owned()),
            approved: Some(approved),
            ..NotificationDetails::default()
        },
        link: page.map(|path| format!("{base}{path}")),
    }
}

/// Send `message`, and only once SES has it, repeat it in the recipient's inbox.
async fn send_then_record(
    db: &PgPool,
    message: &EmailMessage,
    recipient: &str,
    notice: &Notice,
) -> Result<(), String> {
    email::send(message)
        .await
        .map_err(|error| error.to_string())?;
    inbox::record_for_emails(db, &[recipient.to_owned()], notice).await;
    Ok(())
}

fn school_url(school: Option<&str>) -> anyhow::Result<String> {
    crate::schools::frontend_url(&crate::settings::settings()?.frontend_url, school)
}

/// The invitation to join a club's management team.
pub fn invitation(club_name: &str, recipient: &str, invite_url: &str) -> EmailMessage {
    let days = CLUB_MANAGEMENT.invite_expiration_days;
    let intro = format!(
        "You've been invited to join the management team of {club_name} on wat2do. \
         Accept to get access to the club panel."
    );
    let expiry = format!(
        "This invitation expires in {days} days. \
         If you did not expect it, you can safely ignore this email."
    );
    EmailMessage {
        to: vec![recipient.to_owned()],
        subject: format!("Invitation to manage {club_name} on wat2do"),
        body_html: layout::shell(
            &format!("Join {club_name}"),
            &(layout::paragraph(&escape(&intro), false)
                + &layout::button(invite_url, "Accept invitation")
                + &layout::note(&escape(&expiry))),
            &[],
        ),
        body_text: format!("{intro}\n\nAccept the invitation: {invite_url}\n\n{expiry}"),
        inline_images: vec![Arc::clone(&layout::LOGO)],
        ..EmailMessage::default()
    }
}

/// Send an invitation, and repeat it in the invitee's inbox when they have
/// signed up; a failure is logged and the invitation still stands.
pub async fn send_invitation(
    db: &PgPool,
    club_name: &str,
    school: Option<&str>,
    recipient: &str,
    token: &str,
) {
    let sent = match school_url(school) {
        Ok(base) => {
            let url = format!("{base}/invite/{token}");
            let message = invitation(club_name, recipient, &url);
            let notice = Notice {
                kind: NotificationKind::ClubInvitation,
                event_id: None,
                details: NotificationDetails {
                    name: Some(club_name.to_owned()),
                    ..NotificationDetails::default()
                },
                link: Some(url),
            };
            send_then_record(db, &message, recipient, &notice).await
        }
        Err(error) => Err(format!("{error:#}")),
    };
    if let Err(error) = sent {
        tracing::warn!("Failed to send invitation email: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn club_email(approved: bool, reason: Option<&str>) -> EmailMessage {
        review_decision(
            Reviewed::Club,
            "Tea Club",
            approved,
            "lead@uwo.ca",
            "https://uwo.wat2do.io/clubs/7",
            reason,
        )
    }

    #[test]
    fn approval_comes_from_the_team_and_links_the_live_page() {
        // backend/tests/services/test_submission_review_email.py
        let message = club_email(true, None);
        assert_eq!(message.sender.as_deref(), Some("wat2do <team@wat2do.io>"));
        assert_eq!(message.to, ["lead@uwo.ca"]);
        assert_eq!(message.subject, "Your club Tea Club is live on wat2do");
        assert!(
            message
                .body_html
                .contains(r#"href="https://uwo.wat2do.io/clubs/7""#)
        );
        assert!(
            message
                .body_text
                .contains("View your club: https://uwo.wat2do.io/clubs/7")
        );
        assert_eq!(message.inline_images.len(), 1);
    }

    #[test]
    fn rejection_quotes_the_escaped_reason_without_a_link() {
        let message = club_email(false, Some("Not <b>a campus</b> club\nSorry"));
        assert_eq!(message.subject, "We could not approve your club Tea Club");
        assert!(
            message
                .body_html
                .contains("Not &lt;b&gt;a campus&lt;/b&gt; club<br>Sorry")
        );
        assert!(
            message
                .body_text
                .contains("Reason: Not <b>a campus</b> club\nSorry")
        );
        assert!(!message.body_html.contains(r#"href="https://uwo.wat2do.io"#));
        let bare = club_email(false, None);
        assert!(!bare.body_text.contains("Reason"));
        assert_eq!(
            bare.body_text,
            "Thanks for submitting your club. We reviewed it and could not approve it this time.\n\nQuestions? Reply to this email and our team will get back to you."
        );
    }

    #[test]
    fn submitted_events_and_positions_use_the_same_copy() {
        // test_rejection_quotes_the_escaped_reason_without_a_link (kind="event")
        let event = review_decision(
            Reviewed::Event,
            "Tea Club",
            false,
            "lead@uwo.ca",
            "https://uwo.wat2do.io/events",
            Some("Not <b>a campus</b> event\nSorry"),
        );
        assert_eq!(event.subject, "We could not approve your event Tea Club");
        assert!(
            event
                .body_html
                .contains("Not &lt;b&gt;a campus&lt;/b&gt; event<br>Sorry")
        );
        assert!(
            event
                .body_text
                .contains("Reason: Not <b>a campus</b> event\nSorry")
        );
        let position = review_decision(
            Reviewed::Position,
            "Design Lead",
            true,
            "lead@uwo.ca",
            "https://uwo.wat2do.io/positions",
            None,
        );
        assert_eq!(
            position.subject,
            "Your position Design Lead is live on wat2do"
        );
        assert!(
            position
                .body_text
                .contains("View your position: https://uwo.wat2do.io/positions")
        );
        assert_eq!(position.sender.as_deref(), Some("wat2do <team@wat2do.io>"));
    }

    #[test]
    fn claim_decisions_point_to_the_club_panel_or_explain_the_refusal() {
        let approved = review_decision(
            Reviewed::Claim,
            "Tea Club",
            true,
            "a@uwo.ca",
            "https://uwo.wat2do.io/club-panel",
            None,
        );
        assert_eq!(approved.subject, "You can now manage Tea Club on wat2do");
        assert!(
            approved
                .body_text
                .contains("Open the club panel: https://uwo.wat2do.io/club-panel")
        );
        let refused = review_decision(
            Reviewed::Claim,
            "Tea Club",
            false,
            "a@uwo.ca",
            "https://uwo.wat2do.io/club-panel",
            Some("Proof is blurry"),
        );
        assert_eq!(
            refused.subject,
            "We could not verify your claim for Tea Club"
        );
        assert!(refused.body_text.contains("could not verify your role"));
        assert!(refused.body_text.contains("Reason: Proof is blurry"));
    }

    #[test]
    fn a_decision_notification_leads_to_its_page_when_it_has_one() {
        let claim = DecisionPages {
            approved: club_panel_path("/club-panel", 7),
            rejected: Some("/clubs/7".to_owned()),
        };
        let base = "https://uwo.wat2do.io";
        let link = |kind, approved, pages: &DecisionPages| {
            decision_notice(kind, "Tea Club", approved, base, pages).link
        };
        assert_eq!(
            link(Reviewed::Claim, true, &claim).as_deref(),
            Some("https://uwo.wat2do.io/club-panel?club=7")
        );
        assert_eq!(
            link(Reviewed::Claim, false, &claim).as_deref(),
            Some("https://uwo.wat2do.io/clubs/7")
        );
        let event = DecisionPages {
            approved: "/events/42".to_owned(),
            rejected: None,
        };
        assert_eq!(
            link(Reviewed::Event, true, &event).as_deref(),
            Some("https://uwo.wat2do.io/events/42")
        );
        assert_eq!(link(Reviewed::Event, false, &event), None);
    }

    #[test]
    fn invitations_link_the_school_invite_page() {
        let message = invitation("Tea Club", "new@uwo.ca", "https://uwo.wat2do.io/invite/abc");
        assert_eq!(message.subject, "Invitation to manage Tea Club on wat2do");
        assert!(message.sender.is_none());
        assert!(
            message
                .body_text
                .contains("Accept the invitation: https://uwo.wat2do.io/invite/abc")
        );
        assert!(message.body_text.ends_with("This invitation expires in 7 days. If you did not expect it, you can safely ignore this email."));
        // The expiry is small print under the button.
        let html = &message.body_html;
        assert!(html.find("Accept invitation").unwrap() < html.find("font:14px/1.5").unwrap());
    }
}
