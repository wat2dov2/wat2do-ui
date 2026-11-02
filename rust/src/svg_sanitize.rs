//! `core/svg_sanitize.py`: SVG uploads are cleaned before they reach storage,
//! because an SVG can carry scripts, event handlers, embedded HTML and
//! `javascript:` links.
//!
//! The document is parsed (entity declarations are refused, as defusedxml
//! does, so entity bombs and external entities cannot run), dangerous
//! elements and attributes are removed, dangerous CSS is cut from `<style>`
//! and `style=""`, and the tree is written back out byte for byte the way
//! Python's ElementTree writes it.

use std::sync::LazyLock;

use regex::Regex;

/// Elements removed with everything inside them.
const DANGEROUS_ELEMENTS: [&str; 13] = [
    "script",
    "foreignobject",
    "iframe",
    "object",
    "embed",
    "applet",
    "math",
    "handler",
    "set",
    "use",
    "animate",
    "animatetransform",
    "animatemotion",
];

/// Attributes (by local name) whose values may carry a URI.
const URI_ATTRIBUTES: [&str; 7] = [
    "href",
    "xlink:href",
    "src",
    "action",
    "formaction",
    "data",
    "background",
];

/// How many bytes `looks_like_svg` inspects.
const HEAD_SCAN_BYTES: usize = 65536;
/// How much of a URI value is inspected for its scheme.
const SCHEME_PREFIX_CHARS: usize = 40;

static CSS_DANGEROUS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)@import\b|expression\s*\(|-moz-binding\s*:|behavior\s*:|url\s*\(")
        .expect("valid regex")
});
static PREAMBLE_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:\s+|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>)")
        .expect("valid regex")
});

/// Prefixes ElementTree writes for well-known namespaces, plus the two
/// `svg_sanitize.py` registers. Any other namespace becomes `ns<N>`.
const KNOWN_PREFIXES: [(&str, &str); 9] = [
    ("http://www.w3.org/XML/1998/namespace", "xml"),
    ("http://www.w3.org/1999/xhtml", "html"),
    ("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf"),
    ("http://schemas.xmlsoap.org/wsdl/", "wsdl"),
    ("http://www.w3.org/2001/XMLSchema", "xs"),
    ("http://www.w3.org/2001/XMLSchema-instance", "xsi"),
    ("http://purl.org/dc/elements/1.1/", "dc"),
    ("http://www.w3.org/2000/svg", ""),
    ("http://www.w3.org/1999/xlink", "xlink"),
];

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Name {
    namespace: Option<String>,
    local: String,
}

impl Name {
    fn lower_local(&self) -> String {
        self.local.to_lowercase()
    }
}

#[derive(Debug)]
struct Element {
    name: Name,
    attributes: Vec<(Name, String)>,
    text: String,
    children: Vec<Element>,
    tail: String,
}

/// Decode a whole document the way expat reads it: a BOM, else the XML
/// declaration's encoding, else UTF-8.
fn decode_document(raw: &[u8]) -> Result<String, String> {
    let invalid = || "Invalid XML: not well-formed (invalid token)".to_owned();
    if let Some(rest) = raw.strip_prefix(b"\xef\xbb\xbf") {
        return String::from_utf8(rest.to_vec()).map_err(|_| invalid());
    }
    if let Some(rest) = raw.strip_prefix(b"\xff\xfe") {
        return decode_utf16(rest, u16::from_le_bytes).ok_or_else(invalid);
    }
    if let Some(rest) = raw.strip_prefix(b"\xfe\xff") {
        return decode_utf16(rest, u16::from_be_bytes).ok_or_else(invalid);
    }
    match declared_encoding(raw).as_deref() {
        None | Some("utf-8" | "utf8" | "us-ascii" | "ascii") => {
            String::from_utf8(raw.to_vec()).map_err(|_| invalid())
        }
        Some("iso-8859-1" | "latin-1" | "latin1" | "iso8859-1") => {
            Ok(raw.iter().map(|byte| char::from(*byte)).collect())
        }
        Some(other) => Err(format!("Invalid XML: unknown encoding: {other}")),
    }
}

fn decode_utf16(bytes: &[u8], read: fn([u8; 2]) -> u16) -> Option<String> {
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| read(*pair))
        .collect();
    String::from_utf16(&units).ok()
}

fn declared_encoding(raw: &[u8]) -> Option<String> {
    let head = String::from_utf8_lossy(&raw[..raw.len().min(200)]);
    let declaration = head.strip_prefix("<?xml")?;
    let declaration = &declaration[..declaration.find("?>")?];
    let rest = &declaration[declaration.find("encoding")? + "encoding".len()..];
    let rest = rest.trim_start().strip_prefix('=')?.trim_start();
    let quote = rest.chars().next()?;
    let value = &rest[1..];
    Some(value[..value.find(quote)?].to_ascii_lowercase())
}

