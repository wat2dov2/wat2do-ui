import json
import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from core.controlbox import EcsRuntimeControl, GoogleAnalyticsControl, controlbox, load_controlbox

_SOURCE = Path(__file__).resolve().parents[2] / "controlbox"


def _write_control(tmp_path: Path, feature: str, mutate) -> Path:
    directory = tmp_path / "controlbox"
    shutil.copytree(_SOURCE, directory)
    path = directory / f"{feature}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    mutate(payload)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return directory


@pytest.mark.parametrize("measurement_id", ["", "G-ABC123DEF4"])
def test_google_analytics_accepts_disabled_or_configured_tracking(measurement_id):
    assert GoogleAnalyticsControl(measurement_id=measurement_id).measurement_id == measurement_id


@pytest.mark.parametrize("measurement_id", ["UA-1234", "G-", "G-test", "<script>"])
def test_google_analytics_rejects_invalid_measurement_ids(measurement_id):
    with pytest.raises(ValidationError):
        GoogleAnalyticsControl(measurement_id=measurement_id)


def test_checked_in_controlbox_is_valid() -> None:
    assert controlbox.notification_defaults.morning_email is False
    assert controlbox.email_delivery.notification_consent_version == "2026-09"
    assert controlbox.reel_transcription.model == "gpt-4o-mini-transcribe"
    assert controlbox.recommendations.snapshot.candidate_events_per_school == 1000
    assert controlbox.morning_email.new_event_window_hours == 24
    assert controlbox.event_reminder.lead_minutes == 60
    assert controlbox.event_discovery.new_event_window_hours == 24
    assert controlbox.event_discovery.event_without_end_visibility_minutes == 60
    assert controlbox.club_management.initial_render_count == 24
    assert controlbox.discovery_cache.cdn_ttl_seconds == 60
    assert controlbox.event_discovery.initial_render_count == 24
    assert controlbox.event_discovery.preview_event_count == 4
    assert set(controlbox.event_discovery.campus_seasons.definitions) == {
        "homecoming",
        "holidays",
        "thanksgiving",
        "halloween",
        "winter_holidays",
        "orientation",
        "midterm_prep",
        "exam_destress",
        "finals_prep",
    }
    assert controlbox.social_previews.notification_page_size == 500
    assert controlbox.social_previews.capture_path == "/"
    assert controlbox.social_previews.viewport_width == 1200
    assert controlbox.social_previews.viewport_height == 630
    assert controlbox.social_previews.capture_scale == 0.6
    assert controlbox.social_previews.device_scale_factor == 1
    assert controlbox.social_previews.jpeg_quality == 90
    assert controlbox.social_previews.reserved_concurrency == 2
    assert controlbox.social_previews.asset_retention_days == 30
    assert str(controlbox.authentication.legacy_frontend_origins[0]) == "https://wat2do.ca/"
    assert controlbox.club_management.directory_page_size == 20
    assert [str(email) for email in controlbox.contact.recipient_emails] == [
        "e22han@uwaterloo.ca",
        "tqiu@uwaterloo.ca",
    ]
    assert controlbox.contact.rate_limit.maximum_requests == 5
    assert (
        controlbox.contact.business_support.proposed_banner_text
        < controlbox.contact.maximum_message_length
    )
    # Publishing accounts are not configured here at all: which accounts exist,
    # which school each serves, and whether each runs all come from the row
    # written when the account is connected.
    assert not hasattr(controlbox.instagram_publishing, "accounts")
    assert controlbox.instagram_publishing.new_event_window_hours == 24
    assert controlbox.instagram_publishing.maximum_event_slides == 9
    assert controlbox.instagram_publishing.status_poll_interval_seconds == 3
    assert controlbox.instagram_publishing.token_refresh_lead_days == 14
    assert controlbox.scraping.instagram_web_app_id == "936619743392459"
    assert controlbox.positions.undated_visibility_months == 4
    assert controlbox.scraping.directory_minimum_image_dimension_pixels == 160
    assert controlbox.emulator_farm.maximum_running_nodes == 1
    assert controlbox.emulator_farm.accounts_per_node == 3
    assert controlbox.emulator_farm.check_interval_seconds == 1800
    assert controlbox.emulator_farm.live_monitor_interval_seconds == 3
    assert controlbox.emulator_farm.run_headlessly is False
    assert controlbox.emulator_farm.github_repository == "wat2dov2/wat2do-ui"
    assert controlbox.emulator_farm.github_event_type == "new_instagram_post"
    assert [node.name for node in controlbox.emulator_farm.nodes] == ["ig_node_1"]
    assert [node.port for node in controlbox.emulator_farm.nodes] == [5554]
    assert controlbox.instagram_digest.operation_name == "SubscriptionDigestFeedQuery"
    assert controlbox.instagram_digest.client_doc_id == "20099285643937437306465362209"
    assert controlbox.instagram_digest.maximum_pages == 25
    assert controlbox.workflow_failure_alerts.discord_admin_role_ids == ("1506447680287674469",)
    assert controlbox.promoter_program.rate_cents == 100
    assert controlbox.promoter_program.maximum_active_posters == 50
    assert controlbox.promoter_program.payout_day_of_month == 1
    assert controlbox.promoter_program.quiet_poster_days == 30
    assert controlbox.promoter_program.tos_version == "2026-07"
    assert str(controlbox.promoter_program.discord_invite_url) == ("https://discord.gg/uVcZcp4q8R")
    assert [template.id for template in controlbox.promoter_program.approved_templates] == [
        "campus-colour",
        "campus-black-white",
        "campus-low-ink",
    ]
    assert all(
        template.qr_placement.width == pytest.approx(0.470588)
        for template in controlbox.promoter_program.approved_templates
    )


