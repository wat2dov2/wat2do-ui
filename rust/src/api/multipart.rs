//! Form bodies read the way Starlette reads them (`request.form()`, with
//! python-multipart's parser), for routes with a `File(...)` parameter.
//!
//! FastAPI reads the form before it runs any dependency, so a malformed body
//! is a 400 before authentication or a rate limit is checked. Its field
//! value then becomes the parameter: the last part with that name, read as a
//! file when the part names a `filename`, else as text. The body is streamed:
//! only the wanted field is kept, and a file part only up to `keep` bytes
//! (its full size is still counted), so an oversized upload never sits in
//! memory.

use axum::body::Body;
use axum::http::{HeaderMap, StatusCode, header};
use futures_util::StreamExt;
use serde_json::{Value, json};

use super::errors::ApiError;
use super::validation::ValidationIssue;
use crate::text::python_space;

/// Starlette's limits on one form.
const MAX_FILES: usize = 1000;
const MAX_FIELDS: usize = 1000;
const MAX_PART_SIZE: usize = 1024 * 1024;
/// python-multipart's limits on one part's headers and on the boundary.
const MAX_HEADER_COUNT: usize = 8;
const MAX_HEADER_SIZE: usize = 4096 + 128;
const MAX_BOUNDARY_LENGTH: usize = 256;

const CR: u8 = b'\r';
const LF: u8 = b'\n';
const HYPHEN: u8 = b'-';

/// An uploaded file part (Starlette's `UploadFile`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadedFile {
    pub filename: String,
    /// The part's own `Content-Type` header, as sent (`UploadFile.content_type`).
    pub content_type: Option<String>,
    /// How many bytes the part held.
    pub size: usize,
    /// The part's bytes, up to the reader's `keep` limit.
    pub data: Vec<u8>,
}

/// One form field's value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormValue {
    Text(String),
    File(UploadedFile),
}

/// Read the request's form and return the last value of the field `name`
/// (Starlette's `FormData.get`), keeping at most `keep` bytes of a file.
/// A body that is not a form has no fields.
pub async fn read_field(
    headers: &HeaderMap,
    body: Body,
    name: &str,
    keep: usize,
) -> Result<Option<FormValue>, ApiError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .map(|value| latin1(value.as_bytes()))
        .unwrap_or_default();
    let (media_type, params) = parse_options_header(&content_type);
    let mut parser: Box<dyn FormParser> = match media_type.as_str() {
        "multipart/form-data" => {
            let charset = params
                .iter()
                .find(|(key, _)| key == "charset")
                .map_or_else(|| "utf-8".to_owned(), |(_, value)| value.clone());
            let Some((_, boundary)) = params.iter().find(|(key, _)| key == "boundary") else {
                return Err(refusal("Missing boundary in multipart."));
            };
            Box::new(Multipart::new(
                boundary.chars().map(|c| c as u8).collect(),
                Charset::named(&charset),
                name,
                keep,
            ))
        }
        "application/x-www-form-urlencoded" => Box::new(UrlEncoded::new(name)),
        _ => return Ok(None),
    };
    let mut stream = body.into_data_stream();
    while let Some(chunk) = stream.next().await {
        // Starlette's ClientDisconnect, which FastAPI answers as a bad body.
        let chunk = chunk.map_err(|_| refusal("There was an error parsing the body"))?;
        parser.write(&chunk).map_err(FormError::into_api)?;
    }
    parser.finish().map_err(FormError::into_api)
}

/// FastAPI's reading of a required `File(...)` parameter from its form
/// value: the file, or the 422 issue for it at `["body", name]`.
pub fn required_file(
    value: Option<FormValue>,
    name: &str,
) -> Result<UploadedFile, Box<ValidationIssue>> {
    let loc = vec![json!("body"), json!(name)];
    match value {
        // A browser sends an empty, unnamed file when nothing was chosen.
        Some(FormValue::File(file)) if !(file.filename.is_empty() && file.size == 0) => Ok(file),
        Some(FormValue::Text(text)) if !text.is_empty() => Err(Box::new(
            ValidationIssue::new(
                "value_error",
                loc,
                "Value error, Expected UploadFile, received: <class 'str'>",
                Value::String(text),
            )
            .with_ctx(json!({"error": {}})),
        )),
        _ => Err(Box::new(ValidationIssue::missing(loc, Value::Null))),
    }
}

