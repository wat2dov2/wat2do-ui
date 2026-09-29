import json
import shutil
import subprocess

import pytest

from services.instagram_notifications import browser_digest
from services.instagram_notifications.browser_session import BrowserSessionError


def test_action_media_ids_and_merge_use_one_canonical_media_list() -> None:
    action = (
        "clips_home?media_id=123_456&media_list=789%2C123&"
        "notif_type=subscription_daily_digest&cache_ent_id=cache-1"
    )

    assert browser_digest.action_media_ids(action) == ("123", "789")
    assert browser_digest.merge_action_media_ids(action, ("101", "789")) == (
        "clips_home?media_list=123%2C789%2C101&notif_type=subscription_daily_digest&"
        "cache_ent_id=cache-1"
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

    def query(self, source):
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


def test_digest_javascript_checks_identity_per_page_and_cancels_fetches():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    source = browser_digest._digest_query_source("cache-1", "41553815702")
    completed = subprocess.run([node, "--check"], input=source, text=True, capture_output=True)
    assert completed.returncode == 0, completed.stderr
    assert "signal: request.controller.signal" in source
    assert "request.settled = true" in source
    assert source.count("activeRecipient") == 4
    assert "account_changed" in source


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
