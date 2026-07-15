#!/usr/bin/env python3
"""Follow every club Instagram for one school from wat2do-clubs.xlsx, with
randomized spacing between follows.

Reads accounts from ``backend/services/scraper/wat2do-clubs.xlsx`` filtered by
school. The school slug is derived from the username: everything before the
first "." (e.g. ``tmu.wat2do.io`` -> ``tmu``), matching the School column's
canonical slugs. One run does the whole school. Resumable: progress is saved
after every account, so if it stops for any reason, rerun to continue.

Talks to Instagram's web API (www.instagram.com/api/v1) using a browser
session cookie, exactly like the website does. Follows only: the post
notifications toggle (friendships/favorite) gets new accounts' sessions
revoked on the spot, so turn notifications on in the app if needed.

Credentials: the IG_SESSIONID env var holds the ``sessionid`` cookie from a
logged-in instagram.com browser session (DevTools > Application > Cookies).
Instagram revokes the session if the user-agent doesn't match the issuing
browser, so set IG_USER_AGENT to that browser's exact ``navigator.userAgent``
if it isn't current Brave/Chrome on macOS. Both are cached in
session_<username>.json so reruns need no env vars until the cookie expires.

Usage (from backend/):
  python scripts/follow_from_xlsx.py --list-schools
  python scripts/follow_from_xlsx.py --username ubc.wat2do.io --dry-run
  IG_SESSIONID='...' python scripts/follow_from_xlsx.py --username ubc.wat2do.io
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

XLSX_PATH = Path(__file__).resolve().parent.parent / "services" / "scraper" / "wat2do-clubs.xlsx"
HEADER_ROW = 2  # row 1 is a freeform description line

COL_SCHOOL = "School"
COL_HANDLE = "Instagram Handle"
COL_URL = "Instagram URL"

# Randomized spacing between follows. This is the only pacing.
FOLLOW_MIN_DELAY = 5  # seconds
FOLLOW_MAX_DELAY = 12

WEB_BASE = "https://www.instagram.com"
WEB_APP_ID = "936619743392459"  # constant app id the instagram.com frontend sends
# Instagram binds the sessionid to the browser it was issued in; a mismatched
# user-agent gets the whole session revoked on the first request. This default
# matches current Brave/Chrome on macOS; override with IG_USER_AGENT set to the
# exact `navigator.userAgent` of the browser the cookie was copied from.
DEFAULT_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
)


class IgError(RuntimeError):
    """Any Instagram web API refusal that is not one of the specific cases below."""


class IgLoginRequired(IgError):
    """The sessionid cookie is invalid or was revoked; a fresh one is needed."""


class IgUserNotFound(IgError):
    """The username no longer resolves (account deleted or renamed)."""


class IgWebClient:
    """Minimal instagram.com web API client authenticated by a sessionid cookie."""

    def __init__(self, sessionid: str, user_agent: str):
        self.http = requests.Session()
        self.http.headers.update(
            {
                "User-Agent": user_agent,
                "Accept": "*/*",
                "X-IG-App-ID": WEB_APP_ID,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{WEB_BASE}/",
                "Origin": WEB_BASE,
                "sec-ch-ua": '"Brave";v="150", "Chromium";v="150", "Not?A_Brand";v="24"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"macOS"',
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "X-ASBD-ID": "129477",
                "X-IG-WWW-Claim": "0",
            }
        )
        self.http.cookies.set("sessionid", sessionid, domain=".instagram.com")
        # ds_user_id always accompanies sessionid in a real browser; the user id
        # is the sessionid's prefix (before the first url-encoded ':').
        user_id = sessionid.split("%3A", 1)[0].split(":", 1)[0]
        if user_id.isdigit():
            self.http.cookies.set("ds_user_id", user_id, domain=".instagram.com")

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
        if resp.status_code >= 400 or body.get("status") == "fail":
            raise IgError(f"HTTP {resp.status_code}: {message or resp.text[:200]}")
        return body

    def login_check(self) -> str:
        """Validate the session, prime the csrftoken header, return the username.

        Uses the web settings endpoint: app-only endpoints like
        accounts/current_user reject browser user-agents outright.
        """
        resp = self._request("GET", f"{WEB_BASE}/api/v1/accounts/edit/web_form_data/")
        body = self._check(resp)
        return body.get("form_data", {}).get("username", "(unknown)")

    def user_id(self, username: str) -> str:
        """Resolve a handle to a user id via web search (exact match only)."""
        resp = self._request(
            "GET",
            f"{WEB_BASE}/api/v1/web/search/topsearch/",
            params={"query": username},
        )
        for entry in self._check(resp).get("users", []):
            if entry.get("user", {}).get("username", "").lower() == username:
                return str(entry["user"]["pk"])
        raise IgUserNotFound(username)

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


def build_client(session_file: Path) -> IgWebClient:
    saved: dict = {}
    if session_file.exists():
        saved = json.loads(session_file.read_text())

    sessionid = os.environ.get("IG_SESSIONID") or saved.get("sessionid")
    if not sessionid:
        sys.exit(
            "No credentials: set IG_SESSIONID to the `sessionid` cookie of a "
            "logged-in instagram.com browser session (DevTools > Application > Cookies)."
        )
    user_agent = os.environ.get("IG_USER_AGENT") or saved.get("user_agent") or DEFAULT_BROWSER_UA

    cl = IgWebClient(sessionid, user_agent)
    try:
        username = cl.login_check()
    except IgLoginRequired:
        sys.exit(
            "Instagram rejected the sessionid (expired or revoked). Log into "
            "instagram.com in a browser, copy the fresh `sessionid` cookie from "
            "DevTools > Application > Cookies, and rerun with IG_SESSIONID set."
        )
    session_file.write_text(json.dumps({"sessionid": sessionid, "user_agent": user_agent}))
    print(f"Logged in as {username}; session saved to {session_file}")
    return cl


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

    cl = build_client(Path(f"session_{args.username}.json"))

    processed = 0
    cooldowns = 0
    for handle in todo:
        try:
            while True:
                try:
                    cl.follow(cl.user_id(handle))
                    break
                except IgLoginRequired:
                    # Instagram soft-blocks friendship endpoints under heat while
                    # the session itself stays valid. Confirm the session is
                    # alive (raises if not), then cool off and retry.
                    cl.login_check()
                    cooldowns += 1
                    if cooldowns > 3:
                        raise
                    wait = 300 * cooldowns
                    print(
                        f"    friendship endpoints soft-blocked; cooling off {wait // 60} min",
                        flush=True,
                    )
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
