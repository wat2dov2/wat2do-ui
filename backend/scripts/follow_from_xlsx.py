#!/usr/bin/env python3
"""Follow every club Instagram for one school from wat2do-clubs.xlsx, with
randomized spacing between follows.

Reads accounts from ``backend/services/scraper/wat2do-clubs.xlsx`` filtered by
school. The school slug is derived from the username: everything before the
first "." (e.g. ``tmu.wat2do.io`` -> ``tmu``), matching the School column's
canonical slugs. One run does the whole school. Resumable: progress is saved
after every account, so if it stops for any reason, rerun to continue.

Talks to Instagram's web API (www.instagram.com/api/v1) using the school's
recipient-scoped browser session from macOS Keychain. Follows only: the post
notifications toggle (friendships/favorite) gets new accounts' sessions
revoked on the spot, so turn notifications on in the app if needed.

Credentials are managed through ``manage_instagram_digest_sessions.py`` and
never enter environment variables or repository files. The school's
``schools.recipient_id`` selects exactly one Keychain item.

Usage (from backend/):
  python scripts/follow_from_xlsx.py --list-schools
  python scripts/follow_from_xlsx.py --username ubc.wat2do.io --dry-run
  python scripts/follow_from_xlsx.py --username ubc.wat2do.io
"""

import argparse
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv()

from core.controlbox import controlbox  # noqa: E402
from services import school_service  # noqa: E402
from services.instagram_digest.sessions import (  # noqa: E402
    InstagramSession,
    KeychainSessionStore,
    SessionStoreError,
    recipient_session_transaction,
    refresh_browser_session,
)

XLSX_PATH = Path(__file__).resolve().parent.parent / "services" / "scraper" / "wat2do-clubs.xlsx"
HEADER_ROW = 2  # row 1 is a freeform description line

COL_SCHOOL = "School"
COL_HANDLE = "Instagram Handle"
COL_URL = "Instagram URL"

# Randomized spacing between follows. This is the only pacing.
FOLLOW_MIN_DELAY = 60  # seconds
FOLLOW_MAX_DELAY = 90

WEB_BASE = "https://www.instagram.com"


class IgError(RuntimeError):
    """Any Instagram web API refusal that is not one of the specific cases below."""


class IgLoginRequired(IgError):
    """The sessionid cookie is invalid or was revoked; a fresh one is needed."""


class IgUserNotFound(IgError):
    """The username no longer resolves (account deleted or renamed)."""


class IgTransientError(IgError):
    """Temporary Instagram/edge failure (5xx); safe to retry after a cooldown."""


