//! pydantic's `EmailStr`: `email-validator` (`validate_email` with
//! `check_deliverability=False`), returning the normalized address that
//! Python stores, or the reason pydantic reports
//! (`value is not a valid email address: {reason}`).
//!
//! Every check of `email_validator/syntax.py` (2.3) is here in the same order
//! with the same messages. Internationalized domains go through the `idna`
//! crate's UTS-46, so their rare failure messages may word the IDNA cause
//! differently; a character outside letters, numbers, punctuation and
//! symbols is shown by code point rather than by its Unicode name, except for
//! the spaces named below.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;
use unicode_general_category::{GeneralCategory, get_general_category};
use unicode_normalization::UnicodeNormalization;

/// pydantic's `MAX_EMAIL_LENGTH`.
const MAX_INPUT_LENGTH: usize = 2048;
const EMAIL_MAX_LENGTH: usize = 254;
const DNS_LABEL_LENGTH_LIMIT: usize = 63;
const DOMAIN_MAX_LENGTH: usize = 253;
const CASE_INSENSITIVE_MAILBOX_NAMES: [&str; 15] = [
    "info",
    "marketing",
    "sales",
    "support",
    "abuse",
    "noc",
    "security",
    "postmaster",
    "hostmaster",
    "usenet",
    "news",
    "webmaster",
    "www",
    "uucp",
    "ftp",
];
const SPECIAL_USE_DOMAIN_NAMES: [&str; 6] =
    ["arpa", "invalid", "local", "localhost", "onion", "test"];

const ATEXT: &str = r"a-zA-Z0-9_!#\$%&'\*\+\-/=\?\^`\{\|\}~";

static DOT_ATOM_TEXT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"^[{ATEXT}]+(?:\.[{ATEXT}]+)*$")).expect("regex"));
static DOT_ATOM_TEXT_INTL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^[{ATEXT}\u{{80}}-\u{{10FFFF}}]+(?:\.[{ATEXT}\u{{80}}-\u{{10FFFF}}]+)*$"
    ))
    .expect("regex")
});
static DOT_ATOM_TEXT_HOSTNAME: LazyLock<Regex> = LazyLock::new(|| {
    let label = r"(?:(?:[a-zA-Z0-9][a-zA-Z0-9\-]*)?[a-zA-Z0-9])";
    Regex::new(&format!(r"^{label}(?:\.{label})*$")).expect("regex")
});
/// pydantic's `pretty_email_regex`: `Name <address>`.
static PRETTY_EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    let name_chars = r"[\w.!#$%&'*+\-/=?^_`{|}~]";
    Regex::new(&format!(
        r#"^\s*(?:((?:{name_chars}+\s+)*{name_chars}+)|"((?:[^"]|")+)")?\s*<(.+)>\s*$"#
    ))
    .expect("regex")
});

fn atext(character: char) -> bool {
    character.is_ascii_alphanumeric() || "_!#$%&'*+-/=?^`{|}~".contains(character)
}

fn atext_intl_or_dot(character: char) -> bool {
    atext(character) || character == '.' || character as u32 >= 0x80
}

fn hostname_intl(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || character == '-'
        || character == '.'
        || character as u32 >= 0x80
}

fn qtext_intl(character: char) -> bool {
    (' '..='~').contains(&character) || character as u32 >= 0x80
}

fn category_class(character: char) -> char {
    use GeneralCategory::*;
    match get_general_category(character) {
        UppercaseLetter | LowercaseLetter | TitlecaseLetter | ModifierLetter | OtherLetter => 'L',
        NonspacingMark | SpacingMark | EnclosingMark => 'M',
        DecimalNumber | LetterNumber | OtherNumber => 'N',
        ConnectorPunctuation | DashPunctuation | OpenPunctuation | ClosePunctuation
        | InitialPunctuation | FinalPunctuation | OtherPunctuation => 'P',
        MathSymbol | CurrencySymbol | ModifierSymbol | OtherSymbol => 'S',
        SpaceSeparator | LineSeparator | ParagraphSeparator => 'Z',
        _ => 'C',
    }
}

