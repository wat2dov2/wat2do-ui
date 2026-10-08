import json
import shutil
import subprocess
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

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
        current_page_path=lambda **kwargs: "/p/AbC/",
        current_account_username=lambda: "wat2do.ca",
        poll_until=lambda predicate: predicate(),
        activate_account=lambda *_: pytest.fail("Retrieval must never switch accounts"),
        navigate=lambda url, *, reload: calls.append((url, reload)),
        query=lambda *_: {"state": "succeeded", "posts": [deepcopy(POST)]},
    )
    result = module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)
    assert result["account_username"] == "wat2do.ca"
    assert calls == [(URL, True)]
    assert result["posts"][0] == POST
    assert module.media_id_from_url(URL) == str(27 * 64 + 2)


def test_same_target_reload_refreshes_cached_account_before_readiness_and_query():
    state = SimpleNamespace(username="wat2do.previous")
    calls = []

    def navigate(url, *, reload):
        calls.append((url, reload))
        if reload:
            state.username = ACCOUNT

    def query(source):
        assert state.username == ACCOUNT
        return {"state": "succeeded", "posts": [deepcopy(POST)]}

    session = SimpleNamespace(
        navigate=navigate,
        current_page_path=lambda **kwargs: "/p/AbC/",
        current_account_username=lambda: state.username,
        poll_until=lambda ready: ready(),
        query=query,
    )
    result = module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)
    assert calls == [(URL, True)]
    assert result["account_username"] == ACCOUNT


def test_verified_failed_429_is_not_lost_to_a_later_loading_identity():
    queried = False

    def username():
        if queried:
            raise TimeoutError("The post-query navigation identity is still loading")
        return ACCOUNT

    def query(source):
        nonlocal queried
        queried = True
        return {"state": "failed", "reason": "http_error", "http_status": 429}

    session = SimpleNamespace(
        navigate=lambda *args, **kwargs: None,
        current_page_path=lambda **kwargs: "/p/AbC/",
        current_account_username=username,
        poll_until=lambda ready: ready(),
        query=query,
    )
    with pytest.raises(module.BrowserRateLimited, match="HTTP 429"):
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)


@pytest.mark.parametrize("rate_limit_phase", ["before_query", "after_query"])
def test_account_identity_wait_detects_a_fresh_native_429(rate_limit_phase):
    path_reads = 0
    queries = []

    def path(*, check_response=False):
        nonlocal path_reads
        assert check_response
        path_reads += 1
        if path_reads == (2 if rate_limit_phase == "before_query" else 3):
            raise module.BrowserRateLimited("Instagram browser is rate limited (HTTP 429)")
        return "/p/AbC/"

    session = SimpleNamespace(
        navigate=lambda *args, **kwargs: None,
        current_page_path=path,
        current_account_username=lambda: ACCOUNT,
        poll_until=lambda ready: ready(),
        query=lambda source: (
            queries.append(source) or {"state": "succeeded", "posts": [deepcopy(POST)]}
        ),
    )
    with pytest.raises(module.BrowserRateLimited, match="HTTP 429"):
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)
    assert len(queries) == int(rate_limit_phase == "after_query")


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
        current_page_path=lambda **kwargs: "/p/AbC/",
        current_account_username=lambda: "wat2do.ca",
        poll_until=lambda predicate: predicate(),
        activate_account=lambda *_: pytest.fail("Retrieval must never switch accounts"),
        navigate=lambda *_, **__: None,
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
    queue.finish(
        queue.get(jid), result={"account_username": "wat2do.ca", "target_url": URL, "posts": [POST]}
    )

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
    queue.finish(
        queue.get(jid), result={"account_username": "wat2do.ca", "target_url": URL, "posts": [POST]}
    )
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
    queue.finish(
        queue.get(jid), result={"account_username": "wat2do.ca", "target_url": URL, "posts": [POST]}
    )
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
    queue.finish(
        queue.get(jid), result={"account_username": "wat2do.ca", "target_url": URL, "posts": [POST]}
    )
    monkeypatch.setattr(bridge, "claim_pending_browser_media", lambda **_: False)
    monkeypatch.setattr(
        bridge, "_import_posts", lambda *_args, **_kwargs: pytest.fail("Claim lost")
    )
    assert bridge.import_retrieved_media(queue)["imported"] == 0


