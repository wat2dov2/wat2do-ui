"""Run live Pass 2 reconcile scenarios and print input → outcome.

Usage (from backend/):
  .venv/bin/python scripts/demo_pass2_live.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config import settings
from services.scraper.dedup import find_candidates
from services.scraper.reconciler import reconcile_events


def _future(days: int = 5) -> str:
    dt = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=days)
    return dt.isoformat().replace("+00:00", "Z")


FUTURE = _future(5)


def _occ(start: str = FUTURE) -> dict:
    return {"dtstart_utc": start, "dtend_utc": start, "duration": None, "tz": "America/Toronto"}


def _db_event(
    *,
    eid: int,
    title: str,
    location: str,
    description: str = "",
    ig: str = "uwtea",
    organization_id: int | None = 7,
) -> dict:
    return {
        "id": eid,
        "title": title,
        "description": description,
        "location": location,
        "price": 0.0,
        "food": [],
        "registration": False,
        "category": "Arts & Culture",
        "organization": "UW Tea Organization",
        "organization_id": organization_id,
        "ig_handle": ig,
        "school": "uwaterloo",
        "cancelled": False,
        "source_url": f"https://instagram.com/p/{eid}",
        "source_image_url": f"https://cdn/{eid}.jpg",
        "event_dates": [_occ()],
    }


def _extracted(*, title: str, location: str, description: str = "") -> dict:
    return {
        "title": title,
        "description": description,
        "location": location,
        "organization": "UW Tea Organization",
        "price": 0.0,
        "food": [],
        "registration": False,
        "image_index": 0,
        "occurrences": [_occ()],
        "school": "uwaterloo",
        "category": "Arts & Culture",
        "source_image_url": "https://cdn/new.jpg",
    }


def _install_fake_db(same_org: list[dict], same_day: list[dict] | None = None) -> None:
    """Patch get_sb in dedup so find_candidates hits our seeded rows."""
    from services.scraper import dedup as dedup_mod

    queue = [same_org, same_day or []]

    class Fake:
        def table(self, *_a, **_k):
            return self

        def select(self, *_a, **_k):
            return self

        def eq(self, *_a, **_k):
            return self

        def order(self, *_a, **_k):
            return self

        def range(self, *_a, **_k):
            return self

        def gte(self, *_a, **_k):
            return self

        def lt(self, *_a, **_k):
            return self

        def execute(self):
            data = queue.pop(0) if queue else []
            return MagicMock(data=data)

    dedup_mod.get_sb = lambda: Fake()  # type: ignore[assignment]


def _print_block(title: str, obj: object) -> None:
    print(f"\n  {title}")
    print("  " + "-" * 56)
    text = json.dumps(obj, indent=2, default=str)
    for line in text.splitlines():
        print(f"  {line}")


def run_case(
    *,
    name: str,
    caption: str,
    extracted: dict,
    db_rows: list[dict],
    expect: str,
) -> dict:
    print("\n" + "=" * 60)
    print(f"CASE: {name}")
    print("=" * 60)
    print(f"\n  Expectation: {expect}")
    print(f"\n  Caption:\n    {caption}")

    _install_fake_db(db_rows)
    candidates = find_candidates(
        title=extracted["title"],
        location=extracted["location"],
        description=extracted.get("description") or "",
        occurrences=extracted["occurrences"],
        ig_handle="uwtea",
        organization_id=7,
        organization_name=extracted.get("organization"),
    )

    _print_block("Pass 1 extracted (input)", extracted)
    _print_block(
        f"Dedup candidates ({len(candidates)})",
        [
            {
                "id": c["id"],
                "title": c["title"],
                "location": c["location"],
                "organization_id": c.get("organization_id"),
                "organization": c.get("organization"),
                "ig_handle": c.get("ig_handle"),
                "cancelled": c.get("cancelled"),
            }
            for c in candidates
        ],
    )

    finals = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[candidates],
        caption_text=caption,
        school="uwaterloo",
        resolved_organization_ids=[7],
        resolved_ig_handles=["uwtea"],
    )

    if finals is None:
        _print_block("Pass 2 outcome", {"error": "reconcile_events returned None"})
        return {"name": name, "ok": False, "finals": None}

    summary = [
        {
            "id": f.get("id"),
            "title": f.get("title"),
            "location": f.get("location"),
            "cancelled": f.get("cancelled"),
            "description": (f.get("description") or "")[:80],
            "action": "OVERWRITE" if f.get("id") is not None else "INSERT",
        }
        for f in finals
    ]
    _print_block("Pass 2 outcome (summary)", summary)
    _print_block("Pass 2 outcome (full JSON)", finals)

    return {"name": name, "ok": True, "finals": finals, "summary": summary}


def main() -> int:
    if not settings.openai_api_key:
        print("OPENAI_API_KEY is not set - cannot run live Pass 2.")
        return 1

    print(f"Model: {settings.openai_extraction_model}")
    print("Running live Pass 2 scenarios (real OpenAI, mocked DB candidates)...")

    results = []

    results.append(
        run_case(
            name="UPDATE room",
            caption="UPDATE: Tea Tasting Night has moved from SLC 1000 to DC 1302. Same time.",
            extracted=_extracted(
                title="Tea Tasting Night",
                location="DC 1302",
                description="Moved to DC.",
            ),
            db_rows=[
                _db_event(
                    eid=42,
                    title="Tea Tasting Night",
                    location="SLC 1000",
                    description="Weekly tea tasting in SLC.",
                )
            ],
            expect="OVERWRITE id=42, location contains DC/1302, cancelled=false",
        )
    )

    results.append(
        run_case(
            name="Cancel event",
            caption="CANCELLED: Tea Tasting Night this week is cancelled. Sorry!",
            extracted=_extracted(title="Tea Tasting Night", location="SLC 3223"),
            db_rows=[_db_event(eid=43, title="Tea Tasting Night", location="SLC 3223")],
            expect="OVERWRITE id=43, cancelled=true",
        )
    )

    results.append(
        run_case(
            name="New week announcement (no update language)",
            caption=(
                "Tea Tasting Night this Friday in SLC 3223! Bring a mug. "
                "Same weekly series, new week."
            ),
            extracted=_extracted(title="Tea Tasting Night", location="SLC 3223"),
            db_rows=[_db_event(eid=44, title="Tea Tasting Night", location="SLC 3223")],
            expect="INSERT (id=null) - do not overwrite just because title matches",
        )
    )

    results.append(
        run_case(
            name="Two similar candidates - pick tasting, not social",
            caption="UPDATE: Tea Tasting Night moved to MC 2065.",
            extracted=_extracted(
                title="Tea Tasting Night",
                location="MC 2065",
                description="Room change for tasting.",
            ),
            db_rows=[
                _db_event(eid=50, title="Tea Tasting Night", location="SLC"),
                _db_event(eid=51, title="Tea Social Hour", location="SLC"),
            ],
            expect="OVERWRITE id=50 (not 51)",
        )
    )

    results.append(
        run_case(
            name="No dedup hit - brand new event",
            caption="Brand new Pizza Mixer Friday in the SLC Ballroom!",
            extracted=_extracted(
                title="Pizza Mixer",
                location="SLC Ballroom",
                description="Free pizza social.",
            ),
            db_rows=[
                _db_event(
                    eid=99,
                    title="Totally Different Board Meeting",
                    location="Remote Zoom",
                )
            ],
            expect="INSERT (id=null); candidates should be empty or unused",
        )
    )

    results.append(
        run_case(
            name="Shorter description on update",
            caption="Update: new flyer for Tea Tasting Night. Still in SLC 3223.",
            extracted=_extracted(
                title="Tea Tasting Night",
                location="SLC 3223",
                description="Short.",
            ),
            db_rows=[
                _db_event(
                    eid=60,
                    title="Tea Tasting Night",
                    location="SLC 3223",
                    description="A much longer original description that used to be here.",
                )
            ],
            expect="OVERWRITE id=60, description is the shorter new text",
        )
    )

    print("\n" + "=" * 60)
    print("SCORECARD")
    print("=" * 60)
    for r in results:
        if not r["ok"] or not r.get("summary"):
            print(f"  FAIL  {r['name']}: no Pass 2 result")
            continue
        s = r["summary"][0]
        print(
            f"  {s['action']:9}  id={str(s['id']):5}  cancelled={s['cancelled']!s:5}  "
            f"loc={s['location']!r:20}  | {r['name']}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
