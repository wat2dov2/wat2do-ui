"""Validated, non-secret feature controls loaded from ``backend/controlbox``."""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    model_validator,
)

_CONTROLBOX_DIRECTORY = Path(__file__).resolve().parents[1] / "controlbox"
_INSTAGRAM_ACCOUNTS_PER_APP = 10
# Instagram keeps its sessions and messages here; deleting them logs accounts out.
_INSTAGRAM_LOGIN_FOLDERS = frozenset({"databases", "shared_prefs", "app_light_prefs", "no_backup"})


class _ControlModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CampusSeasonWindowControl(_ControlModel):
    filter_id: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]*$", max_length=64)
    start_date: date
    end_date: date
    source_url: HttpUrl

    @model_validator(mode="after")
    def validate_dates(self) -> "CampusSeasonWindowControl":
        if self.end_date < self.start_date:
            raise ValueError("campus season windows must end on or after their start")
        return self


class CampusSeasonDefinitionControl(_ControlModel):
    labels: dict[str, str]
    instructions: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_labels(self) -> "CampusSeasonDefinitionControl":
        if not self.labels.get("en") or any(not label.strip() for label in self.labels.values()):
            raise ValueError("campus season labels require English and nonempty translations")
        return self


class SchoolSeasonControl(_ControlModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=64)
    instructions: str = ""
    display_windows: tuple[CampusSeasonWindowControl, ...]

    @model_validator(mode="after")
    def validate_windows(self) -> "SchoolSeasonControl":
        for previous, following in zip(self.display_windows, self.display_windows[1:]):
            if previous.end_date >= following.start_date:
                raise ValueError("campus season windows must be ordered and nonoverlapping")
        return self


class SchoolSeasonsControl(_ControlModel):
    instructions: str = Field(min_length=1)
    seasons: tuple[SchoolSeasonControl, ...]

    @model_validator(mode="after")
    def validate_ids(self) -> "SchoolSeasonsControl":
        ids = [season.id for season in self.seasons]
        if len(set(ids)) != len(ids):
            raise ValueError("school campus season IDs must be unique")
        return self


class CampusSeasonsControl(_ControlModel):
    definitions: dict[
        Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=64)],
        CampusSeasonDefinitionControl,
    ] = Field(min_length=1)
    schools: dict[Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]*$")], SchoolSeasonsControl]

    @model_validator(mode="after")
    def validate_references(self) -> "CampusSeasonsControl":
        for school in self.schools.values():
            if any(season.id not in self.definitions for season in school.seasons):
                raise ValueError("school campus season IDs must reference a definition")
            for season in school.seasons:
                if any(
                    window.filter_id is not None and window.filter_id not in self.definitions
                    for window in season.display_windows
                ):
                    raise ValueError("campus season window filter IDs must reference a definition")
                if any(window.filter_id for window in season.display_windows) and not all(
                    window.filter_id for window in season.display_windows
                ):
                    raise ValueError("named campus season windows must all have filter IDs")
        return self


class EventViewsControl(_ControlModel):
    calendar_scroll_hour: int = Field(ge=0, le=23)
    map_initial_zoom: int = Field(ge=0, le=22)
    map_cluster_radius: int = Field(gt=0, le=512)
    map_marker_viewport_padding_px: int = Field(ge=0, le=256)
    map_marker_preview_count: int = Field(ge=1, le=3)
    map_cluster_max_zoom: int = Field(ge=0, le=22)
    map_style: str = Field(pattern=r"^https://")
    map_dark_style: str = Field(pattern=r"^https://")
    # Campus centers are fixed [longitude, latitude] pairs, not geocoded at runtime.
    map_campus_centers: dict[
        Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]*$")],
        tuple[
            Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)],
            Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)],
        ],
    ]


class MapGeocodingControl(_ControlModel):
    # Nominatim's usage policy allows one request a second from an identified client.
    search_url: str = Field(pattern=r"^https://")
    user_agent: str = Field(min_length=1)
    request_interval_seconds: float = Field(ge=1, le=60, allow_inf_nan=False)
    request_timeout_seconds: float = Field(gt=0, le=60, allow_inf_nan=False)
    search_radius_degrees: float = Field(gt=0, le=5, allow_inf_nan=False)
    candidate_count: int = Field(ge=1, le=40)
    not_found_retry_days: int = Field(ge=1)
    # A claimed place is left to another worker once its lease lapses.
    claim_lease_seconds: int = Field(ge=60, le=3600)
    # How long a worker waits before checking again when no place is waiting.
    idle_poll_seconds: float = Field(gt=0, le=3600, allow_inf_nan=False)
    # Schools gaining pins have their feeds refreshed at most this often.
    feed_refresh_seconds: float = Field(gt=0, le=3600, allow_inf_nan=False)
    # OpenStreetMap coordinates for campus buildings Nominatim cannot find by
    # the name events use, keyed by school then building name.
    known_places: dict[
        Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]*$")],
        dict[
            Annotated[str, Field(pattern=r"\S")],
            tuple[
                Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)],
                Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)],
            ],
        ],
    ]
    # Each school's official building codes, so extraction expands a code to the right building.
    building_codes: dict[
        Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]*$")],
        dict[Annotated[str, Field(pattern=r"^[A-Z0-9]+$")], Annotated[str, Field(pattern=r"\S")]],
    ]


class EventHighlightsControl(_ControlModel):
    # The events page's featured row at its top: how many events it holds and
    # how far ahead it looks for them.
    featured_count: int = Field(ge=1, le=20)
    featured_window_days: int = Field(ge=1, le=60)
    # How many cards each of the events page's other carousel rows holds.
    row_card_count: int = Field(ge=1, le=50)


class EventDiscoveryControl(_ControlModel):
    new_event_window_hours: int = Field(gt=0)
    event_without_end_visibility_minutes: int = Field(gt=0)
    initial_render_count: int = Field(gt=0, le=100)
    preview_event_count: int = Field(gt=0, le=100)
    server_feed_page_size: int = Field(gt=0, le=100)
    highlights: EventHighlightsControl
    campus_seasons: CampusSeasonsControl
    views: EventViewsControl
    map_geocoding: MapGeocodingControl

    @model_validator(mode="after")
    def validate_map_campus_centers(self) -> "EventDiscoveryControl":
        if set(self.views.map_campus_centers) != set(self.campus_seasons.schools):
            raise ValueError("every school must have exactly one map campus center")
        if not set(self.map_geocoding.known_places) <= set(self.campus_seasons.schools):
            raise ValueError("known map places must belong to configured schools")
        if not set(self.map_geocoding.building_codes) <= set(self.campus_seasons.schools):
            raise ValueError("building codes must belong to configured schools")
        return self


class DatabaseControl(_ControlModel):
    read_attempts: int = Field(ge=1, le=5)
    read_backoff_initial_seconds: float = Field(ge=0, allow_inf_nan=False)
    read_backoff_max_seconds: float = Field(ge=0, allow_inf_nan=False)
    read_backoff_jitter_seconds: float = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_backoff(self) -> "DatabaseControl":
        if self.read_backoff_max_seconds < self.read_backoff_initial_seconds:
            raise ValueError("read_backoff_max_seconds cannot be shorter than initial backoff")
        return self


class ImageDeliveryControl(_ControlModel):
    first_row_image_count: int = Field(ge=1, le=24)
    # Where uploaded media is served (an https origin, no path); the frontend
    # finds a poster's thumbnail by its URL starting here.
    media_origin: str = Field(pattern=r"^https://[a-z0-9-]+(\.[a-z0-9-]+)+$")


class DiscoveryCacheControl(_ControlModel):
    """Discovery snapshots in Next's data cache (`discoveryCache.server.ts`)."""

    # How long a CDN copy of /api/discovery or of a public page counts as fresh.
    cdn_ttl_seconds: int = Field(gt=0, le=300)
    schema_version: int = Field(ge=1)
    # A snapshot older than this is rebuilt on its next read, which still gets
    # the old copy; backend revalidation notices mark it stale sooner.
    refresh_interval_seconds: int = Field(gt=0)
    # The stale-while-revalidate window of CDN-cached /api/discovery responses.
    snapshot_check_seconds: int = Field(gt=0)
    # How long after cdn_ttl_seconds CloudFront still answers a public page
    # with its last copy while it renders a fresh one (frontend/next.config.ts).
    # Revalidation notices do not purge these copies, so an edit shows once the
    # first view past cdn_ttl_seconds has refreshed the page; no visitor gets a
    # copy older than the two summed.
    public_page_stale_while_revalidate_seconds: int = Field(gt=0, le=3600)
    request_timeout_seconds: int = Field(gt=0)
    page_concurrency: int = Field(ge=1, le=8)
    maximum_page_count: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_lifecycle(self) -> "DiscoveryCacheControl":
        if self.snapshot_check_seconds > self.cdn_ttl_seconds:
            raise ValueError("snapshot_check_seconds cannot exceed the CDN TTL")
        return self


class ClientCacheControl(_ControlModel):
    discovery_prefetch_idle_timeout_ms: int = Field(gt=0)
    default_query_stale_seconds: int = Field(ge=0)
    default_query_garbage_collection_seconds: int = Field(gt=0)
    live_event_data_stale_seconds: int = Field(ge=0)
    profile_stale_seconds: int = Field(ge=0)
    admin_stale_seconds: int = Field(ge=0)
    # How many more times the events page asks for the school's complete feed after
    # a failed read, with React Query's backoff (about 1, 2 and 4 seconds), before
    # it offers Try again. Its first screen is already showing meanwhile.
    event_feed_retries: int = Field(ge=0, le=5)

    @model_validator(mode="after")
    def validate_default_cache(self) -> "ClientCacheControl":
        if self.default_query_garbage_collection_seconds < self.default_query_stale_seconds:
            raise ValueError("default query garbage collection cannot be shorter than stale time")
        return self


class InteractionTrackingControl(_ControlModel):
    flush_debounce_milliseconds: int = Field(ge=0)


class AuthenticationControl(_ControlModel):
    session_cookie_days: int = Field(gt=0)
    # A readable cookie the API keeps beside the httpOnly refresh cookie (same
    # domain and lifetime): 1 while the browser holds a session, 0 once the API
    # has found it holds none. The website skips /auth/refresh only when it
    # says 0 and nothing is cached. Never trusted.
    signed_in_cookie: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    verification_token_minutes: int = Field(gt=0)
    access_token_minutes: int = Field(gt=0, le=1440)
    # Wrong six-digit codes an address may try per window, counted in the database so
    # the cap holds across IPs, app tasks and freshly sent codes.
    code_guess_limit: int = Field(ge=1, le=20)
    code_guess_window_minutes: int = Field(gt=0, le=1440)
    # Login emails one address may be sent per window, counted in the database for
    # the same reason, so nobody can flood an inbox from many IPs.
    code_send_limit: int = Field(ge=1, le=50)
    code_send_window_minutes: int = Field(gt=0, le=1440)
    # A just-rotated refresh token still returns its successor for this long, so
    # parallel refreshes from one browser do not log it out.
    refresh_token_reuse_seconds: int = Field(ge=0, le=300)
    token_issuer: str = Field(min_length=1)
    google_client_id: str = Field(pattern=r"^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$")
    legacy_frontend_origins: tuple[HttpUrl, ...]


class DuplicateClubNamesControl(_ControlModel):
    """How the API (rust/src/api/routes/clubs/duplicates.rs) tells that a submitted club's
    name is one its school already lists, after case, accents, punctuation, plurals and the
    school's own names are set aside."""

    # Words that never tell two clubs apart ("the", "of"), always dropped.
    function_words: tuple[Annotated[str, Field(pattern=r"^[a-z]+$")], ...]
    # Words that say what kind of group it is ("club", "society", "student"), in their
    # singular form: dropped to compare, but two names that differ only in these are
    # asked about ("Is this your club?") instead of refused.
    club_words: tuple[Annotated[str, Field(pattern=r"^[a-z]+$")], ...]
    # A name with at least this many words, all in a listed club's name, which has at
    # most similar_extra_words more, is asked about.
    similar_minimum_words: int = Field(ge=1, le=10)
    similar_extra_words: int = Field(ge=0, le=5)
    # Words this long or longer that are one letter apart read as a typo of each other.
    typo_minimum_letters: int = Field(ge=3, le=30)


class ClubManagementControl(_ControlModel):
    initial_render_count: int = Field(gt=0, le=100)
    directory_page_size: int = Field(gt=0, le=100)
    invite_expiration_days: int = Field(gt=0)
    # How long a school's club list for name and handle lookups stays cached
    # in a Python process; the API's club writes (in Rust) cannot clear it.
    school_lookup_cache_seconds: float = Field(gt=0, le=3600)
    duplicate_names: DuplicateClubNamesControl


