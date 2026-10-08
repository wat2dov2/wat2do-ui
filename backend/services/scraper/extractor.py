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
from schemas.event import EventDiscoveryFields
from schemas.position import PositionType
from services.event_service import normalize_campus_season_ids
from services.school_context import (
    campus_season_prompt,
    canonical_school_key,
    current_semester_end,
    resolve_school_timezone,
)

log = logging.getLogger(__name__)

_SYSTEM_MESSAGE = (
    "You triage social media posts and extract campus event and hiring information. "
    "Always return valid JSON with the exact structure requested."
)

EVENT_DISCOVERY_JSON_FIELDS = "\n".join(
    f'"{name}": {"string[]" if name == "campus_season_ids" else "boolean"} or null,'
    for name in EventDiscoveryFields.model_fields
)
EVENT_DISCOVERY_RULES = "\n".join(
    [
        "EVENT DISCOVERY METADATA:",
        "These independent facts may overlap and do not replace the event category.",
        "For boolean flags, use true only when the source establishes the fact, false when it explicitly "
        "rules it out, and null when evidence is missing or uncertain. Never guess from "
        "the category, host, or the word 'free' alone.",
        *(
            f"- {name}: {field.description}"
            for name, field in EventDiscoveryFields.model_fields.items()
        ),
    ]
)


class PostExtractionError(RuntimeError):
    """A provider or response failure that must not consume an imported post."""

    def __init__(self) -> None:
        super().__init__("Instagram post extraction failed")


def _client() -> OpenAI | None:
    """Return a configured OpenAI client, or None if ``OPENAI_API_KEY`` is unset.

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
        model: vision-capable OpenAI model. Defaults to
            ``settings.openai_extraction_model``.

    Returns cleaned event and position dictionaries in one result. A valid
    non-event post may be empty; provider and unusable-response failures raise
    ``PostExtractionError`` so an importer can retry without consuming the post.
    """
    client = None
    try:
        client = _client()
    except Exception:
        log.warning("OpenAI extraction client could not be configured")
    if client is None:
        log.warning("OpenAI extraction client unavailable for %s", school)
        raise PostExtractionError()

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

    response = None
    try:
        response = client.chat.completions.create(
            model=model or settings.openai_extraction_model,
            messages=messages,
        )
    except Exception:
        log.warning("OpenAI extraction call failed")
    if response is None:
        raise PostExtractionError() from None

    try:
        raw = (response.choices[0].message.content or "").strip()
        parsed = _parse_model_json(raw)

        # These values belong to the source, not to model interpretation.
        if isinstance(parsed, dict):
            for key in ("events", "positions"):
                items = parsed.get(key)
                for item in items if isinstance(items, list) else []:
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
    except Exception:
        log.warning("OpenAI extraction returned an unusable response")
    # Keep upstream content out of exception context as well as the message.
    raise PostExtractionError() from None


