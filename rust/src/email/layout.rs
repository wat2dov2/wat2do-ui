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
static HEAD: LazyLock<String> = LazyLock::new(|| {
    format!(
        concat!(
            r#"<meta name="color-scheme" content="light only">"#,
            r#"<meta name="supported-color-schemes" content="light only">"#,
            "<style>@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,800&display=swap');",
            // Keep the light card in dark mode: clients that honour color-scheme stop
            // recolouring, and Outlook's apps restore colours they rewrote (data-ogsb/ogsc).
            ":root{{color-scheme:light only;supported-color-schemes:light only;}}",
            "[data-ogsb] .w2d-page{{background-color:{background}!important;}}",
            "[data-ogsb] .w2d-card{{background-color:{surface}!important;}}",
            "[data-ogsb] .w2d-elevated{{background-color:{elevated}!important;}}",
            "[data-ogsb] .w2d-button{{background-color:{foreground}!important;}}",
            "[data-ogsc] .w2d-card,[data-ogsc] .w2d-card *{{color:{foreground}!important;}}",
            "[data-ogsc] .w2d-card .w2d-button{{color:{background}!important;}}",
            "</style>",
        ),
        background = BACKGROUND,
        surface = SURFACE,
        elevated = SURFACE_ELEVATED,
        foreground = FOREGROUND,
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

/// Heading, content and a footer signed with a small logo on the light card.
/// Send with [`LOGO`] inline.
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
    // Links, when there are any, get their own line above the signature.
    let (footer_links, signature_margin) = if links.is_empty() {
        (String::new(), "24px")
    } else {
        (
            format!(
                r#"<p style="margin:24px 0 0;color:{MUTED_FOREGROUND};font:12px/1.6 {FONT};">{links}</p>"#
            ),
            "8px",
        )
    };
    format!(
        concat!(
            "{head}",
            r#"<div class="w2d-page" style="margin:0;background:{background};padding:28px 16px;">"#,
            r#"<div class="w2d-card" style="max-width:640px;margin:0 auto;background:{surface};"#,
            r#"border:1px solid {border};border-radius:16px;padding:24px;">"#,
            r#"<h1 style="margin:0 0 24px;color:{foreground};"#,
            r#"font:800 28px {font};">{heading}</h1>"#,
            "{content}",
            "{footer_links}",
            r#"<table role="presentation" cellpadding="0" cellspacing="0" "#,
            r#"style="border-collapse:collapse;margin:{signature_margin} 0 0;"><tr>"#,
            r#"<td width="24" valign="middle" style="width:24px;padding:0 6px 0 0;">"#,
            r#"<img src="cid:{logo}" alt="wat2do" width="24" height="17" "#,
            r#"style="display:block;width:24px;height:17px;border:0;"></td>"#,
            r#"<td valign="middle" style="color:{muted};"#,
            r#"font:12px/1.6 {font};">wat2do helps students discover campus events.</td>"#,
            "</tr></table></div></div>",
        ),
        head = HEAD.as_str(),
        background = BACKGROUND,
        surface = SURFACE,
        border = BORDER,
        foreground = FOREGROUND,
        font = FONT,
        heading = escape(heading),
        content = content,
        footer_links = footer_links,
        signature_margin = signature_margin,
        logo = LOGO.content_id,
        muted = MUTED_FOREGROUND,
    )
}

/// A body paragraph; `html` must already be escaped.
pub fn paragraph(html: &str, muted: bool) -> String {
    let color = if muted { MUTED_FOREGROUND } else { FOREGROUND };
    format!(r#"<p style="margin:0 0 18px;color:{color};font:15px/1.6 {FONT};">{html}</p>"#)
}

/// Small print such as expiry notices; `html` must already be escaped.
pub fn note(html: &str) -> String {
    format!(r#"<p style="margin:0;color:{MUTED_FOREGROUND};font:13px/1.6 {FONT};">{html}</p>"#)
}

/// Someone's own words, such as a rejection reason; `html` must already be escaped.
pub fn quote(html: &str) -> String {
    format!(
        concat!(
            r#"<div class="w2d-elevated" style="margin:0 0 18px;padding:16px;background:{};"#,
            "border:1px solid {};border-radius:12px;",
            r#"color:{};font:15px/1.6 {};">{}</div>"#,
        ),
        SURFACE_ELEVATED, BORDER, FOREGROUND, FONT, html
    )
}

pub fn button(href: &str, label: &str) -> String {
    format!(
        concat!(
            r#"<a class="w2d-button" href="{}" style="display:inline-block;margin:4px 0 20px;"#,
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

    // `email_shell` output from `services/email_layout.py`, byte for byte.
    const PYTHON_SHELL_WITH_LINKS: &str = r#"<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><style>@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,800&display=swap');:root{color-scheme:light only;supported-color-schemes:light only;}[data-ogsb] .w2d-page{background-color:#f9f9f9!important;}[data-ogsb] .w2d-card{background-color:#ffffff!important;}[data-ogsb] .w2d-elevated{background-color:#f3f3f3!important;}[data-ogsb] .w2d-button{background-color:#171717!important;}[data-ogsc] .w2d-card,[data-ogsc] .w2d-card *{color:#171717!important;}[data-ogsc] .w2d-card .w2d-button{color:#f9f9f9!important;}</style><div class="w2d-page" style="margin:0;background:#f9f9f9;padding:28px 16px;"><div class="w2d-card" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d6d6d6;border-radius:16px;padding:24px;"><h1 style="margin:0 0 24px;color:#171717;font:800 28px Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Hi &amp; &lt;you&gt;</h1><p>c</p><p style="margin:24px 0 0;color:#5c5c5c;font:12px/1.6 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"><a style="color:#171717;" href="https://x.test/a?b=1&amp;c=2">Settings</a> &middot; <a style="color:#171717;" href="u">Unsubscribe</a></p><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 0;"><tr><td width="24" valign="middle" style="width:24px;padding:0 6px 0 0;"><img src="cid:wat2do-logo" alt="wat2do" width="24" height="17" style="display:block;width:24px;height:17px;border:0;"></td><td valign="middle" style="color:#5c5c5c;font:12px/1.6 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">wat2do helps students discover campus events.</td></tr></table></div></div>"#;
    const PYTHON_SHELL_WITHOUT_LINKS: &str = r#"<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><style>@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,800&display=swap');:root{color-scheme:light only;supported-color-schemes:light only;}[data-ogsb] .w2d-page{background-color:#f9f9f9!important;}[data-ogsb] .w2d-card{background-color:#ffffff!important;}[data-ogsb] .w2d-elevated{background-color:#f3f3f3!important;}[data-ogsb] .w2d-button{background-color:#171717!important;}[data-ogsc] .w2d-card,[data-ogsc] .w2d-card *{color:#171717!important;}[data-ogsc] .w2d-card .w2d-button{color:#f9f9f9!important;}</style><div class="w2d-page" style="margin:0;background:#f9f9f9;padding:28px 16px;"><div class="w2d-card" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d6d6d6;border-radius:16px;padding:24px;"><h1 style="margin:0 0 24px;color:#171717;font:800 28px Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Hi</h1><p>c</p><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:24px 0 0;"><tr><td width="24" valign="middle" style="width:24px;padding:0 6px 0 0;"><img src="cid:wat2do-logo" alt="wat2do" width="24" height="17" style="display:block;width:24px;height:17px;border:0;"></td><td valign="middle" style="color:#5c5c5c;font:12px/1.6 Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">wat2do helps students discover campus events.</td></tr></table></div></div>"#;

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
    fn shell_signs_the_card_with_the_logo_after_the_content() {
        let html = shell("Your code", "<p>Codes expire in 15 minutes.</p>", &[]);
        let logo = html.find(r#"<img src="cid:wat2do-logo""#).unwrap();
        assert!(logo > html.find("expire in 15").unwrap());
    }
}
