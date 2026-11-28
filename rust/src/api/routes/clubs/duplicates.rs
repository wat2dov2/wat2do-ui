//! Whether a club someone submits is one its school already lists, so the
//! sender is pointed to that club's page (to claim it or join its team) instead
//! of adding it twice.
//!
//! A school lists one club per Instagram account (`clubs_school_handle_key`,
//! compared by `club_handle_key`) and one club per name. Names are compared
//! after case, accents, punctuation, plurals, the school's own names
//! ("Carleton", "UofT") and words that never tell clubs apart ("the", "of") are
//! set aside, so "Afghan Student Association" is "Carleton Afghan Students
//! Association" at Carleton. A name that is the same is refused; a name that
//! is only like a listed one (it differs in words such as "club" or "society",
//! names another part of the school, has a word more, or a typo) is asked about
//! ("Is this your club?") and goes through once the sender says it is a
//! different club (`allow_similar_name`).

use std::collections::BTreeSet;

use serde::Serialize;
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;
use utoipa::ToSchema;

use crate::api::errors::ApiError;
use crate::controlbox::{CLUB_MANAGEMENT, DuplicateNames, INSTAGRAM_FOLLOW};
use crate::db::read_with_retry;

/// What a submitted club shares with the club its school already lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClubMatch {
    /// The same Instagram account: refused.
    Instagram,
    /// The same name: refused.
    Name,
    /// A name like it: refused until the sender says it is a different club.
    SimilarName,
}

/// Refuse an Instagram handle another club at the school already has: one club per
/// account and school (`clubs_school_handle_key`, compared by `club_handle_key`).
/// The answer names that club, so the sender can open it and claim it instead.
pub async fn ensure_handle_free(
    db: &sqlx::PgPool,
    school_slug: &str,
    ig: Option<&str>,
    except: Option<i64>,
) -> Result<(), ApiError> {
    let Some(ig) = ig else {
        return Ok(());
    };
    let existing: Option<(i32, String)> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT c.id, c.club_name FROM public.clubs c \
             JOIN public.schools s ON s.id = c.school_id \
             WHERE s.slug = $1 AND public.club_handle_key($2) <> '' \
               AND public.club_handle_key(c.ig) = public.club_handle_key($2) \
               AND c.id IS DISTINCT FROM $3::bigint \
             LIMIT 1",
        )
        .bind(school_slug)
        .bind(ig)
        .bind(except)
        .fetch_optional(db)
    })
    .await?;
    match existing {
        Some((club_id, club_name)) => Err(ApiError::ClubExists {
            club_id,
            club_name,
            matched: ClubMatch::Instagram,
        }),
        None => Ok(()),
    }
}

/// Refuse a club name its school already lists, and, unless the sender said it
/// is a different club (`allow_similar`), one like it. The school's clubs are
/// read once (by `ix_clubs_school_name`, about 1,700 names at the largest school)
/// and compared here; a rejected club never blocks one.
pub async fn ensure_name_new(
    db: &sqlx::PgPool,
    school_slug: &str,
    club_name: &str,
    allow_similar: bool,
) -> Result<(), ApiError> {
    let listed: Vec<(Option<String>, i32, String)> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT s.name, c.id, c.club_name FROM public.clubs c \
             JOIN public.schools s ON s.id = c.school_id \
             WHERE s.slug = $1 AND c.status IS DISTINCT FROM 'rejected' \
             ORDER BY c.id",
        )
        .bind(school_slug)
        .fetch_all(db)
    })
    .await?;
    let Some((school_name, ..)) = listed.first() else {
        return Ok(());
    };
    let school = SchoolNames::new(school_slug, school_name.as_deref().unwrap_or_default());
    let clubs = listed.iter().map(|(_, id, name)| (*id, name.as_str()));
    match closest_club(&school, club_name, clubs) {
        Some((club_id, name, matched)) if matched == ClubMatch::Name || !allow_similar => {
            Err(ApiError::ClubExists {
                club_id,
                club_name: name.to_owned(),
                matched,
            })
        }
        _ => Ok(()),
    }
}