/// The internal DTD subset declares an entity: defusedxml's `EntitiesForbidden`.
fn declares_entity(text: &str) -> bool {
    let Some(start) = text.find("<!DOCTYPE") else {
        return false;
    };
    let doctype = &text[start..];
    let end = doctype_end(doctype, 0);
    doctype[..end].contains("<!ENTITY")
}

fn parse(raw: &[u8]) -> Result<Element, String> {
    let text = decode_document(raw)?;
    if declares_entity(&text) {
        return Err("Invalid XML: EntitiesForbidden".to_owned());
    }
    let options = roxmltree::ParsingOptions {
        allow_dtd: true,
        ..Default::default()
    };
    let document = roxmltree::Document::parse_with_options(&text, options)
        .map_err(|error| format!("Invalid XML: {error}"))?;
    Ok(build(document.root_element()))
}

fn name_of(namespace: Option<&str>, local: &str) -> Name {
    Name {
        namespace: namespace.map(str::to_owned),
        local: local.to_owned(),
    }
}

/// ElementTree's view of a node: `text` before the first child element,
/// each child's `tail` after it; comments and processing instructions vanish.
fn build(node: roxmltree::Node) -> Element {
    let mut element = Element {
        name: name_of(node.tag_name().namespace(), node.tag_name().name()),
        attributes: node
            .attributes()
            .map(|attribute| {
                (
                    name_of(attribute.namespace(), attribute.name()),
                    attribute.value().to_owned(),
                )
            })
            .collect(),
        text: String::new(),
        children: Vec::new(),
        tail: String::new(),
    };
    for child in node.children() {
        if child.is_element() {
            element.children.push(build(child));
        } else if child.is_text() {
            let text = child.text().unwrap_or_default();
            match element.children.last_mut() {
                Some(previous) => previous.tail.push_str(text),
                None => element.text.push_str(text),
            }
        }
    }
    element
}

/// Remove `@import`, `url()`, `expression()`, `-moz-binding` and `behavior`
/// rules, keeping every other rule of the stylesheet.
fn sanitize_css(text: &str) -> String {
    let parts: Vec<&str> = text.split('}').collect();
    let last = parts.len() - 1;
    let mut cleaned = String::new();
    for (index, part) in parts.iter().enumerate() {
        let chunk = if index == last {
            (*part).to_owned()
        } else {
            format!("{part}}}")
        };
        if CSS_DANGEROUS.is_match(&chunk) {
            let preview: String = chunk.trim().chars().take(120).collect();
            tracing::warn!("SVG sanitizer: stripped dangerous CSS declaration: {preview}");
            continue;
        }
        cleaned.push_str(&chunk);
    }
    cleaned
}

/// Whether a URI value starts with an allowed scheme: http(s), a raster
/// `data:image/...`, a fragment or a same-site path.
fn safe_uri(value: &str) -> bool {
    let prefix: String = value.chars().take(SCHEME_PREFIX_CHARS).collect();
    let stripped: String = prefix
        .chars()
        .filter(|character| !matches!(character, '\t' | '\n' | '\r' | ' '))
        .collect();
    if stripped.is_empty() {
        return true;
    }
    let lower = stripped.to_lowercase();
    if lower.starts_with("http:") || lower.starts_with("https:") || lower.starts_with('#') {
        return true;
    }
    if let Some(rest) = lower.strip_prefix('/') {
        return rest.chars().next().is_some_and(|next| next != '/');
    }
    if let Some(subtype) = lower.strip_prefix("data:image/") {
        if subtype.starts_with("svg+xml") {
            return false;
        }
        let letters = subtype.chars().take_while(char::is_ascii_lowercase).count();
        return letters > 0 && matches!(subtype[letters..].chars().next(), Some(';' | ','));
    }
    false
}

fn clean(element: &mut Element) {
    let children = std::mem::take(&mut element.children);
    for mut child in children {
        let local = child.name.lower_local();
        if DANGEROUS_ELEMENTS.contains(&local.as_str()) {
            tracing::warn!("SVG sanitizer: stripped dangerous element <{local}>");
            continue;
        }
        if local == "style" {
            if !child.text.is_empty() {
                child.text = sanitize_css(&child.text);
            }
            if child.text.trim().is_empty() {
                tracing::warn!("SVG sanitizer: removed empty/dangerous <style> element");
                continue;
            }
        }
        clean(&mut child);
        element.children.push(child);
    }
    let tag = element.name.lower_local();
    element.attributes.retain_mut(|(name, value)| {
        let local = name.lower_local();
        let keep = if local.starts_with("on") {
            false
        } else if local == "style" {
            let cleaned = sanitize_css(value);
            let keep = !cleaned.trim().is_empty();
            if keep {
                *value = cleaned;
            }
            keep
        } else if URI_ATTRIBUTES.contains(&local.as_str()) {
            safe_uri(value)
        } else {
            true
        };
        if !keep {
            tracing::warn!(
                "SVG sanitizer: stripped dangerous attribute {} from <{tag}>",
                name.local
            );
        }
        keep
    });
}

