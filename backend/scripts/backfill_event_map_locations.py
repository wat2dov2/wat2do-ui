#!/usr/bin/env python3
"""Write each upcoming event's ``map_location`` with Haiku.

``location`` stays exactly as the host wrote it. Haiku rewrites it as a place a
map search can find (building or venue, street address, city), or null for an
online or unknown venue. Each school's distinct locations are sent once, in small
batches, so every event at the same location gets the same answer.
Re-runnable: only rows whose ``map_location`` would change are written.
Without ``--apply`` it prints the proposed values and writes nothing.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants import MAX_EVENT_LOCATION_LENGTH  # noqa: E402
from core.database import supabase_admin  # noqa: E402
from core.tables import EVENTS, SCHOOLS  # noqa: E402
from services.ingestion.claude_completion import claude_completion  # noqa: E402

_PAGE_SIZE = 1000
_BATCH_SIZE = 40

_SYSTEM = "You place campus events on a map. You answer with one JSON object and nothing else."


def _prompt(school: dict[str, Any], locations: list[str]) -> str:
    venues = "\n".join(f"{index}: {location}" for index, location in enumerate(locations))
    return f"""School: {school["name"]}, {school.get("city") or ""}

Each line below is a number and an event location exactly as the host wrote it.
For each one, write where the event is so a map search finds it: the building or
venue name and its street address, city and province or state.
- Drop rooms, floors and directions; keep the building.
- Keep the building or venue the host named, in the words the host used.
  Expand only an abbreviation or room code ("SLC 2156" is "Student Life Centre");
  never lengthen a name that is already written out ("Bahen Centre" stays "Bahen Centre"),
  and never swap it for a different building.
- Use your knowledge of this school's buildings, abbreviations and addresses.
- When an event lists several venues, use the first physical one.
- When you cannot identify a named venue, write its name with the school and city rather than null.
  But when you cannot tell what a short code or abbreviation stands for, use null.
- Never place an event anywhere its location does not say. A venue off campus stays off campus.
- Use null only for an online event, a TBA venue, or a whole city or region.

Answer with a JSON object mapping each number to its map location string or null, for example
{{"0": "Arts Lecture Hall, University of Waterloo, 200 University Ave W, Waterloo, ON", "1": null}}

{venues}"""


def parse_map_locations(text: str | None, count: int) -> dict[int, str | None]:
    """Keep only well-formed answers for the requested line numbers."""
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not match:
        return {}
    try:
        answer = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    if not isinstance(answer, dict):
        return {}
    parsed: dict[int, str | None] = {}
    for key, value in answer.items():
        if not str(key).isdigit() or int(key) >= count:
            continue
        if value is None:
            parsed[int(key)] = None
        elif isinstance(value, str) and value.strip():
            parsed[int(key)] = value.strip()[:MAX_EVENT_LOCATION_LENGTH]
    return parsed


def _upcoming_events() -> list[dict[str, Any]]:
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    rows: dict[int, dict[str, Any]] = {}
    offset = 0
    while True:
        batch = (
            supabase_admin.table(EVENTS)
            .select("id,school_id,location,map_location,event_dates!inner(dtstart_utc)")
            .gte("event_dates.dtstart_utc", since)
            .eq("cancelled", False)
            .order("id")
            .range(offset, offset + _PAGE_SIZE - 1)
            .execute()
        ).data or []
        for row in batch:
            rows[row["id"]] = row
        if len(batch) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE
    return list(rows.values())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write the new map locations")
    parser.add_argument("--school", help="Only this school slug")
    args = parser.parse_args()

    schools = {
        school["id"]: school
        for school in (
            supabase_admin.table(SCHOOLS).select("id,slug,name,city").execute().data or []
        )
        if not args.school or school["slug"] == args.school
    }
    events = [row for row in _upcoming_events() if row["school_id"] in schools]
    print(f"found {len(events)} upcoming events across {len(schools)} schools")

    changed = unanswered = 0
    for school_id, school in schools.items():
        school_events = [row for row in events if row["school_id"] == school_id]
        locations = sorted({row["location"] for row in school_events})
        answers: dict[str, str | None] = {}
        for start in range(0, len(locations), _BATCH_SIZE):
            batch = locations[start : start + _BATCH_SIZE]
            parsed = parse_map_locations(
                claude_completion(_SYSTEM, _prompt(school, batch), []), len(batch)
            )
            answers.update({batch[index]: answer for index, answer in parsed.items()})
        for row in school_events:
            if row["location"] not in answers:
                unanswered += 1
                print(f"  {school['slug']} {row['id']}: no answer, left unchanged")
                continue
            map_location = answers[row["location"]]
            if map_location == row.get("map_location"):
                continue
            changed += 1
            print(f"  {school['slug']} {row['id']}: {row['location']!r} -> {map_location!r}")
            if args.apply:
                (
                    supabase_admin.table(EVENTS)
                    .update({"map_location": map_location})
                    .eq("id", row["id"])
                    .execute()
                )

    verb = "updated" if args.apply else "would update"
    print(f"{verb} {changed} events; {unanswered} had no answer")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
