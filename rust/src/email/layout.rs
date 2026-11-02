//! The light wat2do layout shared by every email the app sends
//! (`services/email_layout.py`).

use std::sync::{Arc, LazyLock};

use super::InlineImage;

// Email clients do not reliably support CSS custom properties or OKLCH.
// These resolved sRGB values preserve the app's semantic light-theme roles.
pub const BACKGROUND: &str = "#f9f9f9";
pub const SURFACE: &str = "#ffffff";
pub const SURFACE_ELEVATED: &str = "#f3f3f3";
pub const FOREGROUND: &str = "#171717";
pub const MUTED_FOREGROUND: &str = "#5c5c5c";
pub const BORDER: &str = "#d6d6d6";

/// The site's Satoshi, from Fontshare (it allows cross-origin font loads). Clients
/// that ignore web fonts, like Gmail, fall back to the site's system stack.
pub const FONT: &str =
    "Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const FONT_IMPORT: &str = "<style>@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,800&display=swap');</style>";

/// Embedded in every email; the shell shows it as `cid:wat2do-logo`.
pub static LOGO: LazyLock<Arc<InlineImage>> = LazyLock::new(|| {
    Arc::new(InlineImage {
        content_id: "wat2do-logo".to_owned(),
        filename: "wat2do-logo.png".to_owned(),
        content_type: "image/png".to_owned(),
        content: include_bytes!("../../../backend/services/wat2do-logo.png").to_vec(),
    })
});

/// Python's `html.escape(value, quote=True)`.
pub fn escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#x27;"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// Logo, heading, content and footer on the light card. Send with [`LOGO`] inline.
pub fn shell(heading: &str, content: &str, footer_links: &[(&str, &str)]) -> String {
    let links = footer_links
        .iter()
        .map(|(label, url)| {
            format!(
                r#"<a style="color:{FOREGROUND};" href="{}">{}</a>"#,
                escape(url),
                escape(label)
            )
        })
        .collect::<Vec<_>>()
        .join(" &middot; ");
    let links = if links.is_empty() {
        links
    } else {
        links + "<br>"
    };
    format!(
        concat!(
            "{font_import}",
            r#"<div style="margin:0;background:{background};padding:28px 16px;">"#,
            r#"<div style="max-width:640px;margin:0 auto;background:{surface};"#,
            r#"border:1px solid {border};border-radius:16px;padding:24px;">"#,
            r#"<img src="cid:{logo}" alt="wat2do" width="80" height="57" "#,
            r#"style="display:block;margin:0 0 16px;border:0;">"#,
            r#"<h1 style="margin:0 0 24px;color:{foreground};"#,
            r#"font:800 28px {font};">{heading}</h1>"#,
            "{content}",
            r#"<p style="margin:24px 0 0;color:{muted};"#,
            r#"font:12px/1.6 {font};">"#,
            "{links}",
            "wat2do helps students discover campus events.",
            "</p></div></div>",
        ),
        font_import = FONT_IMPORT,
        background = BACKGROUND,
        surface = SURFACE,
        border = BORDER,
        logo = LOGO.content_id,
        foreground = FOREGROUND,
        font = FONT,
        heading = escape(heading),
        content = content,
        muted = MUTED_FOREGROUND,
        links = links,
    )
}

/// A body paragraph; `html` must already be escaped.
pub fn paragraph(html: &str, muted: bool) -> String {
    let color = if muted { MUTED_FOREGROUND } else { FOREGROUND };
    format!(r#"<p style="margin:0 0 18px;color:{color};font:15px/1.6 {FONT};">{html}</p>"#)
}

pub fn button(href: &str, label: &str) -> String {
    format!(
        concat!(
            r#"<a href="{}" style="display:inline-block;margin:4px 0 20px;"#,
            "padding:12px 20px;background:{};",
            "color:{};border-radius:999px;font:700 14px {};",
            r#"text-decoration:none;">{}</a>"#,
        ),
        escape(href),
        FOREGROUND,
        BACKGROUND,
        FONT,
        escape(label)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_matches_python_html_escape() {
        assert_eq!(
            escape(r#"<a href="x">Tom & Jerry's</a>"#),
            "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#x27;s&lt;/a&gt;"
        );
    }

    #[test]
    fn shell_without_links_has_no_separator() {
        let html = shell("Hi", "<p>x</p>", &[]);
        assert!(html.contains("font:12px/1.6 Satoshi"));
        assert!(html.contains(r#"Arial,sans-serif;">wat2do helps students"#));
        assert!(
            html.starts_with(
                "<style>@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400"
            )
        );
    }
}
