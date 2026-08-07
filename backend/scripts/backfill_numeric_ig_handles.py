#!/usr/bin/env python3
"""Replace Instagram user ids stored as handles with the real usernames.

A single-user scrape is dispatched with ``client_payload.username`` when the
webhook has one and ``poster_id`` when it does not, and the workflow falls back
to the second. Until ``resolve_single_user_handle`` learned to look those up, a
numeric id was written straight through to ``events.ig_handle`` - and to the
``organizations.ig`` of any organization the same run created. So a published
carousel credited ``@79731783885`` instead of ``@utsgsplatoon``, and the
organization's page showed the id where its handle belongs.

The id is the only thing left to resolve from: both columns hold it, so there is
no mapping inside the database. Instagram's public profile endpoint answers
id -> username without a session, which is what this uses.

Re-runnable: a row already holding a non-numeric handle is skipped, so a second
run does nothing. Resolutions are cached to ``--cache`` as they succeed, so a
run interrupted by Instagram's burst limit resumes instead of starting over.
Use --dry-run first; it reports every change and writes nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.database import supabase_admin  # noqa: E402
from core.tables import EVENTS, ORGANIZATIONS  # noqa: E402

# Instagram's public web app id. The endpoint answers without a session, but
# only at a human pace: it starts returning 401 after a short burst.
_IG_APP_ID = "936619743392459"
_IG_USER_INFO = "https://i.instagram.com/api/v1/users/{user_id}/info/"
_REQUEST_SPACING_SECONDS = 5.0
_BACKOFF_SECONDS = 90
_MAX_ATTEMPTS = 4
_PAGE_SIZE = 1000


def _is_numeric_handle(value: Any) -> bool:
    return str(value or "").strip().isdigit()


def _lookup_username(user_id: str) -> str | None:
    """Resolve one id, backing off when Instagram asks us to slow down."""
    request = urllib.request.Request(
        _IG_USER_INFO.format(user_id=user_id),
        headers={"X-IG-App-ID": _IG_APP_ID, "User-Agent": "Mozilla/5.0"},
    )
    for attempt in range(_MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                payload = json.load(response)
            username = (payload.get("user") or {}).get("username")
            return str(username).strip().lstrip("@") if username else None
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 429) and attempt < _MAX_ATTEMPTS - 1:
                time.sleep(_BACKOFF_SECONDS * (attempt + 1))
                continue
            print(f"  {user_id}: http {exc.code}", file=sys.stderr)
            return None
        except Exception as exc:  # noqa: BLE001 - one bad id must not stop the run
            print(f"  {user_id}: {exc}", file=sys.stderr)
            return None
    return None


def _rows_with_numeric_handle(table: str, column: str) -> list[dict[str, Any]]:
    """Every row in `table` whose `column` holds an id rather than a handle."""
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = (
            supabase_admin.table(table)
            .select(f"id,{column}")
            .not_.is_(column, "null")
            .range(offset, offset + _PAGE_SIZE - 1)
            .execute()
        )
        batch = response.data or []
        if not batch:
            break
        rows.extend(row for row in batch if _is_numeric_handle(row.get(column)))
        if len(batch) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report without writing")
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path("/tmp/wat2do-ig-handle-map.json"),
        help="Where resolved id -> username pairs are kept so a run can resume",
    )
    args = parser.parse_args()

    events = _rows_with_numeric_handle(EVENTS, "ig_handle")
    organizations = _rows_with_numeric_handle(ORGANIZATIONS, "ig")
    user_ids = sorted(
        {str(row["ig_handle"]).strip() for row in events}
        | {str(row["ig"]).strip() for row in organizations}
    )
    print(
        f"found {len(events)} events and {len(organizations)} organizations "
        f"holding {len(user_ids)} distinct ids"
    )
    if not user_ids:
        return 0

    resolved: dict[str, str] = {}
    if args.cache.exists():
        resolved = {str(k): str(v) for k, v in json.loads(args.cache.read_text()).items() if v}
        print(f"reusing {len(resolved)} cached resolutions from {args.cache}")

    for user_id in user_ids:
        if user_id in resolved:
            continue
        username = _lookup_username(user_id)
        if username:
            resolved[user_id] = username
            print(f"  {user_id} -> @{username}")
            args.cache.write_text(json.dumps(resolved, indent=2))
        time.sleep(_REQUEST_SPACING_SECONDS)

    unresolved = [user_id for user_id in user_ids if user_id not in resolved]

    updated_events = 0
    for row in events:
        username = resolved.get(str(row["ig_handle"]).strip())
        if not username:
            continue
        if not args.dry_run:
            supabase_admin.table(EVENTS).update({"ig_handle": username}).eq(
                "id", row["id"]
            ).execute()
        updated_events += 1

    updated_organizations = 0
    for row in organizations:
        username = resolved.get(str(row["ig"]).strip())
        if not username:
            continue
        if not args.dry_run:
            supabase_admin.table(ORGANIZATIONS).update({"ig": username}).eq(
                "id", row["id"]
            ).execute()
        updated_organizations += 1

    verb = "would update" if args.dry_run else "updated"
    print(
        f"resolved {len(resolved)}/{len(user_ids)} ids; "
        f"{verb} {updated_events} events and {updated_organizations} organizations"
    )
    if unresolved:
        print(f"unresolved ids ({len(unresolved)}): {', '.join(unresolved)}", file=sys.stderr)
    return 1 if unresolved else 0


if __name__ == "__main__":
    raise SystemExit(main())