class IgWebClient:
    """Minimal Instagram web API client using one validated Keychain session."""

    def __init__(self, session: InstagramSession):
        self.session = session
        self.http = requests.Session()
        self.http.headers.update(
            {
                "User-Agent": session.user_agent,
                "Accept": "*/*",
                "X-IG-App-ID": controlbox.instagram_digest.web_app_id,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{WEB_BASE}/",
                "Origin": WEB_BASE,
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "X-ASBD-ID": "129477",
                "X-IG-WWW-Claim": "0",
            }
        )
        for name, value in session.cookies.items():
            self.http.cookies.set(name, value, domain=".instagram.com")
        self.http.headers["X-CSRFToken"] = session.csrftoken

    def session_snapshot(self) -> InstagramSession:
        """Capture any cookies rotated by Instagram without exposing them."""
        cookies = {cookie.name: cookie.value for cookie in self.http.cookies}
        return InstagramSession(
            intended_recipient_id=self.session.intended_recipient_id,
            sessionid=cookies["sessionid"],
            csrftoken=cookies.get("csrftoken", self.session.csrftoken),
            ds_user_id=self.session.intended_recipient_id,
            user_agent=self.session.user_agent,
            account_username=self.session.account_username,
            mid=cookies.get("mid"),
            ig_did=cookies.get("ig_did"),
            rur=cookies.get("rur"),
        )

    def _request(self, method: str, url: str, **kwargs):
        """Issue a request, keeping the rotating csrf/claim tokens up to date.

        Transient network failures (timeouts, dropped connections) are retried
        with backoff rather than surfaced.
        """
        for attempt in range(3):
            try:
                resp = self.http.request(method, url, timeout=30, allow_redirects=False, **kwargs)
                break
            except requests.RequestException:
                if attempt == 2:
                    raise
                time.sleep(10 * (attempt + 1))
        claim = resp.headers.get("x-ig-set-www-claim")
        if claim:
            self.http.headers["X-IG-WWW-Claim"] = claim
        csrftoken = self.http.cookies.get("csrftoken")
        if csrftoken:
            self.http.headers["X-CSRFToken"] = csrftoken
        return resp

    def _check(self, resp) -> dict:
        """Decode a response, translating Instagram's refusal shapes to exceptions."""
        if resp.status_code in (301, 302):
            location = resp.headers.get("location", "")
            if "/accounts/login" in location:
                raise IgLoginRequired(f"redirected to login: {location}")
            raise IgError(f"unexpected redirect to {location}")
        body: dict = {}
        try:
            body = resp.json()
        except ValueError:
            pass
        message = body.get("message", "")
        if resp.status_code in (401, 403) or message == "login_required":
            raise IgLoginRequired(f"HTTP {resp.status_code}: {message or resp.text[:200]}")
        if resp.status_code == 404 or message == "User not found":
            raise IgUserNotFound(message or "404")
        # 5xx (including non-standard edge codes like 572) are transient.
        if resp.status_code >= 500:
            raise IgTransientError(f"HTTP {resp.status_code}: {message or resp.text[:200]}")
        if resp.status_code >= 400 or body.get("status") == "fail":
            raise IgError(f"HTTP {resp.status_code}: {message or resp.text[:200]}")
        return body

    def user_id(self, username: str) -> str:
        """Resolve a handle to a user id via the exact profile lookup.

        instagram.com profile pages use this endpoint; unlike topsearch it
        always returns small accounts, so a miss really means the account is
        gone (404) rather than just unranked in search results.

        Some business profiles make this endpoint 400 server-side (Instagram
        deleted internal schema assets like ig_business_category_subvertical
        that old profiles still reference). Those accounts still resolve via
        the fallback below.
        """
        resp = self._request(
            "GET",
            f"{WEB_BASE}/api/v1/users/web_profile_info/",
            params={"username": username},
        )
        try:
            user = (self._check(resp).get("data") or {}).get("user")
        except (IgLoginRequired, IgUserNotFound):
            raise
        except IgError:
            return self._user_id_fallback(username)
        if not user:
            raise IgUserNotFound(username)
        return str(user["id"])

    def _user_id_fallback(self, username: str) -> str:
        """Resolve a handle whose web_profile_info is broken server-side.

        Topsearch first: it is a plain API call, so it dodges the intermittent
        cookie-consent redirect that document requests sometimes get. Small
        accounts topsearch leaves unranked fall through to scraping the
        profile HTML page.
        """
        resp = self._request(
            "GET",
            f"{WEB_BASE}/api/v1/web/search/topsearch/",
            params={"query": username},
        )
        if resp.status_code == 200:
            try:
                entries = resp.json().get("users") or []
            except ValueError:
                entries = []
            for entry in entries:
                user = entry.get("user") or {}
                if user.get("username") == username and user.get("pk"):
                    return str(user["pk"])
        return self._user_id_from_profile_page(username)

    def _user_id_from_profile_page(self, username: str) -> str:
        """Scrape the profile page HTML for the embedded user id."""
        resp = self._request(
            "GET",
            f"{WEB_BASE}/{username}/",
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
            },
        )
        if resp.status_code == 404:
            raise IgUserNotFound(username)
        if resp.status_code in (301, 302):
            location = resp.headers.get("location", "")
            if "/accounts/login" in location:
                raise IgLoginRequired(f"redirected to login: {location}")
            raise IgError(f"unexpected redirect to {location}")
        match = re.search(r'"profile_id":"(\d+)"', resp.text)
        if not match:
            raise IgError(f"profile page for {username} has no embedded profile_id")
        return match.group(1)

    def follow(self, user_id: str) -> None:
        resp = self._request(
            "POST",
            f"{WEB_BASE}/api/v1/friendships/create/{user_id}/",
            data={"container_module": "profile", "user_id": user_id},
        )
        self._check(resp)


