//! The editorial choices a draft is saved from (`selection.py`): which events,
//! in which order, with which stickers. Claude's answer and a `save` file are
//! checked here before anything is written; an admin still reviews the draft.
//!
//! A refusal reads like pydantic's: one location line and one message line per
//! problem, which the curation agent is shown when it must answer again.

use std::fmt;

use chrono::{DateTime, Utc};
use serde_json::{Map, Value};
use unicode_general_category::{GeneralCategory, get_general_category};

use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::text::python_space;

/// Instagram's caption length, the most a caption intro can hold.
pub const CAPTION_INTRO_LIMIT: usize = 2200;

/// `CarouselPick`: one slide's event and its sticker labels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CarouselPick {
    pub event_id: i64,
    pub sticker_labels: Vec<String>,
}

/// `DraftSelection`: one school's draft, as Claude or a `save` file chose it.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftSelection {
    pub account_key: String,
    pub window_end: DateTime<Utc>,
    pub caption_intro: String,
    pub cover_body: String,
    pub picks: Vec<CarouselPick>,
}

/// Every problem found in one selection, as pydantic lists them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionError(pub Vec<(String, String)>);

impl fmt::Display for SelectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let count = self.0.len();
        write!(
            formatter,
            "{count} validation error{} for DraftSelection",
            if count == 1 { "" } else { "s" }
        )?;
        for (location, message) in &self.0 {
            write!(formatter, "\n{location}\n  {message}")?;
        }
        Ok(())
    }
}

impl std::error::Error for SelectionError {}

/// Collects problems with their locations.
#[derive(Default)]
struct Problems(Vec<(String, String)>);

impl Problems {
    fn add(&mut self, location: impl Into<String>, message: impl Into<String>) {
        self.0.push((location.into(), message.into()));
    }

    /// A string field within `minimum..=maximum` characters.
    fn string(
        &mut self,
        location: &str,
        value: Option<&Value>,
        minimum: usize,
        maximum: Option<usize>,
    ) -> String {
        let Some(value) = value else {
            self.add(location, "Field required");
            return String::new();
        };
        let Some(text) = value.as_str() else {
            self.add(location, "Input should be a valid string");
            return String::new();
        };
        let length = text.chars().count();
        if length < minimum {
            self.add(
                location,
                format!(
                    "String should have at least {minimum} character{}",
                    plural(minimum)
                ),
            );
        }
        if let Some(maximum) = maximum.filter(|maximum| length > *maximum) {
            self.add(
                location,
                format!(
                    "String should have at most {maximum} character{}",
                    plural(maximum)
                ),
            );
        }
        text.to_owned()
    }