def test_browser_projects_only_public_fields_and_keeps_all_carousel_children(monkeypatch):
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


@pytest.mark.parametrize(
    "scenario,status,reason",
    [
        *(("http", status, "http_error") for status in (400, 401, 403, 429, 503)),
        *(("http", status, "http_error") for status in (0, 600, 403.5, "do-not-export")),
        ("json", 200, "invalid_json"),
        ("media", 200, "invalid_media"),
        ("projection", 200, "projection_failed"),
        ("network", None, "request_failed"),
        ("account_before", None, "account_changed"),
        ("account_after", 200, "account_changed"),
    ],
)
def test_browser_failure_projection_exports_only_fixed_reason_and_safe_http_status(
    monkeypatch, scenario, status, reason
):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    identity = (
        '"wat2do.other"'
        if scenario == "account_before"
        else '(++window.identityReads === 1 ? "wat2do.ca" : "wat2do.other")'
        if scenario == "account_after"
        else '"wat2do.ca"'
    )
    monkeypatch.setattr(module, "_current_account_username_source", lambda: identity)
    source = module._query_source("/api/v1/media/1730/info/", "wat2do.ca", profile=False)
    script = f"""
globalThis.window = {{identityReads: 0}};
let calls = 0;
globalThis.fetch = async () => {{
  calls += 1;
  if ({json.dumps(scenario)} === "network") throw new Error("do-not-export");
  return {{ok: {str(scenario != "http").lower()}, status: {json.dumps(status)}, json: async () => {{
    if ({json.dumps(scenario)} === "json") throw new Error("do-not-export");
    return {{items: {"null" if scenario == "media" else '[{code: "AbC", taken_at: "do-not-export", user: {username: "club"}}]'}}};
  }}}};
}};
{source};
setTimeout(() => console.log(JSON.stringify({{result: window.__wat2doInstagramBrowserRequest.result,
  settled: window.__wat2doInstagramBrowserRequest.settled, calls}})), 0);
"""
    completed = subprocess.run(
        [node, "-e", script], text=True, capture_output=True, check=True, timeout=5
    )
    result = json.loads(completed.stdout)
    expected = {"state": "failed", "reason": reason}
    if scenario == "http" and type(status) is int and 100 <= status <= 599:
        expected["http_status"] = status
    assert result["result"] == expected
    assert result["settled"] is True
    assert result["calls"] == (0 if scenario == "account_before" else 1)
    assert "do-not-export" not in completed.stdout


@pytest.mark.parametrize(
    "reason,status,message",
    [
        ("account_changed", None, "account changed"),
        ("http_error", 400, "HTTP 400"),
        ("http_error", 401, "HTTP 401"),
        ("http_error", 403, "HTTP 403"),
        ("http_error", 429, "HTTP 429"),
        ("invalid_json", 200, "not valid JSON"),
        ("invalid_media", None, "media list"),
        ("projection_failed", None, "projection failed"),
        ("request_failed", None, "request failed"),
        ("http_error", "do-not-export", "request was rejected"),
        ("http_error", True, "request was rejected"),
        ("http_error", 999, "request was rejected"),
        (["do-not-export"], None, "retrieval failed"),
    ],
)
def test_classified_public_response_failures_preserve_bounded_read_retry_type(
    reason, status, message
):
    session = SimpleNamespace(
        navigate=lambda *args, **kwargs: None,
        current_page_path=lambda **kwargs: "/p/AbC/",
        current_account_username=lambda: ACCOUNT,
        poll_until=lambda ready: ready(),
        query=lambda source: {"state": "failed", "reason": reason, "http_status": status},
    )
    error_type = (
        module.BrowserRateLimited
        if reason == "http_error" and type(status) is int and status == 429
        else module._BrowserPageUnavailable
    )
    with pytest.raises(error_type, match=message) as raised:
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)
    assert "do-not-export" not in str(raised.value)