/// ElementTree's namespace prefixes, assigned in document order.
struct Prefixes {
    assigned: Vec<(String, String)>,
}

impl Prefixes {
    fn collect(root: &Element) -> Self {
        let mut prefixes = Self {
            assigned: Vec::new(),
        };
        prefixes.visit(root);
        prefixes
    }

    fn visit(&mut self, element: &Element) {
        self.add(&element.name);
        for (name, _) in &element.attributes {
            self.add(name);
        }
        for child in &element.children {
            self.visit(child);
        }
    }

    fn add(&mut self, name: &Name) {
        let Some(uri) = &name.namespace else { return };
        if self.assigned.iter().any(|(known, _)| known == uri) {
            return;
        }
        let prefix = KNOWN_PREFIXES
            .iter()
            .find(|(known, _)| known == uri)
            .map_or_else(
                || format!("ns{}", self.assigned.len()),
                |(_, prefix)| (*prefix).to_owned(),
            );
        if prefix != "xml" {
            self.assigned.push((uri.clone(), prefix));
        }
    }

    fn qualified(&self, name: &Name) -> String {
        let Some(uri) = &name.namespace else {
            return name.local.clone();
        };
        let prefix = self
            .assigned
            .iter()
            .find(|(known, _)| known == uri)
            .map(|(_, prefix)| prefix.as_str())
            .unwrap_or("xml");
        if prefix.is_empty() {
            name.local.clone()
        } else {
            format!("{prefix}:{}", name.local)
        }
    }
}

fn escape_text(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attribute(text: &str) -> String {
    escape_text(text)
        .replace('"', "&quot;")
        .replace('\r', "&#13;")
        .replace('\n', "&#10;")
        .replace('\t', "&#09;")
}

fn write(element: &Element, prefixes: &Prefixes, root: bool, out: &mut String) {
    let tag = prefixes.qualified(&element.name);
    out.push('<');
    out.push_str(&tag);
    if root {
        let mut declarations: Vec<&(String, String)> = prefixes.assigned.iter().collect();
        declarations.sort_by(|left, right| left.1.cmp(&right.1));
        for (uri, prefix) in declarations {
            let colon = if prefix.is_empty() {
                String::new()
            } else {
                format!(":{prefix}")
            };
            out.push_str(&format!(" xmlns{colon}=\"{}\"", escape_attribute(uri)));
        }
    }
    for (name, value) in &element.attributes {
        out.push_str(&format!(
            " {}=\"{}\"",
            prefixes.qualified(name),
            escape_attribute(value)
        ));
    }
    if element.text.is_empty() && element.children.is_empty() {
        out.push_str(" />");
    } else {
        out.push('>');
        out.push_str(&escape_text(&element.text));
        for child in &element.children {
            write(child, prefixes, false, out);
        }
        out.push_str(&format!("</{tag}>"));
    }
    out.push_str(&escape_text(&element.tail));
}

/// `sanitize_svg`: the cleaned SVG, or why the input is not an SVG document.
pub fn sanitize_svg(raw: &[u8]) -> Result<Vec<u8>, String> {
    let mut root = parse(raw)?;
    let local = root.name.lower_local();
    if local != "svg" {
        return Err(format!("Root element is <{local}>, expected <svg>"));
    }
    clean(&mut root);
    let prefixes = Prefixes::collect(&root);
    let mut out = String::from("<?xml version='1.0' encoding='utf-8'?>\n");
    write(&root, &prefixes, true, &mut out);
    Ok(out.into_bytes())
}

/// `_decode_head`: the first bytes as text, detecting a BOM or UTF-16.
fn decode_head(raw: &[u8]) -> String {
    let head = &raw[..raw.len().min(HEAD_SCAN_BYTES)];
    let (body, utf16) = if let Some(rest) = head.strip_prefix(b"\xef\xbb\xbf") {
        (rest, None)
    } else if let Some(rest) = head.strip_prefix(b"\xff\xfe") {
        (rest, Some(false))
    } else if let Some(rest) = head.strip_prefix(b"\xfe\xff") {
        (rest, Some(true))
    } else if head[..head.len().min(4)].contains(&0) {
        (head, Some(head[0] == 0))
    } else {
        (head, None)
    };
    match utf16 {
        None => String::from_utf8_lossy(body).replace('\u{fffd}', ""),
        Some(big_endian) => {
            let read = if big_endian {
                u16::from_be_bytes
            } else {
                u16::from_le_bytes
            };
            let units: Vec<u16> = body
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| read(*pair))
                .collect();
            char::decode_utf16(units).filter_map(Result::ok).collect()
        }
    }
}

