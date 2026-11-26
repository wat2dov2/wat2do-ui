"""The wat2do email layout shared by every email the app sends.

A big headline, body text, a pill button, info cards, a sign-off and a muted
footer, light or dark with the reader. The emails sent by Rust use
`rust/src/email/layout.rs`, a copy of this layout; change both together.
"""

from html import escape
from pathlib import Path

from services.email_service import InlineImage

# Email clients do not reliably support CSS custom properties or OKLCH.
# These resolved sRGB values preserve the app's semantic light-theme roles
# (`frontend/src/styles/functional-tokens.css`).
EMAIL_THEME = {
    "surface": "#ffffff",
    "surface_elevated": "#f3f3f3",
    "foreground": "#171717",
    "muted_foreground": "#5c5c5c",
    "border": "#d6d6d6",
    "primary": "#171717",
    "primary_foreground": "#fafafa",
}

# The app's dark theme, for mail apps that follow the reader's dark mode: each
# class's property and value. Every element that sets one of these colours
# inline also carries its class.
_DARK_THEME = (
    ("w2d-page", "background-color", "#171717"),
    ("w2d-fg", "color", "#f5f5f5"),
    ("w2d-muted", "color", "#949494"),
    ("w2d-elevated", "background-color", "#1c1c1c"),
    ("w2d-border", "border-color", "#292929"),
    ("w2d-button", "background-color", "#f5f5f5"),
    ("w2d-button-label", "color", "#141414"),
)

# The site's Satoshi, from Fontshare (it allows cross-origin font loads). Clients
# that ignore web fonts, like Gmail, fall back to the site's system stack.
EMAIL_FONT = (
    "Satoshi,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif"
)


def _dark_rule(prefix: str, class_name: str, prop: str, value: str) -> str:
    return f"{prefix}.{class_name}{{{prop}:{value}!important;}}"


_EMAIL_HEAD = (
    '<meta name="color-scheme" content="light dark">'
    '<meta name="supported-color-schemes" content="light dark">'
    "<style>@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,800"
    "&display=swap');"
    ":root{color-scheme:light dark;supported-color-schemes:light dark;}"
    "@media (prefers-color-scheme:dark){"
    + "".join(_dark_rule("", *entry) for entry in _DARK_THEME)
    + "}"
    # Outlook's apps mark what they recolour: text with data-ogsc, the rest with data-ogsb.
    + "".join(
        _dark_rule(f"[data-{'ogsc' if entry[1] == 'color' else 'ogsb'}] ", *entry)
        for entry in _DARK_THEME
    )
    + "</style>"
)

# Embedded in every email; the shell shows it as cid:wat2do-logo.
EMAIL_LOGO = InlineImage(
    content_id="wat2do-logo",
    filename="wat2do-logo.png",
    content_type="image/png",
    content=Path(__file__).with_name("wat2do-logo.png").read_bytes(),
)


def email_shell(
    *,
    heading: str,
    content: str,
    footer_links: list[tuple[str, str]] | None = None,
) -> str:
    """The logo, a big left-aligned headline, the content, a sign-off and a small muted footer.

    One centred column with no card around it. Send with ``EMAIL_LOGO`` inline.
    """
    links = " &middot; ".join(email_link(url, label) for label, url in footer_links or [])
    surface = EMAIL_THEME["surface"]
    foreground = EMAIL_THEME["foreground"]
    return (
        f"{_EMAIL_HEAD}"
        '<table class="w2d-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'bgcolor="{surface}" style="border-collapse:collapse;background:{surface};"><tr>'
        '<td align="center" style="padding:40px 24px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="border-collapse:collapse;max-width:560px;"><tr><td style="text-align:left;">'
        f'<img src="cid:{EMAIL_LOGO.content_id}" alt="wat2do" width="45" height="32" '
        'style="display:block;width:45px;height:32px;margin:0 0 32px;border:0;">'
        f'<h1 class="w2d-fg" style="margin:0 0 20px;color:{foreground};'
        f'font:700 30px/1.15 {EMAIL_FONT};letter-spacing:-0.01em;">{escape(heading)}</h1>'
        f"{content}"
        f'<p class="w2d-fg" style="margin:12px 0 0;color:{foreground};'
        f'font:16px/1.45 {EMAIL_FONT};">Thanks,<br>The wat2do team</p>'
        f'<p class="w2d-muted" style="margin:32px 0 0;color:{EMAIL_THEME["muted_foreground"]};'
        f'font:13px/1.5 {EMAIL_FONT};">wat2do helps students discover campus events.'
        f"{f'<br>{links}' if links else ''}</p>"
        "</td></tr></table></td></tr></table>"
    )