def test_retrieval_preserves_original_human_recovery_error_and_deferred_payload():
    from services.instagram_notifications.browser_session import _BrowserReadCleanupPending

    original = module.BrowserSessionError("Instagram browser requires human account recovery")
    payload = {"state": "failed", "reason": "http_error", "http_status": 401}
    pending = _BrowserReadCleanupPending(
        "Instagram browser request cancellation could not be confirmed",
        operation_error=original,
        completed_payload=payload,
    )

    def query(source):
        raise pending

    session = SimpleNamespace(
        navigate=lambda *args, **kwargs: None,
        current_page_path=lambda **kwargs: "/p/AbC/",
        current_account_username=lambda: ACCOUNT,
        poll_until=lambda ready: ready(),
        query=query,
    )
    with pytest.raises(_BrowserReadCleanupPending) as raised:
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)
    assert raised.value is pending
    assert pending.operation_error is original
    assert pending.completed_payload is payload


@pytest.mark.parametrize(
    "original",
    [
        None,
        module._BrowserPageUnavailable("Read timed out"),
        module._BrowserAutomationTransient("Bridge timed out"),
        TimeoutError(),
        module.BrowserSessionError("Instagram browser requires human account recovery"),
        module.BrowserAccountChanged("Account changed"),
        module.BrowserSessionError("Invalid request state"),
        KeyboardInterrupt(),
    ],
)
def test_confirmed_deferred_429_preserves_human_account_and_interrupt_errors(original):
    payload = {"state": "failed", "reason": "http_error", "http_status": 429}
    pending = module._BrowserReadCleanupPending(
        "Instagram browser request cancellation could not be confirmed",
        operation_error=original,
        completed_payload=payload,
    )

    def query(source):
        raise pending

    session = SimpleNamespace(
        navigate=lambda *args, **kwargs: None,
        current_page_path=lambda **kwargs: "/p/AbC/",
        current_account_username=lambda: ACCOUNT,
        poll_until=lambda ready: ready(),
        query=query,
    )
    with pytest.raises(module._BrowserReadCleanupPending) as raised:
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)
    assert raised.value is pending
    promoted = original is None or isinstance(
        original, (module._BrowserPageUnavailable, module._BrowserAutomationTransient, TimeoutError)
    )
    if promoted:
        assert isinstance(pending.operation_error, module.BrowserRateLimited)
        assert "HTTP 429" in str(pending.operation_error)
    else:
        assert pending.operation_error is original
    assert pending.completed_payload is payload


@pytest.mark.parametrize(
    "payload",
    [
        {"state": "failed", "reason": "http_error", "http_status": "429"},
        {"state": "failed", "reason": "projection_failed", "http_status": 429},
        {"state": "succeeded", "reason": "http_error", "http_status": 429},
    ],
)
def test_deferred_payload_requires_the_exact_verified_429_contract(payload):
    pending = module._BrowserReadCleanupPending(
        "Instagram browser request cancellation could not be confirmed", completed_payload=payload
    )

    def query(source):
        raise pending

    session = SimpleNamespace(
        navigate=lambda *args, **kwargs: None,
        current_page_path=lambda **kwargs: "/p/AbC/",
        current_account_username=lambda: ACCOUNT,
        poll_until=lambda ready: ready(),
        query=query,
    )
    with pytest.raises(module._BrowserReadCleanupPending):
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)
    assert pending.operation_error is None


