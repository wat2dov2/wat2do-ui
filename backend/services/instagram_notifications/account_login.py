"""What Brave needs to log a school account back in: its password and any emailed code.

Passwords live in the Mac's login Keychain (one generic password per school account
under ``login_keychain_service``) and are handed straight to the login form; they are
never logged, stored elsewhere or put on a command line. Instagram sends security
codes to one Gmail inbox, read over IMAP with an app password kept in the Keychain.
"""

from __future__ import annotations

import email
import imaplib
import re
import subprocess
import time
from email.message import Message
from email.utils import parsedate_to_datetime

from core.controlbox import controlbox

_CONTROL = controlbox.instagram_browser
_SWITCHER_DOMAIN = re.compile(r"^([a-z0-9_]+)[.]wat2do[.]io$")
_CODE = re.compile(r"(?<!\d)(\d{6})(?!\d)")


def canonical_account(name: str) -> str:
    """``wat2do.<school>`` for a name Instagram's saved profiles or switcher show."""
    name = name.casefold()
    if match := _SWITCHER_DOMAIN.fullmatch(name):
        return f"wat2do.{match.group(1)}"
    for school, shown in _CONTROL.school_switcher_username_overrides.items():
        if shown.casefold() == name:
            return f"wat2do.{school}"
    return name


def account_password(username: str) -> str | None:
    """The account's password from the Keychain, or None when none is stored."""
    try:
        completed = subprocess.run(
            [
                "/usr/bin/security",
                "find-generic-password",
                "-s",
                _CONTROL.login_keychain_service,
                "-a",
                username,
                "-w",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    password = completed.stdout.rstrip("\n")
    return password if completed.returncode == 0 and password else None


def emailed_code(username: str, sent_after: float) -> str | None:
    """Wait for Instagram's security code for the account, sent after ``sent_after``."""
    password = _imap_password()
    if password is None:
        return None
    deadline = time.monotonic() + _CONTROL.login_code_wait_seconds
    while True:
        code = _newest_code(password, username, sent_after)
        if code or time.monotonic() >= deadline:
            return code
        time.sleep(5)


def _imap_password() -> str | None:
    try:
        completed = subprocess.run(
            [
                "/usr/bin/security",
                "find-generic-password",
                "-s",
                _CONTROL.login_code_keychain_service,
                "-a",
                _CONTROL.login_code_email,
                "-w",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    password = completed.stdout.strip()
    return password if completed.returncode == 0 and password else None


def _newest_code(imap_password: str, username: str, sent_after: float) -> str | None:
    try:
        with imaplib.IMAP4_SSL(_CONTROL.login_code_imap_host, timeout=20) as mailbox:
            mailbox.login(_CONTROL.login_code_email, imap_password)
            mailbox.select("INBOX", readonly=True)
            since = time.strftime("%d-%b-%Y", time.gmtime(sent_after - 86400))
            _, found = mailbox.search(None, "FROM", '"instagram"', "SINCE", since)
            for message_id in reversed(found[0].split()[-10:]):
                _, parts = mailbox.fetch(message_id, "(RFC822)")
                raw = next((part[1] for part in parts if isinstance(part, tuple)), None)
                if raw is None:
                    continue
                code = code_in_message(email.message_from_bytes(raw), username, sent_after)
                if code:
                    return code
    except (OSError, imaplib.IMAP4.error):
        return None
    return None


def code_in_message(message: Message, username: str, sent_after: float) -> str | None:
    """The security code in one of Instagram's emails to this account, if it is new."""
    try:
        sent = parsedate_to_datetime(message.get("Date", "")).timestamp()
    except (TypeError, ValueError):
        return None
    if sent < sent_after - 60:
        return None
    text = _text(message)
    if username.casefold() not in text.casefold():
        return None
    match = _CODE.search(text)
    return match.group(1) if match else None


def _text(message: Message) -> str:
    parts = message.walk() if message.is_multipart() else [message]
    chunks = []
    for part in parts:
        if part.get_content_type() not in {"text/plain", "text/html"}:
            continue
        payload = part.get_payload(decode=True)
        if isinstance(payload, bytes):
            chunks.append(payload.decode(part.get_content_charset() or "utf-8", "replace"))
    text = " ".join(chunks)
    return re.sub(r"<[^>]+>", " ", text)