def slugify(value: str) -> str:
    """Fold input to lowercase alphanumerics for forgiving slug comparison."""
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def normalize_handle(raw: str) -> str | None:
    """'https://instagram.com/uwacc/', '@uwacc', 'uwacc' -> 'uwacc' (or None)."""
    if not raw:
        return None
    handle = str(raw).strip().rstrip("/")
    if "instagram.com" in handle:
        handle = handle.split("instagram.com/", 1)[-1]
    handle = handle.split("?", 1)[0].split("/", 1)[0].lstrip("@").strip().lower()
    if not handle or not re.fullmatch(r"[a-z0-9._]{1,30}", handle):
        return None
    return handle


def load_rows(xlsx_path: Path) -> list[dict]:
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl not installed. Run: pip install openpyxl")

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    header_cells = next(ws.iter_rows(min_row=HEADER_ROW, max_row=HEADER_ROW, values_only=True))
    header = {name: idx for idx, name in enumerate(header_cells) if name}
    for required in (COL_SCHOOL, COL_HANDLE, COL_URL):
        if required not in header:
            sys.exit(f"Column '{required}' not found in {xlsx_path}. Found: {list(header)}")

    return [
        {
            "school": r[header[COL_SCHOOL]],
            "handle": r[header[COL_HANDLE]],
            "url": r[header[COL_URL]],
        }
        for r in ws.iter_rows(min_row=HEADER_ROW + 1, values_only=True)
    ]


def school_counts(rows: list[dict]) -> dict[str, int]:
    """Distinct school slugs in the file and how many clubs each has."""
    counts: dict[str, int] = {}
    for row in rows:
        slug = slugify(row["school"])
        if slug:
            counts[slug] = counts.get(slug, 0) + 1
    return counts


def handles_for_school(rows: list[dict], slug: str) -> list[str]:
    """Deduped handles for one school slug. URL column primary, handle column fallback."""
    target = slugify(slug)
    handles: list[str] = []
    seen: set[str] = set()
    for row in rows:
        if slugify(row["school"]) != target:
            continue
        handle = normalize_handle(row["url"]) or normalize_handle(row["handle"])
        if handle and handle not in seen:
            seen.add(handle)
            handles.append(handle)
    return handles


def clear_handle_in_xlsx(xlsx_path: Path, slug: str, handle: str) -> None:
    """Blank the Instagram handle/URL cells for a dead account and save the file."""
    import openpyxl

    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb.worksheets[0]
    header_cells = next(ws.iter_rows(min_row=HEADER_ROW, max_row=HEADER_ROW, values_only=True))
    header = {name: idx for idx, name in enumerate(header_cells) if name}
    for row in ws.iter_rows(min_row=HEADER_ROW + 1):
        if slugify(row[header[COL_SCHOOL]].value) != slug:
            continue
        url_cell = row[header[COL_URL]]
        handle_cell = row[header[COL_HANDLE]]
        if handle in (normalize_handle(url_cell.value), normalize_handle(handle_cell.value)):
            url_cell.value = None
            handle_cell.value = None
    wb.save(xlsx_path)


def load_progress(progress_file: Path) -> set[str]:
    if not progress_file.exists():
        return set()
    return set(json.loads(progress_file.read_text()).get("followed", []))


def prepare_session(account_username: str) -> tuple[str, KeychainSessionStore]:
    """Resolve routing and refresh the recipient-scoped Keychain session."""
    slug = slugify(account_username.split(".", 1)[0])
    school = school_service.get_school(slug)
    if school is None or school.recipient_id is None:
        sys.exit(f"School '{slug}' has no notification recipient routing.")

    store = KeychainSessionStore()
    try:
        with recipient_session_transaction(school.recipient_id):
            session = _refresh_stored_session(
                store,
                school.recipient_id,
                account_username,
            )
    except SessionStoreError as exc:
        sys.exit(
            f"Instagram Keychain session is {exc.status.value}. "
            "Repair it with manage_instagram_digest_sessions.py."
        )
    print(f"Logged in as {session.account_username}; session refreshed in macOS Keychain")
    return school.recipient_id, store


def _refresh_stored_session(
    store: KeychainSessionStore,
    recipient_id: str,
    account_username: str,
) -> InstagramSession:
    session = refresh_browser_session(
        store.load(recipient_id),
        timeout_seconds=controlbox.instagram_digest.request_timeout_seconds,
    )
    if session.account_username != account_username.lower():
        sys.exit("Instagram Keychain session belongs to a different account.")
    store.store(session)
    return session


