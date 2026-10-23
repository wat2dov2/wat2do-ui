"""The light wat2do email layout shared by every email the app sends."""

from dataclasses import replace
from html import escape
from pathlib import Path

from services import school_logo_service, school_service
from services.email_service import InlineImage

# Email clients do not reliably support CSS custom properties or OKLCH.
# These resolved sRGB values preserve the app's semantic light-theme roles.
EMAIL_THEME = {
    "background": "#f9f9f9",
    "surface": "#ffffff",
    "surface_elevated": "#f3f3f3",
    "foreground": "#171717",
    "muted_foreground": "#5c5c5c",
    "border": "#d6d6d6",
}

# The shell always shows cid:wat2do-logo; email_logo picks which image fills it.
_WAT2DO_LOGO = InlineImage(
    content_id="wat2do-logo",
    filename="wat2do-logo.png",
    content_type="image/png",
    content=Path(__file__).with_name("wat2do-logo.png").read_bytes(),
)


def email_logo(school: str | None) -> InlineImage:
    """The school's poster logo when it has one, otherwise the standard wat2do logo."""
    record = school_service.get_school(school)
    poster_logo = (
        school_logo_service.email_poster_logo(record.poster_logo_url)
        if record is not None and record.poster_logo_url
        else None
    )
    return replace(_WAT2DO_LOGO, content=poster_logo) if poster_logo else _WAT2DO_LOGO


def email_shell(
    *,
    heading: str,
    content: str,
    footer_links: list[tuple[str, str]] | None = None,
) -> str:
    """Logo, heading, content, and footer on the light card. Send with ``email_logo`` inline."""
    links = " &middot; ".join(
        f'<a style="color:{EMAIL_THEME["foreground"]};" href="{escape(url, quote=True)}">'
        f"{escape(label)}</a>"
        for label, url in footer_links or []
    )
    return (
        f'<div style="margin:0;background:{EMAIL_THEME["background"]};padding:28px 16px;">'
        f'<div style="max-width:640px;margin:0 auto;background:{EMAIL_THEME["surface"]};'
        f'border:1px solid {EMAIL_THEME["border"]};border-radius:16px;padding:24px;">'
        f'<img src="cid:{_WAT2DO_LOGO.content_id}" alt="wat2do" width="80" height="57" '
        'style="display:block;margin:0 0 16px;border:0;">'
        f'<h1 style="margin:0 0 24px;color:{EMAIL_THEME["foreground"]};'
        f'font:800 28px sans-serif;">{escape(heading)}</h1>'
        f"{content}"
        f'<p style="margin:24px 0 0;color:{EMAIL_THEME["muted_foreground"]};'
        'font:12px/1.6 sans-serif;">'
        f"{links + '<br>' if links else ''}"
        "wat2do helps students discover campus events."
        "</p></div></div>"
    )


def email_paragraph(html: str, *, muted: bool = False) -> str:
    """A body paragraph; ``html`` must already be escaped."""
    color = EMAIL_THEME["muted_foreground" if muted else "foreground"]
    return f'<p style="margin:0 0 18px;color:{color};font:15px/1.6 sans-serif;">{html}</p>'


def email_note(html: str) -> str:
    """Small print such as expiry notices; ``html`` must already be escaped."""
    return (
        f'<p style="margin:0;color:{EMAIL_THEME["muted_foreground"]};'
        f'font:13px/1.6 sans-serif;">{html}</p>'
    )


def email_button(href: str, label: str) -> str:
    return (
        f'<a href="{escape(href, quote=True)}" style="display:inline-block;margin:4px 0 20px;'
        f"padding:12px 20px;background:{EMAIL_THEME['foreground']};"
        f"color:{EMAIL_THEME['background']};border-radius:999px;font:700 14px sans-serif;"
        f'text-decoration:none;">{escape(label)}</a>'
    )