fn refusal(message: &str) -> ApiError {
    ApiError::http(StatusCode::BAD_REQUEST, message)
}

/// Why a form could not be read.
#[derive(Debug, PartialEq, Eq)]
enum FormError {
    /// A malformed body (python-multipart's `FormParserError`).
    Invalid,
    /// Starlette's `MultiPartException` with its message.
    Refused(String),
}

impl FormError {
    fn into_api(self) -> ApiError {
        match self {
            Self::Invalid => refusal("Invalid multipart data."),
            Self::Refused(message) => refusal(&message),
        }
    }
}

trait FormParser: Send {
    fn write(&mut self, data: &[u8]) -> Result<(), FormError>;
    fn finish(self: Box<Self>) -> Result<Option<FormValue>, FormError>;
}

/// The bytes of a header as Starlette decodes them.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| char::from(*byte)).collect()
}

/// The charset text parts and names are decoded with (`_user_safe_decode`):
/// UTF-8 unless the request names Latin-1; undecodable bytes fall back to Latin-1.
#[derive(Debug, Clone, Copy)]
enum Charset {
    Utf8,
    Latin1,
}

impl Charset {
    fn named(name: &str) -> Self {
        match name.trim().to_ascii_lowercase().replace('_', "-").as_str() {
            "latin-1" | "latin1" | "iso-8859-1" | "iso8859-1" | "8859" | "cp819" | "l1" => {
                Self::Latin1
            }
            _ => Self::Utf8,
        }
    }

    fn decode(self, bytes: &[u8]) -> String {
        match self {
            Self::Utf8 => match std::str::from_utf8(bytes) {
                Ok(text) => text.to_owned(),
                Err(_) => latin1(bytes),
            },
            Self::Latin1 => latin1(bytes),
        }
    }
}

fn python_rstrip(text: &str) -> &str {
    text.trim_end_matches(python_space)
}

fn python_lstrip(text: &str) -> &str {
    text.trim_start_matches(python_space)
}

/// A Python index (negative counts from the end) clamped into `0..=len`,
/// as slices and `str.find` / `str.count` read their bounds.
fn python_bound(index: i64, len: usize) -> usize {
    let len = len as i64;
    (if index < 0 {
        (index + len).max(0)
    } else {
        index.min(len)
    }) as usize
}

/// `email.message._parseparam` as python-multipart vendors it: split a
/// header on `;` outside double quotes, lower-casing each parameter name.
/// Ported literally, quirks included (indices are characters).
fn parse_param(value: &str) -> Vec<String> {
    let s: Vec<char> = std::iter::once(';').chain(value.chars()).collect();
    let len = s.len() as i64;
    // `s.find(needle, from, to)`.
    let find = |needle: char, from: i64, to: i64| -> i64 {
        let (from, to) = (python_bound(from, s.len()), python_bound(to, s.len()));
        (from..to)
            .find(|&at| s[at] == needle)
            .map_or(-1, |at| at as i64)
    };
    // `s.count(needle, from, to)`.
    let count = |needle: &[char], from: i64, to: i64| -> i64 {
        let (from, to) = (python_bound(from, s.len()), python_bound(to, s.len()));
        let mut total = 0;
        let mut at = from;
        while at + needle.len() <= to {
            if s[at..at + needle.len()] == *needle {
                total += 1;
                at += needle.len();
            } else {
                at += 1;
            }
        }
        total
    };
    let text = |from: i64, to: i64| -> String {
        let (from, to) = (python_bound(from, s.len()), python_bound(to, s.len()));
        if from >= to {
            String::new()
        } else {
            s[from..to].iter().collect()
        }
    };
    let mut parts = Vec::new();
    let mut start: i64 = 0;
    while find(';', start, len) == start {
        start += 1;
        let mut end = find(';', start, len);
        let (mut ind, mut diff) = (start, 0i64);
        while end > 0 {
            diff += count(&['"'], ind, end) - count(&['\\', '"'], ind, end);
            if diff % 2 == 0 {
                break;
            }
            (end, ind) = (ind, find(';', end + 1, len));
        }
        if end < 0 {
            end = len;
        }
        let equals = find('=', start, end);
        let field = if equals == -1 {
            text(start, end)
        } else {
            format!(
                "{}={}",
                python_rstrip(&text(start, equals)).to_lowercase(),
                python_lstrip(&text(equals + 1, end))
            )
        };
        parts.push(crate::text::python_strip(&field).to_owned());
        start = end;
    }
    parts
}

