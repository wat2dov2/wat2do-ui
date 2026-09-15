"""Validated, non-secret feature controls loaded from ``backend/controlbox``."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

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


class EventDiscoveryControl(_ControlModel):
    feed_revalidate_seconds: int = Field(gt=0)
    new_event_window_hours: int = Field(gt=0)
    event_without_end_visibility_minutes: int = Field(gt=0)
    initial_render_count: int = Field(gt=0, le=100)
    server_feed_page_size: int = Field(gt=0, le=100)


class ClientCacheControl(_ControlModel):
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
    directory_page_size: int = Field(gt=0, le=100)
    directory_revalidate_seconds: int = Field(gt=0)
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


class ScrapingControl(_ControlModel):
    apify_timeout_seconds: int = Field(gt=0)
    poll_interval_seconds: int = Field(gt=0)
    instagram_web_app_id: str = Field(pattern=r"^[0-9]{10,20}$")
    single_user_recent_post_minutes: int = Field(gt=0)
    same_club_title_threshold: float = Field(ge=0, le=1)
    title_similarity_threshold: float = Field(ge=0, le=1)
    location_similarity_threshold: float = Field(ge=0, le=1)
    description_similarity_threshold: float = Field(ge=0, le=1)
    directory_maximum_events_per_source: int = Field(gt=0, le=100)
    maximum_candidates: int = Field(gt=0)
    maximum_cross_club_candidates: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_candidate_limits(self) -> "ScrapingControl":
        if self.maximum_cross_club_candidates > self.maximum_candidates:
            raise ValueError("maximum_cross_club_candidates cannot exceed maximum_candidates")
        return self


class PublicAttendanceControl(_ControlModel):
    maximum_display_names: int = Field(gt=0)


class SocialPreviewsControl(_ControlModel):
    refresh_interval_hours: int = Field(gt=0, le=24)
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


class ContactControl(_ControlModel):
    recipient_email: EmailStr
    maximum_message_length: int = Field(gt=0, le=20_000)
    rate_limit: RateLimitControl


class SiteBannerControl(_ControlModel):
    """How long dismissing the site-wide banner keeps it hidden."""

    dismissal_days: int = Field(gt=0, le=365)


class AdminControl(_ControlModel):
    items_per_page: int = Field(gt=0)


class UploadsControl(_ControlModel):
    """Client-facing upload contract, shared verbatim with the frontend picker."""

    event_image_allowed_mime_types: list[str] = Field(min_length=1)
    event_image_max_size_bytes: int = Field(gt=0)
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


class InstagramPublishingControl(_ControlModel):
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


class EmulatorFarmNodeControl(_ControlModel):
    name: str = Field(pattern=r"^ig_node_[1-9][0-9]*$")
    port: int = Field(ge=5554, le=5682)

    @model_validator(mode="after")
    def validate_node(self) -> "EmulatorFarmNodeControl":
        if self.port % 2:
            raise ValueError("emulator console ports must be even")
        return self


class EmulatorFarmControl(_ControlModel):
    maximum_running_nodes: int = Field(gt=0, le=3)
    accounts_per_node: int = Field(gt=0, le=3)
    check_interval_seconds: int = Field(ge=300)
    live_monitor_interval_seconds: int = Field(ge=1, le=60)
    boot_timeout_seconds: int = Field(gt=0, le=900)
    notification_evidence_max_age_seconds: int = Field(gt=0, le=604800)
    system_image: str = Field(min_length=1)
    device_profile: str = Field(pattern=r"^[a-z0-9_]+$")
    memory_megabytes_per_node: int = Field(ge=2048, le=6144)
    cpu_cores_per_node: int = Field(ge=1, le=4)
    run_headlessly: bool
    instagram_package: Literal["com.instagram.android"]
    automate_package: Literal["com.llamalab.automate"]
    recipient_id_key: Literal["com.instagram.android.igns.logging.intended_recipient_id"]
    github_repository: str = Field(pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    github_event_type: Literal["new_instagram_post"]
    nodes: tuple[EmulatorFarmNodeControl, ...] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def validate_farm(self) -> "EmulatorFarmControl":
        if len(self.nodes) != self.maximum_running_nodes:
            raise ValueError("configured emulator nodes must equal maximum_running_nodes")
        names = [node.name for node in self.nodes]
        ports = [node.port for node in self.nodes]
        if len(names) != len(set(names)):
            raise ValueError("emulator node names must be unique")
        if len(ports) != len(set(ports)):
            raise ValueError("emulator node ports must be unique")
        if "google_apis_playstore" not in self.system_image:
            raise ValueError("emulator farm system image must include Google Play")
        if not self.system_image.endswith(";arm64-v8a"):
            raise ValueError("emulator farm system image must use arm64-v8a")
        return self


class InstagramDigestControl(_ControlModel):
    endpoint_url: HttpUrl
    operation_name: Literal["SubscriptionDigestFeedQuery"]
    client_doc_id: str = Field(pattern=r"^[0-9]{20,40}$")
    web_app_id: str = Field(pattern=r"^[0-9]{10,20}$")
    request_timeout_seconds: float = Field(gt=0, le=120)
    interaction_timeout_seconds: float = Field(gt=0, le=120)
    poll_interval_seconds: float = Field(gt=0, le=5)
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
    banner_dismissal_days: int = Field(gt=0)
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


class ControlBox(_ControlModel):
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
    email_delivery: EmailDeliveryControl
    contact: ContactControl
    site_banner: SiteBannerControl
    admin: AdminControl
    uploads: UploadsControl
    public_attendance: PublicAttendanceControl
    social_previews: SocialPreviewsControl
    emulator_farm: EmulatorFarmControl
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
