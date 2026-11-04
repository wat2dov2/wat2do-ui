//! The raw message SES sends: text and HTML alternatives, with inline images
//! in a `multipart/related` container around the HTML.
//!
//! Gmail and Outlook only resolve `cid:` images that sit in the HTML part's
//! related container, so the message is assembled here rather than by SES.
//! Bodies are encoded exactly as Python's `email` package encodes them
//! (`email.policy.default`: 78-character lines, `\n` line endings), so the
//! parts SES receives are byte-for-byte what the Python service sent.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;

use super::EmailMessage;

const MAX_LINE_LENGTH: usize = 78;

pub fn build(message: &EmailMessage, sender: &str) -> Vec<u8> {
    let alternative = boundary();
    let related = boundary();
    let mut out = String::new();
    header(&mut out, "From", sender);
    header(&mut out, "To", &message.to.join(", "));
    out.push_str(&subject_header(&message.subject));
    if let Some(reply_to) = &message.reply_to {
        header(&mut out, "Reply-To", reply_to);
    }
    for (name, value) in &message.headers {
        // List-Unsubscribe and similar are structured: a URL is never folded or
        // turned into an encoded word, which mail clients would not read back.
        header(&mut out, name, value);
    }
    out.push_str("MIME-Version: 1.0\n");
    multipart_header(&mut out, "alternative", &alternative);
    out.push('\n');

    let mut body = Vec::from(out);
    body.extend_from_slice(format!("--{alternative}\n").as_bytes());
    text_part(&mut body, "plain", &message.body_text);
    body.extend_from_slice(format!("\n--{alternative}\nMIME-Version: 1.0\n").as_bytes());
    let mut related_headers = String::new();
    multipart_header(&mut related_headers, "related", &related);
    body.extend_from_slice(related_headers.as_bytes());
    body.extend_from_slice(format!("\n--{related}\n").as_bytes());
    text_part(&mut body, "html", &message.body_html);
    for image in &message.inline_images {
        body.extend_from_slice(format!("\n--{related}\n").as_bytes());
        body.extend_from_slice(
            format!(
                "Content-Type: {}\nContent-Transfer-Encoding: base64\n\
                 Content-Disposition: inline; filename=\"{}\"\nContent-ID: <{}>\n\
                 MIME-Version: 1.0\n\n",
                image.content_type, image.filename, image.content_id
            )
            .as_bytes(),
        );
        body.extend_from_slice(base64_lines(&image.content).as_bytes());
    }
    body.extend_from_slice(format!("\n--{related}--\n\n--{alternative}--\n").as_bytes());
    body
}

/// Python's `===============<19 digits>==` boundary.
fn boundary() -> String {
    let token = uuid::Uuid::new_v4().as_u128() % 10_u128.pow(19);
    format!("==============={token:019}==")
}

fn header(out: &mut String, name: &str, value: &str) {
    out.push_str(&format!("{name}: {}\n", one_line(value)));
}

/// A header value with every control character (CR, LF, tab, NUL, DEL, the C1
/// controls) and Unicode line or paragraph separator replaced by a space, so a
/// value such as an event title can never end a header or start a new one.
fn one_line(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '\u{2028}' | '\u{2029}') {
                ' '
            } else {
                character
            }
        })
        .collect()
}

fn multipart_header(out: &mut String, subtype: &str, boundary: &str) {
    out.push_str(&format!(
        "Content-Type: multipart/{subtype};\n boundary=\"{boundary}\"\n"
    ));
}

/// `Subject`, folded at spaces when it is long, and sent as UTF-8 encoded
/// words (RFC 2047) when it is not plain ASCII.
fn subject_header(subject: &str) -> String {
    let subject = &one_line(subject);
    let words: Vec<String> = if subject.is_ascii() {
        subject.split(' ').map(str::to_owned).collect()
    } else {
        encoded_words(subject)
    };
    let separator = if subject.is_ascii() { " " } else { "\n " };
    let mut out = String::from("Subject:");
    let mut line_length = out.len();
    for (index, word) in words.iter().enumerate() {
        let fits = line_length + 1 + word.len() <= MAX_LINE_LENGTH;
        if index > 0 && (!fits || separator != " ") {
            out.push_str("\n ");
            line_length = 1;
        } else {
            out.push(' ');
            line_length += 1;
        }
        out.push_str(word);
        line_length += word.len();
    }
    out.push('\n');
    out
}