class MorningEmailControl(_ControlModel):
    local_send_hour: int = Field(ge=0, le=23)
    # Catch-up for skipped scheduled runs: send any time from local_send_hour
    # through this hour, once per local day.
    last_local_send_hour: int = Field(ge=0, le=23)
    new_event_window_hours: int = Field(gt=0)
    provider_attempts: int = Field(gt=0, le=10)
    card_image_px: int = Field(gt=0, le=1200)
    club_logo_px: int = Field(gt=0, le=512)
    image_download_concurrency: int = Field(gt=0, le=32)

    @model_validator(mode="after")
    def validate_send_hours(self) -> "MorningEmailControl":
        if self.last_local_send_hour < self.local_send_hour:
            raise ValueError("last_local_send_hour must not be before local_send_hour")
        return self


class EventChangeAlertsControl(_ControlModel):
    quiet_minutes: int = Field(gt=0, le=60)


class EventReminderControl(_ControlModel):
    lead_minutes: int = Field(gt=0)
    early_tolerance_minutes: int = Field(ge=0)
    late_tolerance_minutes: int = Field(ge=0)
    provider_attempts: int = Field(gt=0, le=10)


class NotificationInboxControl(_ControlModel):
    """The inbox under the top bar's bell: one row per notification email a user is sent."""

    page_size: int = Field(gt=0, le=100)
    retention_days: int = Field(gt=0, le=365)
    refresh_seconds: int = Field(ge=30, le=3600)


class NotificationDefaultsControl(_ControlModel):
    morning_email: bool
    event_reminder: bool
    event_change: bool


class InteractionIngestionControl(_ControlModel):
    maximum_batch_size: int = Field(gt=0)
    maximum_metadata_bytes: int = Field(gt=0)
    maximum_duplicates_per_window: int = Field(gt=0)
    deduplication_window_minutes: int = Field(gt=0)
    maximum_user_interactions_per_window: int = Field(gt=0)
    # Cap on anonymous clicks for one event from a single client IP within the
    # dedup window. Higher than the per-session cap because many students share
    # one NAT'd campus IP; sized to stop scripted click floods, not real traffic.
    maximum_anonymous_clicks_per_ip_per_event: int = Field(gt=0)


class ApiServerControl(_ControlModel):
    """The Rust API server (`wat2do-api serve`) and the Python app it supervises."""

    # The Python app listens here on loopback behind the Rust server.
    python_port: int = Field(ge=1024, le=65535)
    # Longer than the Rust proxy's idle pool timeout, so Python never closes a
    # connection the proxy is about to reuse.
    python_keep_alive_seconds: int = Field(gt=0)
    python_probe_interval_milliseconds: int = Field(gt=0)
    python_probe_timeout_seconds: float = Field(gt=0, allow_inf_nan=False)
    python_shutdown_seconds: int = Field(gt=0)
    shutdown_drain_seconds: int = Field(gt=0)
    upstream_idle_seconds: int = Field(gt=0)
    # A small pool: every task holds at most this many Postgres connections.
    database_connections: int = Field(ge=1, le=5)
    database_idle_seconds: int = Field(gt=0)
    # A request waits at most this long for a free connection, then fails with 503.
    database_acquire_seconds: float = Field(gt=0, le=30, allow_inf_nan=False)
    # Each statement's limit, the same as the data API role's (authenticator, 8 s).
    database_statement_timeout_milliseconds: int = Field(ge=1000, le=60000)

    @model_validator(mode="after")
    def validate_keep_alive(self) -> "ApiServerControl":
        if self.python_keep_alive_seconds <= self.upstream_idle_seconds:
            raise ValueError("python_keep_alive_seconds must exceed upstream_idle_seconds")
        if self.python_port == 8000:
            raise ValueError("python_port must differ from the public API port 8000")
        if self.shutdown_drain_seconds + self.python_shutdown_seconds >= 30:
            raise ValueError("shutdown must finish within a 30 second stop timeout")
        return self


class SharedCacheControl(_ControlModel):
    """How long caches keep one API response that is the same for every visitor."""

    # Browsers (Cache-Control max-age).
    max_age_seconds: int = Field(ge=0, le=86400)
    # Shared caches such as CloudFront, in front of the website and /api (s-maxage).
    shared_max_age_seconds: int = Field(gt=0, le=86400)
    # How much longer a shared cache still answers with it while it fetches the next.
    stale_while_revalidate_seconds: int = Field(ge=0, le=86400)


class ApiCacheControl(_ControlModel):
    """The API's responses that browsers and the CDN may keep (`rust/src/api/cache_control.rs`)."""

    # Each school's click and going counts: short, as they change all day.
    event_stats: SharedCacheControl
    # Categories, interests and report statuses, which change only with a deploy.
    constants: SharedCacheControl


class RateLimitControl(_ControlModel):
    maximum_requests: int = Field(gt=0)
    window_seconds: int = Field(gt=0)


class RateLimitsControl(_ControlModel):
    default: RateLimitControl
    authentication: RateLimitControl
    sensitive_authentication: RateLimitControl
    token_refresh: RateLimitControl
    anonymous_interactions: RateLimitControl
    qr_scans: RateLimitControl
    reports: RateLimitControl
    submissions: RateLimitControl
    calendar_feed: RateLimitControl
    maximum_going_events_per_user: int = Field(gt=0)
    maximum_saved_clubs_per_user: int = Field(gt=0)
    maximum_saved_positions_per_user: int = Field(gt=0)


class ReelTranscriptionControl(_ControlModel):
    model: str = Field(min_length=1)
    maximum_media_bytes: int = Field(gt=0, le=24_000_000)
    download_timeout_seconds: int = Field(gt=0)
    transcription_timeout_seconds: int = Field(gt=0)


class ScrapingControl(_ControlModel):
    apify_memory_megabytes: Literal[128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768]
    apify_timeout_seconds: int = Field(gt=0)
    poll_interval_seconds: int = Field(gt=0)
    instagram_web_app_id: str = Field(pattern=r"^[0-9]{10,20}$")
    same_club_title_threshold: float = Field(ge=0, le=1)
    title_similarity_threshold: float = Field(ge=0, le=1)
    location_similarity_threshold: float = Field(ge=0, le=1)
    description_similarity_threshold: float = Field(ge=0, le=1)
    directory_minimum_image_dimension_pixels: int = Field(gt=0)
    maximum_candidates: int = Field(gt=0)
    maximum_cross_club_candidates: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_limits(self) -> "ScrapingControl":
        if self.maximum_cross_club_candidates > self.maximum_candidates:
            raise ValueError("maximum_cross_club_candidates cannot exceed maximum_candidates")
        return self


class PublicAttendanceControl(_ControlModel):
    maximum_shown_people: int = Field(gt=0)


class SocialPreviewsControl(_ControlModel):
    """How a page previews in search results and shared links: the school share
    image the frontend renders at `/og-image.png`, and the longest title and
    description a school page's copy may use before it falls back to a shorter
    form (`frontend/src/shared/lib/seo.ts`)."""

    width: int = Field(ge=600, le=2400)
    height: int = Field(ge=315, le=1260)
    cache_max_age_seconds: int = Field(ge=60, le=604_800)
    title_max_characters: int = Field(ge=30, le=120)
    description_max_characters: int = Field(ge=70, le=320)


class EmailDeliveryControl(_ControlModel):
    provider_timeout_seconds: float = Field(gt=0)
    team_sender: str = Field(min_length=1)
    notification_consent_version: str = Field(min_length=1)
    image_timeout_seconds: float = Field(gt=0, le=60, allow_inf_nan=False)
    image_max_bytes: int = Field(gt=0, le=20_000_000)
    image_quality: int = Field(gt=0, le=95)
    hero_image_px: int = Field(gt=0, le=2400)


class BusinessSupportLimits(_ControlModel):
    business_name: int = Field(gt=0, le=200)
    location: int = Field(gt=0, le=500)
    website: int = Field(gt=0, le=1000)
    discount: int = Field(gt=0, le=500)
    reason_for_support: int = Field(gt=0, le=5000)
    proposed_banner_text: int = Field(gt=0, le=500)
    student_traffic_per_week: int = Field(gt=0, le=500)
    email: int = Field(gt=0, le=254)


class ContactControl(_ControlModel):
    recipient_emails: list[EmailStr] = Field(min_length=1)
    maximum_message_length: int = Field(gt=0, le=20_000)
    rate_limit: RateLimitControl
    business_support: BusinessSupportLimits


class AdminControl(_ControlModel):
    items_per_page: int = Field(gt=0)


_VERIFIED_CLAIM_PROOF_TYPES = (
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/quicktime",
)


class UploadsControl(_ControlModel):
    """Client-facing upload contract, shared verbatim with the frontend picker."""

    event_image_allowed_mime_types: list[str] = Field(min_length=1)
    event_image_max_size_bytes: int = Field(gt=0)
    event_video_max_size_bytes: int = Field(gt=0)
    event_video_download_timeout_seconds: int = Field(gt=0)
    # A claim's proof is a screenshot or a screen recording (an executive
    # logged in to the club's Instagram, say), so it takes the videos phones
    # record as well as images.
    claim_proof_allowed_mime_types: list[str] = Field(min_length=1)
    claim_proof_max_size_bytes: int = Field(gt=0)
    # Posters are stored at this width, so it is the width every viewer gets.
    # 1080 is where the Instagram sources top out; asking for more would store
    # upscaled pixels, and the detail view is the widest place one is shown.
    event_image_rendition_width_pixels: int = Field(ge=640, le=2400)
    event_image_rendition_quality: int = Field(ge=1, le=100)
    # Cards show a WebP thumbnail made once at upload, at most this wide.
    event_image_thumbnail_width_pixels: int = Field(ge=128, le=1080)
    event_image_thumbnail_quality: int = Field(ge=1, le=100)
    # Club logos drawn at 64 CSS px or less (48 px on cards and club pages) show
    # a WebP thumbnail made once at upload, at most this long on its longest
    # side: 144 covers a 48 px logo at 3x. SVG logos are small already.
    club_logo_thumbnail_size_pixels: int = Field(ge=48, le=512)
    club_logo_thumbnail_quality: int = Field(ge=1, le=100)
    # Every thumbnail is stored next to its image, the image's extension
    # replaced by this suffix, which keeps a segment before ".webp" so it never
    # names a WebP image itself.
    thumbnail_suffix: str = Field(pattern=r"^(\.[a-z0-9]+)+\.webp$")

    @model_validator(mode="after")
    def _validate_thumbnail_width(self) -> "UploadsControl":
        if self.event_image_thumbnail_width_pixels >= self.event_image_rendition_width_pixels:
            raise ValueError("event image thumbnails must be narrower than the rendition")
        return self

    @model_validator(mode="after")
    def _validate_mime_types(self) -> "UploadsControl":
        for mime_type in self.event_image_allowed_mime_types:
            if not mime_type.startswith("image/"):
                raise ValueError("event image MIME types must be image/* types")
        if len(self.event_image_allowed_mime_types) != len(
            set(self.event_image_allowed_mime_types)
        ):
            raise ValueError("event image MIME types must be unique")
        # Only types whose bytes the upload check verifies (rust/src/storage.rs).
        for mime_type in self.claim_proof_allowed_mime_types:
            if mime_type not in _VERIFIED_CLAIM_PROOF_TYPES:
                raise ValueError(
                    "claim proof MIME types must be among " + ", ".join(_VERIFIED_CLAIM_PROOF_TYPES)
                )
        if len(self.claim_proof_allowed_mime_types) != len(
            set(self.claim_proof_allowed_mime_types)
        ):
            raise ValueError("claim proof MIME types must be unique")
        return self


