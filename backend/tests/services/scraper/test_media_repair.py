from dataclasses import replace
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from PIL import Image

from core.constants import BUCKET_EVENT_IMAGES
from core.exceptions import ValidationError
from services.scraper import media_repair as module
from services.storage_service import StorageService


@pytest.fixture
def target():
    return module.MediaRepairTarget(
        resource="events",
        id=29122,
        school="uwaterloo",
        source_url="https://www.instagram.com/p/ORIGINAL/",
        source_image_url="https://wat2do.io/media/event-images/original.jpg",
        source_video_url=None,
    )


@pytest.fixture
def persistence(monkeypatch):
    db = MagicMock()
    query = db.table.return_value
    for operation in ("update", "eq", "is_", "select", "limit"):
        getattr(query, operation).return_value = query
    query.execute.return_value = SimpleNamespace(data=[{"id": 29122}])
    monkeypatch.setattr(module, "get_sb", lambda: db)
    refresh = MagicMock()
    monkeypatch.setattr(module.event_feed_revalidation_service, "revalidate_school", refresh)
    return db, query, refresh


@pytest.fixture
def assets(monkeypatch):
    client = MagicMock()
    storage = StorageService(client, bucket_name="test", public_base_url="https://wat2do.io/media")
    monkeypatch.setattr(module, "storage", storage)
    monkeypatch.setattr(
        storage,
        "upload_file",
        MagicMock(return_value="https://wat2do.io/media/event-images/new.jpg"),
    )
    monkeypatch.setattr(storage, "delete_file", MagicMock())
    return storage, client


