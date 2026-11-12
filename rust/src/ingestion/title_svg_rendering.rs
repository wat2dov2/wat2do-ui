//! How a title drawing renders on a featured card, from laying it out with this
//! machine's fonts (usvg) the way a browser does. The card shows the SVG as an
//! image, so lettering past its view box is cut off; a line with no font size
//! is set at 16 units and its `textLength` stretches it flat across the card;
//! a line set far smaller or larger than its `textLength` is distorted; and
//! dark letters with no light outline vanish on the card's dark fade.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use regex::{Captures, Regex};
use resvg::usvg;

/// Lettering may graze the view box's edge by this much (an outline's soft edge).
const EDGE_TOLERANCE: f32 = 2.0;
/// The most a line's `textLength` may stretch or squeeze it from its natural width.
const MAX_STRETCH: f32 = 2.0;
const MAX_SQUEEZE: f32 = 0.45;
/// Letters darker than this (relative luminance) vanish on the card's dark fade,
/// unless an outline at least LIGHT_OUTLINE shows them, or a copy of the same
/// words at least LIGHT_COPY lies over them (a dark shadow under the lettering).
const DARK: f32 = 0.18;
const LIGHT_OUTLINE: f32 = 0.5;
const LIGHT_COPY: f32 = 0.35;
/// The presentation attributes a line takes from the groups around it.
const INHERITED: [&str; 9] = [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
    "fill",
    "stroke",
    "opacity",
    "fill-opacity",
];
/// What a line's natural width depends on.
const FONT: [&str; 5] = [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
];

static TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<(/?)([a-zA-Z]+)\b([^>]*?)(/?)>").unwrap());
static ATTRIBUTE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?:^|\s)([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
static TEXT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<text\b([^>]*)>(.*?)</text>").unwrap());
static TSPAN_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"</?tspan\b[^>]*>").unwrap());
static TSPAN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<tspan\b([^>]*)>(.*?)</tspan>").unwrap());
static ANY_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static RECT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<rect\b[^>]*/>|<rect\b[^>]*>.*?</rect>").unwrap());
static ROOT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<svg\b[^>]*>").unwrap());
static FONT_SIZE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\sfont-size\s*=\s*("[^"]*"|'[^']*')"#).unwrap());
static SIZE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\s(?:width|height)\s*=\s*("[^"]*"|'[^']*')"#).unwrap());
static VIEW_BOX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"viewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']"#,
    )
    .unwrap()
});

/// The Mac's fonts, loaded once, with the generic families its browsers use.
static FONTS: LazyLock<Arc<usvg::fontdb::Database>> = LazyLock::new(|| {
    let mut fonts = usvg::fontdb::Database::new();
    fonts.load_system_fonts();
    let installed = |candidates: &[&str]| {
        candidates
            .iter()
            .find(|family| {
                fonts
                    .faces()
                    .any(|face| face.families.iter().any(|(name, _)| name == *family))
            })
            .map(|family| family.to_string())
    };
    let sans = installed(&["Helvetica", "Arial", "DejaVu Sans", "Liberation Sans"]);
    let serif = installed(&[
        "Times New Roman",
        "Times",
        "DejaVu Serif",
        "Liberation Serif",
    ]);
    let cursive = installed(&["Snell Roundhand", "Apple Chancery", "DejaVu Sans"]);
    let monospace = installed(&["Courier New", "Courier", "DejaVu Sans Mono"]);
    if let Some(family) = sans {
        fonts.set_sans_serif_family(family);
    }
    if let Some(family) = serif {
        fonts.set_serif_family(family);
    }
    if let Some(family) = cursive {
        fonts.set_cursive_family(family);
    }
    if let Some(family) = monospace {
        fonts.set_monospace_family(family);
    }
    Arc::new(fonts)
});

/// One `<text>`: its own attributes, the style it ends up with, its content
/// (tspans and entities as written), and the largest font size in it.
struct Line {
    own: HashMap<String, String>,
    style: HashMap<String, String>,
    content: String,
    largest: Option<f32>,
    /// A tspan moves its words itself, so the line is not measured as one run.
    positioned: bool,
}

