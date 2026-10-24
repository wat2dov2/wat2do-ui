"""Open, script and close Safari windows for the pain point sweep's site readers.

Readers only run JavaScript that reads what a page displays: they never click,
post or touch cookies or logins. Safari needs "Allow JavaScript from Apple
Events".
"""

from __future__ import annotations

import subprocess

from core.controlbox import controlbox

CONTROL = controlbox.competitor_pain_points


class SafariUnavailable(RuntimeError):
    """Safari could not show a site's search results (not logged in, or not scriptable)."""


def open_window(url: str) -> str:
    """Open ``url`` in a new Safari window and return the window's id."""
    return _osascript(
        'tell application "Safari" to make new document with properties {URL:(item 1 of argv)}',
        'tell application "Safari" to return id of front window',
        args=[url],
    )


def run_javascript(window: str, source: str) -> str:
    return _osascript(
        'tell application "Safari" to do JavaScript (item 1 of argv) '
        "in current tab of window id ((item 2 of argv) as integer)",
        args=[source, window],
    )


def close_window(window: str) -> None:
    _osascript(
        'tell application "Safari" to close window id ((item 1 of argv) as integer)',
        args=[window],
    )


def _osascript(*lines: str, args: list[str]) -> str:
    script = ["on run argv", *lines, "end run"]
    try:
        result = subprocess.run(
            ["osascript", *(part for line in script for part in ("-e", line)), *args],
            capture_output=True,
            text=True,
            timeout=CONTROL.page_wait_seconds * 4,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        # Safari's own reason, such as JavaScript from Apple Events being off.
        reason = (exc.stderr or "").strip().splitlines()[-1:] or ["unknown error"]
        raise SafariUnavailable(f"Safari could not be scripted: {reason[0]}") from None
    except (OSError, subprocess.SubprocessError) as exc:
        raise SafariUnavailable(f"Safari could not be scripted ({type(exc).__name__})") from None
    return result.stdout.strip()