/// python-multipart's `parse_options_header`: the lower-cased value and its
/// parameters (quotes removed; RFC 2231 `key*` forms ignored).
fn parse_options_header(value: &str) -> (String, Vec<(String, String)>) {
    if value.is_empty() {
        return (String::new(), Vec::new());
    }
    if !value.contains(';') {
        return (
            crate::text::python_strip(&value.to_lowercase()).to_owned(),
            Vec::new(),
        );
    }
    let mut parts = parse_param(value).into_iter();
    let media_type = parts.next().unwrap_or_default().to_lowercase();
    let mut options: Vec<(String, String)> = Vec::new();
    for segment in parts {
        let (key, value) = segment.split_once('=').unwrap_or((segment.as_str(), ""));
        if key.contains('*') {
            continue;
        }
        let chars: Vec<char> = value.chars().collect();
        let mut value = value.to_owned();
        if chars.len() >= 2 && chars[0] == '"' && chars[chars.len() - 1] == '"' {
            value = chars[1..chars.len() - 1]
                .iter()
                .collect::<String>()
                .replace("\\\\", "\\")
                .replace("\\\"", "\"");
        }
        // IE6 sent the whole Windows path as the filename.
        let chars: Vec<char> = value.chars().collect();
        if key == "filename"
            && (chars.get(1..3) == Some(&[':', '\\']) || chars.get(..2) == Some(&['\\', '\\']))
        {
            value = value.rsplit('\\').next().unwrap_or_default().to_owned();
        }
        // A later parameter of the same name replaces an earlier one.
        options.retain(|(existing, _)| existing != key);
        options.push((key.to_owned(), value));
    }
    (media_type, options)
}

/// RFC 7230 token characters, which a part's header names must use.
fn is_token(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Start,
    StartBoundary,
    HeaderFieldStart,
    HeaderField,
    HeaderValueStart,
    HeaderValue,
    HeaderValueAlmostDone,
    HeadersAlmostDone,
    PartDataStart,
    PartData,
    EndBoundary,
    End,
}

/// The part being read (Starlette's `MultipartPart`).
#[derive(Debug, Default)]
struct Part {
    disposition: Vec<u8>,
    headers: Vec<(Vec<u8>, Vec<u8>)>,
    name: String,
    file: Option<UploadedFile>,
    text: Vec<u8>,
    /// Every byte of a text part, kept or not (Starlette's size limit).
    text_size: usize,
    /// Whether this part is the wanted field (only it keeps its bytes).
    wanted: bool,
}

/// python-multipart's `MultipartParser` with Starlette's callbacks.
struct Multipart {
    /// `\r\n--` and the boundary.
    boundary: Vec<u8>,
    boundary_too_long: bool,
    state: State,
    index: usize,
    part_boundary: bool,
    last_boundary: bool,
    /// Leading newlines are being skipped up to the first `-`.
    skipping: bool,
    header_count: usize,
    header_size: usize,
    header_name: Vec<u8>,
    header_value: Vec<u8>,
    /// Bytes that may be the start of the boundary, not yet known to be data.
    pending: Vec<u8>,
    part: Part,
    files: usize,
    fields: usize,
    charset: Charset,
    want: String,
    keep: usize,
    found: Option<FormValue>,
}