impl Line {
    fn words(&self) -> String {
        decode(&ANY_TAG.replace_all(&self.content, ""))
            .trim()
            .to_owned()
    }
}

/// What would show wrong if a featured card drew this title, or `None` when it
/// renders cleanly. A drawing usvg cannot lay out counts as one to draw again.
pub fn rendering_problem(svg: &str) -> Option<String> {
    std::panic::catch_unwind(|| problem(svg))
        .unwrap_or_else(|_| Some("it could not be laid out".to_owned()))
}

fn problem(svg: &str) -> Option<String> {
    let Some(view_box) = VIEW_BOX.captures(svg) else {
        return Some("it has no view box".to_owned());
    };
    let width: f32 = view_box[3].parse().unwrap_or(0.0);
    let height: f32 = view_box[4].parse().unwrap_or(0.0);
    let lines = lines(svg);
    if let Some(line) = lines.iter().find(|line| line.largest.is_none()) {
        return Some(format!("\"{}\" has no font size", line.words()));
    }

    // Every mark but bands and boxes (a band may run off the edge), at one unit a pixel.
    let unbanded = RECT.replace_all(&merge_tspans(svg), "").into_owned();
    let Some(root) = ROOT.find(&unbanded).map(|root| root.as_str()) else {
        return Some("it has no svg element".to_owned());
    };
    let sized = SIZE.replace_all(root, "").replacen(
        "<svg",
        &format!("<svg width=\"{width}\" height=\"{height}\""),
        1,
    );
    let Some(ink) = ink_bounds(&unbanded.replacen(root, &sized, 1), true) else {
        return Some("it draws nothing".to_owned());
    };
    if ink.top() < -EDGE_TOLERANCE {
        return Some(format!("its lettering runs {:.0} past the top", -ink.top()));
    }
    if ink.bottom() > height + EDGE_TOLERANCE {
        return Some(format!(
            "its lettering runs {:.0} past the bottom",
            ink.bottom() - height
        ));
    }
    // The card centres a drawing by its lines' textLength, not their ink, so an
    // italic's or a serif's overhang past the box stays cut off.
    if ink.left() < -EDGE_TOLERANCE {
        return Some(format!(
            "its lettering runs {:.0} past the left",
            -ink.left()
        ));
    }
    if ink.right() > width + EDGE_TOLERANCE {
        return Some(format!(
            "its lettering runs {:.0} past the right",
            ink.right() - width
        ));
    }

    for line in lines.iter().filter(|line| !line.positioned) {
        let Some(length) = line.own.get("textLength").and_then(|value| number(value)) else {
            continue;
        };
        let Some(natural) = natural_width(line).filter(|natural| *natural > 0.0) else {
            continue;
        };
        let ratio = length / natural;
        if !(MAX_SQUEEZE..=MAX_STRETCH).contains(&ratio) {
            return Some(format!(
                "\"{}\" is {} to {:.0}% of its width",
                line.words(),
                if ratio > 1.0 { "stretched" } else { "squeezed" },
                ratio * 100.0
            ));
        }
    }

    // A band or box behind the lettering shows dark letters on it.
    if !RECT.is_match(svg) {
        let light_copies: Vec<String> = lines
            .iter()
            .filter(|line| {
                runs(line)
                    .iter()
                    .all(|run| run.fill.is_some_and(|fill| fill >= LIGHT_COPY))
            })
            .map(|line| line.words().to_lowercase())
            .collect();
        for line in &lines {
            if light_copies.contains(&line.words().to_lowercase()) {
                continue;
            }
            if let Some(run) = runs(line).into_iter().find(|run| {
                run.fill.is_some_and(|fill| fill < DARK)
                    && run.opacity >= 0.5
                    && run.outline.is_none_or(|outline| outline < LIGHT_OUTLINE)
            }) {
                return Some(format!("\"{}\" is dark with no light outline", run.words));
            }
        }
    }
    None
}

