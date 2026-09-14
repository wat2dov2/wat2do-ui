"""OpenAI vision-based event and hiring extraction for scraped content.

Each ``image_url`` block in the user-message content is preceded by an
``{"type": "text", "text": "Image N:"}`` marker. The vision model keys off
these markers when populating ``image_index`` on extracted events; without
them carousel-image attribution is essentially random.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from openai import OpenAI
from pydantic import BaseModel, BeforeValidator, Field, model_validator

from core.config import settings
from core.constants import EVENT_CATEGORIES
from core.constants.positions import (
    MAX_POSITION_DESCRIPTION_LENGTH,
    MAX_POSITION_DETAIL_LENGTH,
    MAX_POSITION_REQUIREMENT_COUNT,
    MAX_POSITION_REQUIREMENT_LENGTH,
    MAX_POSITION_TITLE_LENGTH,
)
from core.sanitize import normalize_scraped_text
from schemas.position import PositionType
from services.school_context import (
    canonical_school_key,
    current_semester_end,
    resolve_school_timezone,
)

log = logging.getLogger(__name__)

_SYSTEM_MESSAGE = (
    "You triage social media posts and extract campus event and hiring information. "
    "Always return valid JSON with the exact structure requested."
)


def _client() -> OpenAI | None:
    """Return a configured OpenAI client, or None if ``OPENAI_API_KEY`` is unset.

    A None return causes extraction to log and return an empty result.
    Dry-run does not bypass extraction; it still needs a key to call the model.
    """
    if not settings.openai_api_key:
        return None
    return OpenAI(api_key=settings.openai_api_key)


def extract_post_content(
    *,
    caption_text: str | None,
    image_urls: list[str] | None,
    post_created_at: datetime | None,
    school: str,
    source_club: str | None = None,
    model: str | None = None,
) -> ExtractedPostContent:
    """Triage content and extract zero-or-more events and hiring positions.

    Args:
        caption_text: post caption (may be empty/None for image-only posts).
        image_urls: ordered list of public image URLs (application storage
            after ``image_uploader.upload_post_images``). The list order
            corresponds to the carousel order; ``image_index`` on the
            returned events refers to this list.
        post_created_at: aware datetime of the post (used for relative
            phrases like "tonight"/"tomorrow"). Falls back to "now" in
            the school's local TZ if missing.
        school: school slug (e.g. "uwaterloo").
        source_club: trusted publisher of an official directory page.
            When present, the prompt treats it as the default event host.
        model: vision-capable OpenAI model. Defaults to
            ``settings.openai_extraction_model``.

    Returns cleaned event and position dictionaries in one result. Returns an
    empty result on any failure so the pipeline can keep processing the next
    post.
    """
    client = _client()
    if client is None:
        log.warning("OpenAI key not configured; skipping extraction for %s", school)
        return ExtractedPostContent()

    tz_name = resolve_school_timezone(school)
    try:
        local_tz = ZoneInfo(tz_name)
    except Exception:
        # resolve_school_timezone falls back to "UTC" for unknown schools
        # so this branch only fires if the IANA database is somehow missing
        # the resolved zone - paranoid fallback to UTC.
        local_tz = ZoneInfo("UTC")

    now_local = datetime.now(local_tz)
    if isinstance(post_created_at, datetime):
        if post_created_at.tzinfo is None:
            post_local = post_created_at.replace(tzinfo=local_tz)
        else:
            post_local = post_created_at.astimezone(local_tz)
    else:
        post_local = now_local

    semester_end = current_semester_end(school, now=now_local)
    semester_line = f"Current semester end date: {semester_end}\n" if semester_end else ""

    categories_str = "\n".join(f"- {cat}" for cat in EVENT_CATEGORIES)
    prompt = _build_prompt(
        caption_text=caption_text,
        image_urls=image_urls or [],
        school=canonical_school_key(school),
        local_tz_key=local_tz.key,
        current_date=now_local.strftime("%Y-%m-%d"),
        current_day=now_local.strftime("%A"),
        post_date=post_local.strftime("%Y-%m-%d"),
        post_day=post_local.strftime("%A"),
        post_time=post_local.strftime("%H:%M"),
        semester_line=semester_line,
        categories_str=categories_str,
        source_club=source_club,
    )

    user_content: list[dict] = [{"type": "text", "text": prompt}]
    valid_urls = [u for u in (image_urls or []) if u]
    # Inline ``Image N:`` text markers before each image_url block.
    # See module docstring - preserving this is a hard requirement.
    for i, url in enumerate(valid_urls):
        user_content.append({"type": "text", "text": f"Image {i}:"})
        user_content.append({"type": "image_url", "image_url": {"url": url}})

    messages = [
        {"role": "system", "content": _SYSTEM_MESSAGE},
        {"role": "user", "content": user_content},
    ]

    try:
        response = client.chat.completions.create(
            model=model or settings.openai_extraction_model,
            messages=messages,
        )
    except Exception as e:
        log.exception("OpenAI extraction call failed: %s", e)
        return ExtractedPostContent()

    raw = (response.choices[0].message.content or "").strip()
    parsed = _parse_model_json(raw)

    # These values belong to the source, not to model interpretation.
    if isinstance(parsed, dict):
        for key in ("events", "positions"):
            for item in parsed.get(key) or []:
                if not isinstance(item, dict):
                    continue
                if caption_text and caption_text.strip():
                    item["description"] = (
                        caption_text[:MAX_POSITION_DESCRIPTION_LENGTH]
                        if key == "positions"
                        else caption_text
                    )
                item["school"] = canonical_school_key(school)

    return _clean_extracted_content(parsed)


def extract_events_from_post(
    *,
    caption_text: str | None,
    image_urls: list[str] | None,
    post_created_at: datetime | None,
    school: str,
    source_club: str | None = None,
    model: str | None = None,
) -> list[dict]:
    """Extract events for event-only consumers such as directory imports."""
    return extract_post_content(
        caption_text=caption_text,
        image_urls=image_urls,
        post_created_at=post_created_at,
        school=school,
        source_club=source_club,
        model=model,
    ).events


def _parse_model_json(raw: str):
    """Parse the model's response, tolerating common formatting quirks.

    Strips ``json`` and bare ` ``` ` code fences, then attempts a strict
    parse. On failure, falls back to extracting the first JSON value
    (``[ ... ]`` or ``{ ... }``) in the string - handles the case where
    the model appended a trailing "Note: ..." sentence despite the prompt
    asking for JSON only. Returns ``None`` if nothing parses.
    """
    s = raw
    if s.startswith("```json"):
        s = s[len("```json") :]
    elif s.startswith("```"):
        s = s[3:]
    if s.endswith("```"):
        s = s[: -len("```")]
    s = s.strip()
    if not s:
        return None

    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass

    # Fallback: find the first `[` or `{` and the matching last `]` or `}`.
    for opener, closer in (("[", "]"), ("{", "}")):
        start = s.find(opener)
        end = s.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(s[start : end + 1])
            except json.JSONDecodeError:
                continue

    log.warning("Extractor returned non-JSON text (len=%d): %s", len(raw), raw[:200])
    return None


