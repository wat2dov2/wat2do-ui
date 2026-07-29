"""Validated, non-secret feature controls loaded from ``backend/controlbox``."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

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
    organization_affinity: float = Field(ge=0, le=1)
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


class OrganizationManagementControl(_ControlModel):
    invite_expiration_days: int = Field(gt=0)


class LootTierControl(_ControlModel):
    grey: int = Field(ge=0, le=100)
    bronze: int = Field(ge=0, le=100)
    silver: int = Field(ge=0, le=100)
    gold: int = Field(ge=0, le=100)
    diamond: int = Field(ge=0, le=100)

    @model_validator(mode="after")
    def validate_ordering(self) -> "LootTierControl":
        thresholds = [self.grey, self.bronze, self.silver, self.gold, self.diamond]
        if thresholds != sorted(set(thresholds)):
            raise ValueError("loot tier thresholds must be unique and ascending")
        if self.grey != 0:
            raise ValueError("grey loot tier must start at zero")
        return self


class MorningEmailControl(_ControlModel):
    local_send_hour: int = Field(ge=0, le=23)
    new_event_window_hours: int = Field(gt=0)
    minimum_recommendation_score: float = Field(ge=0, le=1)
    provider_attempts: int = Field(gt=0, le=10)
    loot_tiers: LootTierControl


class EventReminderControl(_ControlModel):
    lead_minutes: int = Field(gt=0)
    early_tolerance_minutes: int = Field(ge=0)
    late_tolerance_minutes: int = Field(ge=0)
    provider_attempts: int = Field(gt=0, le=10)


class NotificationDefaultsControl(_ControlModel):
    morning_email: bool
    event_reminder: bool
    event_change: bool


class PromotionPackageControl(_ControlModel):
    credits: int = Field(gt=0)
    days: int = Field(gt=0)


class CreditsControl(_ControlModel):
    new_user_balance: int = Field(ge=0)
    maximum_admin_add: int = Field(gt=0)
    default_promotion_package: str = Field(min_length=1)
    promotion_packages: dict[str, PromotionPackageControl] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_default_package(self) -> "CreditsControl":
        if self.default_promotion_package not in self.promotion_packages:
            raise ValueError("default_promotion_package must exist in promotion_packages")
        return self


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
    maximum_saved_organizations_per_user: int = Field(gt=0)


class ScrapingControl(_ControlModel):
    apify_timeout_seconds: int = Field(gt=0)
    poll_interval_seconds: int = Field(gt=0)
    single_user_recent_post_minutes: int = Field(gt=0)
    same_organization_title_threshold: float = Field(ge=0, le=1)
    title_similarity_threshold: float = Field(ge=0, le=1)
    location_similarity_threshold: float = Field(ge=0, le=1)
    description_similarity_threshold: float = Field(ge=0, le=1)
    maximum_candidates: int = Field(gt=0)
    maximum_cross_organization_candidates: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_candidate_limits(self) -> "ScrapingControl":
        if self.maximum_cross_organization_candidates > self.maximum_candidates:
            raise ValueError(
                "maximum_cross_organization_candidates cannot exceed maximum_candidates"
            )
        return self


class AiGenerationControl(_ControlModel):
    maximum_output_tokens: int = Field(gt=0)


class PublicAttendanceControl(_ControlModel):
    maximum_display_names: int = Field(gt=0)


class EmailDeliveryControl(_ControlModel):
    provider_timeout_seconds: float = Field(gt=0)


class AdminControl(_ControlModel):
    items_per_page: int = Field(gt=0)


class InstagramPublishingAccountControl(_ControlModel):
    key: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=100)
    school: str = Field(min_length=1, max_length=255)
    instagram_username: str = Field(
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z0-9._]+$",
    )
    enabled: bool = True


class InstagramPublishingControl(_ControlModel):
    graph_api_version: str = Field(pattern=r"^v[0-9]+\.[0-9]+$")
    accounts: tuple[InstagramPublishingAccountControl, ...] = Field(min_length=1)
    generation_timezone: str = Field(min_length=1)
    fallback_window_hours: int = Field(gt=0)
    new_event_window_hours: int = Field(gt=0)
    minimum_lead_hours: int = Field(ge=0)
    maximum_lead_days: int = Field(gt=0)
    maximum_ai_candidates: int = Field(gt=0, le=100)
    maximum_event_slides: int = Field(gt=0, le=9)
    meta_poll_attempts: int = Field(gt=0, le=30)
    meta_poll_interval_seconds: float = Field(gt=0, le=30)
    meta_request_timeout_seconds: float = Field(gt=0, le=120)
    token_lifetime_days: int = Field(gt=0, le=90)
    token_refresh_lead_days: int = Field(gt=0, le=30)

    @model_validator(mode="after")
    def validate_unique_accounts(self) -> "InstagramPublishingControl":
        keys = [account.key for account in self.accounts]
        if len(keys) != len(set(keys)):
            raise ValueError("instagram publishing account keys must be unique")
        schools = [account.school for account in self.accounts]
        if len(schools) != len(set(schools)):
            raise ValueError("instagram publishing account schools must be unique")
        usernames = [account.instagram_username.casefold() for account in self.accounts]
        if len(usernames) != len(set(usernames)):
            raise ValueError("instagram publishing account usernames must be unique")
        if self.token_refresh_lead_days >= self.token_lifetime_days:
            raise ValueError("instagram token refresh lead must be shorter than token lifetime")
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


class ControlBox(_ControlModel):
    event_discovery: EventDiscoveryControl
    client_cache: ClientCacheControl
    interaction_tracking: InteractionTrackingControl
    authentication: AuthenticationControl
    organization_management: OrganizationManagementControl
    recommendations: RecommendationControl
    morning_email: MorningEmailControl
    event_reminder: EventReminderControl
    notification_defaults: NotificationDefaultsControl
    credits: CreditsControl
    interaction_ingestion: InteractionIngestionControl
    rate_limits: RateLimitsControl
    scraping: ScrapingControl
    ai_generation: AiGenerationControl
    email_delivery: EmailDeliveryControl
    admin: AdminControl
    public_attendance: PublicAttendanceControl
    instagram_publishing: InstagramPublishingControl
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
