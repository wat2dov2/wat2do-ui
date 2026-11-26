//! The wat2do layout shared by every email the app sends
//! (`services/email_layout.py`): a big headline, body text, a pill button,
//! info cards, a sign-off and a muted footer, light or dark with the reader.

use std::sync::{Arc, LazyLock};

use super::InlineImage;

// Email clients do not reliably support CSS custom properties or OKLCH.
// These resolved sRGB values preserve the app's semantic light-theme roles
// (`frontend/src/styles/functional-tokens.css`).
pub const SURFACE: &str = "#ffffff";
pub const SURFACE_ELEVATED: &str = "#f3f3f3";
pub const FOREGROUND: &str = "#171717";
pub const MUTED_FOREGROUND: &str = "#5c5c5c";
pub const BORDER: &str = "#d6d6d6";
pub const PRIMARY: &str = "#171717";
pub const PRIMARY_FOREGROUND: &str = "#fafafa";

/// The app's dark theme, for mail apps that follow the reader's dark mode:
/// each class's property and value. Every element that sets one of these
/// colours inline also carries its class.
const DARK_THEME: [(&str, &str, &str); 7] = [
    ("w2d-page", "background-color", "#171717"),
    ("w2d-fg", "color", "#f5f5f5"),
    ("w2d-muted", "color", "#949494"),
    ("w2d-elevated", "background-color", "#1c1c1c"),
    ("w2d-border", "border-color", "#292929"),
    ("w2d-button", "background-color", "#f5f5f5"),
    ("w2d-button-label", "color", "#141414"),
];

/// The site's Satoshi, from Fontshare (it allows cross-origin font loads). Clients
/// that ignore web fonts, like Gmail, fall back to the site's system stack.
pub const FONT: &str =
    "Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
static HEAD: LazyLock<String> = LazyLock::new(|| {
    let rule = |prefix: &str, (class, property, value): &(&str, &str, &str)| {
        format!("{prefix}.{class}{{{property}:{value}!important;}}")
    };
    let dark: String = DARK_THEME.iter().map(|entry| rule("", entry)).collect();
    // Outlook's apps mark what they recolour: text with data-ogsc, the rest with data-ogsb.
    let outlook: String = DARK_THEME
        .iter()
        .map(|entry| {
            let marker = if entry.1 == "color" { "ogsc" } else { "ogsb" };
            rule(&format!("[data-{marker}] "), entry)
        })
        .collect();
    format!(
        concat!(
            r#"<meta name="color-scheme" content="light dark">"#,
            r#"<meta name="supported-color-schemes" content="light dark">"#,
            "<style>@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,800&display=swap');",
            ":root{{color-scheme:light dark;supported-color-schemes:light dark;}}",
            "@media (prefers-color-scheme:dark){{{dark}}}{outlook}</style>",
        ),
        dark = dark,
        outlook = outlook,
    )
});

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