/// The listed club whose name is the same as `name` (the first such), else the
/// one most like it, of `clubs` (id and name, oldest first).
fn closest_club<'a>(
    school: &SchoolNames,
    name: &str,
    clubs: impl Iterator<Item = (i32, &'a str)>,
) -> Option<(i32, &'a str, ClubMatch)> {
    let rules = &CLUB_MANAGEMENT.duplicate_names;
    let sent = NameKey::new(name, school, rules);
    let mut closest: Option<(Likeness, i32, &'a str)> = None;
    for (id, listed) in clubs {
        let Some(likeness) = sent.likeness(&NameKey::new(listed, school, rules), rules) else {
            continue;
        };
        if likeness == Likeness::Same {
            return Some((id, listed, ClubMatch::Name));
        }
        if closest
            .as_ref()
            .is_none_or(|(nearest, ..)| likeness < *nearest)
        {
            closest = Some((likeness, id, listed));
        }
    }
    closest.map(|(_, id, listed)| (id, listed, ClubMatch::SimilarName))
}

/// How alike two club names are, closest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Likeness {
    /// The same words: the same club.
    Same,
    /// The same words, but other club words ("club" against "society") or
    /// another part of the school ("Glendon" against "York").
    SameWords,
    /// One has every word of the other, in any order, and at most
    /// `similar_extra_words` more.
    MoreWords,
    /// The same words but for a typo in a long one.
    Typo,
}

/// A school's own names, each as one run of letters ("uoft", "carleton"): its
/// slug, its other names and abbreviations (`instagram_follow.json`
/// `school_names`) and each word of its full name.
struct SchoolNames(Vec<String>);

impl SchoolNames {
    fn new(slug: &str, full_name: &str) -> Self {
        let rules = &CLUB_MANAGEMENT.duplicate_names;
        let others = INSTAGRAM_FOLLOW
            .school_names
            .get(slug)
            .into_iter()
            .flatten();
        let mut names: Vec<String> = std::iter::once(slug)
            .chain(others.map(String::as_str))
            .map(|name| words(name).concat())
            .chain(words(full_name))
            .filter(|name| !name.is_empty() && !is_listed(name, &rules.function_words))
            .filter(|name| !is_listed(name, &rules.club_words))
            .collect();
        names.sort();
        names.dedup();
        Self(names)
    }

    /// How many of `words`, from the first, spell one of the school's names
    /// (the longest); "U of T" spells "uoft".
    fn spelled_by(&self, words: &[String]) -> Option<(usize, &str)> {
        self.0
            .iter()
            .filter_map(|name| {
                let mut spelled = String::new();
                for (count, word) in words.iter().enumerate() {
                    spelled.push_str(word);
                    if spelled.len() >= name.len() {
                        return (spelled == *name).then_some((count + 1, name.as_str()));
                    }
                }
                None
            })
            .max_by_key(|(count, _)| *count)
    }
}

/// A club name reduced to the words that tell clubs apart.
#[derive(Debug, PartialEq, Eq)]
struct NameKey {
    /// In order, without the school's names, function words or club words.
    words: Vec<String>,
    /// The school's names it carried ("carleton").
    school_names: BTreeSet<String>,
    /// The club words it carried ("student", "association").
    club_words: BTreeSet<String>,
}

impl NameKey {
    fn new(name: &str, school: &SchoolNames, rules: &DuplicateNames) -> Self {
        let all = words(name);
        let mut key = Self {
            words: Vec::new(),
            school_names: BTreeSet::new(),
            club_words: BTreeSet::new(),
        };
        let mut index = 0;
        while index < all.len() {
            if let Some((count, school_name)) = school.spelled_by(&all[index..]) {
                key.school_names.insert(school_name.to_owned());
                index += count;
                continue;
            }
            let word = &all[index];
            if is_listed(word, &rules.club_words) {
                key.club_words.insert(word.clone());
            } else if !is_listed(word, &rules.function_words) {
                key.words.push(word.clone());
            }
            index += 1;
        }
        key
    }