def _follow_with_stored_session(
    store: KeychainSessionStore,
    recipient_id: str,
    account_username: str,
    handle: str,
) -> None:
    with recipient_session_transaction(recipient_id):
        session = store.load(recipient_id)
        if session.account_username != account_username.lower():
            sys.exit("Instagram Keychain session belongs to a different account.")
        client = IgWebClient(session)
        client.follow(client.user_id(handle))
        store.store(client.session_snapshot())


def _check_stored_session(
    store: KeychainSessionStore,
    recipient_id: str,
    account_username: str,
) -> None:
    with recipient_session_transaction(recipient_id):
        _refresh_stored_session(store, recipient_id, account_username)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--xlsx", type=Path, default=XLSX_PATH)
    parser.add_argument(
        "--username",
        default=os.environ.get("IG_USERNAME"),
        help="school account, e.g. ubc.wat2do.io; the school slug is the part before the first dot",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--list-schools", action="store_true")
    args = parser.parse_args()

    rows = load_rows(args.xlsx)

    if args.list_schools:
        print("Available school slugs (club count):")
        for slug, count in sorted(school_counts(rows).items()):
            print(f"  {slug:20s} {count}")
        return

    if not args.username:
        sys.exit("--username (or IG_USERNAME env) is required.")

    slug = slugify(args.username.split(".", 1)[0])
    handles = handles_for_school(rows, slug)
    if not handles:
        print(f"No accounts found for school '{slug}'. Available slugs:", file=sys.stderr)
        for s, count in sorted(school_counts(rows).items()):
            print(f"  {s} ({count})", file=sys.stderr)
        sys.exit(1)

    progress_file = Path(f"progress_{slug}.json")
    followed = load_progress(progress_file)

    def save() -> None:
        progress_file.write_text(json.dumps({"followed": sorted(followed)}, indent=2))

    todo = [h for h in handles if h not in followed]

    print(f"School: {slug}")
    print(
        f"{len(handles)} accounts on file | {len(followed)} already followed | "
        f"{len(todo)} to do this run."
    )

    if args.dry_run:
        print("\nDRY RUN. Accounts that would be followed:")
        for h in todo:
            print(f"  {h}")
        return

    recipient_id, session_store = prepare_session(args.username)

    processed = 0
    cooldowns = 0
    for handle in todo:
        try:
            while True:
                try:
                    _follow_with_stored_session(
                        session_store,
                        recipient_id,
                        args.username,
                        handle,
                    )
                    break
                except (IgLoginRequired, IgTransientError) as e:
                    # Soft-blocks and transient 5xx (e.g. HTTP 572) while the
                    # session itself stays valid. Confirm alive, then cool off.
                    _check_stored_session(
                        session_store,
                        recipient_id,
                        args.username,
                    )
                    cooldowns += 1
                    if cooldowns > 3:
                        raise
                    wait = 300 * cooldowns
                    reason = (
                        "friendship endpoints soft-blocked"
                        if isinstance(e, IgLoginRequired)
                        else f"transient Instagram error ({e})"
                    )
                    print(f"    {reason}; cooling off {wait // 60} min", flush=True)
                    time.sleep(wait)

            followed.add(handle)
            save()
            processed += 1
            print(f"[{processed}/{len(todo)}] {handle}: followed", flush=True)

        except IgUserNotFound:
            # Account deleted or renamed: blank it out of the master sheet and
            # mark it handled so reruns never re-query it.
            print(
                f"    {handle}: account not found (deleted or renamed), "
                "clearing from xlsx and skipping",
                flush=True,
            )
            clear_handle_in_xlsx(args.xlsx, slug, handle)
            followed.add(handle)
            save()
            time.sleep(random.uniform(3, 6))
            continue
        except Exception as e:  # noqa: BLE001 - stop cleanly, keep progress
            print(f"\nStopped on {handle}: {type(e).__name__}: {e}")
            print("Progress is saved after each account; rerun the same command to continue.")
            break

        if handle != todo[-1]:
            delay = random.uniform(FOLLOW_MIN_DELAY, FOLLOW_MAX_DELAY)
            print(f"    waiting {delay:.0f}s", flush=True)
            time.sleep(delay)

    remaining = len([h for h in handles if h not in followed])
    print(f"\nDone: {processed} processed this run, {remaining} remaining.")


if __name__ == "__main__":
    main()