/// The logo, a big left-aligned headline, the content, a sign-off and a small
/// muted footer with its links, in one centred column with no card around it.
/// Send with [`LOGO`] inline.
pub fn shell(heading: &str, content: &str, footer_links: &[(&str, &str)]) -> String {
    let links: String = footer_links
        .iter()
        .map(|(label, url)| link(url, label))
        .collect::<Vec<_>>()
        .join(" &middot; ");
    let links = if links.is_empty() {
        links
    } else {
        format!("<br>{links}")
    };
    format!(
        concat!(
            "{head}",
            r#"<table class="w2d-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" "#,
            r#"bgcolor="{surface}" style="border-collapse:collapse;background:{surface};"><tr>"#,
            r#"<td align="center" style="padding:40px 24px;">"#,
            r#"<table role="presentation" width="100%" cellpadding="0" cellspacing="0" "#,
            r#"style="border-collapse:collapse;max-width:560px;"><tr><td style="text-align:left;">"#,
            r#"<img src="cid:{logo}" alt="wat2do" width="45" height="32" "#,
            r#"style="display:block;width:45px;height:32px;margin:0 0 32px;border:0;">"#,
            r#"<h1 class="w2d-fg" style="margin:0 0 20px;color:{foreground};"#,
            r#"font:700 30px/1.15 {font};letter-spacing:-0.01em;">{heading}</h1>"#,
            "{content}",
            r#"<p class="w2d-fg" style="margin:12px 0 0;color:{foreground};"#,
            r#"font:16px/1.45 {font};">Thanks,<br>The wat2do team</p>"#,
            r#"<p class="w2d-muted" style="margin:32px 0 0;color:{muted};"#,
            r#"font:13px/1.5 {font};">wat2do helps students discover campus events.{links}</p>"#,
            "</td></tr></table></td></tr></table>",
        ),
        head = HEAD.as_str(),
        surface = SURFACE,
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
    let (class, color) = if muted {
        ("w2d-muted", MUTED_FOREGROUND)
    } else {
        ("w2d-fg", FOREGROUND)
    };
    format!(
        r#"<p class="{class}" style="margin:0 0 20px;color:{color};font:16px/1.45 {FONT};">{html}</p>"#
    )
}

/// A smaller bold heading that opens a section of the body, like "Need a refund?".
pub fn section_heading(text: &str) -> String {
    format!(
        r#"<h2 class="w2d-fg" style="margin:12px 0 8px;color:{FOREGROUND};font:700 20px/1.3 {FONT};">{}</h2>"#,
        escape(text)
    )
}

/// A link inside running text or the footer.
pub fn link(href: &str, label: &str) -> String {
    format!(
        r#"<a class="w2d-fg" href="{}" style="color:{FOREGROUND};font-weight:700;text-decoration:underline;">{}</a>"#,
        escape(href),
        escape(label)
    )
}

/// Small print such as expiry notices; `html` must already be escaped.
pub fn note(html: &str) -> String {
    format!(
        r#"<p class="w2d-muted" style="margin:0 0 20px;color:{MUTED_FOREGROUND};font:14px/1.5 {FONT};">{html}</p>"#
    )
}

/// Someone's own words, such as a rejection reason; `html` must already be escaped.
pub fn quote(html: &str) -> String {
    format!(
        concat!(
            r#"<div class="w2d-elevated w2d-border w2d-fg" style="margin:0 0 20px;padding:16px;"#,
            "background:{};border:1px solid {};border-radius:16px;",
            r#"color:{};font:16px/1.45 {};">{}</div>"#,
        ),
        SURFACE_ELEVATED, BORDER, FOREGROUND, FONT, html
    )
}

/// A one-time code, big enough to read and type from a phone.
pub fn code(code: &str) -> String {
    format!(
        concat!(
            r#"<div class="w2d-elevated w2d-fg" style="margin:0 0 20px;padding:18px 16px;"#,
            "background:{};border-radius:16px;text-align:center;",
            r#"color:{};font:700 32px/1.2 {};letter-spacing:8px;">{}</div>"#,
        ),
        SURFACE_ELEVATED,
        FOREGROUND,
        FONT,
        escape(code)
    )
}

/// The email's main action: a full-width pill.
pub fn button(href: &str, label: &str) -> String {
    format!(
        concat!(
            r#"<table role="presentation" width="100%" cellpadding="0" cellspacing="0" "#,
            r#"style="border-collapse:separate;margin:4px 0 24px;"><tr>"#,
            r#"<td class="w2d-button" align="center" bgcolor="{primary}" "#,
            r#"style="background:{primary};border-radius:999px;">"#,
            r#"<a class="w2d-button-label" href="{href}" style="display:block;padding:15px 24px;"#,
            "color:{label_color};font:500 17px/22px {font};text-decoration:none;",
            r#"border-radius:999px;">{label}</a></td></tr></table>"#,
        ),
        primary = PRIMARY,
        href = escape(href),
        label_color = PRIMARY_FOREGROUND,
        font = FONT,
        label = escape(label),
    )
}

/// A soft bordered summary of one thing, such as an event: its title, muted
/// detail lines and, when there is one, its picture on the right, all linking
/// to `href`.
pub fn info_card(href: &str, title: &str, lines: &[String], image_src: Option<&str>) -> String {
    let href = escape(href);
    let lines: String = lines
        .iter()
        .map(|line| {
            format!(
                r#"<div class="w2d-muted" style="margin:4px 0 0;color:{MUTED_FOREGROUND};font:15px/1.4 {FONT};">{}</div>"#,
                escape(line)
            )
        })
        .collect();
    let image = image_src
        .filter(|src| !src.is_empty())
        .map_or(String::new(), |src| {
            format!(
                concat!(
                    r#"<td width="72" valign="middle" style="width:72px;padding:16px 16px 16px 0;">"#,
                    r#"<a href="{href}"><img src="{src}" alt="" width="72" "#,
                    r#"style="display:block;width:72px;height:auto;border:0;border-radius:10px;"></a></td>"#,
                ),
                href = href,
                src = escape(src),
            )
        });
    format!(
        concat!(
            r#"<table class="w2d-border" role="presentation" width="100%" cellpadding="0" cellspacing="0" "#,
            r#"style="border-collapse:separate;margin:0 0 24px;border:1px solid {border};border-radius:16px;"><tr>"#,
            r#"<td valign="middle" style="padding:16px 20px;">"#,
            r#"<a class="w2d-fg" href="{href}" style="color:{foreground};text-decoration:none;"#,
            r#"font:600 17px/1.35 {font};">{title}</a>{lines}</td>{image}</tr></table>"#,
        ),
        border = BORDER,
        href = href,
        foreground = FOREGROUND,
        font = FONT,
        title = escape(title),
        lines = lines,
        image = image,
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

    // `services/email_layout.py` output, byte for byte.
    const PYTHON_SHELL_WITH_LINKS: &str = r##"<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,800&display=swap');:root{color-scheme:light dark;supported-color-schemes:light dark;}@media (prefers-color-scheme:dark){.w2d-page{background-color:#171717!important;}.w2d-fg{color:#f5f5f5!important;}.w2d-muted{color:#949494!important;}.w2d-elevated{background-color:#1c1c1c!important;}.w2d-border{border-color:#292929!important;}.w2d-button{background-color:#f5f5f5!important;}.w2d-button-label{color:#141414!important;}}[data-ogsb] .w2d-page{background-color:#171717!important;}[data-ogsc] .w2d-fg{color:#f5f5f5!important;}[data-ogsc] .w2d-muted{color:#949494!important;}[data-ogsb] .w2d-elevated{background-color:#1c1c1c!important;}[data-ogsb] .w2d-border{border-color:#292929!important;}[data-ogsb] .w2d-button{background-color:#f5f5f5!important;}[data-ogsc] .w2d-button-label{color:#141414!important;}</style><table class="w2d-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="border-collapse:collapse;background:#ffffff;"><tr><td align="center" style="padding:40px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;"><tr><td style="text-align:left;"><img src="cid:wat2do-logo" alt="wat2do" width="45" height="32" style="display:block;width:45px;height:32px;margin:0 0 32px;border:0;"><h1 class="w2d-fg" style="margin:0 0 20px;color:#171717;font:700 30px/1.15 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.01em;">Hi &amp; &lt;you&gt;</h1><p>c</p><p class="w2d-fg" style="margin:12px 0 0;color:#171717;font:16px/1.45 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Thanks,<br>The wat2do team</p><p class="w2d-muted" style="margin:32px 0 0;color:#5c5c5c;font:13px/1.5 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">wat2do helps students discover campus events.<br><a class="w2d-fg" href="https://x.test/a?b=1&amp;c=2" style="color:#171717;font-weight:700;text-decoration:underline;">Settings</a> &middot; <a class="w2d-fg" href="u" style="color:#171717;font-weight:700;text-decoration:underline;">Unsubscribe</a></p></td></tr></table></td></tr></table>"##;
    const PYTHON_SHELL_WITHOUT_LINKS: &str = r##"<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,800&display=swap');:root{color-scheme:light dark;supported-color-schemes:light dark;}@media (prefers-color-scheme:dark){.w2d-page{background-color:#171717!important;}.w2d-fg{color:#f5f5f5!important;}.w2d-muted{color:#949494!important;}.w2d-elevated{background-color:#1c1c1c!important;}.w2d-border{border-color:#292929!important;}.w2d-button{background-color:#f5f5f5!important;}.w2d-button-label{color:#141414!important;}}[data-ogsb] .w2d-page{background-color:#171717!important;}[data-ogsc] .w2d-fg{color:#f5f5f5!important;}[data-ogsc] .w2d-muted{color:#949494!important;}[data-ogsb] .w2d-elevated{background-color:#1c1c1c!important;}[data-ogsb] .w2d-border{border-color:#292929!important;}[data-ogsb] .w2d-button{background-color:#f5f5f5!important;}[data-ogsc] .w2d-button-label{color:#141414!important;}</style><table class="w2d-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="border-collapse:collapse;background:#ffffff;"><tr><td align="center" style="padding:40px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;"><tr><td style="text-align:left;"><img src="cid:wat2do-logo" alt="wat2do" width="45" height="32" style="display:block;width:45px;height:32px;margin:0 0 32px;border:0;"><h1 class="w2d-fg" style="margin:0 0 20px;color:#171717;font:700 30px/1.15 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.01em;">Hi</h1><p>c</p><p class="w2d-fg" style="margin:12px 0 0;color:#171717;font:16px/1.45 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Thanks,<br>The wat2do team</p><p class="w2d-muted" style="margin:32px 0 0;color:#5c5c5c;font:13px/1.5 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">wat2do helps students discover campus events.</p></td></tr></table></td></tr></table>"##;
    const PYTHON_COMPONENTS: &str = r##"<table class="w2d-border" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 24px;border:1px solid #d6d6d6;border-radius:16px;"><tr><td valign="middle" style="padding:16px 20px;"><a class="w2d-fg" href="https://x.test/e/1?a=1&amp;b=2" style="color:#171717;text-decoration:none;font:600 17px/1.35 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Tea &amp; &lt;cake&gt;</a><div class="w2d-muted" style="margin:4px 0 0;color:#5c5c5c;font:15px/1.4 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Fri, May 1 · 11 AM</div><div class="w2d-muted" style="margin:4px 0 0;color:#5c5c5c;font:15px/1.4 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">SLC</div></td><td width="72" valign="middle" style="width:72px;padding:16px 16px 16px 0;"><a href="https://x.test/e/1?a=1&amp;b=2"><img src="cid:event-1" alt="" width="72" style="display:block;width:72px;height:auto;border:0;border-radius:10px;"></a></td></tr></table><table class="w2d-border" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 24px;border:1px solid #d6d6d6;border-radius:16px;"><tr><td valign="middle" style="padding:16px 20px;"><a class="w2d-fg" href="u" style="color:#171717;text-decoration:none;font:600 17px/1.35 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">T</a></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:4px 0 24px;"><tr><td class="w2d-button" align="center" bgcolor="#171717" style="background:#171717;border-radius:999px;"><a class="w2d-button-label" href="https://x.test/?a=1&amp;b=2" style="display:block;padding:15px 24px;color:#fafafa;font:500 17px/22px Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-decoration:none;border-radius:999px;">Go &amp; see</a></td></tr></table><h2 class="w2d-fg" style="margin:12px 0 8px;color:#171717;font:700 20px/1.3 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Need a refund?</h2><p class="w2d-muted" style="margin:0 0 20px;color:#5c5c5c;font:16px/1.45 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">x</p>"##;

    #[test]
    fn shell_matches_python_byte_for_byte() {
        assert_eq!(
            shell(
                "Hi & <you>",
                "<p>c</p>",
                &[
                    ("Settings", "https://x.test/a?b=1&c=2"),
                    ("Unsubscribe", "u")
                ],
            ),
            PYTHON_SHELL_WITH_LINKS
        );
        assert_eq!(shell("Hi", "<p>c</p>", &[]), PYTHON_SHELL_WITHOUT_LINKS);
    }

    #[test]
    fn components_match_python_byte_for_byte() {
        let lines = ["Fri, May 1 \u{b7} 11 AM".to_owned(), "SLC".to_owned()];
        let html = info_card(
            "https://x.test/e/1?a=1&b=2",
            "Tea & <cake>",
            &lines,
            Some("cid:event-1"),
        ) + &info_card("u", "T", &[], None)
            + &button("https://x.test/?a=1&b=2", "Go & see")
            + &section_heading("Need a refund?")
            + &paragraph("x", true);
        assert_eq!(html, PYTHON_COMPONENTS);
    }

    #[test]
    fn dark_mode_recolours_every_themed_class() {
        let html = shell(
            "Hi",
            &(paragraph("a", false) + &note("b") + &code("123456")),
            &[],
        );
        let (_, dark) = html
            .split_once("@media (prefers-color-scheme:dark){")
            .unwrap();
        for (class, property, value) in DARK_THEME {
            assert!(dark.contains(&format!(".{class}{{{property}:{value}!important;}}")));
        }
        assert!(html.contains(r#"<meta name="color-scheme" content="light dark">"#));
    }

    #[test]
    fn shell_leads_with_the_logo_and_signs_off_after_the_content() {
        let html = shell("Your code", "<p>Codes expire in 15 minutes.</p>", &[]);
        let logo = html.find(r#"<img src="cid:wat2do-logo""#).unwrap();
        let heading = html.find("Your code</h1>").unwrap();
        let content = html.find("expire in 15").unwrap();
        let sign_off = html.find("The wat2do team").unwrap();
        assert!(logo < heading && heading < content && content < sign_off);
    }
}