impl Multipart {
    fn new(boundary: Vec<u8>, charset: Charset, want: &str, keep: usize) -> Self {
        let boundary_too_long = boundary.len() > MAX_BOUNDARY_LENGTH;
        let mut full = b"\r\n--".to_vec();
        full.extend_from_slice(&boundary);
        Self {
            boundary: full,
            boundary_too_long,
            state: State::Start,
            index: 0,
            part_boundary: false,
            last_boundary: false,
            skipping: false,
            header_count: 0,
            header_size: 0,
            header_name: Vec::new(),
            header_value: Vec::new(),
            pending: Vec::new(),
            part: Part::default(),
            files: 0,
            fields: 0,
            charset,
            want: want.to_owned(),
            keep,
            found: None,
        }
    }

    fn grow_header(&mut self, amount: usize) -> Result<(), FormError> {
        self.header_size += amount;
        if self.header_size > MAX_HEADER_SIZE {
            return Err(FormError::Invalid);
        }
        Ok(())
    }

    fn part_begin(&mut self) {
        self.part = Part::default();
        self.header_count = 0;
        self.header_size = 0;
    }

    fn header_end(&mut self) {
        let name = std::mem::take(&mut self.header_name).to_ascii_lowercase();
        let value = std::mem::take(&mut self.header_value);
        if name == b"content-disposition" {
            self.part.disposition = value.clone();
        }
        self.part.headers.push((name, value));
    }