def test_suspended_account_stops_before_switch_or_fetch():
    session = SimpleNamespace(
        navigate=lambda *_, **__: (_ for _ in ()).throw(
            module.BrowserSessionError("Instagram browser requires human account recovery")
        ),
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
        current_page_path=lambda **kwargs: "/p/AbC/",
        navigate=lambda *_, **__: None,
        current_account_username=lambda: next(names),
        poll_until=lambda predicate: predicate(),
        query=lambda *_: {"state": "succeeded", "posts": [deepcopy(POST)]},
    )
    with pytest.raises(module.BrowserSessionError, match="changed"):
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)


def test_import_rejects_wrong_retrieved_target(import_setup, monkeypatch):
    queue, _, jid = import_setup
    queue.claim_next()
    queue.finish(
        queue.get(jid),
        result={
            "account_username": "wat2do.ca",
            "target_url": "https://www.instagram.com/p/Other/",
            "posts": [POST],
        },
    )
    monkeypatch.setattr(
        bridge, "claim_pending_browser_media", lambda **_: pytest.fail("Wrong target")
    )
    assert bridge.import_retrieved_media(queue)["invalid"] == 1
    assert queue.get(jid).state == "succeeded"


def test_invalid_import_target_cannot_block_another_school(import_setup, monkeypatch):
    queue, row, jid = import_setup
    queue.finish(
        queue.claim_next(),
        result={"account_username": ACCOUNT, "target_url": URL, "posts": [POST]},
    )
    broken = {**row, "id": "615b6bca-4efd-41c6-8e69-0ff62f3aece2", "source_url": None}
    monkeypatch.setattr(bridge, "_pending_rows", lambda: [broken, row])
    imports = []
    claims = []
    monkeypatch.setattr(
        bridge, "claim_pending_browser_media", lambda **claim: claims.append(claim) or True
    )
    monkeypatch.setattr(
        bridge, "_import_posts", lambda *args, **kwargs: imports.append((args, kwargs))
    )
    monkeypatch.setattr(bridge, "mark_media_succeeded", lambda **_: True)

    result = bridge.import_retrieved_media(queue)

    assert result["imported"] == 1
    assert result["invalid"] == 1
    assert [claim["media_row_id"] for claim in claims] == [row["id"]]
    assert len(imports) == 1
    assert queue.get(jid).state == "succeeded"


def test_manual_retry_cannot_reset_import_history_after_a_worker_claim(import_setup, monkeypatch):
    queue, row, jid = import_setup
    key = f"notification_import_attempts:{row['id']}"
    queue.set_setting(key, 3)

    def pending():
        assert queue.claim_next().id == jid
        return [row]

    monkeypatch.setattr(bridge, "_pending_rows", pending)

    with pytest.raises(ValueError, match="idle retrieval"):
        bridge.retry_retrieved_media(queue, jid)

    assert queue.get(jid).state == "running"
    assert queue.get_setting(key) == 3


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
        jid = queue.enqueue_digest(RECIPIENT, "wat2do.utsc", "example").id
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
    assert bridge.sync_notification_media(queue) == {
        "pending_media": 140,
        "queued": 140,
        "invalid": 0,
    }
    assert bridge.sync_notification_media(queue) == {
        "pending_media": 140,
        "queued": 140,
        "invalid": 0,
    }
    assert sum(row["quantity"] for row in queue.status()["queues"]) == 140


def test_notification_collection_preserves_finite_read_failure_budget(import_setup):
    queue, _, jid = import_setup
    for attempt in range(1, bridge._CONTROL.ingestion_retry_limit + 1):
        assert queue.claim_next().id == jid
        assert queue.get(jid).attempts == attempt
        queue.finish(queue.get(jid), error="Permanent incomplete public media")
        result = bridge.sync_notification_media(queue)
        exhausted = attempt == bridge._CONTROL.ingestion_retry_limit
        assert result["queued"] == (0 if exhausted else 1)
        assert queue.get(jid).state == ("failed" if exhausted else "pending")
        assert queue.get(jid).attempts == attempt
    assert queue.claim_next() is None