class InstagramPublishingControl(_ControlModel):
    cover_body_character_limit: int = Field(gt=0, le=280)
    # A curated slide never carries a single sticker (Tony, 2026-11-27); curation tops a
    # pick up from its event's price, food and registration before refusing it.
    minimum_stickers_per_event: int = Field(ge=1, le=4)
    maximum_stickers_per_event: int = Field(ge=1, le=4)
    sticker_line_character_limit: int = Field(ge=8, le=12)
    sticker_maximum_lines: int = Field(ge=1, le=2)
    sticker_shape_count: int = Field(ge=10, le=10)
    # Curation picks every slide sticker from this fixed list, by school language, so the
    # stickers stay consistent instead of reading as one-off AI copy.
    sticker_labels: dict[Literal["en", "fr"], list[str]]

    graph_api_version: str = Field(pattern=r"^v[0-9]+\.[0-9]+$")
    generation_timezone: str = Field(min_length=1)
    fallback_window_hours: int = Field(gt=0)
    new_event_window_hours: int = Field(gt=0)
    minimum_lead_hours: int = Field(ge=0)
    maximum_lead_days: int = Field(gt=0)
    # Instagram takes ten images: the cover, the event slides and the outro.
    maximum_event_slides: int = Field(gt=0, le=8)
    # A carousel with fewer event slides is never published.
    minimum_event_slides: int = Field(ge=1, le=8)
    # Curation refuses a carousel with more events than this read from one Instagram post
    # (a club's one post listing a week of events filled Berkeley's 11-18 carousel 7 of 8).
    maximum_slides_per_post: int = Field(ge=1, le=8)
    status_poll_interval_seconds: float = Field(gt=0, le=60)
    meta_poll_attempts: int = Field(gt=0, le=30)
    meta_poll_interval_seconds: float = Field(gt=0, le=30)
    meta_request_timeout_seconds: float = Field(gt=0, le=120)
    token_lifetime_days: int = Field(gt=0, le=90)
    token_refresh_lead_days: int = Field(gt=0, le=30)

    curation_model: str = Field(min_length=1)
    curation_parallel_agents: int = Field(ge=1, le=16)
    curation_attempts: int = Field(ge=1, le=5)
    curation_timeout_seconds: int = Field(ge=60, le=7200)
    curation_poster_pixels: int = Field(ge=128, le=2048)
    # Later runs draft only schools still missing today's draft, so one failed run is retried.
    curation_hours: tuple[Annotated[int, Field(ge=0, le=23)], ...] = Field(min_length=1)
    curation_minute: int = Field(ge=0, le=59)
    # Right after curation saves a draft, a second agent checks every slide against the
    # promotion rules and takes off any that fails them before a sitting can post it.
    draft_audit_model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    draft_audit_timeout_seconds: int = Field(ge=60, le=3600)
    # The Claude login the draft audit and the curation quality test run on, never the
    # one ingestion runs on.
    quality_claude_config_dir: str = Field(min_length=1)
    poster_timeout_seconds: float = Field(gt=0, le=120)
    # Right after a sitting posts a carousel, the Mac's emulator likes, reposts and adds a
    # song to it; a carousel posted outside a sitting is tried again music_retry_minutes
    # after a failed try, up to music_attempts tries within music_max_age_hours.
    music_model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    music_agent_timeout_seconds: int = Field(gt=0, le=600)
    music_max_age_hours: int = Field(ge=1, le=72)
    music_attempts: int = Field(ge=1, le=10)
    # On a carousel's first song try, also comment a fitting movie or show GIF.
    gif_comments: bool
    # The GIF scene picker is shown this many of the latest searches, so it never repeats one.
    gif_recent_searches: int = Field(ge=1, le=200)
    music_retry_minutes: int = Field(ge=1, le=720)
    # After a carousel publishes, the emulator worker shares each of its events' original
    # posts to the account's story, in slide order, during action hours and only while the
    # carousel is at most story_max_age_hours old.
    share_event_posts_to_story: bool
    story_max_age_hours: int = Field(ge=1, le=24)
    # Campuses with large Asian student communities, the only ones that get a song an
    # admin marked as Asian or K-pop.
    asian_song_schools: list[Annotated[str, Field(pattern=r"^[a-z0-9-]{1,80}$")]] = Field(
        max_length=100
    )
    # French-language campuses, the only ones that get a song an admin marked as French,
    # and which play nothing else. Listed by hand rather than read from schools.language,
    # which also marks Memorial (an English campus) French.
    french_song_schools: list[Annotated[str, Field(pattern=r"^[a-z0-9-]{1,80}$")]] = Field(
        max_length=100
    )
    # When not empty, the asian_song_schools play only these songs (typed like an admin's
    # song list), in place of the songs marked Asian or K-pop. Empty it to go back to them.
    asian_song_override: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(
        max_length=20
    )
    # The daily stats run keeps each account's newest posts and this many days of follower counts.
    stats_media_limit: int = Field(ge=1, le=100)
    stats_history_days: int = Field(ge=2, le=365)
    launch_agent_timeout_seconds: float = Field(gt=0, le=120)

    @model_validator(mode="after")
    def validate_token_windows(self) -> "InstagramPublishingControl":
        if self.token_refresh_lead_days >= self.token_lifetime_days:
            raise ValueError("instagram token refresh lead must be shorter than token lifetime")
        if self.minimum_stickers_per_event > self.maximum_stickers_per_event:
            raise ValueError("instagram minimum stickers per event must not exceed the maximum")
        return self


class InstagramBrowserControl(_ControlModel):
    parallel_tabs: int = Field(ge=2, le=100)
    tab_health_interval_seconds: float = Field(ge=1, le=300)
    ingestion_retry_limit: int = Field(gt=0, le=10)
    profile_post_limit: int = Field(gt=0, le=50)
    # Club logos come from profile retrievals: a few at a time, capped per day.
    school_switcher_username_overrides: dict[
        Annotated[str, Field(pattern=r"^[a-z0-9_]+$")],
        Annotated[str, Field(pattern=r"^wat2do\.[a-z0-9_]+$", max_length=30)],
    ]
    bootstrap_profile_school: str = Field(pattern=r"^[a-z0-9_]{1,23}$")
    bridge_retry_limit: int = Field(gt=0, le=10)
    storage_busy_timeout_seconds: float = Field(gt=0, le=10, allow_inf_nan=False)
    storage_retry_limit: int = Field(ge=1, le=10)
    storage_retry_interval_seconds: float = Field(gt=0, le=30, allow_inf_nan=False)
    request_timeout_seconds: float = Field(gt=0, le=120)
    apple_event_timeout_seconds: float = Field(gt=0, le=120)
    navigation_interval_seconds: float = Field(gt=0, le=30)
    rate_limit_backoff_seconds: float = Field(gt=0, le=3600)
    rate_limit_max_backoff_seconds: float = Field(gt=0, le=3600)
    rate_limit_recovery_seconds: float = Field(gt=0, le=86400)
    viewport_warm_timeout_seconds: float = Field(gt=0, le=120)
    primary_minimum_viewport_width: int = Field(ge=1024, le=4096)
    worker_window_height: int = Field(ge=600, le=2160)
    worker_window_idle_seconds: float = Field(ge=0, le=60)
    worker_window_idle_wait_seconds: float = Field(ge=0, le=60)
    login_recovery_timeout_seconds: float = Field(gt=0, le=300)
    login_recovery_interval_seconds: float = Field(ge=0, le=86400)
    login_recovery_retry_seconds: float = Field(ge=0, le=3600)
    # After the base spacing above, each further attempt within the backoff window doubles
    # the wait, up to the longest wait: Brave never stays logged out for a day.
    login_recovery_max_interval_seconds: float = Field(gt=0, le=86400)
    login_recovery_backoff_window_seconds: float = Field(gt=0, le=86400)
    account_login_daily_limit: int = Field(ge=0, le=100)
    # A missing account's login starts only this long after the last password went out,
    # so a burst of reruns never sends Instagram many logins at once.
    account_login_spacing_seconds: float = Field(ge=0, le=3600)
    login_from_school: str = Field(min_length=1)
    login_keychain_service: str = Field(min_length=1)
    login_code_email: str = Field(min_length=3)
    login_code_keychain_service: str = Field(min_length=1)
    login_code_imap_host: str = Field(min_length=1)
    login_code_wait_seconds: float = Field(gt=0, le=120)
    interaction_timeout_seconds: float = Field(gt=0, le=120)
    account_transition_grace_seconds: float = Field(gt=0, le=120)
    secondary_cleanup_timeout_seconds: float = Field(gt=0, le=120)
    cancellation_confirm_retry_seconds: float = Field(gt=0, le=3600)
    # An uncertain like or repost pauses the worker at least this long; then the worker
    # settles its tabs and resumes by itself (the engagement is never replayed).
    uncertain_engagement_hold_seconds: float = Field(ge=60, le=86400)
    poll_interval_seconds: float = Field(gt=0, le=5)
    worker_poll_interval_seconds: float = Field(gt=0, le=10)
    job_timeout_seconds: float = Field(gt=0, le=300)
    result_timeout_seconds: float = Field(gt=0, le=1800)
    source_poll_interval_seconds: float = Field(ge=10, le=3600)
    source_page_size: int = Field(gt=0, le=1000)
    worker_log_max_bytes: int = Field(ge=65536, le=67108864)
    worker_log_backup_count: int = Field(ge=1, le=10)
    engagement_interval_seconds: float = Field(ge=1, le=3600)
    engagement_max_wait_seconds: float = Field(ge=1, le=3600)
    # Following list reads for the follow crawl: one page of this many accounts per job,
    # a random pause in the page window before each next page of a list and in the list
    # window before each new list, and at most this many reads within any hour. A 429 or
    # a login wall on one holds only these reads. Finished reads are kept this long for
    # the crawl to collect, then deleted.
    following_page_size: int = Field(ge=12, le=200)
    following_page_delay_min_seconds: float = Field(ge=1, le=600, allow_inf_nan=False)
    following_page_delay_max_seconds: float = Field(ge=1, le=600, allow_inf_nan=False)
    following_list_delay_min_seconds: float = Field(ge=1, le=3600, allow_inf_nan=False)
    following_list_delay_max_seconds: float = Field(ge=1, le=3600, allow_inf_nan=False)
    following_requests_per_hour: int = Field(ge=1, le=3600)
    following_result_retention_seconds: float = Field(ge=600, le=604_800, allow_inf_nan=False)
    actions: tuple[Literal["like", "save", "repost"], ...] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def validate_worker(self) -> "InstagramBrowserControl":
        if len(self.actions) != len(set(self.actions)):
            raise ValueError("Instagram browser actions must be unique")
        if self.result_timeout_seconds <= self.job_timeout_seconds:
            raise ValueError("Instagram browser result timeout must exceed job timeout")
        if self.secondary_cleanup_timeout_seconds > self.interaction_timeout_seconds:
            raise ValueError("Secondary cleanup timeout must not exceed interaction timeout")
        if self.account_transition_grace_seconds > self.interaction_timeout_seconds:
            raise ValueError("Account transition grace must not exceed interaction timeout")
        if (
            self.login_recovery_timeout_seconds
            < self.login_code_wait_seconds + self.interaction_timeout_seconds
        ):
            # A submitted login waits for its emailed code inside the recovery's deadline.
            raise ValueError(
                "Login recovery timeout must cover the security code wait and its entry"
            )
        if self.login_recovery_max_interval_seconds < self.login_recovery_interval_seconds:
            raise ValueError("Login recovery's longest wait must not be shorter than its spacing")
        if self.viewport_warm_timeout_seconds > self.request_timeout_seconds:
            raise ValueError("Viewport warm timeout must not exceed browser request timeout")
        if self.apple_event_timeout_seconds > self.request_timeout_seconds:
            raise ValueError("Apple Event timeout must not exceed browser request timeout")
        if (
            self.navigation_interval_seconds * (self.parallel_tabs - 1)
            >= self.request_timeout_seconds
        ):
            raise ValueError("Navigation spacing must fit the parallel tab request budget")
        if self.rate_limit_backoff_seconds >= self.result_timeout_seconds:
            raise ValueError("Rate limit backoff must be shorter than the result timeout")
        if self.rate_limit_max_backoff_seconds < self.rate_limit_backoff_seconds:
            raise ValueError("Maximum rate limit backoff must include the initial backoff")
        if self.rate_limit_recovery_seconds < self.rate_limit_backoff_seconds:
            raise ValueError("Rate limit recovery must include the initial backoff")
        if self.following_page_delay_min_seconds > self.following_page_delay_max_seconds:
            raise ValueError("following_page_delay_min_seconds must not exceed the maximum")
        if self.following_list_delay_min_seconds > self.following_list_delay_max_seconds:
            raise ValueError("following_list_delay_min_seconds must not exceed the maximum")
        if (
            self.storage_busy_timeout_seconds * self.storage_retry_limit
            + self.storage_retry_interval_seconds * (self.storage_retry_limit - 1)
            >= self.job_timeout_seconds
        ):
            raise ValueError("Storage retry budget must fit inside the browser job timeout")
        return self


class NotificationWorkflowControl(_ControlModel):
    """The process-notification workflow's Rust binary build and step budgets."""

    minimum_free_disk_mb: int = Field(ge=512, le=65536)
    # The runner's cached Rust build is cleared above this size, then rebuilt.
    build_target_max_mb: int = Field(ge=1024, le=65536)
    build_jobs: int = Field(ge=1, le=16)
    # The Mac keeps this many recently used builds so reruns of older commits reuse theirs.
    binaries_to_keep: int = Field(ge=1, le=20)
    build_timeout_minutes: int = Field(ge=5, le=60)
    process_timeout_minutes: int = Field(ge=6, le=60)