def _build_prompt(
    *,
    caption_text: str | None,
    image_urls: list[str],
    school: str,
    local_tz_key: str,
    current_date: str,
    current_day: str,
    post_date: str,
    post_day: str,
    post_time: str,
    semester_line: str,
    categories_str: str,
    source_club: str | None,
) -> str:
    """Assemble the extraction prompt.

    Kept verbose because Instagram-caption phrasing is irregular enough that
    aggressive trimming causes regressions in date inference and price parsing.
    """
    description_field = (
        '\n      "description": string,' if not caption_text or not caption_text.strip() else ""
    )
    description_rule = (
        "No caption is available. Extract description from the relevant image text; do not invent details."
        if description_field
        else "Do not output description. The application attaches the original caption to every extracted item."
    )
    source_club_rule = (
        f"""
OFFICIAL DIRECTORY PUBLISHER:
- This page comes from the official event directory published by {source_club}.
- Use "{source_club}" as the event club unless the page explicitly identifies a distinct student club as the host or co-host.
- Never invent a club from an event title, series name, campaign, service, venue, vendor, or URL slug.
"""
        if source_club
        else ""
    )

    return f"""
Analyze the following Instagram caption and images. First classify the post, then extract every campus event and every open hiring position it clearly advertises.

Campus context: {school}. Use this only as a fallback for ambiguous location and timezone information.
Explicit school, club, location, and timezone information in the caption or image takes precedence over campus context.
Preserve the school and club names printed in the source, including in descriptions. Never rename a host to match campus context or substitute a similarly named club from another school.
{source_club_rule}
Current context: Today is {current_day}, {current_date}
Post was created on: {post_day}, {post_date} at {post_time}
{semester_line}
Caption: {caption_text or ""}

Images are attached below with 0-indexed markers ({len([url for url in image_urls if url])} images).
{description_rule}

CLASSIFICATION POLICY:
- Set "content_type" to "event" for event-only posts, "hiring" for hiring-only posts, "event_and_hiring" when both are clearly advertised, and "other" when neither applies.
- A hiring post explicitly recruits people for one or more qualifying open roles, including executives, committee members, ongoing volunteers, paid staff, or internships.
- A qualifying role gives the selected person defined work, service, leadership, or club responsibilities. An application or sign-up for participation, membership, a program, a team, or an event is not a position.
- General club promotion, member introductions, election activity, event registration, program applications, and participant sign-ups are not hiring. Only roles that pass both eligibility tests below qualify.
- Return an empty array for a content category that is not present. Never force an event into a position or a position into an event.

POSITION ELIGIBILITY GATE (CRITICAL):
- Before extracting each position, independently pass BOTH tests below. If either test fails, omit that position even when another role in the same post qualifies.
- ROLE TEST: The selected person will perform defined work or service, own ongoing responsibilities, hold club authority, or fill an explicit paid job or internship for the club.
- OPENING TEST: This post explicitly says that applications or recruitment are currently open for that specific non-elected role. Evidence includes "we're hiring", "applications are open", "apply for [role]", or "join our [executive/committee/staff] team".
- A call to action such as "apply", "applications open", "sign up", "register", "join", "try out", "audition", "volunteer", or a form/deadline is never sufficient by itself. First establish that the thing being applied for passes the ROLE TEST.
- The recruiting evidence must be on this post and must connect to the advertised role. A deadline, a role title, a list of roles, a description of responsibilities, a department name, a person holding a role, or an announcement that an election exists is not enough by itself.
- Election voting posts are not hiring. Candidate lists or slates, campaign information, voting instructions, election dates, ballots, and results must return an empty positions array even when they name roles.
- Executive elections, nominations, self-nominations, and invitations to run for elected office are not hiring. A separate, explicitly recruited non-elected job in the same post may qualify.
- Member or executive introductions, current-board rosters, team spotlights, role-and-name graphics, posts naming "this year's" role holders, and "meet the team" posts are not hiring.
- Do not extract generic club membership, general members, active-member tiers, supporters, unnamed departments, or duties-only slides as positions. A named functional team role with real duties may qualify; "general member" or "general team member" without a defined club responsibility never does.
- Mentors and mentees joining a peer-mentorship program are program participants, not positions, even when they apply, guide someone, volunteer, or commit for a semester. A Director or Coordinator responsible for operating the mentorship program may qualify.
- Applicants to a course, workshop, cohort, accelerator, competition, scholarship, student-development program, or other learning program are participants, not positions. Do not relabel a program as an internship merely because applications are open, participants complete projects, professionals are involved, or the program is paid.
- Players, athletes, dancers, singers, models, performers, chorus members, and competitive-team members joining through auditions, casting, or tryouts are participants, not positions. A separately advertised coach, choreographer, director, designer, or other work/leadership vacancy may qualify.
- One-off event helpers, event-day volunteers, orientation or Welcome Week volunteers, race or relay participants, and sign-ups for posted volunteer shifts are not positions. An ongoing volunteer role may qualify only when the post recruits for specific continuing responsibilities on behalf of the club, separate from attending or helping at one event.
- Evaluate mixed lists role by role. Omit ineligible entries such as "General Members" while retaining qualifying entries such as "Outreach Ambassador" or "Events Team Member" when the post connects them to defined duties and a current application.
- A role description does not become an opening unless the same post explicitly asks people to apply or otherwise respond to current recruitment for that non-elected role.
- If there is no explicit current recruiting evidence, do not extract any position and do not set "content_type" to "hiring" solely because role names appear.
- Example: "Executive elections start today. Read the candidate speeches and vote for Treasurer" is "other" with "positions": [].
- Example: "Nominations are open. Apply or run for Treasurer by Friday" is "other" with "positions": [].
- Example: "Meet this year's Merch Coordinator" is "other" with "positions": [].
- Example: "Apply to be a mentor or mentee in our peer mentorship program" is "other" with "positions": [].
- Example: "Applications are open for our eight-week equity research training program" is "other" with "positions": [].
- Example: "Volunteers needed for our Welcome Week events; sign up below" is "other" with "positions": [].
- Example: "Try out for our varsity esports team" is "other" with "positions": [].
- Mixed example: "Applications open for Outreach Ambassadors, Events Team Members, and General Members" may include the two defined team roles but must omit General Members.

EVENT POLICY:
- ONLY extract an attendee-facing activity if the post is clearly announcing or describing a real-world event. The activity itself must be named and something a person can attend, participate in, or watch.
- A ticketed, paid, RSVP-only, or registration-required activity is still an event when the actual activity is clearly named. Do not reject an event merely because it has tickets or registration.
- Closure notices, holiday hours, cancellations, and "no meeting today" announcements are not events. A closure or reopening date does not describe a gathering. Only extract an independently advertised gathering, such as a holiday BBQ, not the closure itself.
- Ideally, the post should have BOTH a specific date AND a specific start time.
- EXCEPTION: For major events (e.g., full-day, multi-day, overnight), you MAY extract the event even if a specific start time is not explicitly stated, provided there is a specific DATE or date range.
- For these major events ONLY, if no time is given, you may default the start time to 00:00 (midnight) or a logical start time implied by the context.
- DO NOT extract an event if:
    * The post is a meme, personal photo dump, or generic post with no time/place.
    * The post is inappropriate (nudity, explicit sexual content, or graphic violence).
    * There is NO mention of a date at all.
    * The post only introduces people or some topic, UNLESS there is a clear call to attend or participate in an actual event (such as a meeting, workshop, performance, or competition).
    * It only announces ticket or registration release, a presale, a giveaway, merchandise, a waitlist, an application, a submission period, a placement test, or another administrative deadline rather than the activity itself.
    * It only promotes a trailer, teaser, behind-the-scenes content, a campaign, a vote, election results, a call for artists or volunteers, or a program reveal.
    * It lists event names in a recruitment, volunteer, planning, or administrative schedule without inviting attendees to those activities.

Return exactly one JSON object with this structure:
{{
  "content_type": "event" | "hiring" | "event_and_hiring" | "other",
  "events": [
    {{
      "title": string,{description_field}
      "location": string,
      "club": string,
      "price": number or null,
      "food": string[],
      "registration": boolean,
      "image_index": integer,
      "occurrences": [
        {{
          "dtstart_utc": string,
          "dtend_utc": string,
          "duration": string,
          "tz": string
        }}
      ],
      "category": string or null
    }}
  ],
  "positions": [
    {{
      "title": string,{description_field}
      "club": string,
      "position_type": "executive" | "committee" | "volunteer" | "staff" | "internship" | "general",
      "requirements": string[],
      "commitment": string or null,
      "compensation": string or null,
      "is_paid": true | false | null,
      "location": string or null,
      "contact_email": string or null,
      "deadline_date": string or null,
      "deadline_at": string or null,
      "image_index": integer
    }}
  ]
}}

IMAGE MAPPING RULES:
- You are provided with a list of images.
- For each extracted event or position, identify which specific image contains its relevant details.
- Set "image_index" to that image's 0-based index.
- Otherwise, set "image_index": 0.

OCCURRENCE RULES (CRITICAL):
- Every event MUST include at least one occurrence with a concrete UTC start time.
- Return explicit dates and times that correspond to events as separate entries in the occurrences array.
- DO NOT include registration, signup, RSVP, or application deadlines as occurrences.
- Do NOT infer or compress recurrence patterns. List each event date/time exactly as given.
- Always convert local times to UTC. The JSON must use ISO 8601 format with a trailing "Z" (e.g., "2025-11-05T22:00:00Z").
- If an end time is not provided, leave "dtend_utc" as an empty string.
- If duration is not explicitly available, leave "duration" as an empty string.
- Use the timezone context from the caption/image (default to "{local_tz_key}" for {school}) for the "tz" field.

POSITION RULES:
- Extract one position object per distinct advertised role. If a post recruits several roles, do not collapse them into one generic position.
- If the same advertised role appears in the caption and multiple images, return it once, using the image with the strongest recruiting evidence.
- Use "general" only for a genuinely open-ended team application that does not map to a more specific type.
- Use "staff" for paid non-intern employment. Compensation details belong in "compensation", not in the type.
- Requirements must contain only explicit qualifications or expectations. Use [] when none are stated.
- Preserve commitment, compensation, location, and contact email as written. Use null when absent.
- Set is_paid to true only for explicitly paid roles, false for explicitly unpaid or volunteer roles, and null when payment is unspecified. Never infer payment from position type alone.
- "deadline_date" is "YYYY-MM-DD". Infer a missing year as the next occurrence relative to the post date ({post_date}), but never invent a missing month or day.
- "deadline_at" is a UTC ISO 8601 timestamp ending in "Z" only when an application time is explicitly stated. Otherwise use null.
- An application deadline is position metadata and must never be emitted as an event occurrence.

ADDITIONAL EVENT RULES:
- Prioritize caption text; use image text if missing details.
- Extract one object per logical event, even when the caption and several images repeat it. Combine all explicitly advertised occurrences for that same activity into that object's occurrences array. Do not create event objects for its ticket, registration, check-in, application, campaign, or other administrative milestones.
- Title-case event titles.
- For "club": this is the club / society / faculty hosting the event. Prefer the most specific named entity from the caption or image (e.g., "UW Tea Club"); if none is named, use the Instagram handle as a fallback.
- If year not found, infer the NEXT occurrence of that date relative to the post creation date ({post_date}). If end time < start time (e.g., 7pm-12am), set end to the next day.
- When no explicit date is found but there are relative terms like "tonight", "tomorrow", interpret these relative to the POST CREATION DATE ({post_date}).
- For location: Use the exact location as stated in the caption or image. If the location is a building or room on campus, use only that (e.g., "SLC 3223", "DC Library"). Include city/province if the event is off-campus and the address is provided.
- For price: REGISTRATION COST ONLY. Prefer non-member / general admission price if multiple are listed. Free events are 0.0. Use null if price is not mentioned.
- For food: Return an array. Use specific items when named (e.g., ["Pizza", "Bubble tea"]). Use ["Food"] for a generic food mention. Never return "Yes" or "Yes!" as a food label. Use [] when no food is mentioned.
- For registration: only true if there is a clear instruction to register, RSVP, or sign up.
- If information is not available, use empty string for strings, null for price, and false for booleans.
- Event category must be one of the canonical categories or null: {categories_str}
- Return ONLY the JSON object, with no extra commentary.
"""