/// `_strip_doctype`: the offset past a DOCTYPE at `pos`, internal subset included.
fn doctype_end(text: &str, pos: usize) -> usize {
    let starts = text[pos..]
        .get(..9)
        .is_some_and(|start| start.eq_ignore_ascii_case("<!DOCTYPE"));
    if !starts {
        return pos;
    }
    let mut depth = 0usize;
    for (offset, character) in text[pos + 9..].char_indices() {
        match character {
            '[' => depth += 1,
            ']' => depth = depth.saturating_sub(1),
            '>' if depth == 0 => return pos + 9 + offset + 1,
            _ => {}
        }
    }
    text.len()
}

fn past_preamble(text: &str) -> usize {
    let mut pos = 0;
    while pos < text.len() {
        let next = doctype_end(text, pos);
        if next != pos {
            pos = next;
            continue;
        }
        match PREAMBLE_TOKEN.find(&text[pos..]) {
            Some(token) if !token.is_empty() => pos += token.end(),
            _ => break,
        }
    }
    pos
}

/// `looks_like_svg`: whether the bytes are SVG, whatever the client claimed,
/// so an SVG uploaded as "image/png" is still sanitized.
pub fn looks_like_svg(raw: &[u8]) -> bool {
    if raw.is_empty() {
        return false;
    }
    let text = decode_head(raw);
    if declares_entity(&text) {
        // The sanitizer rejects it with a clearer error.
        return true;
    }
    let options = roxmltree::ParsingOptions {
        allow_dtd: true,
        ..Default::default()
    };
    if let Ok(document) = roxmltree::Document::parse_with_options(&text, options)
        && document.root_element().tag_name().name().to_lowercase() == "svg"
    {
        return true;
    }
    let pos = past_preamble(&text);
    let tail: String = text[pos..]
        .chars()
        .take(200)
        .collect::<String>()
        .to_lowercase();
    tail.starts_with("<svg") || tail.starts_with("<!doctype svg")
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[derive(serde::Deserialize)]
    struct Case {
        #[serde(rename = "fn")]
        function: String,
        input: String,
        output: Option<serde_json::Value>,
        error: Option<String>,
    }

    /// Every input `backend/tests/core/test_svg_sanitize.py` exercised, plus
    /// edge cases, with what Python returned for each.
    #[test]
    fn matches_python_byte_for_byte() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../fixtures/svg_sanitize.json")).unwrap();
        let decode = |text: &str| {
            base64::engine::general_purpose::STANDARD
                .decode(text)
                .unwrap()
        };
        let mut failures = Vec::new();
        for (index, case) in cases.iter().enumerate() {
            let input = decode(&case.input);
            match case.function.as_str() {
                "sanitize" => match (sanitize_svg(&input), &case.output, &case.error) {
                    (Ok(output), Some(expected), _) => {
                        let expected = decode(expected.as_str().unwrap());
                        if output != expected {
                            failures.push(format!(
                                "#{index}\n  rust:   {}\n  python: {}",
                                String::from_utf8_lossy(&output),
                                String::from_utf8_lossy(&expected)
                            ));
                        }
                    }
                    (Err(error), _, Some(expected)) => {
                        // Parser messages differ (expat vs roxmltree); the root check does not.
                        if expected.starts_with("Root element") && &error != expected {
                            failures.push(format!("#{index}: {error} != {expected}"));
                        }
                    }
                    (result, _, _) => {
                        failures.push(format!("#{index}: {result:?} vs {:?}", case.error))
                    }
                },
                _ => {
                    let expected = case
                        .output
                        .as_ref()
                        .and_then(serde_json::Value::as_bool)
                        .unwrap();
                    if looks_like_svg(&input) != expected {
                        failures.push(format!(
                            "#{index} looks_like_svg {:?}",
                            String::from_utf8_lossy(&input)
                        ));
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn uri_schemes_follow_the_allowlist() {
        for safe in [
            "https://x",
            "HTTP://x",
            "#a",
            "/path",
            "data:image/png;base64,x",
            "",
            "  ",
        ] {
            assert!(safe_uri(safe), "{safe}");
        }
        for unsafe_uri in [
            "javascript:alert(1)",
            "java\nscript:x",
            "//evil",
            "data:image/svg+xml;x",
            "data:text/html,x",
            "/",
        ] {
            assert!(!safe_uri(unsafe_uri), "{unsafe_uri}");
        }
    }
}