class RunnerSetupControl(_ControlModel):
    runner_count: int = Field(ge=1, le=10)
    runner_version: str = Field(pattern=r"^[0-9]+\.[0-9]+\.[0-9]+$")
    download_timeout_seconds: int = Field(ge=30, le=1800)
    download_connect_timeout_seconds: int = Field(ge=1, le=60)
    download_retry_limit: int = Field(ge=0, le=5)
    setup_timeout_seconds: int = Field(ge=30, le=1800)
    log_retention_days: int = Field(ge=1, le=30)
    log_page_size_megabytes: int = Field(ge=1, le=64)

    @model_validator(mode="after")
    def validate_download_timeout(self) -> "RunnerSetupControl":
        if self.download_connect_timeout_seconds > self.download_timeout_seconds:
            raise ValueError("Runner connection timeout must fit the download timeout")
        return self


class InstagramBellSetupControl(_ControlModel):
    command_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    dump_retry_limit: int = Field(ge=0, le=5)
    max_consecutive_dump_failures: int = Field(ge=1, le=10)
    verification_retry_limit: int = Field(ge=1, le=5)
    stale_scroll_limit: int = Field(ge=1, le=10)
    run_timeout_seconds: float = Field(gt=0, le=7200, allow_inf_nan=False)
    safe_y_min: int = Field(ge=0, le=4096)
    safe_y_max: int = Field(gt=0, le=8192)
    bell_x_min: int = Field(ge=0, le=4096)
    tap_settle_seconds: float = Field(gt=0, le=10, allow_inf_nan=False)
    scroll_settle_seconds: float = Field(gt=0, le=10, allow_inf_nan=False)
    dump_retry_delay_seconds: float = Field(gt=0, le=10, allow_inf_nan=False)
    ui_poll_interval_seconds: float = Field(gt=0, le=5, allow_inf_nan=False)
    ui_wait_timeout_seconds: float = Field(gt=0, le=30, allow_inf_nan=False)
    menu_open_timeout_seconds: float = Field(gt=0, le=30, allow_inf_nan=False)
    selection_settle_seconds: float = Field(gt=0, le=10, allow_inf_nan=False)
    max_menu_close_attempts: int = Field(ge=1, le=10)
    unavailable_ui_delay_seconds: float = Field(gt=0, le=10, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_deadlines_and_bounds(self) -> "InstagramBellSetupControl":
        if self.safe_y_max <= self.safe_y_min:
            raise ValueError("Bell setup safe_y_max must exceed safe_y_min")
        if self.run_timeout_seconds <= self.command_timeout_seconds:
            raise ValueError("Bell setup run timeout must exceed command timeout")
        return self


class InstagramDigestControl(_ControlModel):
    endpoint_url: HttpUrl
    operation_name: Literal["SubscriptionDigestFeedQuery"]
    client_doc_id: str = Field(pattern=r"^[0-9]{20,40}$")
    web_app_id: str = Field(pattern=r"^[0-9]{10,20}$")
    maximum_pages: int = Field(gt=0, le=100)
    # The browser the worker reads digests with; Lightpanda runs in shadow mode first.
    digest_engine: Literal["brave", "lightpanda"]

    @model_validator(mode="after")
    def validate_endpoint(self) -> "InstagramDigestControl":
        if self.endpoint_url.host != "i.instagram.com":
            raise ValueError("Instagram digest endpoint must use i.instagram.com")
        if self.endpoint_url.path != "/graphql/query":
            raise ValueError("Instagram digest endpoint must use /graphql/query")
        return self


class FollowerTierControl(_ControlModel):
    below: int = Field(gt=0)
    factor: float = Field(gt=0, le=1)


class InstagramAccountGuardControl(_ControlModel):
    """How much each school account may read Following lists, and its breaker.

    The browser worker (``rust/src/instagram_notifications/browser_queue_guard.rs``)
    reads this file live from the checkout it was built from, so a change applies within
    seconds without a reinstall. A refusal (429, refused, a page in place of JSON) holds
    the account's reads ``refusal_hold_hours``, each refusal in a row
    ``refusal_backoff_factor`` times longer; ``breaker_refusal_streak`` refusals in a row,
    a login wall, an ended login or a security check open its breaker (no automated
    traffic until a person resets it).
    """

    refusal_hold_hours: float = Field(gt=0, le=168)
    refusal_backoff_factor: float = Field(ge=1, le=10)
    refusal_max_hold_hours: float = Field(gt=0, le=720)
    refusal_streak_reset_hours: float = Field(gt=0, le=720)
    breaker_refusal_streak: int = Field(ge=1, le=50)
    # A large, established account's Following reads a day and an hour; smaller and
    # newer accounts get the first matching tier's factor, times new_account_factor.
    daily_following_reads: float = Field(gt=0, le=20000)
    hourly_following_reads: float = Field(gt=0, le=3600)
    minimum_daily_following_reads: float = Field(ge=0, le=20000)
    follower_tiers: list[FollowerTierControl]
    new_account_days: float = Field(ge=0, le=3650)
    new_account_factor: float = Field(gt=0, le=1)
    # Named accounts' reads a day, in place of the scaled number (0 stops them).
    account_daily_following_reads: dict[str, float]
    size_refresh_hours: float = Field(gt=0, le=168)

    @model_validator(mode="after")
    def validate_hold_and_tiers(self) -> "InstagramAccountGuardControl":
        if self.refusal_max_hold_hours < self.refusal_hold_hours:
            raise ValueError("refusal_max_hold_hours must be at least refusal_hold_hours")
        belows = [tier.below for tier in self.follower_tiers]
        if belows != sorted(set(belows)):
            raise ValueError("follower_tiers must be in rising order of below")
        if any(reads < 0 for reads in self.account_daily_following_reads.values()):
            raise ValueError("account_daily_following_reads must not be negative")
        return self


class InstagramLightpandaControl(_ControlModel):
    """Lightpanda, the light headless browser that reads Instagram digests per account.

    The worker installs the pinned release (its download must match ``sha256``) and runs
    one process per school account with that account's own cookie jar.
    """

    version: str = Field(pattern=r"^[0-9]+[.][0-9]+[.][0-9]+$")
    download_url: HttpUrl
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    startup_timeout_seconds: float = Field(gt=0, le=120)
    navigation_timeout_seconds: float = Field(gt=0, le=300)
    shutdown_timeout_seconds: float = Field(gt=0, le=60)
    login_wait_seconds: float = Field(gt=0, le=300)
    login_poll_seconds: float = Field(gt=0, le=30)
    # Accounts logging in to Lightpanda for the first time, a new device to Instagram, per day.
    new_login_daily_limit: int = Field(ge=0, le=50)
    # Most Lightpanda processes open at once on the Mac (about 250 MB each), across the
    # worker's sessions and any wat2do-lightpanda command.
    max_sessions: int = Field(ge=1, le=8)
    # A worker session closes after this long without a job, or this long after it opened.
    session_idle_seconds: float = Field(gt=0, le=3600)
    session_max_seconds: float = Field(gt=0, le=86400)
    # Brave stops leaving an account's digests and the Following reads to Lightpanda when
    # the worker's Lightpanda lane has not said it is running for this long.
    lane_stale_seconds: float = Field(ge=5, le=600)
    # A lane digest gets this long in all, opening its session included, and Brave takes
    # one the lane has left waiting this long, so a digest always meets the workflow's
    # deadline. A lane Following read (about a second) gets the third.
    lane_digest_timeout_seconds: float = Field(gt=0, le=150)
    lane_digest_wait_seconds: float = Field(gt=0, le=120)
    lane_following_timeout_seconds: float = Field(gt=0, le=120)
    # The worker logs one more account in to Lightpanda at most this often, the accounts
    # with the most digests in the last ramp_lookback_days first, ramp_last_accounts last.
    ramp_interval_minutes: float = Field(ge=10, le=1440)
    ramp_lookback_days: int = Field(ge=1, le=60)
    # The ramp never spends the day's last ramp_reserved_logins logins, which Brave needs.
    ramp_reserved_logins: int = Field(ge=0, le=50)
    ramp_last_accounts: tuple[str, ...]
    # Shadow mode replays Brave's recent digests in Lightpanda and compares the media IDs.
    shadow_lookback_hours: float = Field(gt=0, le=168)
    shadow_jobs_per_account: int = Field(ge=1, le=50)
    shadow_digest_pause_seconds: float = Field(ge=0, le=600)
    shadow_account_pause_seconds: float = Field(ge=0, le=3600)

    @model_validator(mode="after")
    def validate_download(self) -> "InstagramLightpandaControl":
        if self.lane_digest_wait_seconds + self.lane_digest_timeout_seconds > 180:
            # Brave still needs time for a digest the lane hands back within the
            # workflow's 300 s wait.
            raise ValueError("lane digest wait and timeout cannot exceed 180 seconds together")
        if self.session_idle_seconds > self.session_max_seconds:
            raise ValueError("session_idle_seconds cannot exceed session_max_seconds")
        if any(not re.fullmatch(r"wat2do[.][a-z0-9_]+", name) for name in self.ramp_last_accounts):
            raise ValueError("ramp_last_accounts must name wat2do school accounts")
        if self.download_url.host != "github.com":
            raise ValueError("Lightpanda downloads must come from its GitHub releases")
        if f"/releases/download/{self.version}/" not in (self.download_url.path or ""):
            raise ValueError("Lightpanda's download must be the pinned version's release")
        return self


class MaintenanceControl(_ControlModel):
    """The hourly watchdog (`jobs/maintain_wat2do.py watchdog`) and the daily maintenance agent."""

    watchdog_interval_minutes: int = Field(ge=10, le=240)
    # The maintenance agent runs every day from this Toronto time, whatever the watchdog saw.
    agent_hour: int = Field(ge=0, le=23)
    agent_minute: int = Field(ge=0, le=59)
    # Its model and the Claude Code login it runs on, apart from the one ingestion uses.
    model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    claude_config_dir: str = Field(pattern=r"^~?/[A-Za-z0-9._/-]+$")
    agent_timeout_minutes: int = Field(ge=10, le=360)
    # One Bash call of the agent may run this long (a build, a relogin).
    move_timeout_minutes: int = Field(ge=2, le=60)
    # A red check starts the agent at once, at most once per problem in this many hours
    # and at most this many extra runs a day.
    trigger_debounce_hours: float = Field(gt=0, le=24, allow_inf_nan=False)
    triggered_runs_per_day: int = Field(ge=0, le=24)
    report_dir: str = Field(pattern=r"^~?/[A-Za-z0-9._/ -]+$")
    launch_agent_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    # Each Claude login is asked for one word with this model to see it is not limited.
    probe_model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    probe_timeout_seconds: int = Field(ge=10, le=600)
    command_timeout_seconds: int = Field(ge=5, le=600)
    # Instagram items in the last window against the median of the same window on each
    # of the baseline days; a day's total the same way. A school is dark when its last
    # day is under its ratio of a baseline at least the minimum.
    ingestion_window_hours: int = Field(ge=1, le=24)
    baseline_days: int = Field(ge=2, le=28)
    ingestion_window_min_ratio: float = Field(gt=0, lt=1, allow_inf_nan=False)
    ingestion_window_min_baseline: int = Field(ge=1)
    ingestion_day_min_ratio: float = Field(gt=0, lt=1, allow_inf_nan=False)
    ingestion_silence_minutes: int = Field(ge=10, le=1440)
    school_dark_min_baseline: int = Field(ge=1)
    school_dark_ratio: float = Field(gt=0, lt=1, allow_inf_nan=False)
    # A school with no daily digest for `school_digest_hours` should still be read by the
    # quiet-school lane: under `school_low_ratio` of its baseline, the lane is not
    # covering it. Keep it a few hours past the lane's own `quiet_school_digest_hours`,
    # so the lane has had time to read the school before the watchdog judges it.
    school_low_ratio: float = Field(gt=0, lt=1, allow_inf_nan=False)
    school_digest_hours: int = Field(ge=1, le=96)
    brave_heartbeat_max_seconds: int = Field(ge=30, le=7200)
    brave_window_hours: int = Field(ge=1, le=48)
    brave_job_failure_ratio: float = Field(gt=0, lt=1, allow_inf_nan=False)
    brave_job_min_jobs: int = Field(ge=1)
    brave_error_lines_per_hour: int = Field(ge=1)
    # Refused Following reads (429, refused, a page in place of JSON, a login wall) per
    # account in an hour at or over this turn the following_guard check red.
    following_errors_per_account_hour: int = Field(ge=1)
    # Instagram is quiet at night: silence between local midnight and
    # `recorder_quiet_until_hour` does not count toward `recorder_silence_minutes`.
    recorder_silence_minutes: int = Field(ge=10, le=1440)
    recorder_quiet_until_hour: int = Field(ge=0, le=12)
    recorder_user_silence_hours: int = Field(ge=1, le=72)
    digest_silence_hours: int = Field(ge=1, le=96)
    # A school account on the emulator with no Instagram notification of any kind recorded
    # for this long turns account_notifications red (2026-11-28: wat2do.berkeley went 9
    # days without one while every Android user, and so the recorder check, stayed green).
    account_silence_hours: int = Field(ge=1, le=168)
    # Accounts that check leaves out, by username (none by default).
    account_silence_excluded: tuple[Annotated[str, Field(pattern=r"^[a-z0-9._]+$")], ...] = ()
    dispatch_waiting_max: int = Field(ge=1)
    workflow_file: str = Field(pattern=r"^[a-z0-9-]+\.ya?ml$")
    workflow_window_hours: int = Field(ge=1, le=48)
    workflow_failure_ratio: float = Field(gt=0, lt=1, allow_inf_nan=False)
    workflow_min_runs: int = Field(ge=1)
    queued_run_max_minutes: int = Field(ge=5, le=1440)
    notification_agent_error_ratio: float = Field(gt=0, lt=1, allow_inf_nan=False)
    notification_agent_min_reports: int = Field(ge=1)
    runners: tuple[Annotated[str, Field(pattern=r"^[A-Za-z0-9_.-]+$")], ...] = Field(min_length=1)
    emulator_restarts_per_day: int = Field(ge=1)
    qemu_cpu_percent: int = Field(ge=50, le=2000)
    disk_free_gb_yellow: float = Field(gt=0, allow_inf_nan=False)
    disk_free_gb_red: float = Field(gt=0, allow_inf_nan=False)
    swap_used_gb_red: float = Field(gt=0, allow_inf_nan=False)
    # LaunchAgents that must always have a process, and timers that must stay loaded
    # with a clean last exit.
    keep_alive_agents: tuple[Annotated[str, Field(pattern=r"^[A-Za-z0-9_.-]+$")], ...]
    scheduled_agents: tuple[Annotated[str, Field(pattern=r"^[A-Za-z0-9_.-]+$")], ...]
    retry_log_max_minutes: int = Field(ge=10, le=1440)
    # From these Toronto hours, today's sittings and carousels should have happened.
    sittings_check_hour: int = Field(ge=0, le=23)
    carousels_check_hour: int = Field(ge=0, le=23)
    snapshot_max_age_days: int = Field(ge=0, le=14)
    # Every approved club's Instagram account should be in the follow queue within the
    # worker's hourly club sync, and an approved account followed within this many days.
    follow_sync_hours: int = Field(ge=2, le=72)
    follow_backlog_days: int = Field(ge=1, le=60)

    @model_validator(mode="after")
    def validate_thresholds(self) -> "MaintenanceControl":
        if self.school_dark_ratio >= self.school_low_ratio:
            raise ValueError("school_dark_ratio must be below school_low_ratio")
        if self.disk_free_gb_red >= self.disk_free_gb_yellow:
            raise ValueError("disk_free_gb_red must be below disk_free_gb_yellow")
        if set(self.keep_alive_agents) & set(self.scheduled_agents):
            raise ValueError("a LaunchAgent is either kept alive or scheduled")
        return self


class WorkflowFailureAlertsControl(_ControlModel):
    discord_admin_role_ids: tuple[str, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_discord_role_ids(self) -> "WorkflowFailureAlertsControl":
        role_ids = self.discord_admin_role_ids
        if len(role_ids) != len(set(role_ids)):
            raise ValueError("Discord admin role IDs must be unique")
        if any(not role_id.isdigit() or not 17 <= len(role_id) <= 20 for role_id in role_ids):
            raise ValueError("Discord admin role IDs must be 17 to 20 digit snowflakes")
        return self


class PromoterQrPlacementControl(_ControlModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def validate_bounds(self) -> "PromoterQrPlacementControl":
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("promoter template QR placement must fit inside the asset")
        return self


class PromoterTemplateControl(_ControlModel):
    id: str = Field(
        min_length=1,
        max_length=100,
        pattern=r"^[a-z0-9][a-z0-9-]*$",
    )
    name: str = Field(min_length=1, max_length=100)
    asset_path: str = Field(
        min_length=1,
        max_length=255,
        pattern=r"^/poster-templates/[a-z0-9][a-z0-9-]*-v[0-9]+[.]png$",
    )
    eligible_school: str = Field(
        min_length=1,
        max_length=255,
        pattern=r"^(global|[a-z0-9][a-z0-9-]*)$",
    )
    print_size: Literal["us-letter"]
    orientation: Literal["portrait"]
    qr_placement: PromoterQrPlacementControl
    preview_description: str = Field(min_length=1, max_length=500)
    available_for_creation: bool


class PromoterProgramControl(_ControlModel):
    enabled: bool
    rate_cents: int = Field(gt=0)
    maximum_active_posters: int = Field(gt=0)
    landing_confirmation_seconds: int = Field(gt=0)
    confirmation_token_minutes: int = Field(gt=0)
    payout_day_of_month: int = Field(ge=1, le=28)
    quiet_poster_days: int = Field(gt=0)
    discord_invite_url: HttpUrl
    map_coordinate_decimal_places: int = Field(ge=1, le=5)
    map_visitor_bucket_maximums: tuple[int, int, int]
    risk_rules_version: str = Field(min_length=1, max_length=64)
    rapid_distinct_visitors: int = Field(gt=1)
    rapid_window_seconds: int = Field(gt=0)
    rapid_rule_points: int = Field(gt=0)
    hold_score_threshold: int = Field(gt=0)
    tos_version: str = Field(min_length=1, max_length=64)
    approved_templates: tuple[PromoterTemplateControl, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_promoter_controls(self) -> "PromoterProgramControl":
        maxima = self.map_visitor_bucket_maximums
        if maxima[0] != 0 or list(maxima) != sorted(set(maxima)):
            raise ValueError(
                "map visitor bucket maximums must start at zero and be unique and ascending"
            )
        template_ids = [template.id for template in self.approved_templates]
        if len(template_ids) != len(set(template_ids)):
            raise ValueError("promoter template IDs must be unique")
        asset_paths = [template.asset_path for template in self.approved_templates]
        if len(asset_paths) != len(set(asset_paths)):
            raise ValueError("promoter template asset paths must be unique")
        return self


class GoogleAnalyticsControl(_ControlModel):
    measurement_id: str = Field(pattern=r"^(G-[A-Z0-9]+)?$")


class DiscoveryQueriesControl(_ControlModel):
    excluded_account_emails: tuple[EmailStr, ...]
    maximum_search_length: int = Field(gt=0)
    maximum_page_url_length: int = Field(gt=0)
    maximum_filters_bytes: int = Field(gt=0)
    request_timeout_ms: int = Field(gt=0)
    retry_delays_ms: tuple[int, ...] = Field(min_length=1)
    rate_limit: RateLimitControl

    @model_validator(mode="after")
    def validate_retry_delays(self) -> "DiscoveryQueriesControl":
        if any(delay <= 0 for delay in self.retry_delays_ms):
            raise ValueError("retry delays must be positive")
        return self


class PositionsControl(_ControlModel):
    undated_visibility_months: int = Field(gt=0, le=12)


class ClubDirectoryListingControl(_ControlModel):
    """One listing request; ``{page}`` in the URL or JSON body pages through it from 1."""

    url: str = Field(pattern=r"^https://\S+$", max_length=2048)
    # Sent as a JSON POST body; without one the listing is a plain GET.
    body: str | None = Field(default=None, min_length=2, max_length=2000)


class ClubDirectoryControl(_ControlModel):
    """A school's official club directory, read by a club directory agent."""

    name: str = Field(min_length=1, max_length=100)
    schools: list[Annotated[str, Field(pattern=r"^[a-z0-9-]{1,80}$")]] = Field(
        min_length=1, max_length=10
    )
    listings: list[ClubDirectoryListingControl] = Field(min_length=1, max_length=50)
    # What the agent needs to know about this directory that its listing does not say.
    notes: str = Field(default="", max_length=1000)


class IngestionControl(_ControlModel):
    model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    parallel_agents: int = Field(ge=1, le=16)
    fetch_lanes: int = Field(ge=1, le=16)
    fetch_impersonate: str = Field(pattern=r"^[a-z0-9_]+$")
    fetch_block_pause_seconds: int = Field(gt=0, le=86400)
    retry_backoff_seconds: int = Field(gt=0, le=86400)
    # How long a lane waits to retry, and the queue listener to reconnect, after a database error.
    database_retry_seconds: float = Field(gt=0, le=300)
    # The queue listener notifies itself this often to prove its connection still delivers.
    listener_probe_seconds: float = Field(ge=5, le=600)
    directory_agents: int = Field(ge=1, le=16)
    directory_items_per_run: int = Field(ge=1, le=200)
    directory_horizon_days: int = Field(ge=1, le=365)
    directory_listing_max_bytes: int = Field(gt=0, le=50_000_000)
    directory_model_timeout_seconds: int = Field(gt=0, le=3600)
    directory_scrape_interval_seconds: int = Field(ge=3600, le=86400)
    # Club directory agents read each club directory's listing this often; the club pages
    # they find are read a few at a time on every directory run, and again after a while.
    club_directory_scan_days: int = Field(ge=1, le=90)
    club_directory_max_listing_pages: int = Field(ge=1, le=200)
    club_directory_pages_per_run: int = Field(ge=1, le=5000)
    club_directory_page_delay_seconds: float = Field(ge=0, le=60, allow_inf_nan=False)
    club_directory_recheck_days: int = Field(ge=1, le=365)
    claim_lease_seconds: int = Field(gt=0, le=86400)
    max_attempts: int = Field(ge=1, le=10)
    # Claude counts as unavailable after this many failed agent runs in a row; then, or when
    # its usage limit names no reset time, agents pause this long without spending attempts.
    agent_failure_streak: int = Field(ge=2, le=1000)
    agent_pause_seconds: int = Field(ge=60, le=86400)
    model_timeout_seconds: int = Field(gt=0, le=1800)
    max_images_per_item: int = Field(ge=0, le=20)
    fetch_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    # Club logo profile reads share the Mac's IP with post fetches, so they are spaced out.
    club_logo_read_delay_seconds: float = Field(ge=0, le=3600, allow_inf_nan=False)
    club_logo_retry_days: int = Field(gt=0, le=365)
    # A profile Lightpanda did not render (timed out or failed) is read again after this many
    # hours instead of the retry days.
    club_logo_failed_retry_hours: int = Field(ge=1, le=720)
    # The list of handles to read is built again this often, so a club that is new or just got
    # a handle is read without waiting for the list to run out.
    club_logo_relist_minutes: int = Field(ge=1, le=1440)
    # Lightpanda, relative to the home folder; it renders club profiles logged out.
    profile_renderer: str = Field(min_length=1, max_length=200)
    profile_render_timeout_seconds: float = Field(gt=0, le=300, allow_inf_nan=False)
    # Instagram does not push every school its posts every day. A school with no post or
    # digest notification for this long has its active followed clubs' profiles rendered
    # logged out (this many at a time, spaced out), each again only after the reread hours, and
    # their posts from the last few days are queued (rust/src/ingestion/quiet_schools.rs).
    quiet_school_hours: int = Field(ge=1, le=168)
    # A bell push carries one post and the digest the day's, so a school whose last digest
    # is older than this is read the same way even while bell pushes keep coming.
    quiet_school_digest_hours: int = Field(ge=1, le=168)
    quiet_school_lanes: int = Field(ge=0, le=8)
    quiet_school_read_delay_seconds: float = Field(ge=0, le=600, allow_inf_nan=False)
    quiet_school_reread_hours: int = Field(ge=1, le=168)
    # The list of clubs to read is built again this often, so a school that goes quiet
    # joins it (and one notified again leaves it) without waiting for the list to run out.
    quiet_school_relist_minutes: int = Field(ge=1, le=1440)
    quiet_school_post_days: int = Field(ge=1, le=14)
    # Only clubs with an event added within the active days, or followed within the new
    # follow days (too new to have events), are read.
    quiet_school_active_days: int = Field(ge=1, le=730)
    quiet_school_new_follow_days: int = Field(ge=1, le=365)
    launch_agent_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    # The API server draws the title of every featured event to come (title_svgs.rs), this
    # many at a time, up to this many drawings an event until one is kept, then again after
    # this many hours; it looks for newly featured events this often.
    title_svg_lanes: int = Field(ge=1, le=12)
    title_svg_attempts: int = Field(ge=1, le=10)
    title_svg_retry_hours: int = Field(ge=1, le=168)
    title_svg_poll_seconds: int = Field(ge=10, le=3600)
    # Schools whose student clubs post too few events, so their listings also carry the
    # events the university itself runs and their university accounts are followed. The
    # ingestion, directory and follow-scoring prompts read it as {{lists_university_events}}.
    university_event_schools: list[Annotated[str, Field(pattern=r"^[a-z0-9-]{1,80}$")]] = Field(
        max_length=100
    )
    # Official club directories whose clubs' Instagram accounts are queued for following.
    club_directories: list[ClubDirectoryControl] = Field(max_length=200)

    @model_validator(mode="after")
    def validate_budgets(self) -> "IngestionControl":
        if self.claim_lease_seconds <= self.model_timeout_seconds:
            raise ValueError("Ingestion claims must outlive one model call")
        names = [directory.name for directory in self.club_directories]
        if len(set(names)) != len(names):
            raise ValueError("Club directory names must be unique")
        return self


class InstagramFollowControl(_ControlModel):
    """Finding clubs a school account should follow, reviewing them, and following them."""

    # Sonnet scores each found account from its newest posts, this many per agent run;
    # a score this high starts approved in the admin review.
    model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    agent_timeout_seconds: int = Field(gt=0, le=1800)
    score_batch_size: int = Field(ge=1, le=50)
    auto_approve_score: int = Field(ge=0, le=100)
    # Automated rejections that posted within a year are scored again this often.
    recheck_days: int = Field(ge=7, le=180)
    recheck_batch_size: int = Field(ge=0, le=1000)
    # Logged-out profile reads share the Mac's IP with ingestion, so they are spaced out.
    profile_read_delay_min_seconds: float = Field(ge=0, le=60)
    profile_read_delay_max_seconds: float = Field(ge=0, le=120)

    # A follow that failed is tried again only after this long.
    follow_retry_hours: int = Field(ge=1, le=168)
    # A crawl stops after this many clubs in a row turn up nothing new; nothing else ends
    # it early, so it reads every club the school follows until then.
    crawl_miss_streak: int = Field(ge=1, le=100)
    # A public account no school name matches becomes a candidate once this many of the
    # school's followed clubs follow it, counted across crawls; a sighting not seen
    # again for this many days is forgotten.
    crawl_mutual_follow_threshold: int = Field(ge=2, le=20)
    crawl_sighting_retention_days: int = Field(ge=7, le=730)
    # A club's Following list is read at most this many pages deep (the school's own
    # list always to its end).
    crawl_list_page_limit: int = Field(ge=1, le=100)
    # A list that fails to read is tried again later, up to this many times, and never
    # counts as a miss.
    crawl_seed_attempts: int = Field(ge=1, le=10)
    # The crawl checks on a Brave read it waits for this often at first, doubling the
    # gap up to the maximum while it waits; a read still waiting after the timeout while
    # Brave holds nothing rests that school's crawl.
    crawl_poll_seconds: float = Field(gt=0, le=60, allow_inf_nan=False)
    crawl_poll_max_seconds: float = Field(gt=0, le=600, allow_inf_nan=False)
    crawl_read_timeout_seconds: float = Field(ge=60, le=86_400, allow_inf_nan=False)
    # How long the emulator waits for a profile to load before a follow gives up on it.
    profile_wait_seconds: int = Field(ge=5, le=300)
    # This many lists or follows failing in a row rest that school's crawl or that
    # account's follows this long before the next try.
    failures_before_rest: int = Field(ge=1, le=20)
    rest_seconds: int = Field(ge=0, le=7200)

    # Each school account follows (or unfollows) at most this many accounts a day, and
    # this many within any hour, so a fast emulator never makes an account follow in bursts.
    follows_per_account_per_day: int = Field(ge=1, le=200)
    follows_per_account_per_hour: int = Field(ge=1, le=200)

    # Names clubs use for their school besides its slug, searched in Following lists.
    # UofT's campuses list each other: a club named for one campus often runs on another.
    school_names: dict[str, list[str]]
    # Schools and campuses that share each school's name, abbreviation or city, shown to
    # the scorer so it rejects their accounts (UW is also Washington, Wisconsin and more).
    confusable_schools: dict[str, str]

    @model_validator(mode="after")
    def _read_delays_are_ordered(self) -> "InstagramFollowControl":
        if self.profile_read_delay_min_seconds > self.profile_read_delay_max_seconds:
            raise ValueError("profile_read_delay_min_seconds must not exceed the maximum")
        if self.crawl_poll_seconds > self.crawl_poll_max_seconds:
            raise ValueError("crawl_poll_seconds must not exceed crawl_poll_max_seconds")
        return self


class InstagramDmsControl(_ControlModel):
    # What a sitting reads of a DM thread and the replies it may draft.
    thread_item_limit: int = Field(ge=1, le=50)
    # Code refuses to type a drafted reply longer than this.
    reply_max_characters: int = Field(ge=20, le=1000)
    # The one email address a reply may give, for anything Claude cannot answer.
    contact_email: str = Field(pattern=r"^[a-z0-9._-]+@wat2do\.io$")
    # Threads whose newest message is older than this are left alone: the event is
    # likely over. The inbox is scrolled at most this many screens to find them.
    max_thread_age_days: int = Field(ge=1, le=60)
    inbox_scrolls: int = Field(ge=0, le=10)
    # The claim-link message is the one DM a sitting sends (Tony, 2026-11-24): at most
    # this many a day from one account, each a random gap of this many seconds after
    # the last, so the account never sends in a burst.
    claim_sends_per_account_per_day: int = Field(ge=0, le=30)
    claim_send_gap_min_seconds: int = Field(ge=0, le=3600)
    claim_send_gap_max_seconds: int = Field(ge=0, le=3600)
    # A claim only follows up, this long after we shared or featured the post a thread
    # asked for, never alongside that reply (Tony, 2026-11-25).
    claim_follow_up_hours: int = Field(ge=1, le=168)
    # The notification agent (services/instagram_sessions/notification.py) answers one
    # DM, mention or comment notification at a time. agent_enabled is its kill switch:
    # false makes every run a no-op. While agent_schools names any school, only those
    # accounts are handled (the rollout); an empty list means every account.
    agent_enabled: bool
    agent_schools: tuple[Annotated[str, Field(pattern=r"^[a-z0-9_]{2,40}$")], ...]
    # What one account may do in a day, across every run.
    replies_per_account_per_day: int = Field(ge=0, le=100)
    replies_per_thread_per_day: int = Field(ge=1, le=20)
    boosts_per_account_per_day: int = Field(ge=0, le=100)
    hearts_per_account_per_day: int = Field(ge=0, le=200)
    comment_likes_per_account_per_day: int = Field(ge=0, le=200)
    pins_per_account_per_day: int = Field(ge=0, le=100)
    # Every move that sends or taps something others see first waits a random pause
    # in this range, so an account never acts in a burst.
    send_wait_min_seconds: int = Field(ge=0, le=600)
    send_wait_max_seconds: int = Field(ge=0, le=600)
    # One thread gets at most one reply and one heart within this many hours.
    thread_repeat_hours: int = Field(ge=1, le=720)
    # A challenge, a login screen or an action limit pauses the account's notification
    # handling this long.
    challenge_pause_hours: int = Field(ge=1, le=720)

    @model_validator(mode="after")
    def _send_waits_are_ordered(self) -> "InstagramDmsControl":
        if self.send_wait_min_seconds > self.send_wait_max_seconds:
            raise ValueError("send_wait_min_seconds cannot exceed send_wait_max_seconds")
        return self


class InstagramSessionsControl(_ControlModel):
    # Each school account's daily sitting starts from this Toronto time, after the
    # morning's first curation run has drafted its carousel.
    start_hour: int = Field(ge=0, le=23)
    start_minute: int = Field(ge=0, le=59)
    # The Claude model that runs a sitting, and the Claude Code login it runs on, kept
    # apart from the one ingestion uses so sittings never spend its usage.
    model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    claude_config_dir: str = Field(pattern=r"^~?/[A-Za-z0-9._/-]+$")
    sitting_timeout_minutes: int = Field(ge=10, le=240)
    # A sitting that breaks off is tried again, up to this many sittings a day; Claude's
    # usage limit instead pauses every sitting this long.
    sitting_attempts: int = Field(ge=1, le=5)
    limit_pause_minutes: int = Field(ge=5, le=720)
    # The notification agent runs on the same model and login, at most this long a run.
    notification_timeout_minutes: int = Field(ge=2, le=120)
    # How long Claude Code lets one `ig` move run before moving it to the background: a
    # move paces itself like a person (a reply waits and types for minutes).
    move_timeout_minutes: int = Field(ge=2, le=10)
    # A post's like record gets a thank-you story only from this many likes; a smaller
    # record is kept without one.
    milestone_minimum_likes: int = Field(ge=1, le=100_000)
    # A milestone gets its story only when the check that sees it comes at most this
    # long after the last check and the stats run it reads: a crossing found later may
    # be days old, and is only recorded.
    milestone_window_hours: int = Field(ge=1, le=72)


class HiddenSchoolAccountControl(_ControlModel):
    """A hidden school's test Instagram account on the emulator."""

    android_user: int = Field(ge=0)
    username: str = Field(pattern=r"^[a-z0-9._]{1,30}$")


class InstagramEmulatorControl(_ControlModel):
    # The Android emulator whose Instagram app shares posts to school stories.
    serial: str = Field(pattern=r"^emulator-[0-9]{4,5}$")
    instagram_package: str = Field(pattern=r"^[a-z][a-z0-9_.]+$")
    # The always-on LaunchAgent boots this virtual device with these arguments
    # whenever adb cannot see it, checking again after this many seconds.
    avd_name: str = Field(pattern=r"^[A-Za-z0-9_.-]+$")
    emulator_arguments: tuple[Annotated[str, Field(pattern=r"^[A-Za-z0-9_.-]+$")], ...]
    keep_alive_check_seconds: int = Field(ge=10, le=3600)
    # An emulator whose Android has answered no shell command for this long is hung
    # and is stopped, to boot again. It must cover a boot, during which nothing answers.
    unresponsive_restart_seconds: int = Field(ge=300, le=7200)
    # qemu at spin_cpu_percent or more (100 is one Mac core) while Android uses at most
    # spin_guest_cpu_percent of its own cores, for spin_restart_seconds straight, is
    # qemu's render threads spinning, and the emulator is restarted under its lock.
    spin_cpu_percent: int = Field(ge=100, le=3200)
    spin_guest_cpu_percent: int = Field(ge=0, le=3200)
    spin_restart_seconds: int = Field(ge=300, le=86_400)
    # An Android that answers but has reached no Instagram server for this long has lost
    # its network, which a restart brings back, and is restarted under its lock.
    offline_restart_seconds: int = Field(ge=300, le=7200)
    # A stopped emulator whose qemu has not exited this long after the console's kill
    # is killed outright.
    stop_wait_seconds: int = Field(ge=5, le=600)
    # The Instagram app holds at most ten accounts per Android user, so school
    # accounts are spread across the emulator's users.
    android_user_by_school: dict[
        Annotated[str, Field(pattern=r"^[a-z0-9-]{1,80}$")], Annotated[int, Field(ge=0)]
    ] = Field(min_length=1)
    # Hidden schools' (``schools.hidden``) test accounts, also held in the app: the
    # notification recorder starts their Android users and names their notifications, so
    # the notification workflow gets them, but no worker visit, sitting or follow crawl
    # ever reads this map.
    hidden_school_accounts: dict[
        Annotated[str, Field(pattern=r"^[a-z0-9-]{1,80}$")], HiddenSchoolAccountControl
    ]
    adb_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    # A user switch is waited for until the user is in front and unlocked, at most this long;
    # an account switch settles this long before its inbox is opened.
    user_switch_wait_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    account_switch_settle_seconds: float = Field(ge=0, le=60, allow_inf_nan=False)
    screen_wait_seconds: float = Field(gt=0, le=60, allow_inf_nan=False)
    # A screen read waits until the app has drawn nothing new for this long, but at
    # most this many seconds: a screen that never settles, such as a playing video, is
    # then read as it is.
    screen_settle_milliseconds: int = Field(ge=0, le=5000)
    screen_settle_wait_seconds: float = Field(gt=0, le=30, allow_inf_nan=False)
    # Every tap, swipe and Back waits a random human-like pause inside this window,
    # and every keystroke one inside the keystroke window.
    step_delay_min_seconds: float = Field(ge=0, le=30, allow_inf_nan=False)
    step_delay_max_seconds: float = Field(ge=0, le=30, allow_inf_nan=False)
    keystroke_delay_min_seconds: float = Field(ge=0, le=5, allow_inf_nan=False)
    keystroke_delay_max_seconds: float = Field(ge=0, le=5, allow_inf_nan=False)
    story_upload_wait_seconds: float = Field(gt=0, le=300, allow_inf_nan=False)
    # How long an edited post may take to save after Done, once a song is chosen.
    audio_save_wait_seconds: float = Field(gt=0, le=300, allow_inf_nan=False)
    # A story repost needs room to upload; below this much free space it waits.
    min_free_data_megabytes: int = Field(ge=0, le=10_000)
    # Once a day, from reclaim_hour (local time, before the morning's carousels
    # publish), Instagram is stopped on every Android user and these folders inside its
    # data are deleted as root (the emulator runs a rooted Google APIs image).
    instagram_cache_paths: tuple[
        Annotated[str, Field(pattern=r"^[a-z_]+(?:/[a-z_]+)*(?:/\*)?$")], ...
    ] = Field(min_length=1)
    reclaim_hour: int = Field(ge=0, le=23)
    # The daily reclaim restarts the emulator and waits this long for it to boot again.
    restart_timeout_seconds: int = Field(ge=60, le=3600)
    # An account the app cannot switch to rests this long while the worker visits the
    # others; this many failed switches in a row restart the emulator.
    switch_rest_seconds: int = Field(ge=60, le=86_400)
    switch_failures_before_restart: int = Field(ge=1, le=20)
    restart_min_uptime_seconds: int = Field(ge=0, le=86400)
    # The one worker that drives the emulator visits one account at a time. Replies
    # and post edits happen only between the action hours, follows only between the
    # follow hours (local time). A visit follows at most this many accounts, and stops
    # following once any carousel waits for its song or the daily reclaim is due. With
    # nothing due the worker checks again after idle_seconds.
    action_start_hour: int = Field(ge=0, le=23)
    action_end_hour: int = Field(ge=1, le=24)
    follow_start_hour: int = Field(ge=0, le=23)
    follow_end_hour: int = Field(ge=1, le=24)
    follows_per_visit: int = Field(ge=1, le=50)
    idle_seconds: int = Field(ge=10, le=3600)
    launch_agent_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_timing(self) -> "InstagramEmulatorControl":
        if self.action_start_hour >= self.action_end_hour:
            raise ValueError("action_start_hour must be before action_end_hour")
        if self.follow_start_hour >= self.follow_end_hour:
            raise ValueError("follow_start_hour must be before follow_end_hour")
        if self.step_delay_min_seconds > self.step_delay_max_seconds:
            raise ValueError("step_delay_min_seconds cannot exceed step_delay_max_seconds")
        if self.keystroke_delay_min_seconds > self.keystroke_delay_max_seconds:
            raise ValueError(
                "keystroke_delay_min_seconds cannot exceed keystroke_delay_max_seconds"
            )
        if {path.split("/")[0] for path in self.instagram_cache_paths} & _INSTAGRAM_LOGIN_FOLDERS:
            raise ValueError("Deleting Instagram's settings or databases would log it out")
        if set(self.android_user_by_school) & set(self.hidden_school_accounts):
            raise ValueError("A hidden school's account cannot be a worker account too")
        if (
            Counter(self.android_users_by_account()).most_common(1)[0][1]
            > _INSTAGRAM_ACCOUNTS_PER_APP
        ):
            raise ValueError("An Android user can hold at most ten Instagram accounts")
        return self

    def android_users_by_account(self) -> list[int]:
        """The Android user of every account the app holds, hidden schools' included."""
        return [
            *self.android_user_by_school.values(),
            *(account.android_user for account in self.hidden_school_accounts.values()),
        ]


class OutreachFormalityControl(_ControlModel):
    """How official a club looks, out of 100, from what the outreach sweep already read."""

    # A page host shared by at least this many clubs is a school or union directory.
    directory_min_clubs: int = Field(ge=2, le=1000)
    points: dict[
        Literal[
            "directory_page",
            "own_website",
            "school_email",
            "own_domain_email",
            "free_email",
            "many_listings",
            "some_listings",
            "few_listings",
            "instagram",
            "formal_name",
        ],
        Annotated[int, Field(ge=0, le=100)],
    ]
    # Events and positions listed that count as many, and as some.
    many_listings: int = Field(ge=1, le=1000)
    some_listings: int = Field(ge=1, le=1000)
    # The highest score a confession, meme or similar account can get.
    informal_cap: int = Field(ge=0, le=100)
    free_email_domains: list[str] = Field(min_length=1)
    # Link and social hosts are not a club website.
    link_hosts: list[str] = Field(min_length=1)
    formal_words: list[str] = Field(min_length=1)
    informal_words: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def _fits_in_100(self) -> OutreachFormalityControl:
        best = (
            max(self.points["directory_page"], self.points["own_website"])
            + max(
                self.points["school_email"],
                self.points["own_domain_email"],
                self.points["free_email"],
            )
            + max(
                self.points["many_listings"],
                self.points["some_listings"],
                self.points["few_listings"],
            )
            + self.points["instagram"]
            + self.points["formal_name"]
        )
        if len(self.points) != 10 or best != 100:
            raise ValueError("formality points must name every signal and add up to 100")
        if self.some_listings > self.many_listings:
            raise ValueError("some_listings must not exceed many_listings")
        return self


class ClubPayoutsControl(_ControlModel):
    """What Wat2Do pays a club for each attendee its free QR check-in scans in.

    The club payout terms page (frontend/src/features/legal) shows every value
    here, and outreach pitches offer the rate.
    """

    rate_cents: int = Field(ge=1, le=10000)
    currency: Literal["cad"]
    # Only clubs at these schools take part, so only they are pitched the payout.
    schools: list[str] = Field(min_length=1)
    max_paid_scans_per_event_date: int = Field(ge=1, le=10000)
    max_payout_cents_per_club_per_month: int = Field(ge=1, le=10_000_000)
    # Each month's payouts go out by this day of the next month.
    payout_day_of_month: int = Field(ge=1, le=28)
    # A payout lapses when the club has given no way to pay it this long after the event.
    payout_details_deadline_days: int = Field(ge=30, le=730)
    # A club may question a payout this long after it is sent, and hears back within this long.
    dispute_window_days: int = Field(ge=7, le=365)
    dispute_reply_days: int = Field(ge=1, le=60)
    # A club asked for proof that an event's check-ins are real has this long to send it.
    proof_response_days: int = Field(ge=7, le=90)
    # The longest a payout under review waits past its payout date.
    review_hold_days: int = Field(ge=1, le=180)
    # How long after paying Wat2Do may take back a payout for check-ins that were not eligible.
    clawback_days: int = Field(ge=1, le=365)
    # A change that pays clubs less is announced this long before it applies.
    change_notice_days: int = Field(ge=1, le=90)
    # Either side's liability is capped at the greater of this and a year of payouts.
    liability_floor_cents: int = Field(ge=0, le=10_000_000)
    terms_effective_date: date

    @model_validator(mode="after")
    def _validate_payouts(self) -> "ClubPayoutsControl":
        if len(set(self.schools)) != len(self.schools) or not all(
            re.fullmatch(r"[a-z0-9-]{1,80}", school) for school in self.schools
        ):
            raise ValueError("club payout schools must be unique school slugs")
        if self.max_payout_cents_per_club_per_month < self.rate_cents:
            raise ValueError("a club's monthly payout limit must cover at least one scan")
        return self


class LegalControl(_ControlModel):
    """Who to contact about the site's legal pages, and when the data policy last changed."""

    contact_email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    data_policy_effective_date: date


class PartnerControl(_ControlModel):
    """A business Wat2Do has a deal with at some schools.

    The ingestion prompt lists its events at those schools although a business runs
    them ({{partner_accounts}}), and their sites' banner promotes its next one with
    its discount (frontend/src/features/events/lib/partnerEventBanner.ts).
    """

    # Its Instagram account, as events.ig_handle stores it: lower case, no "@".
    instagram_handle: str = Field(pattern=r"^[a-z0-9._]{1,30}$")
    # How the banner names it.
    name: str = Field(min_length=1, max_length=60)
    discount_percent: int = Field(ge=1, le=100)
    discount_code: str = Field(pattern=r"^[A-Z0-9]{1,30}$")
    schools: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_schools(self) -> "PartnerControl":
        if len(set(self.schools)) != len(self.schools) or not all(
            re.fullmatch(r"[a-z0-9-]{1,80}", school) for school in self.schools
        ):
            raise ValueError("partner schools must be unique school slugs")
        return self


class PartnersControl(_ControlModel):
    # A partner event shows in its school's banner from this many days before it starts
    # until it ends.
    banner_lead_days: int = Field(ge=1, le=60)
    partners: list[PartnerControl] = Field(max_length=100)

    @model_validator(mode="after")
    def _validate_partners(self) -> "PartnersControl":
        handles = [partner.instagram_handle for partner in self.partners]
        if len(set(handles)) != len(handles):
            raise ValueError("each partner's Instagram handle must be listed once")
        return self


class OutreachControl(_ControlModel):
    model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    agent_timeout_seconds: int = Field(gt=0, le=3600)
    # Research agents run at once, one per club whose own page shows no email.
    parallel_agents: int = Field(ge=1, le=16)
    sweep_interval_hours: int = Field(ge=1, le=720)
    # New clubs whose own page each sweep reads; reading a page costs one request.
    clubs_per_sweep: int = Field(ge=1, le=100000)
    # Clubs without an email on their page that each sweep sends a research agent after.
    research_per_sweep: int = Field(ge=0, le=5000)
    # A club research came back empty for is searched again after this long.
    research_retry_days: int = Field(ge=1, le=365)
    page_fetch_concurrency: int = Field(ge=1, le=32)
    # Leads scored for formality per database round trip.
    scoring_batch_size: int = Field(ge=1, le=10000)
    # Each email must appear on the page it was found on, fetched within this time.
    page_fetch_timeout_seconds: float = Field(gt=0, le=60, allow_inf_nan=False)
    launch_agent_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    # Claude judges each lead's club from its events and, for a club whose events
    # students would come out for, writes the video script and the email.
    pitch_model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    pitch_timeout_seconds: int = Field(gt=0, le=3600)
    # Only these schools' leads are pitched, so only they reach the admin page.
    pitch_schools: list[str] = Field(min_length=1)
    # The data API answers at most a thousand rows, so a sweep asks for no more.
    pitches_per_sweep: int = Field(ge=0, le=1000)
    # A club judged not a fit is judged again after this long, in case it has run
    # an event worth coming to since.
    pitch_recheck_days: int = Field(ge=1, le=365)
    # The club's newest events Claude reads.
    pitch_event_limit: int = Field(ge=1, le=50)
    # Who records the video and signs the email.
    sender_name: str = Field(min_length=1, max_length=60)
    # "{school}" becomes the school's slug and "{club_id}" the club's id.
    club_url_template: str = Field(pattern=r"^https://\S*\{school\}\S*\{club_id\}\S*$")
    # "{school}" becomes the school's slug and "{token}" the lead's claim token.
    claim_url_template: str = Field(pattern=r"^https://\S*\{school\}\S*\{token\}\S*$")
    # The club payout terms page each email links; "{school}" becomes the school's slug.
    payout_terms_url_template: str = Field(pattern=r"^https://\S*\{school\}\S*$")
    formality: OutreachFormalityControl

    @model_validator(mode="after")
    def _validate_pitch_schools(self) -> "OutreachControl":
        schools = self.pitch_schools
        if len(set(schools)) != len(schools) or not all(
            re.fullmatch(r"[a-z0-9-]{1,80}", school) for school in schools
        ):
            raise ValueError("pitch_schools must be unique school slugs")
        return self


class CompetitorPainPointsControl(_ControlModel):
    model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    agent_timeout_seconds: int = Field(gt=0, le=3600)
    # Agents run at once; each competitor gets one per search lane, plus X.
    parallel_agents: int = Field(ge=1, le=32)
    sweep_interval_hours: int = Field(ge=1, le=24)
    lookback_days: int = Field(ge=1, le=30)
    findings_per_search: int = Field(ge=1, le=100)
    known_urls_in_prompt: int = Field(ge=0, le=2000)
    launch_agent_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    # The daily report: a stronger model reads the complaints found in the last
    # window and suggests changes to wat2do.io.
    report_model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    report_timeout_seconds: int = Field(gt=0, le=7200)
    report_window_hours: int = Field(ge=1, le=168)
    report_max_complaints: int = Field(ge=1, le=2000)
    # X and Reddit searches read in Safari; "{name}" becomes the competitor's
    # search name.
    x_queries: list[Annotated[str, Field(pattern=r"\{name\}")]] = Field(max_length=10)
    reddit_queries: list[Annotated[str, Field(pattern=r"\{name\}")]] = Field(max_length=10)
    scrolls: int = Field(ge=0, le=10)
    page_wait_seconds: float = Field(gt=0, le=30, allow_inf_nan=False)
    posts_per_query: int = Field(ge=1, le=200)
    # Competitor slug -> display name.
    competitors: dict[
        Annotated[str, Field(pattern=r"^[a-z0-9_]+$")], Annotated[str, Field(min_length=1)]
    ] = Field(min_length=1)
    # One line per competitor that tells it apart from products with a similar name.
    about: dict[str, Annotated[str, Field(min_length=1)]]
    # X and Reddit search term when the display name is not one, e.g. "What2Do (UTM)".
    search_names: dict[str, Annotated[str, Field(min_length=1)]] = Field(default_factory=dict)
    # Lane slug -> where that lane's agent looks; every competitor gets each lane.
    lanes: dict[
        Annotated[str, Field(pattern=r"^[a-z0-9_]+$")], Annotated[str, Field(min_length=1)]
    ] = Field(min_length=1)
    # Source slug -> the hosts its links may use; a source with no hosts
    # (forums) accepts any public host.
    sources: dict[
        Annotated[str, Field(pattern=r"^[a-z0-9_]+$")],
        list[Annotated[str, Field(pattern=r"^[a-z0-9.-]+$")]],
    ] = Field(min_length=1)

    @model_validator(mode="after")
    def _every_competitor_described(self) -> CompetitorPainPointsControl:
        if set(self.about) != set(self.competitors):
            raise ValueError("about must describe exactly the configured competitors")
        if not set(self.search_names) <= set(self.competitors):
            raise ValueError("search_names may only name configured competitors")
        if {"x", "reddit"} & set(self.lanes):
            raise ValueError("the x and reddit lanes are built in; configure their queries")
        return self


class NotificationRetryControl(_ControlModel):
    """Rerunning failed "Handle notification" workflow runs once they can succeed.

    A LaunchAgent runs a pass every interval_minutes. While the Brave worker is paused or
    down it reruns nothing; otherwise it reruns each failed run whose school account is
    not held for a person or missing from Brave with no login allowed yet, each run at
    most max_reruns_per_run times and rerun_spacing_minutes apart.
    """

    interval_minutes: int = Field(ge=1, le=1440)
    launch_agent_timeout_seconds: float = Field(gt=0, le=300)
    # The GitHub repository (owner/name) and the workflow whose failed runs are reran.
    github_repo: str = Field(pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    workflow_name: str = Field(min_length=1, max_length=100)
    # Only runs that failed within this many hours are considered.
    lookback_hours: int = Field(ge=1, le=168)
    # At most this many reruns start per pass: each switches Brave's account, and a burst
    # of switches gets the whole Brave session logged out (8 in 7 minutes on 11-13).
    reruns_per_pass: int = Field(ge=1, le=20)
    # At most this many run reruns are started per day, across every run.
    reruns_per_day: int = Field(ge=0, le=500)
    # A run reran this many times and still failing is reported, not reran again.
    max_reruns_per_run: int = Field(ge=1, le=10)
    # A run is reran again only this long after its last rerun.
    rerun_spacing_minutes: int = Field(ge=0, le=1440)


class NotificationRecordingControl(_ControlModel):
    """Recording the Instagram notifications the Mac's emulator gets in a local file, and
    starting the notification workflow for its posts.
    """

    # A notification whose push category or channel contains one of these, or that Android
    # files as a message or draws as a conversation, is a direct message: only its push
    # category, Android user, recipient and times are kept, never its sender or text.
    direct_message_markers: tuple[Annotated[str, Field(pattern=r"^[a-z_]{2,40}$")], ...] = Field(
        min_length=1
    )
    # The reader is read this long at a time.
    listen_seconds: float = Field(gt=0, le=600, allow_inf_nan=False)
    # A reader that has printed nothing this long is started again, in case Android
    # dropped its registration; the notifications it replays are not written twice.
    quiet_restart_minutes: int = Field(ge=1, le=1440)
    # While the emulator is down or the reader cannot start, the recorder waits a pause
    # that doubles from the first to the longest.
    reconnect_first_seconds: float = Field(gt=0, le=600, allow_inf_nan=False)
    reconnect_longest_seconds: float = Field(gt=0, le=3600, allow_inf_nan=False)
    # A recorded notification is remembered this long, so one a reader replays when it
    # starts again is not written twice.
    remember_days: int = Field(ge=1, le=60)
    # notifications.jsonl is rotated at this size, keeping this many old files.
    file_max_bytes: int = Field(ge=65536, le=1_073_741_824)
    file_backup_count: int = Field(ge=1, le=20)
    # recorder.log, the recorder's own status lines, is rotated the same way.
    log_max_bytes: int = Field(ge=65536, le=67_108_864)
    log_backup_count: int = Field(ge=1, le=10)
    launch_agent_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    # This often, each Android user that holds a school account and has stopped is started
    # again in the background: a stopped user gets no notifications.
    start_users_every_seconds: float = Field(ge=10, le=3600, allow_inf_nan=False)
    # Each new notification in these Instagram push categories starts the workflow through
    # this repository dispatch, as the phones' Automate flow does.
    dispatch_push_categories: tuple[Annotated[str, Field(pattern=r"^[a-z_]{2,60}$")], ...] = Field(
        min_length=1
    )
    github_repo: str = Field(pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    dispatch_event_type: str = Field(pattern=r"^[a-z_]{2,60}$")
    # Each new notification in these categories (direct messages, mentions, comments)
    # starts the workflow's notification agent through this dispatch instead. It carries
    # only the category, the school account, the sender's name and the time, never text.
    agent_push_categories: tuple[Annotated[str, Field(pattern=r"^[a-z0-9_]{2,60}$")], ...] = Field(
        min_length=1
    )
    agent_dispatch_event_type: str = Field(pattern=r"^[a-z_]{2,60}$")
    dispatch_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    # Dispatches go out at least this far apart, so a burst is not taken for spam.
    send_spacing_seconds: float = Field(ge=0, le=60, allow_inf_nan=False)
    # A failed dispatch is tried again after a pause that doubles from the first to the
    # longest; one GitHub refuses (422) this many times is dropped.
    retry_first_seconds: float = Field(gt=0, le=3600, allow_inf_nan=False)
    retry_longest_seconds: float = Field(gt=0, le=86_400, allow_inf_nan=False)
    refusals_before_drop: int = Field(ge=1, le=20)

    @model_validator(mode="after")
    def validate_recording(self) -> "NotificationRecordingControl":
        if "direct" not in self.direct_message_markers:
            raise ValueError("Instagram's direct message categories must stay redacted")
        if self.reconnect_first_seconds > self.reconnect_longest_seconds:
            raise ValueError("reconnect_first_seconds cannot exceed reconnect_longest_seconds")
        if self.retry_first_seconds > self.retry_longest_seconds:
            raise ValueError("retry_first_seconds cannot exceed retry_longest_seconds")
        if any(
            marker in category
            for category in self.dispatch_push_categories
            for marker in self.direct_message_markers
        ):
            raise ValueError("a direct message category must never be dispatched")
        if set(self.agent_push_categories) & set(self.dispatch_push_categories):
            raise ValueError("a category goes either to post processing or to the agent")
        if self.agent_dispatch_event_type == self.dispatch_event_type:
            raise ValueError("the agent's dispatch needs its own event type")
        return self


TicketCountry = Literal["CA", "US"]
TicketCurrency = Literal["cad", "usd"]


class TicketingControl(_ControlModel):
    """Club tickets: free QR tickets, and paid ones sold through each club's Stripe account.

    The Rust API (``rust/src/api/tickets``) reads this file; Python only validates it.
    """

    # Off until the Stripe keys and the Connect webhook exist in an environment;
    # free tickets need neither and are always available.
    paid_tickets_enabled: bool
    # A school's country picks both its clubs' Stripe account country and their ticket currency.
    currency_by_country: dict[TicketCountry, TicketCurrency]
    # Stripe refuses card charges under 50 cents.
    minimum_price_cents: int = Field(ge=50, le=100_000)
    maximum_price_cents: int = Field(gt=0, le=1_000_000)
    # A release's tickets are per date of an event.
    maximum_capacity: int = Field(gt=0, le=100_000)
    # Releases one event's tickets can go on sale in.
    maximum_releases: int = Field(gt=0, le=50)
    maximum_tickets_per_order: int = Field(gt=0, le=20)
    # Stripe Checkout sessions last 30 minutes to 24 hours.
    checkout_minutes: int = Field(ge=30, le=1440)
    # Seats stay held this long after a Checkout session ends, so a payment
    # Stripe reports late never loses its seats to another buyer.
    reservation_grace_minutes: int = Field(ge=0, le=120)
    # The door admits a ticket from this long before its date starts until this
    # long after it ends, so a ticket to another date of a series waits its turn.
    check_in_opens_hours_before: int = Field(ge=0, le=48)
    check_in_closes_hours_after: int = Field(ge=0, le=48)
    # Per person, across taking free tickets and starting checkouts.
    rate_limit: RateLimitControl
    # Every Stripe request names this API version, so an account default never changes our payloads.
    stripe_api_version: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}\.[a-z]+$")
    stripe_timeout_seconds: float = Field(gt=0, le=60)
    # Retries of a request that failed in transit; every write carries an idempotency key.
    stripe_network_retries: int = Field(ge=0, le=5)
    # A webhook signed longer ago than this is refused, so a captured one cannot be replayed.
    webhook_tolerance_seconds: int = Field(ge=60, le=3600)

    @model_validator(mode="after")
    def _prices_and_countries(self) -> TicketingControl:
        if self.minimum_price_cents > self.maximum_price_cents:
            raise ValueError("minimum_price_cents cannot exceed maximum_price_cents")
        if set(self.currency_by_country) != {"CA", "US"}:
            raise ValueError("currency_by_country must cover every school country")
        return self


class ControlBox(_ControlModel):
    api_server: ApiServerControl
    api_cache: ApiCacheControl
    positions: PositionsControl
    database: DatabaseControl
    image_delivery: ImageDeliveryControl
    discovery_cache: DiscoveryCacheControl
    discovery_queries: DiscoveryQueriesControl
    google_analytics: GoogleAnalyticsControl
    event_discovery: EventDiscoveryControl
    client_cache: ClientCacheControl
    interaction_tracking: InteractionTrackingControl
    authentication: AuthenticationControl
    club_management: ClubManagementControl
    morning_email: MorningEmailControl
    event_reminder: EventReminderControl
    event_change_alerts: EventChangeAlertsControl
    notification_inbox: NotificationInboxControl
    notification_defaults: NotificationDefaultsControl
    interaction_ingestion: InteractionIngestionControl
    rate_limits: RateLimitsControl
    scraping: ScrapingControl
    ingestion: IngestionControl
    reel_transcription: ReelTranscriptionControl
    email_delivery: EmailDeliveryControl
    contact: ContactControl
    admin: AdminControl
    uploads: UploadsControl
    public_attendance: PublicAttendanceControl
    social_previews: SocialPreviewsControl
    instagram_browser: InstagramBrowserControl
    notification_workflow: NotificationWorkflowControl
    notification_retry: NotificationRetryControl
    notification_recording: NotificationRecordingControl
    runner_setup: RunnerSetupControl
    instagram_bell_setup: InstagramBellSetupControl
    instagram_digest: InstagramDigestControl
    instagram_lightpanda: InstagramLightpandaControl
    instagram_account_guard: InstagramAccountGuardControl
    instagram_publishing: InstagramPublishingControl
    competitor_pain_points: CompetitorPainPointsControl
    outreach: OutreachControl
    club_payouts: ClubPayoutsControl
    legal: LegalControl
    partners: PartnersControl
    instagram_follow: InstagramFollowControl
    instagram_dms: InstagramDmsControl
    instagram_sessions: InstagramSessionsControl
    instagram_emulator: InstagramEmulatorControl
    workflow_failure_alerts: WorkflowFailureAlertsControl
    maintenance: MaintenanceControl
    promoter_program: PromoterProgramControl
    ticketing: TicketingControl


def load_controlbox(directory: Path = _CONTROLBOX_DIRECTORY) -> ControlBox:
    """Load every feature control file and reject missing or unknown files."""
    expected = set(ControlBox.model_fields)
    actual = {path.stem for path in directory.glob("*.json")}
    unexpected = actual - expected
    if unexpected:
        names = ", ".join(sorted(unexpected))
        raise RuntimeError(f"Unknown feature control files: {names}")

    raw = {}
    for feature in sorted(expected):
        path = directory / f"{feature}.json"
        try:
            raw[feature] = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise RuntimeError(f"Feature control file not found: {path}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Feature control file is invalid JSON: {path}: {exc}") from exc
    return ControlBox.model_validate(raw)


controlbox = load_controlbox()