def test_notification_collection_preserves_an_operator_cancel(import_setup):
    queue, _, jid = import_setup
    queue.cancel(jid)

    result = bridge.sync_notification_media(queue)

    assert result["queued"] == 0
    assert queue.get(jid).state == "cancelled"
    assert queue.claim_next() is None


@pytest.mark.parametrize("invalid", ["recipient", "url"])
def test_invalid_notification_cannot_block_other_schools(import_setup, monkeypatch, invalid):
    queue, row, jid = import_setup
    broken = {**row, "source_url": "https://www.instagram.com/p/Broken/"}
    if invalid == "url":
        broken["source_url"] = None
    monkeypatch.setattr(bridge, "_pending_rows", lambda: [broken, row])

    def identity(target):
        if target is broken and invalid == "recipient":
            raise ValueError("Notification recipient has no configured school")
        return "ubc", RECIPIENT, ACCOUNT

    monkeypatch.setattr(bridge, "_identity", identity)

    result = bridge.sync_notification_media(queue)

    assert result == {"pending_media": 1, "queued": 1, "invalid": 1}
    assert queue.claim_next().id == jid
    assert queue.claim_next() is None


def test_refreshing_signed_media_never_resets_the_separate_import_failure_budget(
    import_setup, monkeypatch
):
    queue, row, jid = import_setup
    key = f"notification_import_attempts:{row['id']}"
    claims = []
    monkeypatch.setattr(
        bridge, "claim_pending_browser_media", lambda **claim: claims.append(claim) or True
    )
    monkeypatch.setattr(bridge, "rollback_media_claim", lambda **_: True)
    monkeypatch.setattr(
        bridge, "_import_posts", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError())
    )
    for attempt in range(1, bridge._CONTROL.ingestion_retry_limit + 1):
        assert queue.claim_next().id == jid
        queue.finish(
            queue.get(jid), result={"account_username": ACCOUNT, "target_url": URL, "posts": [POST]}
        )
        assert bridge.import_retrieved_media(queue)["failed"] == 1
        assert queue.get(jid).attempts == 0
        assert queue.get_setting(key) == attempt
    queue.claim_next()
    queue.finish(
        queue.get(jid), result={"account_username": ACCOUNT, "target_url": URL, "posts": [POST]}
    )
    assert bridge.import_retrieved_media(queue)["blocked"] == 1
    assert len(claims) == bridge._CONTROL.ingestion_retry_limit
    assert queue.get_setting(key) == bridge._CONTROL.ingestion_retry_limit


@pytest.fixture
def review_backlog(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path)
    rows = []
    sequence = 0
    monkeypatch.setattr(bridge, "_pending_rows", lambda: list(rows))
    monkeypatch.setattr(
        bridge,
        "_identity",
        lambda row: (
            row["school"],
            row["notification"]["intended_recipient_id"],
            f"wat2do.{row['school']}",
        ),
    )

    def add(school, *, state="succeeded", timestamp=POST["timestamp"]):
        nonlocal sequence
        sequence += 1
        index = sequence
        url = f"https://www.instagram.com/p/Review{index}/"
        row = {
            "id": str(UUID(int=index)),
            "school": school,
            "source_url": url,
            "created_at": "2026-10-08T00:00:00Z",
            "notification": {"intended_recipient_id": str(100 + ord(school[0]))},
        }
        rows.append(row)
        job_id = queue.enqueue_retrieval(
            school=school,
            recipient_id=row["notification"]["intended_recipient_id"],
            account_username=f"wat2do.{school}",
            url=url,
        )
        if state in {"succeeded", "failed"}:
            claim = queue.claim_next()
            assert claim.id == job_id
            if state == "failed":
                queue.finish(claim, error="read failed")
            else:
                queue.finish(
                    claim,
                    result={
                        "target_url": url,
                        "posts": [{**deepcopy(POST), "url": url, "timestamp": timestamp}],
                    },
                )
        elif state == "cancelled":
            queue.cancel(job_id)
        return row, job_id

    return queue, rows, add