@pytest.mark.parametrize("limit", [0, 25_000_000])
def test_reel_transcription_rejects_unsafe_upload_limits(tmp_path: Path, limit: int) -> None:
    directory = _write_control(
        tmp_path, "reel_transcription", lambda payload: payload.update(maximum_media_bytes=limit)
    )
    with pytest.raises(ValidationError):
        load_controlbox(directory)


def test_upload_contract_matches_event_image_bucket() -> None:
    """The frontend picker reads this control, so it must be the bucket's own rule."""
    from core.constants import BUCKET_EVENT_IMAGES
    from services.storage_service import storage

    assert storage.get_allowed_mime_types(BUCKET_EVENT_IMAGES) == [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    ]
    assert storage.get_file_size_limit(BUCKET_EVENT_IMAGES) == 5 * 1024 * 1024
    # Posters are stored at this width, so it is what every viewer receives.
    assert controlbox.uploads.event_image_rendition_width_pixels == 1080
    assert controlbox.uploads.event_image_allowed_mime_types == storage.get_allowed_mime_types(
        BUCKET_EVENT_IMAGES
    )


def test_non_image_upload_mime_type_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "uploads",
        lambda payload: payload.update({"event_image_allowed_mime_types": ["application/pdf"]}),
    )

    with pytest.raises(ValidationError, match="must be image/\\* types"):
        load_controlbox(path)


def test_duplicate_upload_mime_types_are_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "uploads",
        lambda payload: payload.update(
            {"event_image_allowed_mime_types": ["image/png", "image/png"]}
        ),
    )

    with pytest.raises(ValidationError, match="must be unique"):
        load_controlbox(path)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("notification_page_size", 0),
        ("notification_page_size", 1001),
        ("capture_scale", 0.4),
        ("device_scale_factor", 4),
        ("asset_retention_days", 6),
        ("capture_path", "/events"),
    ],
)
def test_invalid_social_preview_control_is_rejected(
    tmp_path: Path,
    field: str,
    value: float | int | str,
) -> None:
    path = _write_control(
        tmp_path,
        "social_previews",
        lambda payload: payload.update({field: value}),
    )

    with pytest.raises(ValidationError, match=field):
        load_controlbox(path)


def test_social_preview_navigation_must_fit_inside_function_timeout(
    tmp_path: Path,
) -> None:
    path = _write_control(
        tmp_path,
        "social_previews",
        lambda payload: payload.update(
            {"navigation_timeout_seconds": payload["function_timeout_seconds"]}
        ),
    )

    with pytest.raises(ValidationError, match="navigation timeout"):
        load_controlbox(path)