/// `safe_character_display`.
fn display(character: char) -> String {
    if character == '\\' {
        return "\"\\\"".to_owned();
    }
    if matches!(category_class(character), 'L' | 'N' | 'P' | 'S') {
        // Python's repr of a one-character string.
        return if character == '\'' {
            "\"'\"".to_owned()
        } else {
            format!("'{character}'")
        };
    }
    match character {
        ' ' => "SPACE".to_owned(),
        '\u{a0}' => "NO-BREAK SPACE".to_owned(),
        '\u{200b}' => "ZERO WIDTH SPACE".to_owned(),
        '\u{3000}' => "IDEOGRAPHIC SPACE".to_owned(),
        _ if (character as u32) < 0xFFFF => format!("U+{:04X}", character as u32),
        _ => format!("U+{:08X}", character as u32),
    }
}

fn bad_list(characters: impl IntoIterator<Item = char>) -> String {
    let set: BTreeSet<String> = characters.into_iter().map(display).collect();
    set.into_iter().collect::<Vec<_>>().join(", ")
}

type Check<T> = Result<T, String>;

/// Validate and normalize like pydantic's `EmailStr`; `Err` holds the reason.
pub fn normalize(value: &str) -> Check<String> {
    if value.chars().count() > MAX_INPUT_LENGTH {
        return Err(format!(
            "Length must not exceed {MAX_INPUT_LENGTH} characters"
        ));
    }
    if value.contains('\r') || value.contains('\n') {
        return Err("Carriage return and line feed characters are not allowed".to_owned());
    }
    let value = match PRETTY_EMAIL.captures(value) {
        Some(captures) => captures.get(3).expect("address group").as_str(),
        None => value,
    };
    validate(crate::text::python_strip(value))
}

/// `email_validator.validate_email(email, check_deliverability=False)`, normalized.
fn validate(email: &str) -> Check<String> {
    let (display_name, local, domain, quoted) = split_email(email)?;
    let original = if quoted {
        format!("\"{local}\"@{domain}")
    } else {
        format!("{local}@{domain}")
    };
    let local_info = validate_local_part(&local, quoted)?;
    let mut local_part = local_info.local_part;
    let mut ascii_local = local_info.ascii_local_part;
    let normalized_local: String = local_part.nfc().collect();
    if normalized_local != local_part {
        validate_local_part(&normalized_local, quoted)
            .map_err(|reason| format!("After Unicode normalization: {reason}"))?;
        local_part = normalized_local;
    }
    if quoted {
        return Err("Quoting the part before the @-sign is not allowed here.".to_owned());
    }
    if let Some(ascii) = &ascii_local
        && CASE_INSENSITIVE_MAILBOX_NAMES.contains(&ascii.to_lowercase().as_str())
    {
        ascii_local = Some(ascii.to_lowercase());
        local_part = local_part.to_lowercase();
    }
    if domain.is_empty() {
        return Err("There must be something after the @-sign.".to_owned());
    }
    if domain.starts_with('[') && domain.ends_with(']') {
        validate_domain_literal(&domain[1..domain.len() - 1])?;
        return Err("A bracketed IP address after the @-sign is not allowed here.".to_owned());
    }
    let (ascii_domain, unicode_domain) = validate_domain_name(&domain)?;
    let normalized = format!("{local_part}@{unicode_domain}");
    let ascii_form = format!(
        "{}@{ascii_domain}",
        ascii_local.as_deref().unwrap_or(&local_part)
    );
    validate_length(&original, &normalized, &ascii_form)?;
    if display_name.is_some() {
        return Err(
            "A display name and angle brackets around the email address are not permitted here."
                .to_owned(),
        );
    }
    Ok(normalized)
}

fn nfc_first_differs(text: &str, index: usize, character: char) -> bool {
    let rest: String = text.chars().skip(index).collect();
    rest.nfc().next() != Some(character)
}