    fn headers_finished(&mut self) -> Result<(), FormError> {
        let (_, options) = parse_options_header(&latin1(&self.part.disposition));
        let option = |key: &str| {
            options
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.chars().map(|c| c as u8).collect::<Vec<u8>>())
        };
        let Some(name) = option("name") else {
            return Err(FormError::Refused(
                "The Content-Disposition header field \"name\" must be provided.".to_owned(),
            ));
        };
        self.part.name = self.charset.decode(&name);
        self.part.wanted = self.part.name == self.want;
        if let Some(filename) = option("filename") {
            self.files += 1;
            if self.files > MAX_FILES {
                return Err(FormError::Refused(format!(
                    "Too many files. Maximum number of files is {MAX_FILES}."
                )));
            }
            let content_type = self
                .part
                .headers
                .iter()
                .find(|(name, _)| name == b"content-type")
                .map(|(_, value)| latin1(value));
            self.part.file = Some(UploadedFile {
                filename: self.charset.decode(&filename),
                content_type,
                size: 0,
                data: Vec::new(),
            });
        } else {
            self.fields += 1;
            if self.fields > MAX_FIELDS {
                return Err(FormError::Refused(format!(
                    "Too many fields. Maximum number of fields is {MAX_FIELDS}."
                )));
            }
        }
        Ok(())
    }

    fn part_data(&mut self, data: &[u8]) -> Result<(), FormError> {
        if data.is_empty() {
            return Ok(());
        }
        match &mut self.part.file {
            None => {
                if self.part.text_size + data.len() > MAX_PART_SIZE {
                    return Err(FormError::Refused(format!(
                        "Part exceeded maximum size of {}KB.",
                        MAX_PART_SIZE / 1024
                    )));
                }
                self.part.text_size += data.len();
                if self.part.wanted {
                    self.part.text.extend_from_slice(data);
                }
            }
            Some(file) => {
                file.size += data.len();
                if self.part.wanted && file.data.len() < self.keep {
                    let room = self.keep - file.data.len();
                    file.data.extend_from_slice(&data[..data.len().min(room)]);
                }
            }
        }
        Ok(())
    }

    fn part_end(&mut self) {
        let part = std::mem::take(&mut self.part);
        if !part.wanted {
            return;
        }
        self.found = Some(match part.file {
            Some(file) => FormValue::File(file),
            None => FormValue::Text(self.charset.decode(&part.text)),
        });
    }

    fn feed(&mut self, data: &[u8]) -> Result<(), FormError> {
        let length = self.boundary.len();
        let mut i = 0;
        while i < data.len() {
            let c = data[i];
            match self.state {
                State::Start => {
                    if self.skipping || c == CR || c == LF {
                        // Skip leading newlines, and anything after them, to the next `-`.
                        match data[i..].iter().position(|&byte| byte == HYPHEN) {
                            Some(offset) => {
                                i += offset;
                                self.skipping = false;
                                self.index = 0;
                                self.state = State::StartBoundary;
                                continue;
                            }
                            None => {
                                self.skipping = true;
                                return Ok(());
                            }
                        }
                    }
                    self.index = 0;
                    self.state = State::StartBoundary;
                    continue;
                }
                State::StartBoundary => {
                    if self.index == 0 && data[i..].starts_with(&self.boundary[2..]) {
                        self.index = length - 2;
                        i += self.index;
                        continue;
                    }
                    if self.index == length - 2 {
                        if c == HYPHEN {
                            // Possibly an empty message.
                            self.state = State::EndBoundary;
                        } else if c != CR {
                            return Err(FormError::Invalid);
                        }
                        self.index += 1;
                    } else if self.index == length - 1 {
                        if c != LF {
                            return Err(FormError::Invalid);
                        }
                        self.index = 0;
                        self.part_begin();
                        self.state = State::HeaderFieldStart;
                    } else {
                        if c != self.boundary[self.index + 2] {
                            return Err(FormError::Invalid);
                        }
                        self.index += 1;
                    }
                }
                State::HeaderFieldStart => {
                    self.index = 0;
                    if c != CR {
                        self.header_count += 1;
                        if self.header_count > MAX_HEADER_COUNT {
                            return Err(FormError::Invalid);
                        }
                        self.header_size = 0;
                    }
                    self.state = State::HeaderField;
                    continue;
                }
                State::HeaderField => {
                    if c == CR && self.index == 0 {
                        self.state = State::HeadersAlmostDone;
                        i += 1;
                        continue;
                    }
                    self.grow_header(1)?;
                    if c == b':' {
                        // A header needs a name.
                        if self.index == 0 {
                            return Err(FormError::Invalid);
                        }
                        self.state = State::HeaderValueStart;
                    } else {
                        if !is_token(c) {
                            return Err(FormError::Invalid);
                        }
                        self.header_name.push(c);
                        self.index += 1;
                    }
                }
                State::HeaderValueStart => {
                    if c == b' ' {
                        self.grow_header(1)?;
                        i += 1;
                        continue;
                    }
                    self.state = State::HeaderValue;
                    continue;
                }
                State::HeaderValue => {
                    if c == CR {
                        self.header_end();
                        self.header_size = 0;
                        self.state = State::HeaderValueAlmostDone;
                    } else {
                        self.grow_header(1)?;
                        self.header_value.push(c);
                    }
                }
                State::HeaderValueAlmostDone => {
                    if c != LF {
                        return Err(FormError::Invalid);
                    }
                    self.state = State::HeaderFieldStart;
                }
                State::HeadersAlmostDone => {
                    if c != LF {
                        return Err(FormError::Invalid);
                    }
                    self.headers_finished()?;
                    self.state = State::PartDataStart;
                }
                State::PartDataStart => {
                    self.state = State::PartData;
                    continue;
                }
                State::PartData => {
                    let previous = self.index;
                    if self.index < length {
                        if self.boundary[self.index] == c {
                            self.index += 1;
                            self.pending.push(c);
                        } else {
                            self.index = 0;
                        }
                    } else if self.index == length {
                        self.index += 1;
                        if c == CR {
                            self.part_boundary = true;
                        } else if c == HYPHEN {
                            self.last_boundary = true;
                        } else {
                            self.index = 0;
                        }
                        if self.index != 0 {
                            self.pending.push(c);
                        }
                    } else if self.index == length + 1 {
                        if self.part_boundary {
                            if c == LF {
                                self.part_boundary = false;
                                self.pending.clear();
                                self.part_end();
                                self.part_begin();
                                self.index = 0;
                                self.state = State::HeaderFieldStart;
                                i += 1;
                                continue;
                            }
                            self.index = 0;
                            self.part_boundary = false;
                        } else if self.last_boundary {
                            if c == HYPHEN {
                                self.pending.clear();
                                self.part_end();
                                self.state = State::End;
                            } else {
                                self.index = 0;
                            }
                        }
                    }
                    if self.index == 0 {
                        if previous > 0 {
                            // Not the boundary after all: what matched was data,
                            // and this byte may start the boundary itself.
                            let pending = std::mem::take(&mut self.pending);
                            self.part_data(&pending)?;
                            continue;
                        }
                        self.part_data(&[c])?;
                    }
                }
                State::EndBoundary => {
                    if self.index == length - 1 {
                        if c != HYPHEN {
                            return Err(FormError::Invalid);
                        }
                        self.index += 1;
                        self.state = State::End;
                    }
                }
                // An epilogue after the closing boundary is discarded.
                State::End => return Ok(()),
            }
            i += 1;
        }
        Ok(())
    }
}

