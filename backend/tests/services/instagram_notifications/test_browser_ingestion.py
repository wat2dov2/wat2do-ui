from copy import deepcopy
from types import SimpleNamespace

import pytest

from services.instagram_notifications import browser_ingestion as module
from services.instagram_notifications import notification_ingestion as bridge
from services.instagram_notifications.browser_queue import BrowserJobQueue

RECIPIENT = "12342599092"
ACCOUNT = "ubc.wat2do.io"
URL = "https://www.instagram.com/p/AbC/"
POST = {
    "url": URL,
    "ownerUsername": "club",
    "timestamp": "2026-10-04T12:00:00+00:00",
    "caption": "Workshop with snacks",
    "type": "Sidecar",
    "coauthors": [{"username": "cohost"}],
    "childPosts": [
        {"displayUrl": "https://s.cdninstagram.com/one.jpg"},
        {
            "type": "Video",
            "displayUrl": "https://s.cdninstagram.com/two.jpg",
            "videoUrl": "https://s.cdninstagram.com/two.mp4",
        },
    ],
}


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.com/p/AbC/",
        "https://www.instagram.com/p/AbC/?cookie=x",
        "https://user@www.instagram.com/club/",
        "http://instagram.com/club/",
    ],
)
def test_rejects_nonpublic_or_credentialed_targets(url):
    with pytest.raises(ValueError):
        module.canonical_target_url(url)


def test_verified_browser_result_preserves_carousel_video_and_coauthors():
    calls = []
    session = SimpleNamespace(
        run=lambda source: (
            "/p/AbC/" if source == "window.location.pathname" else calls.append(source)
        ),
        current_account_username=lambda: "wat2do.ca",
        poll_until=lambda predicate: predicate(),
        activate_account=lambda *_: pytest.fail("Retrieval must never switch accounts"),
        navigate_post=lambda *args, **kwargs: calls.append((args, kwargs)),
        query=lambda *_: {"state": "succeeded", "posts": [deepcopy(POST)]},
    )
    result = module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)
    assert result["account_username"] == "wat2do.ca"
    assert any("location.assign" in source for source in calls)
    assert result["posts"][0] == POST
    assert module.media_id_from_url(URL) == str(27 * 64 + 2)


@pytest.mark.parametrize(
    "mutation", ["wrong_media", "empty_carousel", "missing_video", "bad_host", "naive_time"]
)
def test_incomplete_or_mismatched_media_fails(mutation):
    post = deepcopy(POST)
    if mutation == "wrong_media":
        post["url"] = "https://www.instagram.com/p/AbD/"
    if mutation == "empty_carousel":
        post["childPosts"] = []
    if mutation == "missing_video":
        post["childPosts"][1].pop("videoUrl")
    if mutation == "bad_host":
        post["childPosts"][0]["displayUrl"] = "https://evil.com/file"
    if mutation == "naive_time":
        post["timestamp"] = "2026-10-04T12:00:00"
    session = SimpleNamespace(
        run=lambda *_: "/p/AbC/",
        current_account_username=lambda: "wat2do.ca",
        poll_until=lambda predicate: predicate(),
        activate_account=lambda *_: pytest.fail("Retrieval must never switch accounts"),
        navigate_post=lambda *_, **__: None,
        query=lambda *_: {"state": "succeeded", "posts": [post]},
    )
    with pytest.raises(module.BrowserSessionError):
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)


@pytest.fixture
def import_setup(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path)
    row = {
        "id": "d6246624-50f7-4aa1-bf0a-0d14b604d5a7",
        "source_url": URL,
        "notification": {"intended_recipient_id": RECIPIENT},
    }
    monkeypatch.setattr(bridge, "_pending_rows", lambda: [row])
    monkeypatch.setattr(bridge, "_identity", lambda *_: ("ubc", RECIPIENT, ACCOUNT))
    jid = queue.enqueue_retrieval(
        school="ubc", recipient_id=RECIPIENT, account_username=ACCOUNT, url=URL
    )
    return queue, row, jid


def test_pending_retrieval_does_not_claim_production_media(import_setup, monkeypatch):
    queue, _, _ = import_setup
    monkeypatch.setattr(
        bridge, "claim_pending_browser_media", lambda **_: pytest.fail("Not retrieved")
    )
    assert bridge.import_retrieved_media(queue)["waiting"] == 1


def test_import_uses_existing_pipeline_only_after_journaling_claim(import_setup, monkeypatch):
    queue, row, jid = import_setup
    queue.claim_next()
    queue.finish(jid, result={"account_username": "wat2do.ca", "target_url": URL, "posts": [POST]})

    def claim(**args):
        assert queue.get_setting(bridge._JOURNAL) == args
        return True

    calls = []
    monkeypatch.setattr(bridge, "claim_pending_browser_media", claim)
    monkeypatch.setattr(
        bridge,
        "run_pipeline",
        lambda **args: calls.append(args) or SimpleNamespace(status="success"),
    )
    monkeypatch.setattr(bridge, "mark_media_succeeded", lambda **_: True)
    result = bridge.import_retrieved_media(queue)
    assert result["imported"] == 1
    assert calls[0]["posts"] == [POST]
    assert calls[0]["school"] == "ubc"
    assert queue.get_setting(bridge._JOURNAL) is None