/// `split_string_at_unquoted_special`.
fn split_at_special(text: &str, specials: &[char]) -> Check<(String, String)> {
    let mut inside_quote = false;
    let mut escaped = false;
    let mut left = String::new();
    let mut found = false;
    for (index, character) in text.chars().enumerate() {
        if nfc_first_differs(text, index, character) {
            left.push(character);
        } else if inside_quote {
            left.push(character);
            if character == '\\' && !escaped {
                escaped = true;
            } else if character == '"' && !escaped {
                inside_quote = false;
                escaped = false;
            } else {
                escaped = false;
            }
        } else if character == '"' {
            left.push(character);
            inside_quote = true;
        } else if specials.contains(&character) {
            found = true;
            break;
        } else {
            left.push(character);
        }
    }
    if !found {
        if text.contains('\u{FF20}') {
            return Err("The email address has the \"full-width\" at-sign (@) character instead of a regular at-sign.".to_owned());
        }
        if text.contains('\u{FE6B}') {
            return Err("The email address has the \"small commercial at\" character instead of a regular at-sign.".to_owned());
        }
        return Err("An email address must have an @-sign.".to_owned());
    }
    let right = text[left.len()..].to_owned();
    Ok((left, right))
}

/// `unquote_quoted_string`.
fn unquote(text: &str) -> Check<(String, bool)> {
    let characters: Vec<char> = text.chars().collect();
    let mut quoted = false;
    let mut escaped = false;
    let mut value = String::new();
    for (index, character) in characters.iter().copied().enumerate() {
        if quoted {
            if escaped {
                value.push(character);
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                if index != characters.len() - 1 {
                    let rest: Vec<String> = characters[index + 1..]
                        .iter()
                        .copied()
                        .map(display)
                        .collect();
                    return Err(format!(
                        "Extra character(s) found after close quote: {}",
                        rest.join(", ")
                    ));
                }
                break;
            } else {
                value.push(character);
            }
        } else if index == 0 && character == '"' {
            quoted = true;
        } else {
            value.push(character);
        }
    }
    Ok((value, quoted))
}

/// `split_email`: display name, unquoted local part, domain, and whether it was quoted.
fn split_email(email: &str) -> Check<(Option<String>, String, String, bool)> {
    let (left, right) = split_at_special(email, &['@', '<'])?;
    let (display_name, local, mut domain) = if let Some(after) = right.strip_prefix('<') {
        let left = left.trim_end();
        let (name, name_quoted) = unquote(left)?;
        if !name_quoted {
            let bad: Vec<char> = name
                .chars()
                .filter(|character| {
                    (!(atext(*character) || *character == '.') && *character != ' ')
                        || *character == '.'
                })
                .collect();
            if !bad.is_empty() {
                return Err(format!(
                    "The display name contains invalid characters when not quoted: {}.",
                    bad_list(bad)
                ));
            }
        }
        check_unsafe(&name, true)?;
        if !right.contains('>') {
            return Err("An open angle bracket at the start of the email address has to be followed by a close angle bracket at the end.".to_owned());
        }
        let trimmed = right.trim_end_matches(' ');
        if !trimmed.ends_with('>') {
            return Err("There can't be anything after the email address.".to_owned());
        }
        let spec = after.trim_end_matches(' ').trim_end_matches('>');
        let (local, domain) = split_at_special(spec, &['@'])?;
        (Some(name), local, domain)
    } else {
        (None, left, right)
    };
    if let Some(rest) = domain.strip_prefix('@') {
        domain = rest.to_owned();
    }
    let (local, quoted) = unquote(&local)?;
    Ok((display_name, local, domain, quoted))
}

struct LocalPart {
    local_part: String,
    ascii_local_part: Option<String>,
}

/// `validate_email_local_part` with SMTPUTF8 allowed and no empty local part.
fn validate_local_part(local: &str, quoted: bool) -> Check<LocalPart> {
    if local.is_empty() {
        return Err("There must be something before the @-sign.".to_owned());
    }
    if DOT_ATOM_TEXT.is_match(local) {
        return Ok(LocalPart {
            local_part: local.to_owned(),
            ascii_local_part: Some(local.to_owned()),
        });
    }
    let mut valid = None;
    let mut requires_smtputf8 = false;
    if DOT_ATOM_TEXT_INTL.is_match(local) {
        valid = Some("dot-atom");
        requires_smtputf8 = true;
    } else if quoted {
        let bad: Vec<char> = local.chars().filter(|c| !qtext_intl(*c)).collect();
        if !bad.is_empty() {
            return Err(format!(
                "The email address contains invalid characters in quotes before the @-sign: {}.",
                bad_list(bad)
            ));
        }
        if local.chars().any(|c| !(' '..='~').contains(&c)) {
            requires_smtputf8 = true;
        }
        valid = Some("quoted");
    }
    if let Some(kind) = valid {
        check_unsafe(local, kind == "quoted")?;
        let local_part = if kind == "quoted" {
            let mut escaped = String::from("\"");
            for character in local.chars() {
                if character == '"' || character == '\\' {
                    escaped.push('\\');
                }
                escaped.push(character);
            }
            escaped.push('"');
            escaped
        } else {
            local.to_owned()
        };
        return Ok(LocalPart {
            ascii_local_part: (!requires_smtputf8).then(|| local_part.clone()),
            local_part,
        });
    }
    let bad: Vec<char> = local.chars().filter(|c| !atext_intl_or_dot(*c)).collect();
    if !bad.is_empty() {
        return Err(format!(
            "The email address contains invalid characters before the @-sign: {}.",
            bad_list(bad)
        ));
    }
    check_dot_atom(
        local,
        "An email address cannot start with a {}.",
        "An email address cannot have a {} immediately before the @-sign.",
        false,
    )?;
    Err("The email address contains invalid characters before the @-sign.".to_owned())
}