def empty_str_to_none(v: object) -> object:
    if isinstance(v, str) and not v.strip():
        return None
    return v


OptionalStr = Annotated[str | None, BeforeValidator(empty_str_to_none)]
OptionalDatetime = Annotated[datetime | None, BeforeValidator(empty_str_to_none)]
PostContentType = Literal["event", "hiring", "event_and_hiring", "other"]


class ExtractedOccurrence(BaseModel):
    dtstart_utc: datetime
    dtend_utc: OptionalDatetime = None
    duration: OptionalStr = None
    tz: OptionalStr = None


class ExtractedEvent(BaseModel):
    title: str = Field(default="")
    description: str = Field(default="")
    location: str = Field(default="")
    club: str = Field(default="")
    price: float | None = None
    food: list[str] = Field(default_factory=list)
    registration: bool = False
    image_index: int = 0
    occurrences: list[ExtractedOccurrence] = Field(default_factory=list)
    school: str = Field(default="")
    category: str | None = None

    @model_validator(mode="after")
    def coerce_free_price(self) -> ExtractedEvent:
        if self.price is None:
            haystack = " ".join(
                str(v) for v in (self.title, self.description, " ".join(self.food)) if v
            ).lower()
            if "free" in haystack:
                self.price = 0.0
        return self

    @model_validator(mode="after")
    def sort_occurrences(self) -> ExtractedEvent:
        self.occurrences.sort(key=lambda occ: occ.dtstart_utc)
        return self


