"""Validated, non-secret feature controls loaded from ``backend/controlbox``."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, model_validator

_CONTROLBOX_DIRECTORY = Path(__file__).resolve().parents[1] / "controlbox"
_INTERACTION_TYPES = {"click", "detail_view", "going", "ungoing", "share"}


class _ControlModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ScoreBlend(_ControlModel):
    content: float = Field(ge=0, le=1)
    collaborative: float = Field(ge=0, le=1)
    popularity: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def validate_total(self) -> "ScoreBlend":
        total = self.content + self.collaborative + self.popularity
        if abs(total - 1.0) > 1e-9:
            raise ValueError("recommendation blend weights must total 1")
        return self


class RecommendationSnapshotControl(_ControlModel):
    recommendations_per_user: int = Field(gt=0)
    candidate_events_per_school: int = Field(gt=0)


class RecommendationApiControl(_ControlModel):
    maximum_results: int = Field(gt=0)


class PersonalizationControl(_ControlModel):
    relevance_weight: float = Field(ge=0, le=1)
    warm_interactions: int = Field(ge=0)
    hot_interactions: int = Field(gt=0)
    hot_blend: ScoreBlend
    warm_blend: ScoreBlend
    warm_without_collaborative_blend: ScoreBlend
    cold_blend: ScoreBlend

    @model_validator(mode="after")
    def validate_tiers(self) -> "PersonalizationControl":
        if self.warm_interactions >= self.hot_interactions:
            raise ValueError("warm_interactions must be lower than hot_interactions")
        return self


class CollaborativeFilteringControl(_ControlModel):
    minimum_interactions: int = Field(gt=0)
    neighbor_count: int = Field(gt=0)
    user_item_blend_weight: float = Field(ge=0, le=1)
    going_weight: float = Field(gt=0)
    maximum_user_event_score: float = Field(gt=0)


class TemporalTier(_ControlModel):
    within_hours: int = Field(gt=0)
    score: float = Field(ge=0, le=1)


class ContentScoringControl(_ControlModel):
    category_match: float = Field(ge=0, le=1)
    category_without_profile: float = Field(ge=0, le=1)
    school_match: float = Field(ge=0, le=1)
    club_affinity: float = Field(ge=0, le=1)
    temporal_tiers: tuple[TemporalTier, ...] = Field(min_length=1)
    temporal_fallback: float = Field(ge=0, le=1)
    free_event: float = Field(ge=0, le=1)
    has_food: float = Field(ge=0, le=1)
    first_year: float = Field(ge=0, le=1)
    first_year_categories: frozenset[str] = Field(min_length=1)
    price_normalization_cap: float = Field(gt=0)
    morning_end_hour: int = Field(ge=1, le=23)
    afternoon_end_hour: int = Field(ge=1, le=23)

    @model_validator(mode="after")
    def validate_ordering(self) -> "ContentScoringControl":
        tier_hours = [tier.within_hours for tier in self.temporal_tiers]
        if tier_hours != sorted(set(tier_hours)):
            raise ValueError("temporal_tiers must have unique, ascending within_hours")
        if self.morning_end_hour >= self.afternoon_end_hour:
            raise ValueError("morning_end_hour must be lower than afternoon_end_hour")
        return self


class PopularityControl(_ControlModel):
    half_life_days: float = Field(gt=0)
    fallback_score: float = Field(ge=0, le=1)
    candidate_limit: int = Field(gt=0)
    maximum_user_contribution: float = Field(gt=0)


class RecommendationInteractionControl(_ControlModel):
    lookback_days: int = Field(gt=0)
    weights: dict[str, float]

    @model_validator(mode="after")
    def validate_weights(self) -> "RecommendationInteractionControl":
        if set(self.weights) != _INTERACTION_TYPES:
            raise ValueError(f"interaction weight keys must be {_INTERACTION_TYPES}")
        return self


class EvaluationControl(_ControlModel):
    k: int = Field(gt=0)
    minimum_interactions: int = Field(gt=0)
    maximum_events: int = Field(ge=0)


class RecommendationControl(_ControlModel):
    snapshot: RecommendationSnapshotControl
    api: RecommendationApiControl
    personalization: PersonalizationControl
    collaborative_filtering: CollaborativeFilteringControl
    content_scoring: ContentScoringControl
    popularity: PopularityControl
    interactions: RecommendationInteractionControl
    evaluation: EvaluationControl

    @model_validator(mode="after")
    def validate_limits(self) -> "RecommendationControl":
        if self.snapshot.recommendations_per_user > self.api.maximum_results:
            raise ValueError("recommendations_per_user cannot exceed maximum_results")
        return self


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
    map_search_concurrency: int = Field(gt=0, le=10)
    map_search_timeout_seconds: int = Field(gt=0, le=60)
    map_style: str = Field(pattern=r"^mapbox://styles/")
    map_venue_aliases: dict[
        Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]*$")],
        dict[Annotated[str, Field(pattern=r"\S")], Annotated[str, Field(pattern=r"\S")]],
    ]


class EventDiscoveryControl(_ControlModel):
    new_event_window_hours: int = Field(gt=0)
    event_without_end_visibility_minutes: int = Field(gt=0)
    initial_render_count: int = Field(gt=0, le=100)
    preview_event_count: int = Field(gt=0, le=100)
    server_feed_page_size: int = Field(gt=0, le=100)
    campus_seasons: CampusSeasonsControl
    views: EventViewsControl


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
    device_sizes: tuple[int, ...] = Field(min_length=1)
    image_sizes: tuple[int, ...] = Field(min_length=1)
    quality: int = Field(ge=1, le=100)
    first_row_image_count: int = Field(ge=1, le=24)
    optimized_format: Literal["image/webp"]
    optimized_remote_host: str = Field(min_length=1)
    optimized_remote_path: str = Field(pattern=r"^/.*\/$")
    warm_widths: tuple[int, ...] = Field(min_length=1)
    warm_concurrency: int = Field(ge=1, le=8)
    warm_request_timeout_seconds: int = Field(gt=0)
    warm_retry_seconds: int = Field(gt=0)
    warm_success_ttl_seconds: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_sizes(self) -> "ImageDeliveryControl":
        for sizes in (self.device_sizes, self.image_sizes, self.warm_widths):
            if min(sizes) <= 0 or list(sizes) != sorted(set(sizes)):
                raise ValueError("image sizes must be positive, unique and ascending")
        if max(self.image_sizes) >= min(self.device_sizes):
            raise ValueError("image_sizes must be smaller than the smallest device_sizes entry")
        if not set(self.warm_widths).issubset((*self.device_sizes, *self.image_sizes)):
            raise ValueError("warm_widths must be configured image or device sizes")
        if any(character in self.optimized_remote_host for character in "/:?#@* "):
            raise ValueError("optimized_remote_host must be a hostname without a scheme or path")
        if any(part in {".", ".."} for part in self.optimized_remote_path.split("/")):
            raise ValueError("optimized_remote_path cannot contain relative path segments")
        return self


class EcsRuntimeControl(_ControlModel):
    task_cpu: int = Field(gt=0)
    task_memory_mib: int = Field(gt=0)
    desired_count: int = Field(ge=2)
    frontend_cpu: int = Field(gt=0)
    backend_cpu: int = Field(gt=0)
    frontend_memory_reservation_mib: int = Field(gt=0)
    backend_memory_reservation_mib: int = Field(gt=0)
    cache_init_memory_reservation_mib: int = Field(gt=0)
    frontend_heap_mib: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_capacity(self) -> "EcsRuntimeControl":
        # AWS Fargate Linux task sizes, in CPU units and MiB:
        # https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html
        memory_sizes: dict[int, range | tuple[int, ...]] = {
            256: (512, 1024, 2048),
            512: range(1024, 4097, 1024),
            1024: range(2048, 8193, 1024),
            2048: range(4096, 16385, 1024),
            4096: range(8192, 30721, 1024),
            8192: range(16384, 61441, 4096),
            16384: range(32768, 122881, 8192),
            32768: (61440, 122880, 249856),
        }
        if self.task_memory_mib not in memory_sizes.get(self.task_cpu, ()):
            raise ValueError("task CPU and memory must be a supported Fargate combination")
        if self.frontend_cpu + self.backend_cpu > self.task_cpu:
            raise ValueError("container CPU shares cannot exceed task CPU")
        reservations = (
            self.frontend_memory_reservation_mib
            + self.backend_memory_reservation_mib
            + self.cache_init_memory_reservation_mib
        )
        if reservations > self.task_memory_mib:
            raise ValueError("container memory reservations cannot exceed task memory")
        # V8 old space excludes young-generation, native image buffers and Node
        # overhead. The checked-in budget leaves 256 MiB inside the frontend
        # reservation, plus unreserved task memory for transient allocation.
        if self.frontend_heap_mib >= self.frontend_memory_reservation_mib:
            raise ValueError("frontend heap must leave headroom below its memory reservation")
        return self


class DiscoveryCacheControl(_ControlModel):
    cdn_ttl_seconds: int = Field(gt=0, le=300)
    generation_retention_days: int = Field(ge=2)
    schema_version: int = Field(ge=1)
    storage_prefix: str = Field(min_length=1)
    refresh_interval_seconds: int = Field(gt=0)
    worker_interval_seconds: int = Field(gt=0)
    lease_seconds: int = Field(gt=0)
    request_timeout_seconds: int = Field(gt=0)
    page_concurrency: int = Field(ge=1, le=8)
    maximum_page_count: int = Field(gt=0)
    state_write_attempts: int = Field(gt=0)
    failure_backoff_seconds: int = Field(gt=0)
    maximum_snapshot_age_seconds: int = Field(gt=0)
    readiness_timeout_seconds: int = Field(gt=0)
    startup_grace_seconds: int = Field(gt=0)
    deployment_timeout_seconds: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_lifecycle(self) -> "DiscoveryCacheControl":
        if (
            self.deployment_timeout_seconds
            <= self.readiness_timeout_seconds + self.startup_grace_seconds
        ):
            raise ValueError("deployment_timeout_seconds must exceed readiness and startup grace")
        if self.maximum_snapshot_age_seconds <= self.refresh_interval_seconds:
            raise ValueError("maximum_snapshot_age_seconds must exceed the refresh interval")
        if self.generation_retention_days * 86400 <= self.maximum_snapshot_age_seconds:
            raise ValueError("generation_retention_days must outlast the maximum snapshot age")
        if self.worker_interval_seconds > self.refresh_interval_seconds:
            raise ValueError("worker_interval_seconds cannot exceed the refresh interval")
        if self.request_timeout_seconds >= self.lease_seconds:
            raise ValueError("request_timeout_seconds must be shorter than the lease")
        if any(part in {"", ".", ".."} for part in self.storage_prefix.split("/")):
            raise ValueError("storage_prefix must be a nonempty relative object prefix")
        return self


class ClientCacheControl(_ControlModel):
    discovery_prefetch_idle_timeout_ms: int = Field(gt=0)
    default_query_stale_seconds: int = Field(ge=0)
    default_query_garbage_collection_seconds: int = Field(gt=0)
    live_event_data_stale_seconds: int = Field(ge=0)
    profile_stale_seconds: int = Field(ge=0)
    admin_stale_seconds: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_default_cache(self) -> "ClientCacheControl":
        if self.default_query_garbage_collection_seconds < self.default_query_stale_seconds:
            raise ValueError("default query garbage collection cannot be shorter than stale time")
        return self


class InteractionTrackingControl(_ControlModel):
    flush_debounce_milliseconds: int = Field(ge=0)


class AuthenticationControl(_ControlModel):
    session_cookie_days: int = Field(gt=0)
    verification_token_minutes: int = Field(gt=0)
    legacy_frontend_origins: tuple[HttpUrl, ...]


class ClubManagementControl(_ControlModel):
    initial_render_count: int = Field(gt=0, le=100)
    directory_page_size: int = Field(gt=0, le=100)
    invite_expiration_days: int = Field(gt=0)


class MorningEmailControl(_ControlModel):
    local_send_hour: int = Field(ge=0, le=23)
    new_event_window_hours: int = Field(gt=0)
    minimum_recommendation_score: float = Field(ge=0, le=1)
    provider_attempts: int = Field(gt=0, le=10)


class EventReminderControl(_ControlModel):
    lead_minutes: int = Field(gt=0)
    early_tolerance_minutes: int = Field(ge=0)
    late_tolerance_minutes: int = Field(ge=0)
    provider_attempts: int = Field(gt=0, le=10)


class NotificationDefaultsControl(_ControlModel):
    morning_email: bool
    event_reminder: bool
    event_change: bool


class InteractionIngestionControl(_ControlModel):
    default_query_limit: int = Field(gt=0)
    maximum_batch_size: int = Field(gt=0)
    maximum_metadata_bytes: int = Field(gt=0)
    maximum_duplicates_per_window: int = Field(gt=0)
    deduplication_window_minutes: int = Field(gt=0)
    maximum_user_interactions_per_window: int = Field(gt=0)


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
    maximum_display_names: int = Field(gt=0)


class SocialPreviewsControl(_ControlModel):
    stale_check_interval_minutes: int = Field(ge=5, le=1440)
    capture_path: Literal["/"]
    viewport_width: int = Field(ge=600, le=2400)
    viewport_height: int = Field(ge=315, le=1260)
    capture_scale: float = Field(ge=0.5, le=1)
    device_scale_factor: int = Field(ge=1, le=3)
    jpeg_quality: int = Field(ge=1, le=100)
    navigation_timeout_seconds: int = Field(gt=0, le=120)
    function_timeout_seconds: int = Field(gt=0, le=900)
    memory_megabytes: int = Field(ge=1024, le=10_240)
    reserved_concurrency: int = Field(ge=2, le=10)
    maximum_receive_count: int = Field(ge=1, le=10)
    asset_retention_days: int = Field(ge=7, le=365)

    @model_validator(mode="after")
    def validate_timeout(self) -> "SocialPreviewsControl":
        if self.navigation_timeout_seconds >= self.function_timeout_seconds:
            raise ValueError(
                "social preview navigation timeout must be shorter than function timeout"
            )
        return self


class EmailDeliveryControl(_ControlModel):
    provider_timeout_seconds: float = Field(gt=0)
    notification_consent_version: str = Field(min_length=1)


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


class UploadsControl(_ControlModel):
    """Client-facing upload contract, shared verbatim with the frontend picker."""

    event_image_allowed_mime_types: list[str] = Field(min_length=1)
    event_image_max_size_bytes: int = Field(gt=0)
    event_video_max_size_bytes: int = Field(gt=0)
    event_video_download_timeout_seconds: int = Field(gt=0)
    # Posters are stored at this width, so it is the width every viewer gets.
    # 1080 is where the Instagram sources top out; asking for more would store
    # upscaled pixels, and the detail view is the widest place one is shown.
    event_image_rendition_width_pixels: int = Field(ge=640, le=2400)
    event_image_rendition_quality: int = Field(ge=1, le=100)

    @model_validator(mode="after")
    def _validate_mime_types(self) -> "UploadsControl":
        for mime_type in self.event_image_allowed_mime_types:
            if not mime_type.startswith("image/"):
                raise ValueError("event image MIME types must be image/* types")
        if len(self.event_image_allowed_mime_types) != len(
            set(self.event_image_allowed_mime_types)
        ):
            raise ValueError("event image MIME types must be unique")
        return self


class InstagramMusicChartControl(_ControlModel):
    name: str = Field(min_length=1)
    url: HttpUrl


class InstagramPublishingControl(_ControlModel):
    music_history_batch_count: int = Field(gt=0)
    music_charts: dict[str, InstagramMusicChartControl]
    music_chart_by_school: dict[str, str]
    default_music_chart: str

    @model_validator(mode="after")
    def validate_music_charts(self) -> "InstagramPublishingControl":
        chart_keys = {self.default_music_chart, *self.music_chart_by_school.values()}
        if not chart_keys <= self.music_charts.keys():
            raise ValueError("instagram music mappings must reference configured charts")
        return self

    maximum_stickers_per_event: int = Field(ge=1, le=4)
    sticker_line_character_limit: int = Field(ge=8, le=12)
    sticker_maximum_lines: int = Field(ge=1, le=2)
    sticker_shape_count: int = Field(ge=10, le=10)

    graph_api_version: str = Field(pattern=r"^v[0-9]+\.[0-9]+$")
    generation_timezone: str = Field(min_length=1)
    fallback_window_hours: int = Field(gt=0)
    new_event_window_hours: int = Field(gt=0)
    minimum_lead_hours: int = Field(ge=0)
    maximum_lead_days: int = Field(gt=0)
    maximum_event_slides: int = Field(gt=0, le=9)
    status_poll_interval_seconds: float = Field(gt=0, le=60)
    meta_poll_attempts: int = Field(gt=0, le=30)
    meta_poll_interval_seconds: float = Field(gt=0, le=30)
    meta_request_timeout_seconds: float = Field(gt=0, le=120)
    token_lifetime_days: int = Field(gt=0, le=90)
    token_refresh_lead_days: int = Field(gt=0, le=30)

    @model_validator(mode="after")
    def validate_token_windows(self) -> "InstagramPublishingControl":
        if self.token_refresh_lead_days >= self.token_lifetime_days:
            raise ValueError("instagram token refresh lead must be shorter than token lifetime")
        return self


class InstagramBrowserControl(_ControlModel):
    parallel_tabs: int = Field(ge=2, le=100)
    tab_health_interval_seconds: float = Field(ge=1, le=300)
    ingestion_retry_limit: int = Field(gt=0, le=10)
    profile_post_limit: int = Field(gt=0, le=50)
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
    interaction_timeout_seconds: float = Field(gt=0, le=120)
    account_transition_grace_seconds: float = Field(gt=0, le=120)
    secondary_cleanup_timeout_seconds: float = Field(gt=0, le=120)
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
        if (
            self.storage_busy_timeout_seconds * self.storage_retry_limit
            + self.storage_retry_interval_seconds * (self.storage_retry_limit - 1)
            >= self.job_timeout_seconds
        ):
            raise ValueError("Storage retry budget must fit inside the browser job timeout")
        return self


class NotificationWorkflowControl(_ControlModel):
    uv_version: str = Field(pattern=r"^[0-9]+\.[0-9]+\.[0-9]+$")
    minimum_free_disk_mb: int = Field(ge=512, le=65536)
    cache_max_mb: int = Field(ge=64, le=8192)
    cleanup_free_disk_mb: int = Field(ge=512, le=65536)
    uv_tool_versions_to_keep: int = Field(ge=1, le=5)
    setup_timeout_minutes: int = Field(ge=1, le=30)
    install_timeout_minutes: int = Field(ge=1, le=60)
    process_timeout_minutes: int = Field(ge=6, le=60)
    http_timeout_seconds: int = Field(ge=1, le=120)
    http_retries: int = Field(ge=0, le=5)
    cache_cleanup_timeout_seconds: int = Field(ge=1, le=120)

    @model_validator(mode="after")
    def validate_cleanup_reserve(self) -> "NotificationWorkflowControl":
        if self.cleanup_free_disk_mb < self.minimum_free_disk_mb:
            raise ValueError("Cleanup free disk threshold must include the minimum disk reserve")
        return self


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

    @model_validator(mode="after")
    def validate_endpoint(self) -> "InstagramDigestControl":
        if self.endpoint_url.host != "i.instagram.com":
            raise ValueError("Instagram digest endpoint must use i.instagram.com")
        if self.endpoint_url.path != "/graphql/query":
            raise ValueError("Instagram digest endpoint must use /graphql/query")
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


class IngestionControl(_ControlModel):
    model: str = Field(pattern=r"^claude-[a-z0-9-]+$")
    process_interval_seconds: int = Field(ge=60, le=3600)
    process_time_budget_seconds: int = Field(gt=0, le=3600)
    directory_scrape_interval_seconds: int = Field(ge=3600, le=86400)
    claim_lease_seconds: int = Field(gt=0, le=86400)
    max_attempts: int = Field(ge=1, le=10)
    checked_ttl_days: int = Field(ge=1, le=365)
    model_timeout_seconds: int = Field(gt=0, le=1800)
    max_images_per_item: int = Field(ge=0, le=20)
    storage_busy_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    directory_max_listing_pages: int = Field(gt=0, le=200)
    directory_max_detail_pages_per_source: int = Field(gt=0, le=5000)
    fetch_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)
    fetch_max_text_characters: int = Field(gt=0, le=100000)
    fetch_max_images: int = Field(gt=0, le=50)
    launch_agent_timeout_seconds: float = Field(gt=0, le=120, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_budgets(self) -> "IngestionControl":
        if self.process_time_budget_seconds >= self.process_interval_seconds:
            raise ValueError("Ingestion processing must finish before its next interval")
        if self.claim_lease_seconds <= self.model_timeout_seconds:
            raise ValueError("Ingestion claims must outlive one model call")
        return self


class ControlBox(_ControlModel):
    positions: PositionsControl
    database: DatabaseControl
    ecs_runtime: EcsRuntimeControl
    image_delivery: ImageDeliveryControl
    discovery_cache: DiscoveryCacheControl
    discovery_queries: DiscoveryQueriesControl
    google_analytics: GoogleAnalyticsControl
    event_discovery: EventDiscoveryControl
    client_cache: ClientCacheControl
    interaction_tracking: InteractionTrackingControl
    authentication: AuthenticationControl
    club_management: ClubManagementControl
    recommendations: RecommendationControl
    morning_email: MorningEmailControl
    event_reminder: EventReminderControl
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
    runner_setup: RunnerSetupControl
    instagram_bell_setup: InstagramBellSetupControl
    instagram_digest: InstagramDigestControl
    instagram_publishing: InstagramPublishingControl
    workflow_failure_alerts: WorkflowFailureAlertsControl
    promoter_program: PromoterProgramControl


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