/// `check_unsafe_chars`.
fn check_unsafe(text: &str, allow_space: bool) -> Check<()> {
    let mut bad = BTreeSet::new();
    for (index, character) in text.chars().enumerate() {
        match category_class(character) {
            'L' | 'N' | 'P' | 'S' => {}
            'M' => {
                if index == 0 {
                    bad.insert(character);
                }
            }
            'Z' => {
                if get_general_category(character) != GeneralCategory::SpaceSeparator
                    || !allow_space
                {
                    bad.insert(character);
                }
            }
            _ => {
                bad.insert(character);
            }
        }
    }
    if bad.is_empty() {
        return Ok(());
    }
    // Python sorts the characters themselves here, then displays them.
    let shown: Vec<String> = bad.into_iter().map(display).collect();
    Err(format!(
        "The email address contains unsafe characters: {}.",
        shown.join(", ")
    ))
}

fn check_dot_atom(label: &str, start: &str, end: &str, is_hostname: bool) -> Check<()> {
    let fill = |template: &str, what: &str| template.replace("{}", what);
    if label.ends_with('.') {
        return Err(fill(end, "period"));
    }
    if label.starts_with('.') {
        return Err(fill(start, "period"));
    }
    if label.contains("..") {
        return Err("An email address cannot have two periods in a row.".to_owned());
    }
    if is_hostname {
        if label.ends_with('-') {
            return Err(fill(end, "hyphen"));
        }
        if label.starts_with('-') {
            return Err(fill(start, "hyphen"));
        }
        if label.contains(".-") || label.contains("-.") {
            return Err(
                "An email address cannot have a period and a hyphen next to each other.".to_owned(),
            );
        }
    }
    Ok(())
}

/// `uts46_valid_char`, without the decomposition-to-dot rule (covered by UTS-46 below).
fn uts46_valid_char(character: char) -> bool {
    let code = character as u32;
    if (0x80..=0x9f).contains(&code) {
        return false;
    }
    if ((0x2010..=0x2060).contains(&code)
        && !(0x2024..=0x2026).contains(&code)
        && !(0x2028..=0x202E).contains(&code))
        || matches!(code, 0x00AD | 0x2064 | 0xFF0E)
        || (0x200B..=0x200D).contains(&code)
        || (0x1BCA0..=0x1BCA3).contains(&code)
    {
        return true;
    }
    use GeneralCategory::*;
    !matches!(
        get_general_category(character),
        Format
            | Unassigned
            | PrivateUse
            | Surrogate
            | SpaceSeparator
            | LineSeparator
            | ParagraphSeparator
    )
}

