import json

import pytest

from services.scraper.instagram_embed import extract_post
from services.scraper.pipeline import _extract_image_urls
from services.scraper.single_user import exact_post_results_match_targets

URL = "https://www.instagram.com/p/ABC123/"


def media():
    return {
        "code": "ABC123",
        "user": {"username": "campusclub"},
        "taken_at": 1700000000,
        "caption": {"text": "Come dance!"},
        "image_versions2": {"candidates": [{"url": "https://example.com/post.jpg"}]},
    }


def test_digest_media_reuses_pipeline_contract():
    payload = {"data": {"subscription_digest_feed": {"items": [{"media": media()}]}}}
    post = extract_post(json.dumps(payload), URL)
    assert post["caption"] == "Come dance!"
    assert exact_post_results_match_targets([URL], [post])
    assert _extract_image_urls(post) == ["https://example.com/post.jpg"]


def test_embedded_json_carousel_preserves_order():
    item = media()
    item.update(carousel_media_count=2, carousel_media=[media(), media()])
    item["carousel_media"][1]["image_versions2"]["candidates"][0]["url"] = (
        "https://example.com/2.jpg"
    )
    post = extract_post(f'<script type="application/json">{json.dumps(item)}</script>', URL)
    assert len(post["images"]) == 2
    assert post["images"][1] == "https://example.com/2.jpg"


@pytest.mark.parametrize("field", ["caption", "user", "image_versions2"])
def test_rejects_incomplete_media(field):
    item = media()
    del item[field]
    with pytest.raises(ValueError):
        extract_post(json.dumps(item), URL)


def test_rejects_partial_carousel():
    item = media()
    item.update(carousel_media_count=2, carousel_media=[media()])
    with pytest.raises(ValueError, match="Incomplete carousel"):
        extract_post(json.dumps(item), URL)


@pytest.mark.parametrize("payload", ["<html>Log in</html>", '{"shortcode":"ABC123"}', "{}"])
def test_rejects_shell_or_unrelated_response(payload):
    with pytest.raises(ValueError, match="No complete matching"):
        extract_post(payload, URL)


def test_rejects_non_instagram_url():
    with pytest.raises(ValueError):
        extract_post(json.dumps(media()), "https://example.com/p/ABC123/")


def test_public_carousel_initializer_without_timestamp():
    item = {
        "__typename": "GraphSidecar",
        "shortcode": "ABC123",
        "owner": {"username": "campusclub"},
        "edge_media_to_caption": {"edges": [{"node": {"text": "Three slides"}}]},
        "edge_sidecar_to_children": {
            "edges": [{"node": {"display_url": f"https://example.com/{i}.jpg"}} for i in range(3)]
        },
    }
    context = json.dumps({"gql_data": {"shortcode_media": item}})
    initializer = json.dumps({"contextJSON": context})
    post = extract_post(f"<script>someInitializer({initializer});</script>", URL)
    assert post["timestamp"] is None
    assert post["caption"] == "Three slides"
    assert len(_extract_image_urls(post)) == 3


@pytest.mark.parametrize("timestamp", [True, "yesterday"])
def test_rejects_invalid_timestamp(timestamp):
    item = media()
    item["taken_at"] = timestamp
    with pytest.raises(ValueError, match="Invalid timestamp"):
        extract_post(json.dumps(item), URL)


def _simple_embed(*, sidecar=False, linked_url=URL):
    flags = json.dumps({"isRichEmbed": False, "isSidecar": sidecar})
    return (
        f'<script>init([["PolarisEmbedSimple","init",[],[{flags}]]]);</script>'
        f'<a class="EmbeddedMedia" href="{linked_url}"></a>'
        '<img class="EmbeddedMediaImage" src="https://example.com/post.jpg">'
        '<div class="Caption"><a class="CaptionUsername">club</a><br>'
        "Come &amp; join!<br>Tomorrow</div>"
    )


def test_single_image_embed_preserves_caption_and_missing_timestamp():
    post = extract_post(_simple_embed(), URL)
    assert post["caption"] == "Come & join!\nTomorrow"
    assert post["ownerUsername"] == "club"
    assert post["timestamp"] is None
    assert post["images"] == ["https://example.com/post.jpg"]


def test_carousel_cannot_degrade_to_cover_image():
    with pytest.raises(ValueError):
        extract_post(_simple_embed(sidecar=True), URL)


def test_single_image_must_match_requested_post():
    with pytest.raises(ValueError, match="does not match"):
        extract_post(_simple_embed(linked_url="https://www.instagram.com/p/OTHER/"), URL)


def test_mixed_carousel_keeps_video_thumbnail():
    item = media()
    item.update(carousel_media=[media(), media()], carousel_media_count=2)
    item["carousel_media"][1]["media_type"] = 2
    assert len(extract_post(json.dumps(item), URL)["images"]) == 2


def test_rejects_carousel_with_missing_slide_image():
    item = media()
    item.update(carousel_media=[media(), {"media_type": 2}], carousel_media_count=2)
    with pytest.raises(ValueError, match="missing a usable image"):
        extract_post(json.dumps(item), URL)