    /// How alike this name is to `other`, or `None` when they name different clubs.
    fn likeness(&self, other: &Self, rules: &DuplicateNames) -> Option<Likeness> {
        // A name of only school names and club words ("Carleton Student
        // Association") says nothing to compare; numbers ("Class of 2027") always differ.
        if self.words.is_empty() || other.words.is_empty() || numbers(self) != numbers(other) {
            return None;
        }
        if self.words == other.words || self.words.concat() == other.words.concat() {
            let both_name_the_school = !self.school_names.is_empty()
                && !other.school_names.is_empty()
                && !self.school_names.is_subset(&other.school_names)
                && !other.school_names.is_subset(&self.school_names);
            return Some(
                if both_name_the_school || self.club_words != other.club_words {
                    Likeness::SameWords
                } else {
                    Likeness::Same
                },
            );
        }
        let (fewer, more) = if self.words.len() <= other.words.len() {
            (self.word_set(), other.word_set())
        } else {
            (other.word_set(), self.word_set())
        };
        if fewer.len() >= rules.similar_minimum_words
            && fewer.is_subset(&more)
            && more.len() - fewer.len() <= rules.similar_extra_words
        {
            return Some(Likeness::MoreWords);
        }
        let typo = |a: &String, b: &String| {
            a == b
                || (a.chars().count().min(b.chars().count()) >= rules.typo_minimum_letters
                    && one_edit_apart(a, b))
        };
        (self.words.len() == other.words.len()
            && self.words.iter().zip(&other.words).all(|(a, b)| typo(a, b)))
        .then_some(Likeness::Typo)
    }

    fn word_set(&self) -> BTreeSet<&str> {
        self.words.iter().map(String::as_str).collect()
    }
}

fn numbers(key: &NameKey) -> BTreeSet<&str> {
    key.words
        .iter()
        .filter(|word| word.chars().all(|c| c.is_ascii_digit()))
        .map(String::as_str)
        .collect()
}

fn is_listed(word: &str, list: &[String]) -> bool {
    list.iter().any(|listed| listed == word)
}

/// The words of `text`: lower-cased, without accents or apostrophes
/// ("Students'" is "students"), split at anything else that is not a letter
/// or digit, each in its singular form.
fn words(text: &str) -> Vec<String> {
    let folded: String = text
        .chars()
        .filter(|c| !matches!(c, '\'' | '\u{2019}' | '\u{2018}' | '\u{02BC}' | '`'))
        .collect::<String>()
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect();
    folded
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(singular)
        .collect()
}

/// An English plural's singular, closely enough that both forms meet
/// ("societies" and "society" are both "society").
fn singular(word: &str) -> String {
    let stem = |suffix: &str| &word[..word.len() - suffix.len()];
    if word.len() > 4 && word.ends_with("ies") {
        format!("{}y", stem("ies"))
    } else if word.len() > 4 && word.ends_with("sses") {
        stem("es").to_owned()
    } else if word.len() > 3
        && word.ends_with('s')
        && !["ss", "us", "is"]
            .iter()
            .any(|ending| word.ends_with(ending))
    {
        stem("s").to_owned()
    } else {
        word.to_owned()
    }
}