def test_unknown_control_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "morning_email",
        lambda payload: payload.update({"mystery_knob": 1}),
    )

    with pytest.raises(ValidationError, match="mystery_knob"):
        load_controlbox(path)


def test_invalid_discord_admin_role_id_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "workflow_failure_alerts",
        lambda payload: payload.update({"discord_admin_role_ids": ["not-a-snowflake"]}),
    )

    with pytest.raises(ValidationError, match="Discord admin role IDs"):
        load_controlbox(path)


def test_invalid_instagram_web_app_id_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "scraping",
        lambda payload: payload.update({"instagram_web_app_id": "not-an-app-id"}),
    )

    with pytest.raises(ValidationError, match="instagram_web_app_id"):
        load_controlbox(path)


@pytest.mark.parametrize(
    "field,value",
    [
        ("apify_memory_megabytes", 1000),
        ("pending_media_workers", 0),
        ("workflow_status_timeout_seconds", 0),
        ("pending_media_workers", 16),
        ("pending_media_memory_budget_megabytes", 0),
    ],
)
def test_scrape_resource_controls_are_validated(tmp_path, field, value):
    path = _write_control(tmp_path, "scraping", lambda payload: payload.update({field: value}))
    with pytest.raises(ValidationError):
        load_controlbox(path)


def test_invalid_instagram_digest_endpoint_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "instagram_digest",
        lambda payload: payload.update({"endpoint_url": "https://example.com/graphql/query"}),
    )

    with pytest.raises(ValidationError, match="must use i.instagram.com"):
        load_controlbox(path)


def _append_emulator_node(
    payload: dict[str, object],
    *,
    port: int,
) -> None:
    payload["maximum_running_nodes"] = 2
    payload["nodes"].append(
        {
            "name": "ig_node_2",
            "port": port,
        }
    )


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda payload: payload.update({"maximum_running_nodes": 4}),
            "maximum_running_nodes",
        ),
        (
            lambda payload: payload["nodes"][0].update({"port": 5555}),
            "ports must be even",
        ),
        (
            lambda payload: _append_emulator_node(payload, port=5554),
            "ports must be unique",
        ),
        (
            lambda payload: payload.update(
                {"system_image": "system-images;android-35;google_apis;x86_64"}
            ),
            "Google Play",
        ),
    ],
)
def test_invalid_emulator_farm_control_is_rejected(tmp_path: Path, mutate, message: str) -> None:
    path = _write_control(tmp_path, "emulator_farm", mutate)

    with pytest.raises(ValidationError, match=message):
        load_controlbox(path)


def test_invalid_recommendation_blend_is_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "recommendations",
        lambda payload: payload["personalization"]["hot_blend"].update({"content": 0.9}),
    )

    with pytest.raises(ValidationError, match="blend weights must total 1"):
        load_controlbox(path)


def test_invalid_cross_field_limits_are_rejected(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "recommendations",
        lambda payload: payload["snapshot"].update({"recommendations_per_user": 100}),
    )

    with pytest.raises(ValidationError, match="cannot exceed maximum_results"):
        load_controlbox(path)


def test_missing_feature_control_is_rejected(tmp_path: Path) -> None:
    path = _write_control(tmp_path, "admin", lambda payload: payload)
    (path / "admin.json").unlink()

    with pytest.raises(RuntimeError, match="Feature control file not found"):
        load_controlbox(path)


def test_promoter_template_qr_must_fit_inside_asset(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "promoter_program",
        lambda payload: payload["approved_templates"][0]["qr_placement"].update(
            {"x": 0.8, "width": 0.4}
        ),
    )

    with pytest.raises(ValidationError, match="must fit inside the asset"):
        load_controlbox(path)


def test_promoter_template_ids_must_be_unique(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "promoter_program",
        lambda payload: payload["approved_templates"][1].update(
            {"id": payload["approved_templates"][0]["id"]}
        ),
    )

    with pytest.raises(ValidationError, match="template IDs must be unique"):
        load_controlbox(path)