/// Every `<text>` with the presentation attributes it inherits from its groups.
fn lines(svg: &str) -> Vec<Line> {
    let mut styles = vec![HashMap::new()];
    let mut lines: Vec<Line> = Vec::new();
    let mut in_text = false;
    for tag in TAG.captures_iter(svg) {
        let (closing, name, self_closing) = (!tag[1].is_empty(), &tag[2], !tag[4].is_empty());
        if name == "tspan" {
            if let (false, true, Some(line)) = (closing, in_text, lines.last_mut()) {
                let own = attributes(&tag[3]);
                line.positioned |= ["x", "y", "dx", "dy", "rotate"]
                    .iter()
                    .any(|name| own.contains_key(*name));
                if let Some(size) = own.get("font-size").and_then(|value| number(value)) {
                    line.largest = Some(line.largest.map_or(size, |largest| largest.max(size)));
                }
            }
            continue;
        }
        if !matches!(name, "svg" | "g" | "text") {
            continue;
        }
        if closing {
            styles.pop();
            in_text &= name != "text";
            continue;
        }
        let own = attributes(&tag[3]);
        let mut style = styles.last().cloned().unwrap_or_default();
        for property in INHERITED {
            if let Some(value) = own.get(property) {
                style.insert(property.to_owned(), value.clone());
            }
        }
        if name == "text" {
            let largest = style.get("font-size").and_then(|value| number(value));
            lines.push(Line {
                own,
                style: style.clone(),
                content: String::new(),
                largest,
                positioned: false,
            });
            in_text = !self_closing;
        }
        if !self_closing {
            styles.push(style);
        }
    }
    for (line, text) in lines.iter_mut().zip(TEXT.captures_iter(svg)) {
        line.content = text[2].to_owned();
    }
    lines
}

/// A tag's attributes, its `style` declarations over them as CSS has it.
fn attributes(tag: &str) -> HashMap<String, String> {
    let mut found: HashMap<String, String> = ATTRIBUTE
        .captures_iter(tag)
        .map(|attribute| {
            let value = attribute
                .get(2)
                .or(attribute.get(3))
                .map_or("", |value| value.as_str());
            (attribute[1].to_owned(), value.trim().to_owned())
        })
        .collect();
    if let Some(style) = found.get("style").cloned() {
        for declaration in style.split(';') {
            if let Some((name, value)) = declaration.split_once(':') {
                found.insert(name.trim().to_owned(), value.trim().to_owned());
            }
        }
    }
    found
}

/// usvg spreads a `textLength` wrongly over a line split into tspans, so a
/// line whose tspans only restyle words is measured as one run, at its largest
/// font size (its `textLength` sets its width either way).
fn merge_tspans(svg: &str) -> String {
    TEXT.replace_all(svg, |text: &Captures| {
        let tspans: Vec<HashMap<String, String>> = TSPAN_TAG
            .find_iter(&text[2])
            .map(|tag| attributes(tag.as_str()))
            .collect();
        if tspans.is_empty()
            || tspans.iter().any(|own| {
                ["x", "y", "dx", "dy", "rotate"]
                    .iter()
                    .any(|name| own.contains_key(*name))
            })
        {
            return text[0].to_owned();
        }
        let own = attributes(&text[1]);
        let largest = tspans
            .iter()
            .chain([&own])
            .filter_map(|own| own.get("font-size").and_then(|value| number(value)))
            .reduce(f32::max);
        let mut opening = text[1].to_owned();
        if let Some(largest) = largest {
            opening = FONT_SIZE.replace_all(&opening, "").into_owned();
            opening.push_str(&format!(" font-size=\"{largest}\""));
        }
        format!(
            "<text{opening}>{}</text>",
            TSPAN_TAG.replace_all(&text[2], "")
        )
    })
    .into_owned()
}

/// The bounds of everything a drawing paints, outlines included when `strokes`.
fn ink_bounds(svg: &str, strokes: bool) -> Option<usvg::Rect> {
    let options = usvg::Options {
        fontdb: FONTS.clone(),
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_str(svg, &options).ok()?;
    if strokes {
        tree.root().abs_stroke_bounding_box()
    } else {
        tree.root().abs_bounding_box()
    }
}

/// How wide a line's words set in its font, without its `textLength`.
fn natural_width(line: &Line) -> Option<f32> {
    let font: String = FONT
        .iter()
        .filter_map(|name| {
            let value = if *name == "font-size" {
                line.largest.map(|size| size.to_string())
            } else {
                line.style.get(*name).cloned()
            }?;
            Some(format!(" {name}=\"{}\"", value.replace('"', "&quot;")))
        })
        .collect();
    let words = TSPAN_TAG.replace_all(&line.content, "");
    ink_bounds(
        &format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8000\" height=\"2000\"><text x=\"100\" y=\"1000\"{font}>{words}</text></svg>"
        ),
        false,
    )
    .map(|bounds| bounds.width())
}