/// Base64 encoded words short enough that each fits a line after `Subject: `,
/// never splitting a character.
fn encoded_words(text: &str) -> Vec<String> {
    const PREFIX: &str = "=?utf-8?b?";
    const MAX_BYTES: usize = (MAX_LINE_LENGTH - "Subject: ".len() - PREFIX.len() - 2) / 4 * 3;
    let mut words = Vec::new();
    let mut chunk = String::new();
    for character in text.chars() {
        if chunk.len() + character.len_utf8() > MAX_BYTES {
            words.push(format!("{PREFIX}{}?=", STANDARD.encode(&chunk)));
            chunk.clear();
        }
        chunk.push(character);
    }
    if !chunk.is_empty() {
        words.push(format!("{PREFIX}{}?=", STANDARD.encode(&chunk)));
    }
    words
}

fn text_part(out: &mut Vec<u8>, subtype: &str, text: &str) {
    let (encoding, payload) = encode_text(text);
    out.extend_from_slice(
        format!(
            "Content-Type: text/{subtype}; charset=\"utf-8\"\n\
             Content-Transfer-Encoding: {encoding}\n\n"
        )
        .as_bytes(),
    );
    out.extend_from_slice(&payload);
}

/// `email.contentmanager._encode_text`: 7bit or 8bit when every line fits,
/// otherwise whichever of quoted-printable and base64 is shorter for the first
/// ten lines.
fn encode_text(text: &str) -> (&'static str, Vec<u8>) {
    let lines = split_lines(text.as_bytes());
    let joined = |lines: &[&[u8]]| {
        let mut body = lines.join(&b'\n');
        body.push(b'\n');
        body
    };
    if lines.iter().map(|line| line.len()).max().unwrap_or(0) <= MAX_LINE_LENGTH {
        let body = joined(&lines);
        return if body.is_ascii() {
            ("7bit", body)
        } else {
            ("8bit", body)
        };
    }
    let sniff = joined(&lines[..lines.len().min(10)]);
    let sniff_qp = quoted_printable(&sniff);
    let sniff_base64_length = sniff.len().div_ceil(3) * 4 + 1;
    if sniff_qp.len() > sniff_base64_length {
        return ("base64", base64_lines(&joined(&lines)).into_bytes());
    }
    if lines.len() <= 10 {
        return ("quoted-printable", sniff_qp.into_bytes());
    }
    (
        "quoted-printable",
        quoted_printable(&joined(&lines)).into_bytes(),
    )
}

/// `bytes.splitlines()`: `\r\n`, `\n` and `\r` end a line.
fn split_lines(data: &[u8]) -> Vec<&[u8]> {
    let mut lines = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while index < data.len() {
        match data[index] {
            b'\r' if data.get(index + 1) == Some(&b'\n') => {
                lines.push(&data[start..index]);
                index += 2;
                start = index;
            }
            b'\r' | b'\n' => {
                lines.push(&data[start..index]);
                index += 1;
                start = index;
            }
            _ => index += 1,
        }
    }
    if start < data.len() {
        lines.push(&data[start..]);
    }
    lines
}

fn is_body_safe(byte: u8) -> bool {
    byte == b'\t' || (b' '..=b'~').contains(&byte) && byte != b'='
}

/// `email.quoprimime.body_encode(body, 78)` over the body's bytes.
fn quoted_printable(body: &[u8]) -> String {
    if body.is_empty() {
        return String::new();
    }
    let mut translated = String::with_capacity(body.len() * 2);
    for &byte in body {
        if is_body_safe(byte) || byte == b'\r' || byte == b'\n' {
            translated.push(byte as char);
        } else {
            translated.push_str(&format!("={byte:02X}"));
        }
    }
    let max_line_length_less_one = MAX_LINE_LENGTH - 1;
    let mut encoded: Vec<String> = Vec::new();
    for line in split_lines(translated.as_bytes()) {
        // Every byte is ASCII after translation, so byte and character offsets agree.
        let line = std::str::from_utf8(line).expect("translated to ASCII");
        let bytes = line.as_bytes();
        let mut start: isize = 0;
        let last_start = bytes.len() as isize - 1 - MAX_LINE_LENGTH as isize;
        while start <= last_start {
            let stop = (start + max_line_length_less_one as isize) as usize;
            let begin = start as usize;
            if bytes[stop - 2] == b'=' {
                encoded.push(line[begin..stop - 1].to_owned());
                start = stop as isize - 2;
            } else if bytes[stop - 1] == b'=' {
                encoded.push(line[begin..stop].to_owned());
                start = stop as isize - 1;
            } else {
                encoded.push(format!("{}=", &line[begin..stop]));
                start = stop as isize;
            }
        }
        let begin = start as usize;
        match bytes.last() {
            Some(&last @ (b' ' | b'\t')) => {
                let room = start - last_start;
                let quoted = format!("={last:02X}");
                let tail = if room >= 3 {
                    quoted
                } else if room == 2 {
                    format!("{}=\n", last as char)
                } else {
                    format!("=\n{quoted}")
                };
                encoded.push(format!("{}{tail}", &line[begin..line.len() - 1]));
            }
            _ => encoded.push(line[begin..].to_owned()),
        }
    }
    if matches!(translated.as_bytes().last(), Some(b'\r' | b'\n')) {
        encoded.push(String::new());
    }
    encoded.join("\n")
}