def test_import_failure_rolls_back_and_refreshes_without_success(import_setup, monkeypatch):
    queue, _, jid = import_setup
    queue.claim_next()
    queue.finish(jid, result={"account_username": "wat2do.ca", "target_url": URL, "posts": [POST]})
    monkeypatch.setattr(bridge, "claim_pending_browser_media", lambda **_: True)
    monkeypatch.setattr(
        bridge, "_import_posts", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError())
    )
    rollbacks = []
    monkeypatch.setattr(
        bridge, "rollback_media_claim", lambda **args: rollbacks.append(args) or True
    )
    monkeypatch.setattr(bridge, "mark_media_succeeded", lambda **_: pytest.fail("Failed import"))
    assert bridge.import_retrieved_media(queue)["failed"] == 1
    assert len(rollbacks) == 1
    assert queue.get(jid).state == "pending"


def test_commit_then_network_failure_keeps_recoverable_token(import_setup, monkeypatch):
    queue, _, jid = import_setup
    queue.claim_next()
    queue.finish(jid, result={"account_username": "wat2do.ca", "target_url": URL, "posts": [POST]})
    monkeypatch.setattr(
        bridge, "claim_pending_browser_media", lambda **_: (_ for _ in ()).throw(OSError())
    )
    with pytest.raises(OSError):
        bridge.import_retrieved_media(queue)
    journal = queue.get_setting(bridge._JOURNAL)
    assert journal is not None
    recovered = []
    monkeypatch.setattr(
        bridge, "rollback_media_claim", lambda **args: recovered.append(args) or True
    )
    monkeypatch.setattr(bridge, "_pending_rows", lambda: [])
    assert bridge.import_retrieved_media(queue)["recovered"] == 1
    assert recovered == [journal]


def test_import_claim_conflict_does_not_extract_or_finalize(import_setup, monkeypatch):
    queue, _, jid = import_setup
    queue.claim_next()
    queue.finish(jid, result={"account_username": "wat2do.ca", "target_url": URL, "posts": [POST]})
    monkeypatch.setattr(bridge, "claim_pending_browser_media", lambda **_: False)
    monkeypatch.setattr(
        bridge, "_import_posts", lambda *_args, **_kwargs: pytest.fail("Claim lost")
    )
    assert bridge.import_retrieved_media(queue)["imported"] == 0


def test_browser_projects_only_public_fields_and_keeps_all_carousel_children(monkeypatch):
    import json
    import shutil
    import subprocess

    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    monkeypatch.setattr(module, "_current_account_username_source", lambda: '"wat2do.ca"')
    source = module._query_source("/api/v1/media/1730/info/", "wat2do.ca", profile=False)
    media = {
        "code": "AbC",
        "taken_at": 1791115200,
        "media_type": 8,
        "user": {"username": "club", "private_internal_field": "not-exported"},
        "caption": {"text": "Full caption"},
        "coauthor_producers": [{"username": "cohost"}],
        "carousel_media": [
            {
                "media_type": 1,
                "image_versions2": {
                    "candidates": [
                        {"url": "https://s.cdninstagram.com/one.jpg", "width": 100, "height": 100}
                    ]
                },
            },
            {
                "media_type": 2,
                "image_versions2": {
                    "candidates": [
                        {"url": "https://s.cdninstagram.com/two.jpg", "width": 100, "height": 100}
                    ]
                },
                "video_versions": [
                    {"url": "https://s.cdninstagram.com/two.mp4", "width": 100, "height": 100}
                ],
            },
        ],
    }
    script = f"""globalThis.window = {{}};
    globalThis.fetch = async () => ({{ok:true,json:async()=>({json.dumps({"items": [media]})})}});
    {source};
    setTimeout(() => console.log(JSON.stringify(window.__wat2doInstagramBrowserRequest.result)),0);
    """
    completed = subprocess.run([node, "-e", script], text=True, capture_output=True, check=True)
    post = json.loads(completed.stdout)["posts"][0]
    assert post["type"] == "Sidecar"
    assert post["caption"] == "Full caption"
    assert post["childPosts"][1]["videoUrl"].endswith("two.mp4")
    assert post["coauthors"] == [{"username": "cohost"}]
    assert "private_internal_field" not in completed.stdout
    module._validate_post(post)


def test_suspended_account_stops_before_switch_or_fetch():
    session = SimpleNamespace(
        run=lambda *_: "/accounts/suspended/",
        activate_account=lambda *_: pytest.fail("Suspended browser requires a human"),
    )
    with pytest.raises(module.BrowserSessionError, match="human account recovery"):
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)