def test_review_selection_rotates_schools_before_returning_to_large_backlog(review_backlog):
    queue, _, add = review_backlog
    for _ in range(20):
        add("a")
    add("b")
    add("c")
    queue.set_setting(bridge._REVIEW_CURSOR, {"last_school": "a", "next_newest": {}})

    result = bridge.ready_review_targets(queue)

    assert [target["school"] for target in result["targets"][:3]] == ["b", "c", "a"]
    assert len(result["targets"]) == bridge._CONTROL.ingestion_batch_size
    assert result["schools"]["a"]["ready"] == 20
    assert result["totals"]["pending"] == 22


def test_review_selection_does_not_claim_enqueue_or_advance_unreviewed_targets(
    review_backlog, monkeypatch
):
    queue, rows, add = review_backlog
    row, job_id = add("a")
    for name in ("enqueue_retrieval", "claim_next", "set_setting"):
        monkeypatch.setattr(queue, name, MagicMock(side_effect=AssertionError("Preview must read")))
    monkeypatch.setattr(
        bridge, "claim_pending_browser_media", MagicMock(side_effect=AssertionError())
    )

    first = bridge.ready_review_targets(queue)
    newer_row, newer_job_id = deepcopy(row), job_id
    newer_row["id"] = str(UUID(int=100))
    rows.append(newer_row)
    second = bridge.ready_review_targets(queue)

    assert first["targets"][0]["row"] == row
    assert first["targets"][0]["job_id"] == job_id
    assert first["targets"][0]["posts"][0]["url"] == row["source_url"]
    assert len(second["targets"]) == 2
    assert second["targets"][0]["job_id"] == newer_job_id
    assert queue.get_setting(bridge._REVIEW_CURSOR) is None
    assert queue.get(job_id).state == "succeeded"
    bridge.claim_pending_browser_media.assert_not_called()


def test_review_cursor_alternates_age_per_school_even_across_even_batch_cycle(
    review_backlog, monkeypatch
):
    queue, rows, add = review_backlog
    monkeypatch.setattr(
        bridge, "_CONTROL", SimpleNamespace(ingestion_batch_size=1, ingestion_retry_limit=3)
    )
    a_new, _ = add("a", timestamp="2026-10-07T12:00:00Z")
    a_old, _ = add("a", timestamp="2026-10-03T12:00:00Z")
    b_new, _ = add("b", timestamp="2026-10-07T12:00:00Z")
    b_old, _ = add("b", timestamp="2026-10-03T12:00:00Z")

    first = bridge.ready_review_targets(queue)
    assert first["targets"][0]["row"] == a_new
    queue.set_setting(bridge._REVIEW_CURSOR, first["targets"][0]["cursor_after"])
    rows.remove(a_new)
    second = bridge.ready_review_targets(queue)
    assert second["targets"][0]["row"] == b_new
    queue.set_setting(bridge._REVIEW_CURSOR, second["targets"][0]["cursor_after"])
    rows.remove(b_new)
    add("a", timestamp="2026-10-08T12:00:00Z")
    add("b", timestamp="2026-10-08T12:00:00Z")

    third = bridge.ready_review_targets(queue)
    assert third["targets"][0]["row"] == a_old
    queue.set_setting(bridge._REVIEW_CURSOR, third["targets"][0]["cursor_after"])
    rows.remove(a_old)
    assert bridge.ready_review_targets(queue)["targets"][0]["row"] == b_old


def test_review_cursor_after_each_target_supports_partial_completed_batch(review_backlog):
    queue, _, add = review_backlog
    add("a")
    add("b")
    add("c")
    result = bridge.ready_review_targets(queue)
    first_cursor = result["targets"][0]["cursor_after"]
    assert first_cursor == {"last_school": "a", "next_newest": {"a": False}}
    assert result["suggested_next_cursor"]["last_school"] == "c"
    queue.set_setting(bridge._REVIEW_CURSOR, first_cursor)

    assert bridge.ready_review_targets(queue)["targets"][0]["school"] == "b"


