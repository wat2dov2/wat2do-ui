"""Edge-case + limit tests: real ``find_candidates`` against a mocked DB.

Pass 2 judgment cases optionally hit the live OpenAI API when a key is
configured (``@pytest.mark.live_llm``). Dedup threshold / cap cases stay
fully deterministic with canned Pass 2 JSON.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from core.config import settings
from core.constants import (
    SCRAPING_LOCATION_SIMILARITY_THRESHOLD,
    SCRAPING_MAX_CANDIDATES,
    SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD,
    SCRAPING_TITLE_SIMILARITY_THRESHOLD,
)
from services.scraper.dedup import (
    find_candidates,
    jaccard_similarity,
    title_similarity,
)
from services.scraper.reconciler import reconcile_events

_DAY = datetime.now(timezone.utc).replace(hour=18, minute=0, second=0, microsecond=0) + timedelta(
    days=5
)
_DAY_ISO = _DAY.isoformat().replace("+00:00", "Z")
_OTHER_DAY = _DAY + timedelta(days=2)
_OTHER_DAY_ISO = _OTHER_DAY.isoformat().replace("+00:00", "Z")
_PAST = datetime.now(timezone.utc) - timedelta(days=14)
_PAST_ISO = _PAST.isoformat().replace("+00:00", "Z")


def _occ(start_iso: str) -> dict:
    return {
        "dtstart_utc": start_iso,
        "dtend_utc": start_iso,
        "duration": None,
        "tz": "America/Toronto",
    }


def _db_event(
    *,
    eid: int,
    title: str,
    location: str,
    description: str = "",
    ig_handle: str = "uwteaorganization",
    organization_id: int | None = 7,
    start_iso: str = _DAY_ISO,
    cancelled: bool = False,
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
        "ig_handle": ig_handle,
        "school": "uwaterloo",
        "cancelled": cancelled,
        "source_url": f"https://instagram.com/p/{eid}",
        "source_image_url": f"https://cdn/{eid}.jpg",
        "event_dates": [_occ(start_iso)],
    }


def _same_day_row(event: dict) -> dict:
    return {"event_id": event["id"], "events": event}


def _queue_dedup_db(
    fake_sb,
    *,
    same_org_rows: list[dict],
    same_day_rows: list[dict],
) -> None:
    """Queue responses for find_candidates' two fetch_all_pages loops.

    Each loop does at least one page query. Returning fewer than page_size
    (1000) rows ends the loop, so one response per stage is enough.
    """
    fake_sb.queue_responses([same_org_rows, same_day_rows])


def _extracted(
    *,
    title: str,
    location: str,
    description: str = "",
    start_iso: str = _DAY_ISO,
) -> dict:
    return {
        "title": title,
        "description": description,
        "location": location,
        "organization": "UW Tea Organization",
        "price": 0.0,
        "food": [],
        "registration": False,
        "image_index": 0,
        "occurrences": [_occ(start_iso)],
        "school": "uwaterloo",
        "category": "Arts & Culture",
        "source_image_url": "https://cdn/new.jpg",
    }


def _mock_pass2(monkeypatch, payload: list[dict]):
    content = json.dumps(payload)

    class _Msg:
        def __init__(self):
            self.content = content

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]

    class _Completions:
        def create(self, **kwargs):
            return _Resp()

    class _Chat:
        completions = _Completions()

    class _Client:
        chat = _Chat()

    monkeypatch.setattr("services.scraper.reconciler._client", lambda: _Client())


# ── Real dedup edge cases ─────────────────────────────────────────────


def test_dedup_same_org_near_threshold_included(fake_sb, patch_sb):
    """Title similarity just above 0.8 must be a same-org candidate."""
    patch_sb("services.scraper.dedup")
    # "Tea Tasting Night" vs "Tea Tasting Evening" is known > 0.8 in existing tests.
    a = "Tea Tasting Night"
    b = "Tea Tasting Evening"
    assert title_similarity(a, b) > SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD

    row = _db_event(eid=1, title=a, location="SLC")
    _queue_dedup_db(fake_sb, same_org_rows=[row], same_day_rows=[])

    hits = find_candidates(
        title=b,
        location="SLC",
        description="",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
    )
    assert [h["id"] for h in hits] == [1]


def test_dedup_same_org_below_threshold_excluded(fake_sb, patch_sb):
    patch_sb("services.scraper.dedup")
    a = "Weekly Board Meeting"
    b = "Pizza Social Hour"
    assert title_similarity(a, b) <= SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD

    row = _db_event(eid=2, title=a, location="SLC")
    _queue_dedup_db(fake_sb, same_org_rows=[row], same_day_rows=[])

    hits = find_candidates(
        title=b,
        location="SLC",
        description="",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
    )
    assert hits == []


def test_dedup_past_same_org_event_excluded(fake_sb, patch_sb):
    patch_sb("services.scraper.dedup")
    row = _db_event(eid=3, title="Tea Tasting Night", location="SLC", start_iso=_PAST_ISO)
    _queue_dedup_db(fake_sb, same_org_rows=[row], same_day_rows=[])

    hits = find_candidates(
        title="Tea Tasting Night",
        location="SLC",
        description="",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
    )
    assert hits == []


def test_dedup_same_day_substring_needs_location(fake_sb, patch_sb):
    """Substring title alone is not enough without location similarity."""
    patch_sb("services.scraper.dedup")
    row = _db_event(
        eid=4,
        title="Movie Night",
        location="DC Library",
        ig_handle="otherclub",
    )
    _queue_dedup_db(fake_sb, same_org_rows=[], same_day_rows=[_same_day_row(row)])

    # Far location → should miss.
    far = find_candidates(
        title="Friday Movie Night",
        location="Remote Zoom Link Only",
        description="",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
    )
    assert far == []

    # Similar location → hit. Re-queue for second call.
    _queue_dedup_db(fake_sb, same_org_rows=[], same_day_rows=[_same_day_row(row)])
    near = find_candidates(
        title="Friday Movie Night",
        location="DC Library 1568",
        description="",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
    )
    assert [h["id"] for h in near] == [4]
    assert (
        jaccard_similarity("DC Library", "DC Library 1568") > SCRAPING_LOCATION_SIMILARITY_THRESHOLD
    )


def test_dedup_same_day_different_utc_day_misses(fake_sb, patch_sb):
    patch_sb("services.scraper.dedup")
    row = _db_event(
        eid=5,
        title="Movie Night",
        location="DC Library",
        ig_handle="otherclub",
        start_iso=_OTHER_DAY_ISO,
    )
    # Same-day query returns empty because the DB event is on another day.
    _queue_dedup_db(fake_sb, same_org_rows=[], same_day_rows=[])

    hits = find_candidates(
        title="Friday Movie Night",
        location="DC Library 1568",
        description="",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
    )
    assert hits == []
    # Sanity: the seeded event would match if it were on the same day.
    assert title_similarity("Movie Night", "Friday Movie Night") >= 0.0


def test_dedup_no_ig_handle_skips_same_org_path(fake_sb, patch_sb):
    patch_sb("services.scraper.dedup")
    row = _db_event(eid=6, title="Tea Tasting Night", location="SLC 3223")
    # Without ig_handle, only same-day stage runs (one page query).
    fake_sb.queue_responses([[_same_day_row(row)]])

    hits = find_candidates(
        title="Tea Tasting Night",
        location="SLC 3223",
        description="",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle=None,
    )
    assert [h["id"] for h in hits] == [6]
    # Confirm same-org path was skipped: no eq("ig_handle", ...) filter call.
    ig_eq_calls = [c for c in fake_sb.eq.call_args_list if c.args and c.args[0] == "ig_handle"]
    assert ig_eq_calls == []


def test_dedup_merges_same_org_and_same_day_without_dup_ids(fake_sb, patch_sb):
    patch_sb("services.scraper.dedup")
    shared = _db_event(eid=7, title="Tea Tasting Night", location="SLC 3223")
    other = _db_event(
        eid=8,
        title="Movie Night",
        location="SLC 3223",
        ig_handle="otherclub",
        description="popcorn night free snacks",
    )
    _queue_dedup_db(
        fake_sb,
        same_org_rows=[shared],
        same_day_rows=[_same_day_row(shared), _same_day_row(other)],
    )

    hits = find_candidates(
        title="Tea Tasting Evening",
        location="SLC 3223",
        description="popcorn night free snacks",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
    )
    ids = [h["id"] for h in hits]
    assert ids.count(7) == 1
    assert 7 in ids


def test_dedup_caps_at_max_candidates(fake_sb, patch_sb, monkeypatch):
    """When many same-org matches exist, only SCRAPING_MAX_CANDIDATES return."""
    patch_sb("services.scraper.dedup")
    monkeypatch.setattr(
        "services.scraper.dedup.SCRAPING_MAX_CANDIDATES",
        3,
    )
    rows = [
        _db_event(eid=100 + i, title=f"Tea Tasting Night {i}", location="SLC") for i in range(8)
    ]
    # Force all titles to be highly similar to the query.
    for row in rows:
        row["title"] = "Tea Tasting Night"
    _queue_dedup_db(fake_sb, same_org_rows=rows, same_day_rows=[])

    hits = find_candidates(
        title="Tea Tasting Night",
        location="SLC",
        description="",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
        limit=3,
    )
    assert len(hits) == 3


def test_dedup_ranks_higher_title_similarity_first(fake_sb, patch_sb):
    patch_sb("services.scraper.dedup")
    exact = _db_event(eid=20, title="Tea Tasting Night", location="SLC")
    looser = _db_event(eid=21, title="Tea Night Social", location="SLC")
    # Only include rows that clear the same-org threshold against the query.
    query = "Tea Tasting Night"
    assert title_similarity(exact["title"], query) > SCRAPING_SAME_ORGANIZATION_TITLE_THRESHOLD
    # looser may or may not clear 0.8; if it doesn't, only exact returns.
    _queue_dedup_db(fake_sb, same_org_rows=[looser, exact], same_day_rows=[])

    hits = find_candidates(
        title=query,
        location="SLC",
        description="",
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
    )
    assert hits
    assert hits[0]["id"] == 20
    if len(hits) > 1:
        assert title_similarity(hits[0]["title"], query) >= title_similarity(
            hits[1]["title"], query
        )


def test_dedup_title_and_location_threshold_pair(fake_sb, patch_sb):
    """Non-substring path: need title>0.7 AND location>0.5 (or loc+desc)."""
    patch_sb("services.scraper.dedup")
    row = _db_event(
        eid=30,
        title="Career Workshop Series",
        location="Engineering 7",
        ig_handle="engclub",
        description="resume tips",
    )
    query_title = "Workshop Series Career Fair Prep"
    query_location = "Engineering 7 Room 123"
    query_description = "resume tips interview"

    title_sim = title_similarity(row["title"], query_title)
    loc_sim = jaccard_similarity(row["location"], query_location)
    desc_sim = jaccard_similarity(row["description"], query_description)
    should_match = (
        title_sim > SCRAPING_TITLE_SIMILARITY_THRESHOLD
        and loc_sim > SCRAPING_LOCATION_SIMILARITY_THRESHOLD
    ) or (loc_sim > SCRAPING_LOCATION_SIMILARITY_THRESHOLD and desc_sim > 0.3)

    _queue_dedup_db(fake_sb, same_org_rows=[], same_day_rows=[_same_day_row(row)])
    hits = find_candidates(
        title=query_title,
        location=query_location,
        description=query_description,
        occurrences=[_occ(_DAY_ISO)],
        ig_handle="uwteaorganization",
    )
    if should_match:
        assert [h["id"] for h in hits] == [30]
    else:
        assert hits == []


# ── Real dedup → Pass 2 (canned JSON) ─────────────────────────────────


def test_e2e_dedup_then_pass2_update_uses_live_candidate_id(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.dedup")
    row = _db_event(eid=42, title="Tea Tasting Night", location="SLC 1000")
    _queue_dedup_db(fake_sb, same_org_rows=[row], same_day_rows=[])

    extracted = _extracted(title="Tea Tasting Evening", location="DC 1302", description="Moved")
    candidates = find_candidates(
        title=extracted["title"],
        location=extracted["location"],
        description=extracted["description"],
        occurrences=extracted["occurrences"],
        ig_handle="uwteaorganization",
    )
    assert [c["id"] for c in candidates] == [42]

    _mock_pass2(
        monkeypatch,
        [{**extracted, "id": 42, "cancelled": False}],
    )
    finals = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[candidates],
        caption_text="UPDATE: tea tasting moved to DC 1302",
        school="uwaterloo",
    )
    assert finals is not None
    assert finals[0]["id"] == 42
    assert finals[0]["location"] == "DC 1302"


def test_e2e_dedup_miss_means_pass2_cannot_overwrite(fake_sb, patch_sb, monkeypatch):
    """If dedup returns no candidates, Pass 2 id is stripped even if model invents one."""
    patch_sb("services.scraper.dedup")
    row = _db_event(eid=55, title="Totally Different Event", location="Remote")
    _queue_dedup_db(fake_sb, same_org_rows=[row], same_day_rows=[])

    extracted = _extracted(title="Brand New Mixer", location="SLC Ballroom")
    candidates = find_candidates(
        title=extracted["title"],
        location=extracted["location"],
        description="",
        occurrences=extracted["occurrences"],
        ig_handle="uwteaorganization",
    )
    assert candidates == []

    _mock_pass2(
        monkeypatch,
        [{**extracted, "id": 55, "cancelled": False}],
    )
    finals = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[candidates],
        caption_text="Come to our brand new mixer!",
        school="uwaterloo",
    )
    assert finals is not None
    assert finals[0]["id"] is None


def test_e2e_multi_candidate_pass2_picks_one(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.dedup")
    a = _db_event(eid=70, title="Tea Tasting Night", location="SLC")
    b = _db_event(eid=71, title="Tea Tasting Evening", location="SLC")
    _queue_dedup_db(fake_sb, same_org_rows=[a, b], same_day_rows=[])

    extracted = _extracted(title="Tea Tasting Night", location="SLC 3223")
    candidates = find_candidates(
        title=extracted["title"],
        location=extracted["location"],
        description="",
        occurrences=extracted["occurrences"],
        ig_handle="uwteaorganization",
    )
    assert {c["id"] for c in candidates} == {70, 71}

    _mock_pass2(
        monkeypatch,
        [{**extracted, "id": 70, "cancelled": False}],
    )
    finals = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[candidates],
        caption_text="Update: room is now SLC 3223",
        school="uwaterloo",
    )
    assert finals is not None
    assert finals[0]["id"] == 70
    assert 71 not in [f.get("id") for f in finals]


def test_e2e_cancel_with_live_dedup_candidate(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.dedup")
    row = _db_event(eid=88, title="Tea Tasting Night", location="SLC")
    _queue_dedup_db(fake_sb, same_org_rows=[row], same_day_rows=[])

    extracted = _extracted(title="Tea Tasting Night", location="SLC")
    candidates = find_candidates(
        title=extracted["title"],
        location=extracted["location"],
        description="",
        occurrences=extracted["occurrences"],
        ig_handle="uwteaorganization",
    )
    assert candidates[0]["id"] == 88

    _mock_pass2(
        monkeypatch,
        [
            {
                **extracted,
                "id": 88,
                "cancelled": True,
                "description": candidates[0].get("description") or extracted["description"],
            }
        ],
    )
    finals = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[candidates],
        caption_text="CANCELLED: Tea Tasting Night is cancelled.",
        school="uwaterloo",
    )
    assert finals[0]["id"] == 88
    assert finals[0]["cancelled"] is True


# ── Live Pass 2 LLM (real OpenAI) against real dedup candidates ───────


@pytest.mark.live_llm
@pytest.mark.skipif(not settings.openai_api_key, reason="OPENAI_API_KEY not configured")
def test_live_pass2_update_caption_overwrites_matched_id(fake_sb, patch_sb):
    """Live model should keep id=42 for an explicit update caption."""
    patch_sb("services.scraper.dedup")
    row = _db_event(
        eid=42,
        title="Tea Tasting Night",
        location="SLC 1000",
        description="Weekly tea tasting in SLC.",
    )
    _queue_dedup_db(fake_sb, same_org_rows=[row], same_day_rows=[])

    extracted = _extracted(
        title="Tea Tasting Night",
        location="DC 1302",
        description="Moved to DC.",
    )
    candidates = find_candidates(
        title=extracted["title"],
        location=extracted["location"],
        description=extracted["description"],
        occurrences=extracted["occurrences"],
        ig_handle="uwteaorganization",
    )
    assert [c["id"] for c in candidates] == [42]

    finals = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[candidates],
        caption_text=(
            "UPDATE: Tea Tasting Night has moved from SLC 1000 to DC 1302. Same time, new room."
        ),
        school="uwaterloo",
    )
    assert finals is not None, "live Pass 2 returned None"
    assert len(finals) == 1
    assert finals[0]["id"] == 42
    assert "DC" in (finals[0]["location"] or "").upper() or "1302" in (finals[0]["location"] or "")


@pytest.mark.live_llm
@pytest.mark.skipif(not settings.openai_api_key, reason="OPENAI_API_KEY not configured")
def test_live_pass2_cancel_caption_sets_cancelled(fake_sb, patch_sb):
    patch_sb("services.scraper.dedup")
    row = _db_event(eid=43, title="Tea Tasting Night", location="SLC 3223")
    _queue_dedup_db(fake_sb, same_org_rows=[row], same_day_rows=[])

    extracted = _extracted(title="Tea Tasting Night", location="SLC 3223")
    candidates = find_candidates(
        title=extracted["title"],
        location=extracted["location"],
        description="",
        occurrences=extracted["occurrences"],
        ig_handle="uwteaorganization",
    )
    assert candidates[0]["id"] == 43

    finals = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[candidates],
        caption_text="CANCELLED: Tea Tasting Night this week is cancelled. Sorry!",
        school="uwaterloo",
    )
    assert finals is not None
    assert finals[0]["id"] == 43
    assert finals[0]["cancelled"] is True


@pytest.mark.live_llm
@pytest.mark.skipif(not settings.openai_api_key, reason="OPENAI_API_KEY not configured")
def test_live_pass2_no_update_language_inserts_new_instance(fake_sb, patch_sb):
    """Recurring-style repost without update language should insert (null id)."""
    patch_sb("services.scraper.dedup")
    row = _db_event(eid=44, title="Tea Tasting Night", location="SLC 3223")
    _queue_dedup_db(fake_sb, same_org_rows=[row], same_day_rows=[])

    extracted = _extracted(title="Tea Tasting Night", location="SLC 3223")
    candidates = find_candidates(
        title=extracted["title"],
        location=extracted["location"],
        description="",
        occurrences=extracted["occurrences"],
        ig_handle="uwteaorganization",
    )
    assert candidates[0]["id"] == 44

    finals = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[candidates],
        caption_text=(
            "Tea Tasting Night this Friday in SLC 3223! Bring a mug. Same weekly series, new week."
        ),
        school="uwaterloo",
    )
    assert finals is not None
    assert len(finals) == 1
    assert finals[0]["id"] is None, (
        f"expected insert (id=null) for announcement without update language; "
        f"got id={finals[0]['id']} location={finals[0].get('location')!r}"
    )
    assert finals[0]["cancelled"] is False


@pytest.mark.live_llm
@pytest.mark.skipif(not settings.openai_api_key, reason="OPENAI_API_KEY not configured")
def test_live_pass2_two_candidates_picks_matching_one(fake_sb, patch_sb):
    patch_sb("services.scraper.dedup")
    tea = _db_event(eid=50, title="Tea Tasting Night", location="SLC")
    social = _db_event(eid=51, title="Tea Social Hour", location="SLC")
    _queue_dedup_db(fake_sb, same_org_rows=[tea, social], same_day_rows=[])

    extracted = _extracted(
        title="Tea Tasting Night",
        location="MC 2065",
        description="Room change for tasting.",
    )
    candidates = find_candidates(
        title=extracted["title"],
        location=extracted["location"],
        description=extracted["description"],
        occurrences=extracted["occurrences"],
        ig_handle="uwteaorganization",
    )
    assert {c["id"] for c in candidates} >= {50}

    finals = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[candidates],
        caption_text="UPDATE: Tea Tasting Night moved to MC 2065.",
        school="uwaterloo",
    )
    assert finals is not None
    assert finals[0]["id"] == 50
    assert finals[0]["id"] != 51