/// `email.contentmanager._encode_base64`: 76-character lines.
fn base64_lines(data: &[u8]) -> String {
    let bytes_per_line = MAX_LINE_LENGTH / 4 * 3;
    let mut out = String::with_capacity(data.len() * 4 / 3 + data.len() / bytes_per_line + 4);
    for chunk in data.chunks(bytes_per_line) {
        out.push_str(&STANDARD.encode(chunk));
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_ascii_bodies_are_7bit_and_short_unicode_bodies_8bit() {
        assert_eq!(encode_text("Hello"), ("7bit", b"Hello\n".to_vec()));
        assert_eq!(encode_text(""), ("7bit", b"\n".to_vec()));
        assert_eq!(encode_text("café"), ("8bit", "café\n".as_bytes().to_vec()));
    }

    #[test]
    fn long_lines_are_quoted_printable_like_python() {
        // Expected values come from Python 3.12's EmailMessage.set_content.
        let url = format!(
            "https://uwaterloo.wat2do.io/api/notification-preferences/unsubscribe?token={}",
            "A".repeat(100)
        );
        let (encoding, payload) = encode_text(&format!("Line one\nUnsubscribe: {url}\ncafé"));
        assert_eq!(encoding, "quoted-printable");
        assert_eq!(
            String::from_utf8(payload).unwrap(),
            "Line one\n\
             Unsubscribe: https://uwaterloo.wat2do.io/api/notification-preferences/unsubsc=\n\
             ribe?token=3DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n\
             AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n\
             caf=C3=A9\n"
        );
        let (_, html) = encode_text(&format!("<p style=\"a:b\">Héllo {}</p>", "x".repeat(200)));
        assert_eq!(
            String::from_utf8(html).unwrap(),
            "<p style=3D\"a:b\">H=C3=A9llo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=\n\
             xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=\n\
             xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</p>\n"
        );
    }

    #[test]
    fn quoted_printable_never_splits_an_escape_and_quotes_trailing_space() {
        let encoded =
            quoted_printable(format!("{}é {}\n", "a".repeat(75), " ".repeat(2)).as_bytes());
        assert!(encoded.lines().all(|line| line.len() <= 78), "{encoded}");
        assert!(
            !encoded
                .lines()
                .any(|line| line.ends_with("=C") || line.ends_with("=C3="))
        );
        assert!(encoded.ends_with("=20\n"), "{encoded:?}");
    }

    #[test]
    fn mostly_unicode_bodies_switch_to_base64() {
        let (encoding, payload) = encode_text(&"é".repeat(100));
        assert_eq!(encoding, "base64");
        let text = String::from_utf8(payload).unwrap();
        assert!(text.lines().all(|line| line.len() <= 76));
    }

    #[test]
    fn subjects_fold_and_encode_like_rfc_2047() {
        assert_eq!(subject_header("1 new event"), "Subject: 1 new event\n");
        let long = subject_header(&format!("Starts in about 1 hour: {}", "word ".repeat(20)));
        assert!(long.lines().all(|line| line.len() <= 78), "{long}");
        let unicode = subject_header(&format!(
            "Starts in about 1 hour: Café 🎉 {}",
            "é".repeat(60)
        ));
        assert!(unicode.lines().all(|line| line.len() <= 78), "{unicode}");
        let decoded: String = unicode
            .trim_end()
            .trim_start_matches("Subject: ")
            .split("\n ")
            .map(|word| {
                let encoded = word.trim_start_matches("=?utf-8?b?").trim_end_matches("?=");
                String::from_utf8(STANDARD.decode(encoded).unwrap()).unwrap()
            })
            .collect();
        assert_eq!(
            decoded,
            format!("Starts in about 1 hour: Café 🎉 {}", "é".repeat(60))
        );
    }

    #[test]
    fn the_message_nests_inline_images_with_the_html() {
        let message = EmailMessage {
            to: vec![
                "e22han@uwaterloo.ca".to_owned(),
                "tqiu@uwaterloo.ca".to_owned(),
            ],
            subject: "Wat2do update".to_owned(),
            body_html: "<p>Hello</p>".to_owned(),
            body_text: "Hello".to_owned(),
            reply_to: Some("sender@example.com".to_owned()),
            headers: vec![(
                "List-Unsubscribe".to_owned(),
                format!("<https://uwaterloo.wat2do.io/u?token={}>", "A".repeat(114)),
            )],
            inline_images: vec![std::sync::Arc::new(crate::email::InlineImage {
                content_id: "wat2do-logo".to_owned(),
                filename: "logo.png".to_owned(),
                content_type: "image/png".to_owned(),
                content: b"png".to_vec(),
            })],
            ..EmailMessage::default()
        };
        let raw = String::from_utf8(build(&message, "wat2do <notifications@wat2do.io>")).unwrap();
        let boundaries: Vec<&str> = raw
            .match_indices("boundary=\"")
            .map(|(at, _)| &raw[at + 10..at + 46])
            .collect();
        let normalized = raw
            .replace(boundaries[0], "OUTER")
            .replace(boundaries[1], "INNER");
        assert_eq!(
            normalized,
            format!(
                "From: wat2do <notifications@wat2do.io>\n\
                 To: e22han@uwaterloo.ca, tqiu@uwaterloo.ca\n\
                 Subject: Wat2do update\n\
                 Reply-To: sender@example.com\n\
                 List-Unsubscribe: <https://uwaterloo.wat2do.io/u?token={}>\n\
                 MIME-Version: 1.0\n\
                 Content-Type: multipart/alternative;\n boundary=\"OUTER\"\n\
                 \n\
                 --OUTER\n\
                 Content-Type: text/plain; charset=\"utf-8\"\n\
                 Content-Transfer-Encoding: 7bit\n\
                 \n\
                 Hello\n\
                 \n\
                 --OUTER\n\
                 MIME-Version: 1.0\n\
                 Content-Type: multipart/related;\n boundary=\"INNER\"\n\
                 \n\
                 --INNER\n\
                 Content-Type: text/html; charset=\"utf-8\"\n\
                 Content-Transfer-Encoding: 7bit\n\
                 \n\
                 <p>Hello</p>\n\
                 \n\
                 --INNER\n\
                 Content-Type: image/png\n\
                 Content-Transfer-Encoding: base64\n\
                 Content-Disposition: inline; filename=\"logo.png\"\n\
                 Content-ID: <wat2do-logo>\n\
                 MIME-Version: 1.0\n\
                 \n\
                 cG5n\n\
                 \n\
                 --INNER--\n\
                 \n\
                 --OUTER--\n",
                "A".repeat(114)
            )
        );
    }

    #[test]
    fn control_characters_never_reach_a_header() {
        assert_eq!(
            one_line("Tea\r\nBcc: x@y.z\tnow\u{0}\u{7f}\u{85}\u{2028}end"),
            "Tea  Bcc: x@y.z now    end"
        );
        let message = EmailMessage {
            to: vec!["a@b.ca\r\nBcc: evil@x.com".to_owned()],
            subject: "Starts in about 1 hour: Tea\r\nBcc: evil@x.com".to_owned(),
            headers: vec![(
                "List-Unsubscribe".to_owned(),
                "<https://x/u>\nX-Evil: 1".to_owned(),
            )],
            ..EmailMessage::default()
        };
        let raw = String::from_utf8(build(&message, "wat2do <team@wat2do.io>\r\nX: y")).unwrap();
        let headers = raw.split("\n\n").next().unwrap();
        assert!(!headers.contains('\r'));
        assert!(
            headers
                .lines()
                .all(|line| !line.starts_with("Bcc") && !line.starts_with("X"))
        );
        assert!(headers.contains("Subject: Starts in about 1 hour: Tea  Bcc: evil@x.com\n"));
        let unicode = subject_header("Café\nBcc: evil@x.com");
        assert!(
            unicode.lines().skip(1).all(|line| line.starts_with(' ')),
            "{unicode}"
        );
        assert!(!unicode.contains("Bcc"));
    }

    #[test]
    fn boundaries_look_like_pythons() {
        let token = boundary();
        assert_eq!(token.len(), 15 + 19 + 2);
        assert!(token.starts_with("===============") && token.ends_with("=="));
    }
}