impl FormParser for Multipart {
    fn write(&mut self, data: &[u8]) -> Result<(), FormError> {
        if self.boundary_too_long {
            return Err(FormError::Invalid);
        }
        self.feed(data)
    }

    /// python-multipart does not check that the message ended: an unfinished
    /// part is simply not in the form.
    fn finish(self: Box<Self>) -> Result<Option<FormValue>, FormError> {
        if self.boundary_too_long {
            return Err(FormError::Invalid);
        }
        Ok(self.found)
    }
}

/// An `application/x-www-form-urlencoded` body (Starlette's `FormParser`):
/// every field is text.
struct UrlEncoded {
    body: Vec<u8>,
    want: String,
}

impl UrlEncoded {
    fn new(want: &str) -> Self {
        Self {
            body: Vec::new(),
            want: want.to_owned(),
        }
    }
}

/// `urllib.parse.unquote_plus`: `+` is a space, `%XX` escapes are UTF-8
/// (an invalid sequence becomes U+FFFD).
fn unquote_plus(text: &str) -> String {
    let bytes = text.replace('+', " ").into_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%'
            && at + 2 < bytes.len()
            && let (Some(high), Some(low)) = (
                (bytes[at + 1] as char).to_digit(16),
                (bytes[at + 2] as char).to_digit(16),
            )
        {
            out.push((high * 16 + low) as u8);
            at += 3;
            continue;
        }
        out.push(bytes[at]);
        at += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

impl FormParser for UrlEncoded {
    fn write(&mut self, data: &[u8]) -> Result<(), FormError> {
        self.body.extend_from_slice(data);
        Ok(())
    }

    fn finish(self: Box<Self>) -> Result<Option<FormValue>, FormError> {
        let mut found = None;
        let mut fields = 0;
        for chunk in self.body.split(|byte| *byte == b'&') {
            if chunk.is_empty() {
                continue;
            }
            let (name, value) = match chunk.iter().position(|byte| *byte == b'=') {
                Some(equals) => (&chunk[..equals], &chunk[equals + 1..]),
                None => (chunk, &chunk[chunk.len()..]),
            };
            if name.len() + value.len() > MAX_PART_SIZE {
                return Err(FormError::Refused(format!(
                    "Field exceeded maximum size of {}KB.",
                    MAX_PART_SIZE / 1024
                )));
            }
            fields += 1;
            if fields > MAX_FIELDS {
                return Err(FormError::Refused(format!(
                    "Too many fields. Maximum number of fields is {MAX_FIELDS}."
                )));
            }
            if unquote_plus(&latin1(name)) == self.want {
                found = Some(FormValue::Text(unquote_plus(&latin1(value))));
            }
        }
        Ok(found)
    }
}

#[cfg(test)]
mod tests;
