import json
import shutil
import subprocess
from copy import deepcopy
from types import SimpleNamespace

import pytest

from services.instagram_notifications import browser_ingestion as module
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
        query=lambda *_, **__: {"state": "succeeded", "posts": [deepcopy(POST)]},
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

    def query(source, *, read_only):
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

    def query(source, *, read_only):
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
        query=lambda source, **_: (
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
        query=lambda *_, **__: {"state": "succeeded", "posts": [post]},
    )
    with pytest.raises(module.BrowserSessionError):
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)


def _retrieved(queue, jid, posts=None, target_url=URL):
    queue.finish(
        queue.claim_next(),
        result={"account_username": ACCOUNT, "target_url": target_url, "posts": posts or [POST]},
    )
    assert queue.get(jid).state == "succeeded"


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
        query=lambda source, **_: {"state": "failed", "reason": reason, "http_status": status},
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

    def query(source, *, read_only):
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

    def query(source, *, read_only):
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

    def query(source, *, read_only):
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


def test_retrieval_rejects_account_change():
    names = iter(["wat2do.ca", "wat2do.ca", "wat2do.sfu", "wat2do.sfu"])
    session = SimpleNamespace(
        current_page_path=lambda **kwargs: "/p/AbC/",
        navigate=lambda *_, **__: None,
        current_account_username=lambda: next(names),
        poll_until=lambda predicate: predicate(),
        query=lambda *_, **__: {"state": "succeeded", "posts": [deepcopy(POST)]},
    )
    with pytest.raises(module.BrowserSessionError, match="changed"):
        module.BrowserInstagramRetriever(session).retrieve(URL, cutoff_days=1)


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


@pytest.mark.parametrize(
    "user,expected",
    [
        (
            {"username": "club", "profile_pic_url_hd": "https://s.cdninstagram.com/hd.jpg"},
            "https://s.cdninstagram.com/hd.jpg",
        ),
        (
            {
                "username": "club",
                "has_anonymous_profile_picture": True,
                "profile_pic_url_hd": "https://s.cdninstagram.com/blank.jpg",
            },
            None,
        ),
    ],
)
def test_profile_projection_carries_the_profile_picture(monkeypatch, user, expected):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    monkeypatch.setattr(module, "_current_account_username_source", lambda: '"wat2do.ca"')
    source = module._query_source(
        "/api/v1/users/web_profile_info/?username=club", "wat2do.ca", profile=True
    )
    body = {"data": {"user": {**user, "edge_owner_to_timeline_media": {"edges": []}}}}
    script = f"""globalThis.window = {{}};
    globalThis.fetch = async () => ({{ok:true,json:async()=>({json.dumps(body)})}});
    {source};
    setTimeout(() => console.log(JSON.stringify(window.__wat2doInstagramBrowserRequest.result)),0);
    """
    completed = subprocess.run([node, "-e", script], text=True, capture_output=True, check=True)
    result = json.loads(completed.stdout)
    assert result["profileUsername"] == "club"
    assert result["profilePicture"] == expected


@pytest.mark.parametrize(
    "owner,picture,expected",
    [
        ("club", "https://s.cdninstagram.com/hd.jpg", "https://s.cdninstagram.com/hd.jpg"),
        ("someoneelse", "https://s.cdninstagram.com/hd.jpg", None),
        ("club", "https://evil.com/hd.jpg", None),
    ],
)
def test_profile_picture_is_kept_only_for_the_requested_profile(owner, picture, expected):
    session = SimpleNamespace(
        current_page_path=lambda **kwargs: "/club/",
        current_account_username=lambda: "wat2do.ca",
        poll_until=lambda predicate: predicate(),
        navigate=lambda url, *, reload: None,
        query=lambda *_, **__: {
            "state": "succeeded",
            "posts": [],
            "profileUsername": owner,
            "profilePicture": picture,
        },
    )
    result = module.BrowserInstagramRetriever(session).retrieve(
        "https://www.instagram.com/club/", cutoff_days=1
    )
    assert result["profile_picture_url"] == expected