@pytest.mark.parametrize(
    "review",
    [
        {"reviewer": "Codex", "decision": "unresolved", "school": "a", "source_url": "MATCH"},
        {"reviewer": "Codex", "decision": "unresolved", "school": "b", "source_url": "MATCH"},
        {"reviewer": "Codex", "decision": "unresolved", "school": "a", "source_url": URL},
        {"reviewer": "extractor", "decision": "unresolved", "school": "a", "source_url": "MATCH"},
        None,
    ],
)
def test_only_exact_codex_unresolved_decisions_hold_review_targets(review_backlog, review):
    queue, _, add = review_backlog
    row, _ = add("a")
    if review and review["source_url"] == "MATCH":
        review = {**review, "source_url": row["source_url"]}
    queue.set_setting(
        f"notification_reviewed_target:{row['id']}", {"codex_review": review, "content": {}}
    )

    result = bridge.ready_review_targets(queue)

    held = review == {
        "reviewer": "Codex",
        "decision": "unresolved",
        "school": "a",
        "source_url": row["source_url"],
    }
    assert result["totals"]["held"] == int(held)
    assert len(result["targets"]) == int(not held)


def test_review_backlog_reports_held_failed_waiting_blocked_and_excluded(review_backlog):
    queue, _, add = review_backlog
    held, _ = add("a")
    queue.set_setting(
        f"notification_reviewed_target:{held['id']}",
        {
            "codex_review": {
                "reviewer": "Codex",
                "decision": "unresolved",
                "school": "a",
                "source_url": held["source_url"],
            }
        },
    )
    blocked, _ = add("b")
    queue.set_setting(
        f"notification_import_attempts:{blocked['id']}", bridge._CONTROL.ingestion_retry_limit
    )
    add("c", state="failed")
    add("d", state="cancelled")
    add("e")
    add("f", state="pending")
    queue.set_setting("excluded_accounts", ["wat2do.e"])
    assert {job.school for job in queue.retrieval_results()} == {"a", "b", "e"}
    assert len(queue.retrieval_results(succeeded_only=False)) == 6

    result = bridge.ready_review_targets(queue)

    assert result["targets"] == []
    assert result["totals"] == {
        "pending": 6,
        "ready": 0,
        "waiting": 1,
        "failed": 1,
        "held": 1,
        "blocked": 1,
        "excluded": 1,
        "cancelled": 1,
        "invalid": 0,
        "selected": 0,
    }
    assert result["schools"]["c"]["failed"] == 1
    assert queue.get_setting(bridge._REVIEW_CURSOR) is None


@pytest.mark.parametrize(
    "cursor", ["corrupt", {"last_school": None, "next_newest": {"a": "false"}}]
)
def test_invalid_review_cursor_fails_without_resetting_progress(review_backlog, cursor):
    queue, _, add = review_backlog
    add("a")
    queue.set_setting(bridge._REVIEW_CURSOR, cursor)
    with pytest.raises(ValueError, match="review cursor is invalid"):
        bridge.ready_review_targets(queue)
    assert queue.get_setting(bridge._REVIEW_CURSOR) == cursor


def test_review_selection_matches_recipient_and_verified_exact_post(review_backlog, monkeypatch):
    queue, rows, add = review_backlog
    row, job_id = add("a")
    original_recipient = row["notification"]["intended_recipient_id"]
    row["notification"]["intended_recipient_id"] = "99999"
    assert bridge.ready_review_targets(queue)["totals"]["waiting"] == 1
    row["notification"]["intended_recipient_id"] = original_recipient
    job = queue.get(job_id)
    job.result["posts"][0]["url"] = URL
    monkeypatch.setattr(queue, "retrieval_results", lambda **_: [job])
    invalid = bridge.ready_review_targets(queue)
    assert invalid["totals"]["invalid"] == 1
    assert invalid["targets"] == []
    assert rows == [row]