def test_explicit_retrieval_retry_resets_only_matching_media(import_setup, monkeypatch):
    queue, row, jid = import_setup
    key = f"notification_import_attempts:{row['id']}"
    queue.set_setting(key, 3)
    queue.set_setting("notification_import_attempts:other", 3)
    bridge.retry_retrieved_media(queue, jid)
    assert queue.get_setting(key) == 0
    assert queue.get_setting("notification_import_attempts:other") == 3


def test_retrieval_rejects_account_change():
    names = iter(["wat2do.ca", "wat2do.ca", "wat2do.sfu", "wat2do.sfu"])
    session = SimpleNamespace(
        run=lambda *_: "/p/AbC/",
        current_account_username=lambda: next(names),
        poll_until=lambda predicate: predicate(),
        query=lambda *_: pytest.fail("Changed account must not fetch"),
    )
    with pytest.raises(module.BrowserSessionError, match="changed"):
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)


def test_import_rejects_wrong_retrieved_target(import_setup, monkeypatch):
    queue, _, jid = import_setup
    queue.claim_next()
    queue.finish(
        jid,
        result={
            "account_username": "wat2do.ca",
            "target_url": "https://www.instagram.com/p/Other/",
            "posts": [POST],
        },
    )
    monkeypatch.setattr(
        bridge, "claim_pending_browser_media", lambda **_: pytest.fail("Wrong target")
    )
    with pytest.raises(ValueError, match="target"):
        bridge.import_retrieved_media(queue)


def test_excluded_account_remains_pending_while_other_retrieval_runs(tmp_path):
    queue = BrowserJobQueue(tmp_path)
    held = queue.enqueue_retrieval(
        school="utsc", recipient_id=RECIPIENT, account_username="wat2do.utsc", url=URL
    )
    allowed = queue.enqueue_retrieval(
        school="ubc", recipient_id=RECIPIENT, account_username=ACCOUNT, url=URL
    )
    queue.set_setting("excluded_accounts", ["wat2do.utsc"])
    assert queue.claim_next().id == allowed
    assert queue.get(held).state == "pending"
    assert queue.claim_next() is None


def test_excluded_notification_is_not_synced_or_imported(import_setup, monkeypatch):
    queue, _, jid = import_setup
    queue.set_setting("excluded_accounts", [ACCOUNT])
    monkeypatch.setattr(bridge, "claim_pending_browser_media", lambda **_: pytest.fail("Excluded"))
    assert bridge.sync_notification_media(queue)["queued"] == 0
    assert bridge.import_retrieved_media(queue)["imported"] == 0
    assert queue.get(jid).state == "pending"


@pytest.mark.parametrize("kind", ["digest", "engagement"])
def test_exclusions_apply_to_account_bound_jobs(tmp_path, kind):
    queue = BrowserJobQueue(tmp_path)
    if kind == "digest":
        jid = queue.enqueue_digest(RECIPIENT, "wat2do.utsc", "example")
    else:
        jid = queue.enqueue_engagement(
            school="utsc",
            recipient_id=RECIPIENT,
            account_username="wat2do.utsc",
            post_url=URL,
        )
    queue.set_setting("excluded_accounts", ["wat2do.utsc"])
    assert queue.claim_next() is None
    assert queue.get(jid).state == "pending"
    queue.set_setting("excluded_accounts", [])
    assert queue.claim_next().id == jid


@pytest.mark.parametrize(
    "target,expected",
    [
        ("https://www.instagram.com/p/DeHr2BlJhZ6/", "https://www.instagram.com/p/DeHr2BlJhZ6/"),
        ("https://instagram.com/p/DeHr2BlJhZ6/", "https://www.instagram.com/p/DeHr2BlJhZ6/"),
        ("Some.Club", "https://www.instagram.com/some.club/"),
        (" @Some.Club ", "https://www.instagram.com/some.club/"),
        ("https://www.instagram.com/Some.Club/", "https://www.instagram.com/some.club/"),
    ],
)
def test_manual_targets_preserve_exact_posts_and_normalize_handles(target, expected):
    assert module.canonical_target_url(target) == expected


def test_sync_enqueues_entire_backlog_not_one_source_page(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path)
    rows = [{"source_url": f"https://www.instagram.com/p/Backlog{i}/"} for i in range(140)]
    monkeypatch.setattr(bridge, "_pending_rows", lambda: rows)
    monkeypatch.setattr(bridge, "_identity", lambda _: ("ubc", RECIPIENT, ACCOUNT))
    assert bridge.sync_notification_media(queue) == {"pending_media": 140, "queued": 140}
    assert bridge.sync_notification_media(queue) == {"pending_media": 140, "queued": 140}
    assert sum(row["quantity"] for row in queue.status()["queues"]) == 140