def email_paragraph(html: str, *, muted: bool = False) -> str:
    """A body paragraph; ``html`` must already be escaped."""
    class_name, color = (
        ("w2d-muted", EMAIL_THEME["muted_foreground"])
        if muted
        else ("w2d-fg", EMAIL_THEME["foreground"])
    )
    return (
        f'<p class="{class_name}" style="margin:0 0 20px;color:{color};'
        f'font:16px/1.45 {EMAIL_FONT};">{html}</p>'
    )


def email_section_heading(text: str) -> str:
    """A smaller bold heading that opens a section of the body, like "Need a refund?"."""
    return (
        f'<h2 class="w2d-fg" style="margin:12px 0 8px;color:{EMAIL_THEME["foreground"]};'
        f'font:700 20px/1.3 {EMAIL_FONT};">{escape(text)}</h2>'
    )


def email_link(href: str, label: str) -> str:
    """A link inside running text or the footer."""
    return (
        f'<a class="w2d-fg" href="{escape(href, quote=True)}" style="color:{EMAIL_THEME["foreground"]};'
        f'font-weight:700;text-decoration:underline;">{escape(label)}</a>'
    )


def email_button(href: str, label: str) -> str:
    """The email's main action: a full-width pill."""
    primary = EMAIL_THEME["primary"]
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="border-collapse:separate;margin:4px 0 24px;"><tr>'
        f'<td class="w2d-button" align="center" bgcolor="{primary}" '
        f'style="background:{primary};border-radius:999px;">'
        f'<a class="w2d-button-label" href="{escape(href, quote=True)}" '
        'style="display:block;padding:15px 24px;'
        f"color:{EMAIL_THEME['primary_foreground']};font:500 17px/22px {EMAIL_FONT};"
        f'text-decoration:none;border-radius:999px;">{escape(label)}</a></td></tr></table>'
    )


def email_info_card(href: str, title: str, lines: list[str], image_src: str | None) -> str:
    """A soft bordered summary of one thing, such as an event.

    Its title, muted detail lines and, when there is one, its picture on the
    right, all linking to ``href``.
    """
    href = escape(href, quote=True)
    details = "".join(
        f'<div class="w2d-muted" style="margin:4px 0 0;color:{EMAIL_THEME["muted_foreground"]};'
        f'font:15px/1.4 {EMAIL_FONT};">{escape(line)}</div>'
        for line in lines
    )
    image = (
        '<td width="72" valign="middle" style="width:72px;padding:16px 16px 16px 0;">'
        f'<a href="{href}"><img src="{escape(image_src, quote=True)}" alt="" width="72" '
        'style="display:block;width:72px;height:auto;border:0;border-radius:10px;"></a></td>'
        if image_src
        else ""
    )
    return (
        '<table class="w2d-border" role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border-collapse:separate;margin:0 0 24px;border:1px solid {EMAIL_THEME["border"]};'
        'border-radius:16px;"><tr>'
        '<td valign="middle" style="padding:16px 20px;">'
        f'<a class="w2d-fg" href="{href}" style="color:{EMAIL_THEME["foreground"]};'
        f'text-decoration:none;font:600 17px/1.35 {EMAIL_FONT};">{escape(title)}</a>{details}</td>'
        f"{image}</tr></table>"
    )
