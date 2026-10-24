import json
import shutil
import subprocess

import pytest

from services.instagram_notifications import browser_digest
from services.instagram_notifications.browser_session import (
    BrowserAccountChanged,
    BrowserRateLimited,
    BrowserSessionError,
    _BrowserAutomationTransient,
    _BrowserPageUnavailable,
    _BrowserReadCleanupPending,
    _BrowserTabUnavailable,
)


def test_digest_media_count_treats_under_count_as_advisory() -> None:
    assert browser_digest.digest_media_count_shortfall(155, 156) == 1
    assert browser_digest.digest_media_count_shortfall(156, 156) == 0
    assert browser_digest.digest_media_count_shortfall(155, None) == 0


def test_digest_media_count_rejects_over_count() -> None:
    with pytest.raises(
        browser_digest.BrowserDigestError,
        match="resolved more media IDs than advertised",
    ):
        browser_digest.digest_media_count_shortfall(157, 156)


class FakeSession:
    def __init__(self, payload=None):
        self.calls = []
        self.payload = payload or {
            "state": "succeeded",
            "media_ids": ["123", "456"],
            "page_count": 1,
        }

    def activate_account(self, recipient_id, username):
        self.calls.append((recipient_id, username))
        return username.lower()

    def query(self, source, *, read_only):
        self.calls.append(source)
        return self.payload


def test_digest_reuses_shared_session_and_returns_only_media_identities():
    session = FakeSession()
    result = browser_digest.BrowserInstagramDigestResolver(session=session).resolve(
        "41553815702", "USASK.wat2do.io", "cache-1"
    )
    assert result == browser_digest.DigestResolution(
        account_username="usask.wat2do.io", media_ids=("123", "456"), page_count=1
    )
    assert session.calls[0] == ("41553815702", "USASK.wat2do.io")
    assert "sessionid" not in session.calls[1].lower()


def test_session_error_keeps_digest_public_error_contract():
    class BrokenSession(FakeSession):
        def activate_account(self, *_args):
            raise BrowserSessionError("Matching Instagram browser account is unavailable")

    with pytest.raises(browser_digest.BrowserDigestError, match="account is unavailable"):
        browser_digest.BrowserInstagramDigestResolver(session=BrokenSession()).resolve(
            "41553815702", "usask.wat2do.io", "cache-1"
        )


@pytest.mark.parametrize(
    "error_type",
    [
        BrowserAccountChanged,
        BrowserRateLimited,
        _BrowserAutomationTransient,
        _BrowserPageUnavailable,
        _BrowserTabUnavailable,
    ],
)
def test_digest_preserves_recoverable_session_failure_type(error_type):
    error = error_type("Recoverable browser failure")

    class BrokenSession(FakeSession):
        def query(self, _source, *, read_only):
            raise error

    with pytest.raises(error_type) as raised:
        browser_digest.BrowserInstagramDigestResolver(session=BrokenSession()).resolve(
            "41553815702", "usask.wat2do.io", "cache-1"
        )
    assert raised.value is error


@pytest.mark.parametrize(
    "reason,error_type",
    [
        ("account_changed", BrowserAccountChanged),
        ("rate_limited", BrowserRateLimited),
        ("temporarily_unavailable", _BrowserPageUnavailable),
        ("request_failed", _BrowserPageUnavailable),
    ],
)
def test_digest_response_uses_typed_recoverable_failure(reason, error_type):
    session = FakeSession({"state": "failed", "reason": reason})
    with pytest.raises(error_type):
        browser_digest.BrowserInstagramDigestResolver(session=session).resolve(
            "41553815702", "usask.wat2do.io", "cache-1"
        )


@pytest.mark.parametrize(
    "original",
    [
        None,
        _BrowserPageUnavailable("Transient page failure"),
        _BrowserAutomationTransient("Transient bridge failure"),
        TimeoutError("Transient readiness timeout"),
        BrowserSessionError("Instagram browser requires human account recovery"),
        BrowserAccountChanged("The active account changed"),
        KeyboardInterrupt(),
    ],
)
def test_deferred_digest_429_keeps_original_human_account_and_interrupt_causes(original):
    pending = _BrowserReadCleanupPending(
        "Instagram browser request cancellation could not be confirmed",
        operation_error=original,
        completed_payload={"state": "failed", "reason": "rate_limited"},
    )

    class PendingSession(FakeSession):
        def query(self, source, *, read_only):
            raise pending

    with pytest.raises(_BrowserReadCleanupPending) as raised:
        browser_digest.BrowserInstagramDigestResolver(session=PendingSession()).resolve(
            "41553815702", "usask.wat2do.io", "cache-1"
        )
    assert raised.value is pending
    if original is None or isinstance(
        original, (_BrowserPageUnavailable, _BrowserAutomationTransient, TimeoutError)
    ):
        assert isinstance(pending.operation_error, BrowserRateLimited)
    else:
        assert pending.operation_error is original