/// Whether one letter added, removed or changed turns `a` into `b`.
fn one_edit_apart(a: &str, b: &str) -> bool {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let (shorter, longer) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    if longer.len() - shorter.len() > 1 || shorter == longer {
        return false;
    }
    // Past the first difference, the rest is the same once that letter is skipped.
    let prefix = shorter
        .iter()
        .zip(&longer)
        .take_while(|(x, y)| x == y)
        .count();
    let rest = if shorter.len() == longer.len() {
        prefix + 1
    } else {
        prefix
    };
    shorter[rest..] == longer[prefix + 1..]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn school(slug: &str, name: &str) -> SchoolNames {
        SchoolNames::new(slug, name)
    }

    fn closest<'a>(
        school: &SchoolNames,
        name: &str,
        clubs: &[(i32, &'a str)],
    ) -> Option<(i32, &'a str, ClubMatch)> {
        closest_club(school, name, clubs.iter().copied())
    }

    fn likeness(school: &SchoolNames, a: &str, b: &str) -> Option<Likeness> {
        let rules = &CLUB_MANAGEMENT.duplicate_names;
        NameKey::new(a, school, rules).likeness(&NameKey::new(b, school, rules), rules)
    }

    #[test]
    fn the_same_club_under_another_name_is_refused() {
        // 2026-11-27: a student added Carleton's Afghan Students Association again.
        let carleton = school("carleton", "Carleton University");
        let listed = [
            (1, "Carleton Chess Club"),
            (32912, "Carleton Afghan Students Association"),
        ];
        assert_eq!(
            closest(&carleton, "Afghan Student Association", &listed),
            Some((
                32912,
                "Carleton Afghan Students Association",
                ClubMatch::Name
            ))
        );
        for same in [
            "afghan students' association",
            "The Afghan Student’s Association at Carleton University",
            "AFGHAN STUDENTS ASSOCIATION (Carleton University)",
        ] {
            assert_eq!(
                likeness(&carleton, same, "Afghan Student Association"),
                Some(Likeness::Same),
                "{same}"
            );
        }
        let uoft = school("utsg", "University of Toronto St. George");
        for (a, b) in [
            ("UofT Cheese Club", "Cheese Club"),
            ("Société de débat", "Societe de Debat"),
            ("E-Sports Club", "Esports Club"),
            (
                "Women in Science and Engineering",
                "Women in Science & Engineering",
            ),
        ] {
            assert_eq!(likeness(&uoft, a, b), Some(Likeness::Same), "{a} / {b}");
        }
        // Two different names of the school read like two parts of it: asked.
        assert_eq!(
            likeness(
                &uoft,
                "U of T Cheese Club",
                "University of Toronto Cheese Club"
            ),
            Some(Likeness::SameWords)
        );
    }

    #[test]
    fn a_name_only_like_a_listed_one_is_asked_about() {
        let york = school("yorku", "York University");
        for (a, b, like) in [
            // Other club words: a club team is not always the varsity one.
            ("York Chess Club", "York Chess Society", Likeness::SameWords),
            (
                "Women's Club Soccer",
                "York Women's Soccer",
                Likeness::SameWords,
            ),
            // Another part of the school.
            (
                "Glendon Photography Club",
                "Osgoode Photography Club",
                Likeness::SameWords,
            ),
            (
                "Chinese Scholars Association",
                "Chinese Visiting Scholars Association",
                Likeness::MoreWords,
            ),
            (
                "Investment Banking Club",
                "Investmnt Banking Club",
                Likeness::Typo,
            ),
            // The same words in another order.
            ("Kappa Sigma", "Sigma Kappa", Likeness::MoreWords),
        ] {
            assert_eq!(likeness(&york, a, b), Some(like), "{a} / {b}");
        }
        let listed = [
            (4, "York Debating Society"),
            (5, "Osgoode Debating Society"),
        ];
        assert_eq!(
            closest(&york, "Debating Club", &listed),
            Some((4, "York Debating Society", ClubMatch::SimilarName))
        );
    }

    #[test]
    fn different_clubs_are_left_alone() {
        let waterloo = school("uwaterloo", "University of Waterloo");
        for (a, b) in [
            ("Class of 2027", "Class of 2028"),
            ("Tennis Club", "Table Tennis Club"),
            ("Alpha Delta Pi", "Alpha Delta Phi"),
            ("Men's Basketball", "Women's Basketball"),
            ("BUKSA", "BUNSA"),
            // Nothing but the school's names and club words to compare.
            ("Waterloo Student Association", "UW Students Society"),
        ] {
            assert_eq!(likeness(&waterloo, a, b), None, "{a} / {b}");
        }
        assert_eq!(closest(&waterloo, "Chess Club", &[]), None);
    }

    #[test]
    fn names_fold_to_singular_unaccented_words() {
        assert_eq!(
            words("Société des Étudiants’ Clubs (SÉC) & Universities"),
            ["societe", "des", "etudiant", "club", "sec", "university"]
        );
        assert_eq!(words("𝗮𝗻𝘁𝗵𝗿𝗼𝗽𝗼𝗹𝗼𝗴𝘆 classes"), ["anthropology", "class"]);
        assert!(one_edit_apart("investment", "investmnt"));
        assert!(one_edit_apart("council", "kouncil"));
        assert!(!one_edit_apart("investment", "investmnet"));
        assert!(!one_edit_apart("autism", "autism"));
    }

    #[test]
    fn listed_words_are_their_own_singular() {
        let rules = &CLUB_MANAGEMENT.duplicate_names;
        for word in rules.function_words.iter().chain(&rules.club_words) {
            assert_eq!(words(word), std::slice::from_ref(word), "{word}");
        }
    }
}