/// A stretch of a line's words in one colour: the line's own, or a tspan's.
struct Run {
    words: String,
    fill: Option<f32>,
    outline: Option<f32>,
    opacity: f32,
}

/// The coloured stretches a line shows: its words outside tspans in its own
/// colours, each tspan's in its own or the line's.
fn runs(line: &Line) -> Vec<Run> {
    let run = |own: &HashMap<String, String>, words: String| {
        let value = |name: &str| own.get(name).or(line.style.get(name));
        Run {
            words,
            // An unset fill is black.
            fill: luminance(value("fill").map_or("#000000", String::as_str)),
            outline: value("stroke")
                .filter(|stroke| *stroke != "none")
                .and_then(|stroke| luminance(stroke)),
            opacity: ["opacity", "fill-opacity"]
                .iter()
                .filter_map(|name| value(name).and_then(|value| number(value)))
                .fold(1.0, f32::min),
        }
    };
    let words = |content: &str| decode(&ANY_TAG.replace_all(content, "")).trim().to_owned();
    let mut runs: Vec<Run> = TSPAN
        .captures_iter(&line.content)
        .map(|tspan| run(&attributes(&tspan[1]), words(&tspan[2])))
        .collect();
    runs.push(run(
        &HashMap::new(),
        words(&TSPAN.replace_all(&line.content, "")),
    ));
    runs.retain(|run| !run.words.is_empty());
    runs
}