@pytest.mark.parametrize(
    "status,reason",
    [(429, "rate_limited"), (503, "temporarily_unavailable"), (401, "auth_required")],
)
def test_digest_http_failure_has_one_safe_reason_and_terminal_settlement(status, reason):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    from services.instagram_notifications import browser_session

    source = browser_digest._digest_query_source("cache-1", "41553815702")
    script = (
        "global.window = {};"
        'global.document = {cookie: "csrftoken=private; ds_user_id=41553815702"};'
        f"global.fetch = async () => ({{status: {status}, ok: false}});"
        + source
        + ";setImmediate(() => {const request = window["
        + json.dumps(browser_session._REQUEST_KEY)
        + "]; console.log(JSON.stringify({result: request.result, settled: request.settled}));});"
    )
    completed = subprocess.run([node], input=script, text=True, capture_output=True)
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {
        "result": {"state": "failed", "reason": reason},
        "settled": True,
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"state": "succeeded", "media_ids": ["123", "123"], "page_count": 1},
        {"state": "succeeded", "media_ids": ["123"], "page_count": True},
        {"state": "succeeded", "media_ids": ["123"], "page_count": 0},
        {"state": "succeeded", "media_ids": ["invalid"], "page_count": 1},
        {"state": "failed", "reason": "auth_required"},
    ],
)
def test_digest_rejects_bad_or_failed_results(payload):
    with pytest.raises(browser_digest.BrowserDigestError):
        browser_digest.BrowserInstagramDigestResolver(session=FakeSession(payload)).resolve(
            "41553815702", "usask.wat2do.io", "cache-1"
        )


def test_digest_stops_pagination_when_account_changes_after_first_page():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    from services.instagram_notifications import browser_session

    source = browser_digest._digest_query_source("cache-1", "41553815702")
    script = (
        """
      global.window = {};
      global.document = {cookie: "csrftoken=fixture; ds_user_id=41553815702"};
      let fetches = 0;
      global.fetch = async () => {
        fetches += 1;
        return {status: 200, ok: true, json: async () => ({data: {
          subscription_digest_feed: {
            items: [{media: {get pk() {
              document.cookie = "csrftoken=fixture; ds_user_id=999";
              return "123";
            }}}],
            paging_info: {more_available: true, max_id: "page-2"}
          }
        }})};
      };
    """
        + source
        + ";setImmediate(() => {const request = window["
        + json.dumps(browser_session._REQUEST_KEY)
        + "]; console.log(JSON.stringify({result: request.result, settled: request.settled, fetches}));});"
    )
    completed = subprocess.run([node], input=script, text=True, capture_output=True, timeout=5)
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {
        "result": {"state": "failed", "reason": "account_changed"},
        "settled": True,
        "fetches": 1,
    }


def test_digest_aborts_inflight_fetch_before_account_can_change():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    from services.instagram_notifications import browser_session

    source = browser_digest._digest_query_source("cache-1", "41553815702")
    script = (
        """
      global.window = {};
      global.document = {cookie: "csrftoken=private; ds_user_id=41553815702"};
      let aborted = false;
      global.fetch = (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    """
        + source
        + ";\nconst first = "
        + browser_session._cancel_request_source()
        + """;
      setImmediate(() => {
        const second = """
        + browser_session._cancel_request_source()
        + """;
        console.log(JSON.stringify({aborted, first, second}));
      });
    """
    )
    result = subprocess.run([node], input=script, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"aborted": True, "first": "pending", "second": "settled"}


@pytest.mark.parametrize(
    ("items", "expected"),
    [
        # A post Instagram could not load is skipped; the digest keeps the rest.
        ([{"media": {"pk": "111"}}, {"media": None}, {"media": {"pk": "222"}}], ["111", "222"]),
        # A partly loaded post is kept through its "<media>_<owner>" strong ID.
        (
            [
                {"media": {"pk": "111"}},
                {"media": {"strong_id__": "3988328074353983199_19865977534", "context__": None}},
                {"media": {"context__": None}},
            ],
            ["111", "3988328074353983199"],
        ),
        # A post whose identities disagree still fails the whole digest.
        ([{"media": {"pk": "111", "id": "999_1"}}], None),
    ],
)
def test_digest_skips_posts_instagram_could_not_load(items, expected):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    from services.instagram_notifications import browser_session

    source = browser_digest._digest_query_source("cache-1", "41553815702")
    script = (
        """
      global.window = {};
      global.document = {cookie: "csrftoken=fixture; ds_user_id=41553815702"};
      global.fetch = async () => ({status: 200, ok: true, json: async () => ({
        errors: [{message: "execution error", severity: "ERROR"}],
        data: {subscription_digest_feed: {items: %s, paging_info: {more_available: false}}}
      })});
    """
        % json.dumps(items)
        + source
        + ";setImmediate(() => setImmediate(() => {const request = window["
        + json.dumps(browser_session._REQUEST_KEY)
        + "]; console.log(JSON.stringify(request.result));}));"
    )
    completed = subprocess.run([node], input=script, text=True, capture_output=True, timeout=5)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    if expected is None:
        assert result == {"state": "failed", "reason": "invalid_response"}
    else:
        assert result == {"state": "succeeded", "media_ids": expected, "page_count": 1}