def extract_events_from_post(
    *,
    caption_text: str | None,
    image_urls: list[str] | None,
    post_created_at: datetime | None,
    school: str,
    model: str | None = None,
) -> list[dict]:
    """Extract events for event-only consumers such as poster scanning."""
    return extract_post_content(
        caption_text=caption_text,
        image_urls=image_urls,
        post_created_at=post_created_at,
        school=school,
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

    return f"""
Analyze the following Instagram caption and images. First classify the post, then extract every campus event and every open hiring position it clearly advertises.

Campus context: {school}. Use this to disambiguate an explicitly named campus venue and timezone, never to supply a missing venue.
Explicit school, club, location, and timezone information in the caption or image takes precedence over campus context.
Preserve the school and club names printed in the source, including in descriptions. Never rename a host to match campus context or substitute a similarly named club from another school.
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
- Ideally, the post should have BOTH a specific date AND a specific start time. An explicitly advertised recurring schedule with a resolvable start date also qualifies under EXPLICIT RECURRING SCHEDULES below.
- EXCEPTION: For major events (e.g., full-day, multi-day, overnight), you MAY extract the event even if a specific start time is not explicitly stated, provided there is a specific DATE or date range.
- For these major events ONLY, if no time is given, you may default the start time to 00:00 (midnight) or a logical start time implied by the context.
- DO NOT extract an event if:
    * The post is a meme, personal photo dump, or generic post with no time/place.
    * The post is inappropriate (nudity, explicit sexual content, or graphic violence).
    * There is NO mention of a date, relative date, or resolvable recurring schedule at all.
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
      {EVENT_DISCOVERY_JSON_FIELDS}
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
- Return each advertised event date/time as a separate entry in the occurrences array, including dates expanded from an explicit recurring schedule below.
- DO NOT include registration, signup, RSVP, or application deadlines as occurrences.
- Do not invent recurrence from a club's usual habits, an event title, or "first meeting" alone. Do not compress multiple occurrences into one long date range or a recurrence-rule string.
- Always convert each occurrence's local time to UTC using the timezone offset on THAT date, including daylight-saving changes. A weekly 6 PM meeting stays at 6 PM local time even when its UTC hour changes. The JSON must use ISO 8601 format with a trailing "Z" (e.g., "2025-11-05T22:00:00Z").
- If an end time is not provided, leave "dtend_utc" as an empty string.
- If duration is not explicitly available, leave "duration" as an empty string.
- Use the timezone context from the caption/image (default to "{local_tz_key}" for {school}) for the "tz" field.

EXPLICIT RECURRING SCHEDULES:
- Read the caption AND every image for schedule details, including small-print panels such as "Weekly Meetings". A caption advertising the first meeting does not cancel an image's explicit weekly schedule. Resolve actual contradictions in favor of an explicit update; silence about recurrence is not a contradiction.
- Wording such as "weekly", "every Tuesday", "Tuesdays", "every other week", or "the first Monday of each month" explicitly advertises recurrence. Expand a sufficiently specified schedule into ALL concrete occurrences within its supported bounds, not just the first or next date.
- Anchor the series to its advertised first date. If no first date is given, use the first matching weekday on or after the POST CREATION DATE ({post_date}); do not shift the series to today's date. An interval such as every other week needs a clear starting date, and ambiguous wording such as "biweekly" must not be guessed.
- Use the source's explicit end date, date range, or session count when provided. Include the last matching date within those bounds. Respect stated skipped dates, cancellations, breaks, and different hours for particular sessions. Do not invent holiday exceptions that the source does not announce.
- If a campus series has no explicit end date or count, expand it through the supplied Current semester end date only when the series belongs to that same semester. Never carry a past-term or future-term series into a different current semester, and never extend beyond the applicable semester as a fallback.
- If neither an explicit bound nor an applicable semester end is available, keep the individually stated dates only; do not invent a cutoff or an unlimited series. Do not fabricate a weekday, interval, start time, or missing anchor.
- For a first meeting followed by weekly meetings of the same activity, return ONE logical event with the first meeting and every later session in its occurrences array. Deduplicate the first date if it also matches the weekly rule. Give genuinely separate activities separate event objects.
- Example: "First meeting Tuesday September 29, 2026, 6-7 PM in MC 4045. Weekly meetings Tuesdays 6-7 PM in MC 4045" with a semester end of December 22, 2026 means 13 occurrences: September 29; October 6, 13, 20, 27; November 3, 10, 17, 24; December 1, 8, 15, 22. In America/Toronto, the starts are 22:00Z before the November daylight-saving change and 23:00Z afterwards.
- Counterexample: "First meeting September 29, 2026, 6-7 PM" with no recurring schedule means exactly one occurrence, even if a semester end is supplied.

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

LOCATION RULES:
- Read the caption AND every relevant carousel image, including small print, venue labels, map pins, room numbers, and the last slide. A short caption does not make a location printed on the poster unavailable.
- Extract the most specific attendee destination actually stated: venue or building plus room/floor, and street address and city/province when supplied. Preserve meaningful campus abbreviations and room numbers, including leading zeroes (e.g., "STC 0020", "SLC 3223", "DC Library"). Do not discard a room, venue name, or supplied address.
- Use a location belonging to this event, not a sponsor's address, the host's office, another event in a roundup, or a registration website. School context alone, a club's usual meeting place, or an Instagram handle is not venue evidence.
- An explicit moved/corrected venue overrides the older venue. Otherwise combine compatible details; do not discard a poster's precise room because the caption names only the building. Preserve date/session qualifiers when advertised occurrences use different venues.
- For explicitly virtual events, use "Online" and include the platform when stated (e.g., "Online (Zoom)"). For hybrid events, retain the verified physical venue and online format. A registration link alone never means the event is online.
- Preserve an explicit "TBA", "TBD", or "location shared after registration" notice. If no location or online format is evidenced, return an empty location string; never invent a venue or substitute the school name or "On campus".

ADDITIONAL EVENT RULES:
- Prioritize caption text; use image text if missing details.
- Extract one object per logical event, even when the caption and several images repeat it. Combine all explicitly advertised occurrences, including expanded recurring dates, for that same activity into that object's occurrences array. Do not create event objects for its ticket, registration, check-in, application, campaign, or other administrative milestones.
- Title-case event titles.
- For "club": this is the club / society / faculty hosting the event. Prefer the most specific named entity from the caption or image (e.g., "UW Tea Club"); if none is named, use the Instagram handle as a fallback.
- If year not found, infer the NEXT occurrence of that date relative to the post creation date ({post_date}). If end time < start time (e.g., 7pm-12am), set end to the next day.
- When no explicit date is found but there are relative terms like "tonight", "tomorrow", interpret these relative to the POST CREATION DATE ({post_date}).
- For price: REGISTRATION COST ONLY. Prefer non-member / general admission price if multiple are listed. Free events are 0.0. Use null if price is not mentioned.
- For food: Return an array. Use specific items when named (e.g., ["Pizza", "Bubble tea"]). Use ["Food"] for a generic food mention. Never return "Yes" or "Yes!" as a food label. Use [] when no food is mentioned.
- For registration: only true if there is a clear instruction to register, RSVP, or sign up.
- If information is not available, use empty string for strings, null for price and discovery metadata, and false for registration.
- Event category must be one of the canonical categories or null: {categories_str}
{EVENT_DISCOVERY_RULES}
{campus_season_prompt(school)}
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


class ExtractedEvent(EventDiscoveryFields):
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
        raise ValueError("Extractor response must contain a classified post")

    content_type = value.get("content_type")
    if content_type not in {"event", "hiring", "event_and_hiring", "other"}:
        raise ValueError("Extractor response has an invalid content type")

    events: list[dict] = []
    raw_events = value.get("events")
    if raw_events is None:
        raw_events = []
    if content_type in {"event", "event_and_hiring"}:
        if not isinstance(raw_events, list):
            raise ValueError("Extractor events must be a list")
        for event in raw_events:
            if not isinstance(event, dict):
                continue
            try:
                events.append(_clean_event(event))
            except ValueError:
                continue

    positions: list[dict] = []
    raw_positions = value.get("positions")
    if raw_positions is None:
        raw_positions = []
    if content_type in {"hiring", "event_and_hiring"}:
        if not isinstance(raw_positions, list):
            raise ValueError("Extractor positions must be a list")
        for position in raw_positions:
            if not isinstance(position, dict):
                continue
            try:
                positions.append(_clean_position(position))
            except ValueError:
                continue

    if (
        not events
        and not positions
        and (
            (content_type in {"event", "event_and_hiring"} and raw_events)
            or (content_type in {"hiring", "event_and_hiring"} and raw_positions)
        )
    ):
        raise ValueError("Extractor response contains no usable advertised items")

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
        validated = ExtractedEvent.model_validate(
            {
                **event,
                "campus_season_ids": normalize_campus_season_ids(
                    event.get("campus_season_ids"), event.get("school")
                ),
            }
        )
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