/// `validate_email_domain_name`: (ASCII form, Unicode form).
fn validate_domain_name(domain: &str) -> Check<(String, String)> {
    let invalid = |characters: Vec<char>, suffix: &str| {
        format!(
            "The part after the @-sign contains invalid characters{suffix}: {}.",
            bad_list(characters)
        )
    };
    let bad: Vec<char> = domain.chars().filter(|c| !hostname_intl(*c)).collect();
    if !bad.is_empty() {
        return Err(invalid(bad, ""));
    }
    check_unsafe(domain, false)?;
    let bad: Vec<char> = domain.chars().filter(|c| !uts46_valid_char(*c)).collect();
    if !bad.is_empty() {
        return Err(invalid(bad, ""));
    }
    // UTS-46 mapping: casefolding, NFC and label separators to dots.
    let remapped = if domain.is_ascii() {
        domain.to_ascii_lowercase()
    } else {
        let (mapped, result) = idna::domain_to_unicode(domain);
        result.map_err(|error| {
            format!("The part after the @-sign contains invalid characters ({error:?}).")
        })?;
        mapped
    };
    let bad: Vec<char> = remapped.chars().filter(|c| !hostname_intl(*c)).collect();
    if !bad.is_empty() {
        return Err(invalid(bad, " after Unicode normalization"));
    }
    check_dot_atom(
        &remapped,
        "An email address cannot have a {} immediately after the @-sign.",
        "An email address cannot end with a {}.",
        true,
    )?;
    for label in remapped.split('.') {
        let characters: Vec<char> = label.chars().collect();
        if characters.len() >= 4
            && characters[2] == '-'
            && characters[3] == '-'
            && !characters[..2]
                .iter()
                .collect::<String>()
                .eq_ignore_ascii_case("xn")
        {
            return Err("An email address cannot have two letters followed by two dashes immediately after the @-sign or after a period, except Punycode.".to_owned());
        }
    }
    let ascii_domain = if DOT_ATOM_TEXT_HOSTNAME.is_match(&remapped) {
        remapped.clone()
    } else {
        let ascii = idna::domain_to_ascii(&remapped)
            .map_err(|error| format!("The part after the @-sign is invalid ({error})."))?;
        if !DOT_ATOM_TEXT_HOSTNAME.is_match(&ascii) {
            return Err("The email address contains invalid characters after the @-sign after IDNA encoding.".to_owned());
        }
        ascii
    };
    if ascii_domain.len() > DOMAIN_MAX_LENGTH {
        let diff = ascii_domain.len() - DOMAIN_MAX_LENGTH;
        if ascii_domain == domain {
            return Err(format!(
                "The email address is too long after the @-sign {}.",
                length_reason(diff)
            ));
        }
        let plural = if diff == 1 { "" } else { "s" };
        return Err(format!(
            "The email address is too long after the @-sign ({diff} byte{plural} too many after IDNA encoding)."
        ));
    }
    for label in ascii_domain.split('.') {
        if label.len() > DNS_LABEL_LENGTH_LIMIT {
            return Err(format!(
                "After the @-sign, periods cannot be separated by so many characters {}.",
                length_reason(label.len() - DNS_LABEL_LENGTH_LIMIT)
            ));
        }
    }
    if !ascii_domain.contains('.') {
        return Err("The part after the @-sign is not valid. It should have a period.".to_owned());
    }
    if !ascii_domain
        .chars()
        .last()
        .is_some_and(|last| last.is_ascii_alphabetic())
    {
        return Err(
            "The part after the @-sign is not valid. It is not within a valid top-level domain."
                .to_owned(),
        );
    }
    for special in SPECIAL_USE_DOMAIN_NAMES {
        if ascii_domain == special || ascii_domain.ends_with(&format!(".{special}")) {
            return Err("The part after the @-sign is a special-use or reserved name that cannot be used with email.".to_owned());
        }
    }
    let unicode_domain = if ascii_domain
        .split('.')
        .any(|label| label.to_ascii_lowercase().starts_with("xn--"))
    {
        let (decoded, result) = idna::domain_to_unicode(&ascii_domain);
        result
            .map_err(|error| format!("The part after the @-sign is not valid IDNA ({error:?})."))?;
        decoded
    } else {
        ascii_domain.clone()
    };
    Ok((ascii_domain, unicode_domain))
}

fn length_reason(diff: usize) -> String {
    let plural = if diff > 1 { "s" } else { "" };
    format!("({diff} character{plural} too many)")
}