/// Relative luminance of a colour written as hex, `rgb()` or a common dark name.
fn luminance(colour: &str) -> Option<f32> {
    let colour = colour.trim().to_ascii_lowercase();
    let named = match colour.as_str() {
        "black" => "#000000",
        "white" => "#ffffff",
        "navy" => "#000080",
        "maroon" => "#800000",
        "darkblue" => "#00008b",
        "darkred" => "#8b0000",
        "darkgreen" => "#006400",
        "midnightblue" => "#191970",
        "indigo" => "#4b0082",
        "purple" => "#800080",
        other => other,
    };
    let channels: Vec<f32> = if let Some(hex) = named.strip_prefix('#') {
        let hex: String = match hex.len() {
            3 => hex.chars().flat_map(|c| [c, c]).collect(),
            6 => hex.to_owned(),
            _ => return None,
        };
        (0..3)
            .map(|i| {
                u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
                    .ok()
                    .map(f32::from)
            })
            .collect::<Option<_>>()?
    } else {
        named
            .strip_prefix("rgb(")
            .and_then(|rest| rest.strip_suffix(')'))?
            .split(',')
            .map(|channel| channel.trim().parse::<f32>().ok())
            .collect::<Option<_>>()?
    };
    (channels.len() == 3)
        .then(|| (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255.0)
}

/// A length's number, such as 48 in "48" or "48px".
fn number(value: &str) -> Option<f32> {
    let digits: String = value
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    digits.parse().ok()
}

fn decode(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A title line at 56 units, as wide as its words naturally set.
    fn drawing(attributes: &str, words: &str) -> String {
        format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 90"><text x="200" y="66" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="bold" textLength="330" lengthAdjust="spacingAndGlyphs" {attributes}>{words}</text></svg>"##
        )
    }

    #[test]
    fn a_title_set_inside_its_view_box_at_its_natural_width_renders_cleanly() {
        assert_eq!(
            rendering_problem(&drawing(
                r##"font-size="56" fill="#ffd400""##,
                "GAMES NIGHT"
            )),
            None
        );
        // Words restyled in a tspan, and a size set on the group around the line.
        assert_eq!(
            rendering_problem(&drawing(
                r##"font-size="56" fill="#ffd400""##,
                r##"GAMES <tspan fill="#ffffff">NIGHT</tspan>"##
            )),
            None
        );
        assert_eq!(
            rendering_problem(
                &drawing(r##"fill="#ffd400""##, "GAMES NIGHT")
                    .replace("<text", r#"<g font-size="56"><text"#)
                    .replace("</text>", "</text></g>")
            ),
            None
        );
    }

    #[test]
    fn a_line_with_no_font_size_is_drawn_again() {
        let problem = rendering_problem(&drawing(r##"fill="#ffd400""##, "GAMES NIGHT"));
        assert_eq!(problem.as_deref(), Some("\"GAMES NIGHT\" has no font size"));
    }

    #[test]
    fn lettering_cut_off_by_the_view_box_is_drawn_again() {
        let high = drawing(r##"font-size="56" fill="#ffd400""##, "GAMES NIGHT")
            .replace(r#"y="66""#, r#"y="30""#);
        assert!(rendering_problem(&high).unwrap().contains("past the top"));
        let low = drawing(r##"font-size="56" fill="#ffd400""##, "Gaming Night")
            .replace(r#"y="66""#, r#"y="88""#);
        assert!(rendering_problem(&low).unwrap().contains("past the bottom"));
        let wide = drawing(r##"font-size="56" fill="#ffd400""##, "GAMES NIGHT")
            .replace(r#"textLength="330""#, r#"textLength="480""#);
        assert!(rendering_problem(&wide).unwrap().contains("past the left"));
        // The card centres by textLength, so lettering off to one side stays cut off.
        let aside = drawing(r##"font-size="56" fill="#ffd400""##, "GAMES NIGHT")
            .replace(r#"x="200""#, r#"x="260""#);
        assert!(
            rendering_problem(&aside)
                .unwrap()
                .contains("past the right")
        );
    }

    #[test]
    fn letters_stretched_or_squeezed_far_from_their_shape_are_drawn_again() {
        let stretched = drawing(r##"font-size="20" fill="#ffd400""##, "GO");
        assert!(rendering_problem(&stretched).unwrap().contains("stretched"));
        let squeezed = drawing(
            r##"font-size="56" fill="#ffd400""##,
            "INTERNATIONAL STUDENTS CHAMPIONSHIP",
        );
        assert!(rendering_problem(&squeezed).unwrap().contains("squeezed"));
    }

    #[test]
    fn dark_letters_need_a_light_outline_a_light_copy_or_a_band() {
        let dark = drawing(r##"font-size="56" fill="#101828""##, "GAMES NIGHT");
        assert!(rendering_problem(&dark).unwrap().contains("dark"));
        let outlined = drawing(
            r##"font-size="56" fill="#101828" stroke="#ffffff" stroke-width="3" paint-order="stroke""##,
            "GAMES NIGHT",
        );
        assert_eq!(rendering_problem(&outlined), None);
        let shadowed = dark.replace(
            "</svg>",
            r##"<text x="198" y="64" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="56" fill="#ffd400" textLength="330" lengthAdjust="spacingAndGlyphs">GAMES NIGHT</text></svg>"##,
        );
        assert_eq!(rendering_problem(&shadowed), None);
        // Words coloured in tspans show in the tspans' colours.
        let coloured = drawing(
            r#"font-size="56""#,
            r##"<tspan fill="#ffffff">GAMES </tspan><tspan fill="#f7b25c">NIGHT</tspan>"##,
        );
        assert_eq!(rendering_problem(&coloured), None);
        let half_dark = drawing(
            r#"font-size="56""#,
            r##"<tspan fill="#ffffff">GAMES </tspan><tspan fill="#101828">NIGHT</tspan>"##,
        );
        assert_eq!(
            rendering_problem(&half_dark).as_deref(),
            Some("\"NIGHT\" is dark with no light outline")
        );
        let banded = dark.replace(
            r#"viewBox="0 0 400 90">"#,
            r##"viewBox="0 0 400 90"><rect x="0" y="0" width="400" height="90" fill="#ffd400"/>"##,
        );
        assert_eq!(rendering_problem(&banded), None);
    }
}