def test_promoter_map_buckets_must_be_unique_and_ascending(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "promoter_program",
        lambda payload: payload.update({"map_visitor_bucket_maximums": [0, 49, 9]}),
    )

    with pytest.raises(ValidationError, match="visitor bucket maximums"):
        load_controlbox(path)


def test_promoter_payout_day_must_exist_in_every_month(tmp_path: Path) -> None:
    path = _write_control(
        tmp_path,
        "promoter_program",
        lambda payload: payload.update({"payout_day_of_month": 29}),
    )

    with pytest.raises(ValidationError, match="payout_day_of_month"):
        load_controlbox(path)


@pytest.mark.parametrize(
    "field,value",
    [
        ("maximum_filters_bytes", 0),
        ("request_timeout_ms", 0),
        ("retry_delays_ms", [0]),
        ("excluded_account_emails", ["not-an-email"]),
    ],
)
def test_discovery_query_limits_are_validated(tmp_path, field, value):
    directory = _write_control(
        tmp_path, "discovery_queries", lambda payload: payload.update({field: value})
    )
    with pytest.raises(ValidationError):
        load_controlbox(directory)


def test_discovery_controls_load_checked_in_feature_sources():
    assert controlbox.database.read_attempts == 3
    assert controlbox.discovery_cache.storage_prefix == "media/discovery-cache"
    assert controlbox.discovery_cache.startup_grace_seconds == 90
    assert controlbox.image_delivery.optimized_format == "image/webp"
    assert controlbox.image_delivery.optimized_remote_host == "wat2do.io"
    assert controlbox.image_delivery.optimized_remote_path == "/media/"


def test_ecs_runtime_keeps_redundancy_and_memory_headroom():
    runtime = controlbox.ecs_runtime
    assert runtime.desired_count == 2
    assert runtime.task_cpu == runtime.frontend_cpu + runtime.backend_cpu == 1024
    assert runtime.task_memory_mib == 2048
    assert runtime.frontend_heap_mib == 768
    assert runtime.frontend_memory_reservation_mib - runtime.frontend_heap_mib == 256
    assert (
        runtime.frontend_memory_reservation_mib
        + runtime.backend_memory_reservation_mib
        + runtime.cache_init_memory_reservation_mib
    ) < runtime.task_memory_mib


@pytest.mark.parametrize(
    "patch,message",
    [
        ({"desired_count": 1}, "desired_count"),
        ({"frontend_heap_mib": 0}, "frontend_heap_mib"),
        ({"frontend_heap_mib": 1024}, "headroom"),
        ({"frontend_heap_mib": 1025}, "headroom"),
        ({"frontend_cpu": 513}, "CPU shares"),
        ({"backend_cpu": 0}, "backend_cpu"),
        ({"backend_memory_reservation_mib": 993}, "memory reservations"),
        ({"cache_init_memory_reservation_mib": 513}, "memory reservations"),
        ({"cache_init_memory_reservation_mib": 0}, "cache_init_memory_reservation_mib"),
        ({"task_cpu": 1000}, "Fargate combination"),
        ({"task_memory_mib": 1024}, "Fargate combination"),
        ({"task_memory_mib": 2049}, "Fargate combination"),
        ({"task_memory_mib": 9216}, "Fargate combination"),
        ({"task_cpu": 8192, "task_memory_mib": 17408}, "Fargate combination"),
        ({"task_cpu": 16384, "task_memory_mib": 36864}, "Fargate combination"),
    ],
)
def test_ecs_runtime_rejects_unsafe_capacity(tmp_path, patch, message):
    directory = _write_control(tmp_path, "ecs_runtime", lambda payload: payload.update(patch))
    with pytest.raises(ValidationError, match=message):
        load_controlbox(directory)


@pytest.mark.parametrize(
    "cpu,memory_mib",
    [
        (256, 2048),
        (512, 4096),
        (1024, 8192),
        (2048, 16384),
        (4096, 30720),
        (8192, 61440),
        (16384, 122880),
        (32768, 249856),
    ],
)
def test_ecs_runtime_accepts_supported_fargate_sizes(cpu, memory_mib):
    values = controlbox.ecs_runtime.model_dump()
    values.update(
        task_cpu=cpu, task_memory_mib=memory_mib, frontend_cpu=cpu // 2, backend_cpu=cpu // 2
    )
    assert EcsRuntimeControl.model_validate(values).task_memory_mib == memory_mib