def stored_poster(client, width=2160):
    image = BytesIO()
    Image.new("RGB", (width, width // 2), "red").save(image, format="JPEG")
    stream = BytesIO(image.getvalue())
    client.get_object.return_value = {"Body": stream, "ContentType": "image/jpeg"}
    return stream


def test_image_preview_reads_current_s3_asset_without_writing(target, assets, persistence):
    storage, client = assets
    stream = stored_poster(client)
    db, _, refresh = persistence
    result = module.repair_stored_image(target)
    assert result["status"] == "ready"
    assert result["new_width"] == 1080
    assert result["new_height"] == 540
    assert result["new_bytes"] < result["original_bytes"]
    client.get_object.assert_called_once_with(Bucket="test", Key="media/event-images/original.jpg")
    assert stream.closed
    storage.upload_file.assert_not_called()
    db.table.assert_not_called()
    refresh.assert_not_called()


def test_image_repair_keeps_old_immutable_asset_and_updates_only_expected_reference(
    target, assets, persistence
):
    storage, client = assets
    stored_poster(client)
    _, query, refresh = persistence
    result = module.repair_stored_image(target, apply=True)
    assert result["status"] == "updated"
    query.update.assert_called_once_with(
        {"source_image_url": "https://wat2do.io/media/event-images/new.jpg"}
    )
    assert ("id", 29122) in [call.args for call in query.eq.call_args_list]
    assert ("source_image_url", target.source_image_url) in [
        call.args for call in query.eq.call_args_list
    ]
    storage.delete_file.assert_not_called()
    refresh.assert_called_once_with("uwaterloo", resources=("events",))


def test_changed_image_target_does_not_overwrite_newer_reference(target, assets, persistence):
    storage, client = assets
    stored_poster(client)
    _, query, refresh = persistence
    query.execute.return_value = SimpleNamespace(data=[])
    assert module.repair_stored_image(target, apply=True)["status"] == "conflict"
    storage.delete_file.assert_called_once_with(BUCKET_EVENT_IMAGES, "new.jpg")
    refresh.assert_not_called()


def test_uncertain_database_result_preserves_uploaded_asset(target, assets, persistence):
    storage, client = assets
    stored_poster(client)
    _, query, _ = persistence
    query.execute.side_effect = RuntimeError("response lost after commit")
    with pytest.raises(RuntimeError):
        module.repair_stored_image(target, apply=True)
    storage.delete_file.assert_not_called()


def test_small_image_and_foreign_asset_never_write(target, assets):
    storage, client = assets
    stored_poster(client, width=320)
    assert module.repair_stored_image(target, apply=True)["status"] == "already_sized"
    foreign = replace(target, source_image_url="https://other.example/image.jpg")
    assert module.repair_stored_image(foreign, apply=True)["status"] == "unavailable"
    storage.upload_file.assert_not_called()
    assert client.get_object.call_count == 1


@pytest.fixture
def video_upload(monkeypatch):
    upload = MagicMock(return_value="https://wat2do.io/media/event-videos/repaired.mp4")
    monkeypatch.setattr(module, "upload_video_from_url", upload)
    return upload


def video_post(**overrides):
    return {
        "url": "https://www.instagram.com/reel/ORIGINAL/",
        "videoUrl": "https://scontent.cdninstagram.com/video.mp4?private-signature=redacted",
        **overrides,
    }


def test_video_preview_checks_exact_post_and_does_not_export_signed_query(
    target, video_upload, persistence
):
    result = module.repair_stored_video(target, video_post())
    assert result["status"] == "ready"
    assert result["source_video_host"] == "scontent.cdninstagram.com"
    assert "private-signature" not in str(result)
    video_upload.assert_not_called()
    persistence[0].table.assert_not_called()


def test_video_repairs_only_missing_selected_row_and_refreshes_position_directory(
    target, video_upload, persistence
):
    target = replace(target, resource="positions")
    db, query, refresh = persistence
    result = module.repair_stored_video(target, video_post(), apply=True)
    assert result["status"] == "updated"
    db.table.assert_called_once_with("positions")
    query.is_.assert_called_once_with("source_video_url", "null")
    assert ("source_url", target.source_url) in [call.args for call in query.eq.call_args_list]
    assert ("id", target.id) in [call.args for call in query.eq.call_args_list]
    refresh.assert_called_once_with("uwaterloo", resources=("positions",))
    video_upload.assert_called_once_with(video_post()["videoUrl"])


def test_existing_video_is_not_downloaded_again(target, video_upload):
    target = replace(target, source_video_url="https://wat2do.io/media/event-videos/old.mp4")
    assert (
        module.repair_stored_video(target, video_post(), apply=True)["status"] == "already_present"
    )
    video_upload.assert_not_called()


def test_wrong_post_and_carousel_never_download_or_write(target, video_upload, persistence):
    with pytest.raises(ValidationError, match="exact Instagram post"):
        module.repair_stored_video(
            target, video_post(url="https://instagram.com/p/OTHER/"), apply=True
        )
    result = module.repair_stored_video(
        target, video_post(childPosts=[{"videoUrl": "child.mp4"}]), apply=True
    )
    assert result["status"] == "unsupported"
    assert "association" in result["reason"]
    video_upload.assert_not_called()
    persistence[0].table.assert_not_called()


@pytest.mark.parametrize("children", [None, []])
def test_declared_carousel_missing_children_is_still_ambiguous(target, video_upload, children):
    result = module.repair_stored_video(
        target, video_post(type="Sidecar", childPosts=children), apply=True
    )
    assert result["status"] == "unsupported"
    assert "association" in result["reason"]
    video_upload.assert_not_called()


def test_failed_video_download_keeps_image_and_existing_row(target, video_upload, persistence):
    video_upload.return_value = None
    assert module.repair_stored_video(target, video_post(), apply=True)["status"] == "failed"
    persistence[0].table.assert_not_called()


def test_loading_target_requires_only_selected_public_media_fields(persistence):
    db, query, _ = persistence
    query.execute.return_value = SimpleNamespace(
        data=[
            {
                "id": 12,
                "source_url": None,
                "source_image_url": None,
                "source_video_url": None,
                "school_record": {"slug": "udem"},
            }
        ]
    )
    result = module.load_media_target("positions", 12)
    assert result.school == "udem"
    assert result.resource == "positions"
    db.table.assert_called_once_with("positions")
    query.eq.assert_called_once_with("id", 12)
    query.limit.assert_called_once_with(1)


@pytest.mark.parametrize("apply", [False, True])
def test_directory_spinner_is_cleared_only_after_owned_image_validation(
    target, assets, persistence, monkeypatch, apply
):
    from services.scraper import directory_scraper

    storage, client = assets
    db, query, refresh = persistence
    selected = replace(target, school="uwaterloo", source_url="https://wusa.ca/event/lunch")
    stored_poster(client, width=40)
    monkeypatch.setattr(
        directory_scraper, "scrape_event_page", lambda url, config: ("Lunch details", [])
    )
    result = module.repair_directory_image(selected, apply=apply)
    assert result["width"] == 40
    assert result["status"] == ("updated" if apply else "ready")
    if apply:
        query.update.assert_called_once_with({"source_image_url": None})
        query.eq.assert_any_call("source_image_url", selected.source_image_url)
        query.eq.assert_any_call("source_url", selected.source_url)
        refresh.assert_called_once_with("uwaterloo", resources=("events", "clubs"))
    else:
        query.update.assert_not_called()
        refresh.assert_not_called()