class ExtractedPosition(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_POSITION_TITLE_LENGTH)
    description: str = Field(min_length=1, max_length=MAX_POSITION_DESCRIPTION_LENGTH)
    club: str = Field(default="")
    position_type: PositionType
    requirements: list[
        Annotated[str, Field(min_length=1, max_length=MAX_POSITION_REQUIREMENT_LENGTH)]
    ] = Field(default_factory=list, max_length=MAX_POSITION_REQUIREMENT_COUNT)
    commitment: OptionalStr = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    compensation: OptionalStr = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    is_paid: bool | None = None
    location: OptionalStr = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    contact_email: OptionalStr = Field(default=None, max_length=320)
    deadline_date: date | None = None
    deadline_at: OptionalDatetime = None
    image_index: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def deadline_time_requires_date(self) -> ExtractedPosition:
        if self.deadline_at is not None and self.deadline_date is None:
            raise ValueError("deadline_at requires deadline_date")
        if self.deadline_at is not None and self.deadline_at.tzinfo is None:
            raise ValueError("deadline_at must include a timezone")
        return self


class ExtractedPostContent(BaseModel):
    content_type: PostContentType = "other"
    events: list[dict] = Field(default_factory=list)
    positions: list[dict] = Field(default_factory=list)


def _clean_extracted_content(value: object) -> ExtractedPostContent:
    if not isinstance(value, dict):
        return ExtractedPostContent()

    content_type = value.get("content_type")
    if content_type not in {"event", "hiring", "event_and_hiring", "other"}:
        log.warning("Extractor returned invalid content_type: %r", content_type)
        return ExtractedPostContent()

    events: list[dict] = []
    if content_type in {"event", "event_and_hiring"}:
        for event in value.get("events") or []:
            if not isinstance(event, dict):
                continue
            try:
                events.append(_clean_event(event))
            except ValueError:
                continue

    positions: list[dict] = []
    if content_type in {"hiring", "event_and_hiring"}:
        for position in value.get("positions") or []:
            if not isinstance(position, dict):
                continue
            try:
                positions.append(_clean_position(position))
            except ValueError:
                continue

    return ExtractedPostContent(
        content_type=content_type,
        events=events,
        positions=positions,
    )


def _clean_event(event: dict) -> dict:
    """Validate and normalize one extracted event dict using Pydantic.

    Idempotent - running this twice on the same input is a no-op. The
    pipeline depends on this for safety after JSON parsing of arbitrary
    model output.
    """
    try:
        validated = ExtractedEvent.model_validate(event)
        return _normalize_extracted_strings(validated.model_dump(mode="json"))
    except Exception as e:
        log.warning("Validation failed for event payload: %s", e)
        raise ValueError(f"Invalid event payload: {e}") from e


def _clean_position(position: dict) -> dict:
    """Validate and normalize one extracted hiring position."""
    try:
        validated = ExtractedPosition.model_validate(position)
        return _normalize_extracted_strings(validated.model_dump(mode="json"))
    except Exception as e:
        log.warning("Validation failed for position payload: %s", e)
        raise ValueError(f"Invalid position payload: {e}") from e


def _normalize_extracted_strings(value):
    """Normalize every textual leaf returned by the extraction model."""
    if isinstance(value, str):
        return normalize_scraped_text(value)
    if isinstance(value, list):
        return [_normalize_extracted_strings(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_extracted_strings(item) for key, item in value.items()}
    return value