    fn extra(&mut self, prefix: &str, object: &Map<String, Value>, allowed: &[&str]) {
        for key in object.keys().filter(|key| !allowed.contains(&key.as_str())) {
            self.add(format!("{prefix}{key}"), "Extra inputs are not permitted");
        }
    }
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

/// `" ".join(label.split())`.
fn normalize(label: &str) -> String {
    label
        .split(python_space)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `textwrap.wrap(label, width, break_long_words=False, break_on_hyphens=False)`
/// for a label whose words are single-spaced.
fn wrap(label: &str, width: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut line = String::new();
    for word in label.split(' ').filter(|word| !word.is_empty()) {
        let length = line.chars().count();
        if line.is_empty() {
            line = word.to_owned();
        } else if length + 1 + word.chars().count() <= width {
            line.push(' ');
            line.push_str(word);
        } else {
            lines.push(std::mem::replace(&mut line, word.to_owned()));
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

/// `str.isalpha()` for one character: any letter category.
fn is_letter(character: char) -> bool {
    matches!(
        get_general_category(character),
        GeneralCategory::UppercaseLetter
            | GeneralCategory::LowercaseLetter
            | GeneralCategory::TitlecaseLetter
            | GeneralCategory::ModifierLetter
            | GeneralCategory::OtherLetter
    )
}

/// `CarouselPick.validate_labels`: distinct labels that fit two short lines,
/// every word capitalized; whitespace is collapsed.
pub fn validate_labels(labels: &[String]) -> Result<Vec<String>, String> {
    let control = &*INSTAGRAM_PUBLISHING;
    let normalized: Vec<String> = labels.iter().map(|label| normalize(label)).collect();
    let mut folded: Vec<String> = normalized
        .iter()
        .map(|label| crate::text::casefold(label))
        .collect();
    folded.sort();
    folded.dedup();
    if folded.len() != normalized.len() {
        return Err("Every event sticker must highlight a different benefit or detail".into());
    }
    for label in &normalized {
        let lines = wrap(label, control.sticker_line_character_limit);
        if lines.is_empty()
            || lines.len() > control.sticker_maximum_lines
            || lines
                .iter()
                .any(|line| line.chars().count() > control.sticker_line_character_limit)
        {
            return Err("Sticker labels must fit two lines of at most 12 characters".into());
        }
        if label.split(python_space).any(|word| {
            word.chars()
                .find(|character| is_letter(*character))
                .is_some_and(char::is_lowercase)
        }) {
            return Err("Sticker words must start with capital letters".into());
        }
    }
    Ok(normalized)
}

/// One pick, from JSON.
fn pick(problems: &mut Problems, index: usize, value: &Value) -> Option<CarouselPick> {
    let prefix = format!("picks.{index}");
    let Value::Object(object) = value else {
        problems.add(
            prefix,
            "Input should be a valid dictionary or instance of CarouselPick",
        );
        return None;
    };
    problems.extra(
        &format!("{prefix}."),
        object,
        &["event_id", "sticker_labels"],
    );
    let event_id = match object.get("event_id") {
        None => {
            problems.add(format!("{prefix}.event_id"), "Field required");
            None
        }
        Some(value) => match value.as_i64().or_else(|| {
            value
                .as_f64()
                .filter(|number| number.fract() == 0.0)
                .map(|number| number as i64)
        }) {
            Some(id) => Some(id),
            None => {
                problems.add(
                    format!("{prefix}.event_id"),
                    "Input should be a valid integer",
                );
                None
            }
        },
    };
    let location = format!("{prefix}.sticker_labels");
    let labels = match object.get("sticker_labels") {
        None => {
            problems.add(&location, "Field required");
            None
        }
        Some(Value::Array(items)) => {
            let labels: Vec<String> = items
                .iter()
                .enumerate()
                .filter_map(|(item, value)| match value.as_str() {
                    Some(label) => Some(label.to_owned()),
                    None => {
                        problems.add(
                            format!("{location}.{item}"),
                            "Input should be a valid string",
                        );
                        None
                    }
                })
                .collect();
            let maximum = INSTAGRAM_PUBLISHING.maximum_stickers_per_event;
            if labels.len() != items.len() {
                None
            } else if labels.is_empty() {
                problems.add(
                    &location,
                    "List should have at least 1 item after validation, not 0",
                );
                None
            } else if labels.len() > maximum {
                problems.add(
                    &location,
                    format!(
                        "List should have at most {maximum} items after validation, not {}",
                        labels.len()
                    ),
                );
                None
            } else {
                match validate_labels(&labels) {
                    Ok(labels) => Some(labels),
                    Err(message) => {
                        problems.add(&location, format!("Value error, {message}"));
                        None
                    }
                }
            }
        }
        Some(_) => {
            problems.add(&location, "Input should be a valid list");
            None
        }
    };
    Some(CarouselPick {
        event_id: event_id?,
        sticker_labels: labels?,
    })
}

impl DraftSelection {
    /// A selection from its parts, the picks still as JSON (Claude's answer).
    pub fn new(
        account_key: &str,
        window_end: DateTime<Utc>,
        caption_intro: &str,
        cover_body: &str,
        picks: &Value,
    ) -> Result<Self, SelectionError> {
        let mut problems = Problems::default();
        let account_key = problems.string("account_key", Some(&Value::from(account_key)), 1, None);
        let caption_intro = problems.string(
            "caption_intro",
            Some(&Value::from(caption_intro)),
            0,
            Some(CAPTION_INTRO_LIMIT),
        );
        let cover_body = problems.string(
            "cover_body",
            Some(&Value::from(cover_body)),
            0,
            Some(INSTAGRAM_PUBLISHING.cover_body_character_limit),
        );
        let picks = Self::picks(&mut problems, Some(picks));
        Self::finish(
            problems,
            account_key,
            Some(window_end),
            caption_intro,
            cover_body,
            picks,
        )
    }

    /// `DraftSelection.model_validate_json`: a `save` file.
    pub fn from_json(text: &str) -> Result<Self, SelectionError> {
        let mut problems = Problems::default();
        let value: Value = serde_json::from_str(text).map_err(|error| {
            SelectionError(vec![(String::new(), format!("Invalid JSON: {error}"))])
        })?;
        let Value::Object(object) = value else {
            return Err(SelectionError(vec![(
                String::new(),
                "Input should be an object".into(),
            )]));
        };
        problems.extra(
            "",
            &object,
            &[
                "account_key",
                "window_end",
                "caption_intro",
                "cover_body",
                "picks",
            ],
        );
        let account_key = problems.string("account_key", object.get("account_key"), 1, None);
        let window_end = match object.get("window_end") {
            None => {
                problems.add("window_end", "Field required");
                None
            }
            Some(value) => {
                let parsed = value.as_str().and_then(crate::text::parse_iso_datetime);
                if parsed.is_none() {
                    problems.add("window_end", "Input should be a valid datetime");
                }
                parsed
            }
        };
        let caption_intro = problems.string(
            "caption_intro",
            object.get("caption_intro"),
            0,
            Some(CAPTION_INTRO_LIMIT),
        );
        let cover_body = problems.string(
            "cover_body",
            object.get("cover_body"),
            0,
            Some(INSTAGRAM_PUBLISHING.cover_body_character_limit),
        );
        let picks = Self::picks(&mut problems, object.get("picks"));
        Self::finish(
            problems,
            account_key,
            window_end,
            caption_intro,
            cover_body,
            picks,
        )
    }

    fn picks(problems: &mut Problems, value: Option<&Value>) -> Vec<Option<CarouselPick>> {
        match value {
            None => {
                problems.add("picks", "Field required");
                Vec::new()
            }
            Some(Value::Array(items)) => items
                .iter()
                .enumerate()
                .map(|(index, item)| pick(problems, index, item))
                .collect(),
            Some(_) => {
                problems.add("picks", "Input should be a valid list");
                Vec::new()
            }
        }
    }

    fn finish(
        problems: Problems,
        account_key: String,
        window_end: Option<DateTime<Utc>>,
        caption_intro: String,
        cover_body: String,
        picks: Vec<Option<CarouselPick>>,
    ) -> Result<Self, SelectionError> {
        if !problems.0.is_empty() {
            return Err(SelectionError(problems.0));
        }
        Ok(Self {
            account_key,
            window_end: window_end.expect("checked above"),
            caption_intro,
            cover_body,
            picks: picks
                .into_iter()
                .map(|pick| pick.expect("checked above"))
                .collect(),
        })
    }
}

/// `validate_picks`: distinct events, each one of this school's candidates.
pub fn validate_picks(candidate_ids: &[i64], picks: &[CarouselPick]) -> Result<(), String> {
    let mut ids: Vec<i64> = picks.iter().map(|pick| pick.event_id).collect();
    let all_allowed = ids.iter().all(|id| candidate_ids.contains(id));
    ids.sort_unstable();
    ids.dedup();
    if ids.len() != picks.len() || !all_allowed {
        return Err("Draft choices must contain distinct eligible events".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn labels(labels: &[&str]) -> Vec<String> {
        labels.iter().map(|label| (*label).to_owned()).collect()
    }

    fn window_end() -> DateTime<Utc> {
        "2026-10-04T13:00:00Z".parse().unwrap()
    }

    #[test]
    fn original_copy_is_accepted_in_order() {
        // test_external_choices_accept_original_copy_and_preserve_order
        let draft = DraftSelection::new(
            "uwaterloo",
            window_end(),
            "",
            "",
            &json!([3, 1].map(|id| json!({"event_id": id, "sticker_labels": ["Free Pizza", "Reg. Required", "Meet Friends"]}))),
        )
        .unwrap();
        validate_picks(&[1, 2, 3, 4], &draft.picks).unwrap();
        assert_eq!(
            draft
                .picks
                .iter()
                .map(|pick| pick.event_id)
                .collect::<Vec<_>>(),
            [3, 1]
        );
        assert_eq!(
            draft.picks[0].sticker_labels,
            labels(&["Free Pizza", "Reg. Required", "Meet Friends"])
        );
    }

    #[test]
    fn invalid_copy_fails_before_saving() {
        // test_invalid_copy_fails_before_saving
        for invalid in [
            &["Free", "free"][..],
            &["Free Pizza", "Free Pizza"],
            &[""],
            &["Registrations Required"],
            &["One Two Three Four Five Six"],
            &["free Pizza"],
            &["Free pizza"],
        ] {
            assert!(validate_labels(&labels(invalid)).is_err(), "{invalid:?}");
        }
        let five = DraftSelection::new(
            "uwaterloo",
            window_end(),
            "",
            "",
            &json!([{"event_id": 1, "sticker_labels": ["One", "Two", "Three", "Four", "Five"]}]),
        )
        .unwrap_err();
        assert_eq!(
            five.to_string(),
            "1 validation error for DraftSelection\npicks.0.sticker_labels\n  List should have at most 4 items after validation, not 5"
        );
    }

    #[test]
    fn four_distinct_stickers_have_their_whitespace_collapsed() {
        // test_four_distinct_stickers_and_whitespace_normalization
        assert_eq!(
            validate_labels(&labels(&[
                " Free  Pizza ",
                "Reg. Required",
                "Cash Prizes",
                "$5 Entry"
            ]))
            .unwrap(),
            labels(&["Free Pizza", "Reg. Required", "Cash Prizes", "$5 Entry"])
        );
    }

    #[test]
    fn refusals_name_each_problem_for_the_agent() {
        // test_rejected_answer_is_retried_with_the_reason
        let refused = DraftSelection::new(
            "uwaterloo",
            window_end(),
            "",
            &"x".repeat(121),
            &json!([{"event_id": 17, "sticker_labels": ["free pizza"]}]),
        )
        .unwrap_err();
        assert_eq!(
            refused.to_string(),
            "2 validation errors for DraftSelection\ncover_body\n  String should have at most 120 characters\n\
             picks.0.sticker_labels\n  Value error, Sticker words must start with capital letters"
        );
    }

    #[test]
    fn invalid_event_selections_fail() {
        // test_invalid_event_selection_fails and test_empty_pool_accepts_only_empty_choices
        let pick = |id| CarouselPick {
            event_id: id,
            sticker_labels: labels(&["Free"]),
        };
        assert!(validate_picks(&[1], &[pick(999)]).is_err());
        assert!(validate_picks(&[1], &[pick(1), pick(1)]).is_err());
        validate_picks(&[], &[]).unwrap();
        assert!(validate_picks(&[], &[pick(1)]).is_err());
        // test_editorial_threshold_can_reject_the_entire_eligible_pool
        validate_picks(&[1], &[]).unwrap();
        // test_editorial_threshold_can_keep_more_than_publication_capacity
        let candidates: Vec<i64> = (1..=15).collect();
        let picks: Vec<CarouselPick> = candidates.iter().map(|id| pick(*id)).collect();
        validate_picks(&candidates, &picks).unwrap();
    }

    #[test]
    fn save_files_are_read_strictly() {
        // test_save_command_validates_external_choices
        let draft = DraftSelection::from_json(
            r#"{"account_key": "uwaterloo", "window_end": "2026-09-28T14:00:00Z",
                "caption_intro": "Today's plans", "cover_body": "Campus picks",
                "picks": [{"event_id": 17, "sticker_labels": ["Meet Friends"]}]}"#,
        )
        .unwrap();
        assert_eq!(draft.picks[0].event_id, 17);
        assert_eq!(
            draft.window_end,
            "2026-09-28T14:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
        let refused = DraftSelection::from_json(
            r#"{"account_key": "", "window_end": "soon", "caption_intro": "",
                "cover_body": "", "picks": [], "notes": "extra"}"#,
        )
        .unwrap_err();
        assert_eq!(
            refused
                .0
                .iter()
                .map(|(location, _)| location.as_str())
                .collect::<Vec<_>>(),
            ["notes", "account_key", "window_end"]
        );
    }
}