@pytest.mark.parametrize(
    "feature,patch",
    [
        ("contact", {"recipient_emails": []}),
        ("contact", {"recipient_emails": ["not-an-email"]}),
        ("event_discovery", {"preview_event_count": 0}),
        ("event_discovery", {"preview_event_count": 101}),
        ("database", {"read_attempts": 0}),
        ("database", {"read_attempts": 6}),
        ("database", {"read_backoff_initial_seconds": -1}),
        ("database", {"read_backoff_jitter_seconds": -1}),
        ("database", {"read_backoff_max_seconds": float("inf")}),
        ("database", {"read_backoff_max_seconds": 0.01}),
        ("discovery_cache", {"schema_version": 0}),
        ("discovery_cache", {"page_concurrency": 0}),
        ("discovery_cache", {"page_concurrency": 9}),
        ("discovery_cache", {"maximum_page_count": 0}),
        ("discovery_cache", {"state_write_attempts": 0}),
        ("discovery_cache", {"startup_grace_seconds": 0}),
        ("discovery_cache", {"deployment_timeout_seconds": 690}),
        ("discovery_cache", {"maximum_snapshot_age_seconds": 300}),
        (
            "discovery_cache",
            {"generation_retention_days": 2, "maximum_snapshot_age_seconds": 172800},
        ),
        (
            "discovery_cache",
            {"worker_interval_seconds": controlbox.discovery_cache.refresh_interval_seconds + 1},
        ),
        ("discovery_cache", {"lease_seconds": 20, "request_timeout_seconds": 20}),
        ("discovery_cache", {"storage_prefix": "/media/discovery-cache"}),
        ("discovery_cache", {"storage_prefix": "media/../discovery-cache"}),
        ("discovery_cache", {"storage_prefix": "media//discovery-cache"}),
        ("image_delivery", {"device_sizes": []}),
        ("image_delivery", {"device_sizes": [640, 256]}),
        ("image_delivery", {"device_sizes": [256, 256]}),
        ("image_delivery", {"image_sizes": [0, 16]}),
        ("image_delivery", {"image_sizes": [256]}),
        ("image_delivery", {"warm_widths": []}),
        ("image_delivery", {"warm_concurrency": 0}),
        ("image_delivery", {"warm_concurrency": 9}),
        ("uploads", {"event_video_max_size_bytes": 0}),
        ("uploads", {"event_video_download_timeout_seconds": 0}),
        ("image_delivery", {"warm_widths": [385]}),
        ("image_delivery", {"warm_widths": [640, 384]}),
        ("image_delivery", {"warm_request_timeout_seconds": 0}),
        ("image_delivery", {"warm_retry_seconds": 0}),
        ("image_delivery", {"warm_success_ttl_seconds": 0}),
        ("image_delivery", {"quality": 0}),
        ("image_delivery", {"quality": 101}),
        ("image_delivery", {"first_row_image_count": 25}),
        ("image_delivery", {"optimized_format": "image/avif"}),
        ("image_delivery", {"optimized_remote_host": "https://wat2do.io"}),
        ("image_delivery", {"optimized_remote_host": "*.wat2do.io"}),
        ("image_delivery", {"optimized_remote_path": "/media/../"}),
    ],
)
def test_discovery_control_limits_reject_unsafe_configuration(tmp_path, feature, patch):
    directory = _write_control(tmp_path, feature, lambda payload: payload.update(patch))
    with pytest.raises(ValidationError):
        load_controlbox(directory)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda seasons: seasons["definitions"]["homecoming"].update(labels={"fr": "HOCO"}),
        lambda seasons: seasons["definitions"]["homecoming"].update(labels={"en": " "}),
        lambda seasons: seasons["schools"].update(
            {"Bad Slug": {"instructions": "test", "seasons": []}}
        ),
        lambda seasons: seasons["schools"]["uwaterloo"]["seasons"][0].update(id="unknown"),
        lambda seasons: seasons["schools"]["uwaterloo"]["seasons"][0]["display_windows"][0].update(
            filter_id="unknown"
        ),
        lambda seasons: seasons["schools"]["uwaterloo"]["seasons"][1]["display_windows"][0].pop(
            "filter_id"
        ),
        lambda seasons: seasons["schools"]["uwaterloo"]["seasons"].append(
            seasons["schools"]["uwaterloo"]["seasons"][0]
        ),
        lambda seasons: seasons["schools"]["uwaterloo"]["seasons"][0].update(
            display_windows=[
                {
                    "start_date": "2026-10-02",
                    "end_date": "2026-10-01",
                    "source_url": "https://uwaterloo.ca/calendar",
                }
            ]
        ),
        lambda seasons: seasons["schools"]["uwaterloo"]["seasons"][0].update(
            display_windows=[
                {"start_date": "2026-10-01", "end_date": "2026-10-02", "source_url": "not-a-url"}
            ]
        ),
        lambda seasons: seasons["schools"]["uwaterloo"]["seasons"][0].update(
            display_windows=[
                {
                    "start_date": "2026-10-01",
                    "end_date": "2026-10-02",
                    "source_url": "https://uwaterloo.ca/calendar",
                }
            ]
            * 2
        ),
    ],
)
def test_campus_seasons_reject_invalid_configuration(tmp_path, mutate):
    directory = _write_control(
        tmp_path, "event_discovery", lambda payload: mutate(payload["campus_seasons"])
    )
    with pytest.raises(ValidationError):
        load_controlbox(directory)