/// `validate_email_domain_literal`: only its errors matter, since pydantic
/// never allows a bracketed address.
fn validate_domain_literal(literal: &str) -> Check<()> {
    if !literal.is_empty() && literal.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return literal
            .parse::<std::net::Ipv4Addr>()
            .map(|_| ())
            .map_err(|_| format!("The address in brackets after the @-sign is not valid: It is not an IPv4 address (Expected 4 octets in {literal:?}) or is missing an address literal tag."));
    }
    if let Some(address) = literal.strip_prefix("IPv6:") {
        return address
            .parse::<std::net::Ipv6Addr>()
            .map(|_| ())
            .map_err(|_| format!("The IPv6 address in brackets after the @-sign is not valid ({address:?} does not appear to be an IPv6 address)."));
    }
    if !literal.contains(':') {
        return Err("The part after the @-sign in brackets is not an IPv4 address and has no address literal tag.".to_owned());
    }
    Err("The part after the @-sign contains an invalid address literal tag in brackets.".to_owned())
}

/// `validate_email_length`.
fn validate_length(original: &str, normalized: &str, ascii: &str) -> Check<()> {
    for (address, reason) in [
        (original, None),
        (normalized, Some("after normalization")),
        (
            ascii,
            Some("when the part after the @-sign is converted to IDNA ASCII"),
        ),
    ] {
        let characters = address.chars().count();
        let bytes = address.len();
        if bytes <= EMAIL_MAX_LENGTH {
            continue;
        }
        let diff = bytes - EMAIL_MAX_LENGTH;
        let plural = if diff > 1 { "s" } else { "" };
        let reason = match reason {
            None if characters == bytes => length_reason(diff),
            None => {
                let widest = address.chars().map(char::len_utf8).max().unwrap_or(1);
                let fewest = (diff / widest).max(1);
                if fewest == diff {
                    format!("({diff} character{plural} too many)")
                } else {
                    format!("({fewest}-{diff} character{plural} too many)")
                }
            }
            Some(reason) => format!("{reason} ({diff} byte{plural} too many)"),
        };
        return Err(format!("The email address is too long {reason}."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_addresses_are_normalized_like_email_validator() {
        for (input, expected) in [
            ("student@uwaterloo.ca", "student@uwaterloo.ca"),
            ("Student@UWaterloo.CA", "Student@uwaterloo.ca"),
            ("  padded@example.com  ", "padded@example.com"),
            ("Info@Example.com", "info@example.com"),
            ("Jane Doe <jane@example.com>", "jane@example.com"),
            ("a.b+tag@sub.example.org", "a.b+tag@sub.example.org"),
            ("josé@example.com", "josé@example.com"),
        ] {
            assert_eq!(normalize(input).as_deref(), Ok(expected), "{input}");
        }
    }

    #[test]
    fn invalid_addresses_give_email_validator_reasons() {
        // Messages from pydantic 2 / email-validator 2.3 for the same inputs.
        for (input, reason) in [
            ("not-an-email", "An email address must have an @-sign."),
            (
                "a@b",
                "The part after the @-sign is not valid. It should have a period.",
            ),
            (
                "a@@b.com",
                "The part after the @-sign contains invalid characters: '@'.",
            ),
            ("@b.com", "There must be something before the @-sign."),
            ("a@", "There must be something after the @-sign."),
            (".a@b.com", "An email address cannot start with a period."),
            (
                "a.@b.com",
                "An email address cannot have a period immediately before the @-sign.",
            ),
            (
                "a..b@c.com",
                "An email address cannot have two periods in a row.",
            ),
            (
                "a b@c.com",
                "The email address contains invalid characters before the @-sign: SPACE.",
            ),
            (
                "a@-b.com",
                "An email address cannot have a hyphen immediately after the @-sign.",
            ),
            (
                "a@b.c0m1",
                "The part after the @-sign is not valid. It is not within a valid top-level domain.",
            ),
            (
                "a@site.local",
                "The part after the @-sign is a special-use or reserved name that cannot be used with email.",
            ),
            (
                "\"quoted\"@example.com",
                "Quoting the part before the @-sign is not allowed here.",
            ),
            (
                "a@[127.0.0.1]",
                "A bracketed IP address after the @-sign is not allowed here.",
            ),
            (
                "a\nb@c.com",
                "Carriage return and line feed characters are not allowed",
            ),
        ] {
            assert_eq!(normalize(input), Err(reason.to_owned()), "{input:?}");
        }
        let long = format!("{}@example.com", "a".repeat(250));
        assert_eq!(
            normalize(&long),
            Err("The email address is too long (8 characters too many).".to_owned())
        );
    }
}