def test_instagram_browser_controls_have_one_shared_timing_source():
    assert controlbox.instagram_browser.school_username_overrides == {"uwaterloo": "wat2do.ca"}
    assert controlbox.instagram_browser.actions == ("like", "save", "repost")
    assert controlbox.instagram_browser.job_timeout_seconds == 120
    assert controlbox.instagram_browser.result_timeout_seconds == 300
    assert controlbox.instagram_browser.engagement_interval_seconds == 10
    assert controlbox.instagram_browser.source_page_size == 100
    assert controlbox.instagram_browser.result_timeout_seconds > (
        controlbox.instagram_browser.job_timeout_seconds
    )
    assert not hasattr(controlbox.instagram_digest, "request_timeout_seconds")
    assert not hasattr(controlbox.instagram_digest, "interaction_timeout_seconds")
    assert not hasattr(controlbox.instagram_digest, "poll_interval_seconds")


@pytest.mark.parametrize(
    "patch",
    [
        {"request_timeout_seconds": 0},
        {"request_timeout_seconds": 121},
        {"interaction_timeout_seconds": 0},
        {"poll_interval_seconds": 0},
        {"worker_poll_interval_seconds": 0},
        {"job_timeout_seconds": 0},
        {"job_timeout_seconds": 301},
        {"result_timeout_seconds": 120},
        {"source_poll_interval_seconds": 0},
        {"source_page_size": 0},
        {"source_page_size": 1001},
        {"engagement_interval_seconds": 0},
        {"actions": []},
        {"actions": ["like", "like"]},
        {"actions": ["unlike"]},
        {"school_username_overrides": {"uwaterloo": "someone_else"}},
        {"school_username_overrides": {"../uwaterloo": "wat2do.ca"}},
        {"school_username_overrides": {"uwaterloo": "wat2do." + "a" * 30}},
        {"sessionid": "credentials-do-not-belong-in-controlbox"},
    ],
)
def test_instagram_browser_controls_reject_unsafe_worker_configuration(tmp_path, patch):
    directory = _write_control(
        tmp_path,
        "instagram_browser",
        lambda payload: payload.update(patch),
    )
    with pytest.raises(ValidationError):
        load_controlbox(directory)


@pytest.mark.parametrize(
    "field",
    [
        "business_name",
        "location",
        "website",
        "reason_for_support",
        "proposed_banner_text",
        "student_traffic_per_week",
        "discount",
        "email",
    ],
)
def test_business_nomination_limits_must_be_positive(tmp_path: Path, field: str) -> None:
    directory = _write_control(
        tmp_path,
        "contact",
        lambda payload: payload["business_support"].update({field: 0}),
    )
    with pytest.raises(ValidationError):
        load_controlbox(directory)
