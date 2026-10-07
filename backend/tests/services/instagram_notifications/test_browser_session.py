import json
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from types import SimpleNamespace

import pytest

from services.instagram_notifications import browser_session as browser
from services.instagram_notifications.browser_ingestion import BrowserInstagramRetriever
from tests.services.instagram_notifications.test_browser_engagement import (
    _DOM_ADAPTER,
    _FixtureParser,
)
from tests.services.instagram_notifications.test_browser_ingestion import POST


@pytest.mark.parametrize(
    "source",
    [
        browser._open_more_source(),
        browser._switch_button_state_source(),
        browser._click_switch_accounts_source(),
        browser._account_chooser_state_source(),
        browser._click_account_source("usask.wat2do.io"),
        browser._current_account_username_source(),
        browser._recipient_is_active_source("41553815702"),
        browser._close_account_chooser_source(),
        browser._cancel_request_source(),
    ],
)
def test_shared_generated_sources_parse(source):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    completed = subprocess.run([node, "--check"], input=source, text=True, capture_output=True)
    assert completed.returncode == 0, completed.stderr


def _evaluate_account_identity(html, *, ready_state="complete"):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable for offline DOM fixture tests")
    parser = _FixtureParser()

    def retain_text(data):
        attributes = parser.stack[-1]["attrs"]
        attributes["data-fixture-text"] = attributes.get("data-fixture-text", "") + data

    parser.handle_data = retain_text
    parser.feed(html)
    script = (
        _DOM_ADAPTER
        + f"""
      Object.defineProperty(Element.prototype, "textContent", {{get() {{
        return (this.attrs["data-fixture-text"] || "") +
          this.children.map(child => child.textContent).join("");
      }}}});
      const bounds = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function() {{
        return {{...bounds.call(this), left: Number(this.attrs["data-left"] || 10)}};
      }};
      global.document = new Element({json.dumps(parser.root)});
      document.readyState = {json.dumps(ready_state)};
      console.log(JSON.stringify({browser._current_account_username_source()}));
    """
    )
    completed = subprocess.run([node], input=script, text=True, capture_output=True)
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


@pytest.mark.parametrize("content_tag", ["main", "article", "section", "div"])
def test_viewed_profile_avatar_is_unreadable_until_own_navigation_profile_loads(content_tag):
    html = (
        f"<{content_tag}><a href='/dalmackerel/'>"
        '<img alt="dalmackerel\'s profile picture"></a>'
        f"</{content_tag}>"
    )
    assert _evaluate_account_identity(html) == ""


def test_logged_account_navigation_ignores_viewed_profile_owner_in_same_left_column():
    html = (
        "<nav><a href='/wat2do.uwaterloo/'>"
        '<img alt="wat2do.uwaterloo\'s profile picture"></a></nav>'
        "<main><a href='/dalmackerel/'>"
        '<img alt="dalmackerel\'s profile picture"></a></main>'
    )
    assert _evaluate_account_identity(html) == "wat2do.uwaterloo"


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        (
            "<div role='navigation'><a href='/wat2do.uwaterloo/'>"
            '<img alt="wat2do.uwaterloo\'s profile picture"></a></div>',
            "wat2do.uwaterloo",
        ),
        (
            "<nav><a href='/wat2do.uwaterloo/' data-hidden='true'>"
            '<img alt="wat2do.uwaterloo\'s profile picture"></a></nav>'
            "<main><a href='/dalmackerel/'>"
            '<img alt="dalmackerel\'s profile picture"></a></main>',
            "",
        ),
        (
            "<nav><a href='/wat2do.uwaterloo/'>"
            '<img alt="dalmackerel\'s profile picture"></a></nav>',
            "",
        ),
        (
            "<nav><a href='/wat2do.uwaterloo/'>"
            '<img alt="wat2do.uwaterloo\'s profile picture"></a>'
            "<a href='/wat2do.uwo/'>"
            '<img alt="wat2do.uwo\'s profile picture"></a></nav>',
            "!ambiguous",
        ),
        (
            "<main><nav><a href='/dalmackerel/'>"
            '<img alt="dalmackerel\'s profile picture"></a></nav></main>',
            "",
        ),
        (
            "<div role='dialog'><nav><a href='/dalmackerel/'>"
            '<img alt="dalmackerel\'s profile picture"></a></nav></div>',
            "",
        ),
    ],
)
def test_account_identity_requires_visible_owned_navigation_and_matching_avatar(html, expected):
    assert _evaluate_account_identity(html) == expected


@pytest.mark.parametrize(
    "control",
    [
        "<a href='/wat2do.uwaterloo/' role='link'>"
        '<img alt="wat2do.uwaterloo\'s profile picture"><span>Profile</span></a>',
        "<a href='/wat2do.uwaterloo/' aria-label='Profile'>"
        '<img alt="wat2do.uwaterloo\'s profile picture"></a>',
        "<a href='/wat2do.uwaterloo/'>"
        '<img alt="wat2do.uwaterloo\'s profile picture">'
        "<svg aria-label='Profile'><title>Profile</title></svg></a>",
    ],
)
def test_logged_identity_uses_explicit_profile_control_when_navigation_has_no_landmark(control):
    html = "<div>" + control + "</div><main><a href='/dalmackerel/'>"
    html += '<img alt="dalmackerel\'s profile picture"></a></main>'
    assert _evaluate_account_identity(html) == "wat2do.uwaterloo"
    assert _evaluate_account_identity(html, ready_state="loading") == ""


def test_same_account_in_desktop_and_mobile_navigation_is_deduplicated():
    link = "<a href='/wat2do.uwaterloo/'>"
    link += '<img alt="wat2do.uwaterloo\'s profile picture"></a>'
    assert (
        _evaluate_account_identity(
            "<nav>" + link + "</nav><div role='navigation'>" + link + "</div>"
        )
        == "wat2do.uwaterloo"
    )


def _compact_navigation_fixture(
    *, include_profile=True, routes=("/", "/explore/", "/reels/", "/direct/inbox/")
):
    controls = "".join(f"<div><a href='{route}' role='link'></a></div>" for route in routes)
    if include_profile:
        # Live compact layout: unlabelled own avatar has DIV/SPAN/DIV/DIV
        # ancestors before the shared route container at depth five.
        controls += (
            "<div><div><span><div><a href='/wat2do.uwaterloo/' role='link' data-left='608.25'>"
            '<img alt="wat2do.uwaterloo\'s profile picture"></a></div></span></div></div>'
        )
    return "<div>" + controls + "</div>"


def test_compact_unlabelled_profile_uses_bounded_actual_navigation_routes():
    assert _evaluate_account_identity(_compact_navigation_fixture()) == "wat2do.uwaterloo"


@pytest.mark.parametrize("include_profile", [False, True])
def test_public_owner_in_loose_sibling_branch_cannot_borrow_page_navigation(include_profile):
    html = "<div>" + _compact_navigation_fixture(include_profile=include_profile)
    html += (
        "<div><div><a href='/dalmackerel/'>"
        '<img alt="dalmackerel\'s profile picture"></a></div></div></div>'
    )
    assert _evaluate_account_identity(html) == ("wat2do.uwaterloo" if include_profile else "")


@pytest.mark.parametrize("missing_route", ["/", "/explore/", "/reels/", "/direct/inbox/"])
def test_incomplete_compact_navigation_is_unreadable_during_hydration(missing_route):
    routes = tuple(
        route for route in ("/", "/explore/", "/reels/", "/direct/inbox/") if route != missing_route
    )
    assert _evaluate_account_identity(_compact_navigation_fixture(routes=routes)) == ""


def test_unrelated_page_home_link_does_not_complete_partial_navigation():
    html = "<div><a href='/'>page logo</a>"
    html += (
        _compact_navigation_fixture(routes=("/explore/", "/reels/", "/direct/inbox/")) + "</div>"
    )
    assert _evaluate_account_identity(html) == ""


class AccountBrowser:
    def __init__(self, username="usask.wat2do.io", recipient=True):
        self.username = username
        self.recipient = recipient
        self.sources = []
        self.menu = False
        self.chooser = False

    def __call__(self, source, _timeout):
        self.sources.append(source)
        if "request.controller.abort()" in source:
            return "settled"
        if source.startswith("delete window"):
            return "cleared"
        if "const anchors =" in source:
            return self.username
        if "activeRecipient" in source:
            return "true" if self.recipient else "false"
        if "const settings =" in source:
            self.menu = True
            return "clicked"
        if 'const username = "usask.wat2do.io"' in source:
            self.username = "usask.wat2do.io"
            self.recipient = True
            self.chooser = False
            return "clicked"
        if "const button" in source and "Switch accounts" in source:
            self.chooser = True
            return "clicked"
        if 'h1,[role="heading"]' in source:
            return "ready" if self.chooser else "pending"
        if "some(element" in source:
            return "ready" if self.menu else "pending"
        raise AssertionError(source)


def test_switches_once_and_verifies_recipient_without_exporting_credentials():
    fake = AccountBrowser(username="ulaval.wat2do.io", recipient=False)
    result = browser.BrowserInstagramSession(javascript_runner=fake).activate_account(
        "41553815702", "usask.wat2do.io"
    )
    assert result == "usask.wat2do.io"
    assert sum('const username = "usask.wat2do.io"' in source for source in fake.sources) == 1
    assert "sessionid" not in "\n".join(fake.sources).lower()


def test_matching_username_with_wrong_recipient_never_navigates():
    fake = AccountBrowser(recipient=False)
    with pytest.raises(browser.BrowserSessionError, match="does not match"):
        browser.BrowserInstagramSession(javascript_runner=fake).activate_account(
            "41553815702", "usask.wat2do.io"
        )
    assert not any("location" in source for source in fake.sources)


@pytest.mark.parametrize(
    "username", ["usask.wat2do.io", "wat2do.ca", "utm.wat2do.ca", "wat2do.usask"]
)
def test_accepts_supported_account_names(username):
    fake = AccountBrowser(username=username)
    assert (
        browser.BrowserInstagramSession(javascript_runner=fake).activate_account(
            "41553815702", username
        )
        == username
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://attacker.test/p/ABC/",
        "https://instagram.com.evil/p/ABC/",
        "https://www.instagram.com@evil.test/p/ABC/",
        "http://www.instagram.com/p/ABC/",
        "https://www.instagram.com/accounts/login/",
        "https://www.instagram.com/p/a/b/",
        "https://www.instagram.com:443/p/ABC/",
    ],
)
def test_rejects_noncanonical_navigation_targets(url):
    with pytest.raises(browser.BrowserSessionError, match="post URL is invalid"):
        browser.canonical_post_url(url)


def test_normalizes_only_valid_post_permalink():
    assert browser.canonical_post_url("https://instagram.com/p/ABC_12-/?igsh=tracking") == (
        "https://www.instagram.com/p/ABC_12-/"
    )


def test_pins_existing_tab_and_never_rediscovers_after_navigation(monkeypatch):
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        output = (
            "42"
            if args[2] == browser._SELECT_TAB_SCRIPT
            else "99"
            if args[2] == browser._WORKER_WINDOW_SCRIPT
            else '{"width":1200,"height":900}'
            if args[-2] == browser._VIEWPORT_SOURCE
            else "ok"
        )
        return subprocess.CompletedProcess(args, 0, stdout=output)

    monkeypatch.setattr(browser.subprocess, "run", run)
    runner = browser._PinnedBraveJavascriptRunner()
    assert runner("first operation", 1) == "ok"
    assert runner("second operation", 1) == "ok"
    assert calls[0][2] == browser._SELECT_TAB_SCRIPT
    assert calls[1][2] == browser._WORKER_WINDOW_SCRIPT
    assert calls[2][-3:] == ["42", browser._VIEWPORT_SOURCE, "99"]
    assert calls[3][-3:] == ["42", "first operation", "99"]
    assert calls[4][-3:] == ["42", "second operation", "99"]
    assert "make new" not in browser._SELECT_TAB_SCRIPT


@pytest.mark.parametrize(
    ("detail", "expected"),
    [
        ("Executing JavaScript through AppleScript is turned off. secret", "Enable Brave View"),
        ("Brave is not running. secret", "Open Brave"),
        ("Pinned Instagram tab is closed. secret", "pinned Instagram tab was closed"),
    ],
)
def test_browser_errors_are_actionable_and_sanitized(monkeypatch, detail, expected):
    def run(*args, **kwargs):
        raise subprocess.CalledProcessError(1, "osascript", stderr=detail)

    monkeypatch.setattr(browser.subprocess, "run", run)
    with pytest.raises(browser.BrowserSessionError, match=expected) as raised:
        browser._run_applescript("source", (), 1)
    assert "secret" not in str(raised.value)


def test_confirmed_pinned_tab_closure_preserves_repairable_failure_type(monkeypatch):
    def run(*args, **kwargs):
        raise subprocess.CalledProcessError(
            1, "osascript", stderr="Pinned Instagram tab is closed. secret"
        )

    monkeypatch.setattr(browser.subprocess, "run", run)
    with pytest.raises(browser._BrowserTabUnavailable) as raised:
        browser._run_applescript("source", (), 1)
    assert str(raised.value) == "The pinned Instagram tab was closed"


@pytest.mark.parametrize("failure", [TimeoutError, KeyboardInterrupt, browser.BrowserSessionError])
def test_query_cancels_and_awaits_settlement_when_interrupted(failure):
    calls = []
    started = False
    cancelled = False

    def run(source, _timeout):
        nonlocal started, cancelled
        calls.append(source)
        if source == "start request":
            started = True
            return "started"
        if "JSON.stringify" in source:
            raise failure("interrupted")
        if "request.controller.abort()" in source:
            if started and not cancelled:
                cancelled = True
                return "pending"
            return "settled"
        if source.startswith("delete window"):
            return "cleared"
        raise AssertionError(source)

    with pytest.raises(failure):
        browser.BrowserInstagramSession(javascript_runner=run, sleep=lambda _: None).query(
            "start request"
        )
    assert cancelled
    assert calls[-1].startswith("delete window")


@pytest.mark.parametrize("operation_fails", [False, True])
def test_secondary_uncertain_query_cleanup_preserves_result_and_original_error(
    monkeypatch, operation_fails
):
    started = False
    payload = {"state": "failed", "reason": "auth_required"}
    original_error = (
        browser.BrowserAccountChanged("Instagram browser account changed")
        if operation_fails
        else browser._BrowserPageUnavailable("Request did not settle")
    )

    def run(self, source, timeout):
        nonlocal started
        if "request.controller.abort()" in source:
            if started:
                raise browser.BrowserSessionError("Brave browser automation timed out")
            return "settled"
        if source.startswith("delete window"):
            return "cleared"
        if source == "start request":
            started = True
            return "started"
        if "JSON.stringify" in source:
            if operation_fails:
                raise original_error
            return json.dumps({"result": payload, "settled": False})
        raise AssertionError(source)

    monkeypatch.setattr(browser._PinnedBraveJavascriptRunner, "__call__", run)
    session = browser.BrowserInstagramSession(
        javascript_runner=browser._PinnedBraveJavascriptRunner("42", window_id="99"),
        allow_account_switch=False,
    )

    def poll(completed):
        if not completed():
            raise original_error

    monkeypatch.setattr(session, "poll_until", poll)
    with pytest.raises(browser._BrowserReadCleanupPending) as raised:
        session.query("start request")
    assert "cancellation could not be confirmed" in str(raised.value)
    assert raised.value.operation_error is original_error
    assert raised.value.completed_payload == (None if operation_fails else payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"state": "succeeded", "posts": [{"url": "https://www.instagram.com/p/POST/"}]},
        {"state": "failed", "reason": "auth_required"},
    ],
)
def test_atomic_settlement_proof_preserves_terminal_result_under_cleanup_contention(payload):
    started = False
    cancellation_calls = []

    def run(source, timeout):
        nonlocal started
        if "request.controller.abort()" in source:
            cancellation_calls.append(started)
            if started:
                raise browser._BrowserAutomationTransient("Brave browser automation timed out")
            return "settled"
        if source.startswith("delete window"):
            return "cleared"
        if source == "start request":
            started = True
            return "started"
        assert "JSON.stringify" in source
        return json.dumps({"result": payload, "settled": True})

    session = browser.BrowserInstagramSession(javascript_runner=run)
    assert session.query("start request") == payload
    assert cancellation_calls == [False]


def test_query_waits_for_terminal_result_and_settlement_in_one_atomic_read():
    payload = {"state": "succeeded", "media_ids": ["123"]}
    states = iter(
        [
            None,
            {"result": None, "settled": False},
            {"result": {"state": "pending"}, "settled": True},
            {"result": payload, "settled": False},
            {"result": payload, "settled": True},
        ]
    )
    sleeps = []
    reads = []

    def run(source, timeout):
        if "request.controller.abort()" in source:
            return "settled"
        if source.startswith("delete window"):
            return "cleared"
        if source == "start request":
            return "started"
        reads.append(source)
        return json.dumps(next(states))

    session = browser.BrowserInstagramSession(javascript_runner=run, sleep=sleeps.append)
    assert session.query("start request") == payload
    assert len(reads) == 5 and len(sleeps) == 4
    assert all("request.result" in source and "request.settled" in source for source in reads)


@pytest.mark.parametrize(
    "state",
    [
        [],
        True,
        {"state": "succeeded"},
        {"result": {"state": "succeeded"}, "settled": "true"},
        {"result": {"state": "succeeded"}, "settled": 1},
        {"result": {"state": "succeeded"}, "settled": None},
        {"result": [], "settled": True},
        {"result": {"state": "unknown"}, "settled": True},
        {"result": {}, "settled": True},
        {"result": {"state": "succeeded"}, "settled": True, "extra": True},
    ],
)
def test_invalid_atomic_request_state_cannot_skip_cleanup(state):
    started = False
    cancellations = []

    def run(source, timeout):
        nonlocal started
        if "request.controller.abort()" in source:
            cancellations.append(started)
            return "settled"
        if source.startswith("delete window"):
            return "cleared"
        if source == "start request":
            started = True
            return "started"
        return json.dumps(state)

    with pytest.raises(browser.BrowserSessionError, match="invalid request state"):
        browser.BrowserInstagramSession(javascript_runner=run).query("start request")
    assert cancellations == [False, True]


def test_terminal_unsettled_result_timing_out_still_aborts_and_cleans_request():
    now = [0.0]
    started = False
    cancellations = []
    cleared = []

    def run(source, timeout):
        nonlocal started
        if "request.controller.abort()" in source:
            cancellations.append(started)
            return "settled"
        if source.startswith("delete window"):
            cleared.append(source)
            return "cleared"
        if source == "start request":
            started = True
            return "started"
        return json.dumps({"result": {"state": "succeeded"}, "settled": False})

    session = browser.BrowserInstagramSession(
        javascript_runner=run,
        monotonic=lambda: now[0],
        sleep=lambda seconds: now.__setitem__(0, now[0] + seconds),
        job_timeout_seconds=1,
    )
    with pytest.raises(browser._BrowserPageUnavailable, match="timed out"):
        session.query("start request")
    assert cancellations == [False, True]
    assert len(cleared) == 2


def test_unconfirmed_cancellation_fails_before_switching_account():
    now = 0.0
    calls = []

    def sleep(seconds):
        nonlocal now
        now += seconds

    def run(source, _timeout):
        calls.append(source)
        return "pending"

    with pytest.raises(browser.BrowserSessionError, match="cancellation could not be confirmed"):
        browser.BrowserInstagramSession(
            javascript_runner=run, sleep=sleep, monotonic=lambda: now
        ).activate_account("41553815702", "usask.wat2do.io")
    assert all("request.controller.abort()" in source for source in calls)


@pytest.mark.parametrize(
    "value", [None, 123, "", "other", "school.evil.com", "x" * 25 + ".wat2do.io"]
)
def test_shared_account_validator_rejects_unknown_or_overlong_accounts(value):
    with pytest.raises(ValueError, match="account username is invalid"):
        browser.validate_account_username(value)


def test_shared_account_validator_normalizes_supported_accounts():
    assert browser.validate_account_username("  UBC.WAT2DO.IO ") == "ubc.wat2do.io"


@pytest.mark.parametrize(
    "detail",
    [
        "Not authorized to send Apple events to Brave Browser. secret",
        "An Apple event failed (-1743). secret",
    ],
)
def test_automation_permission_error_preserves_actionable_sanitized_cause(monkeypatch, detail):
    def run(*args, **kwargs):
        raise subprocess.CalledProcessError(1, "osascript", stderr=detail)

    monkeypatch.setattr(browser.subprocess, "run", run)
    with pytest.raises(browser.BrowserSessionError) as raised:
        browser.BrowserInstagramSession().cancel_pending_request()
    message = str(raised.value)
    assert "Instagram browser request cancellation could not be confirmed" in message
    assert "Allow the Mac runner to control Brave" in message
    assert "System Settings > Privacy & Security > Automation" in message
    assert "secret" not in message


def test_cancellation_preserves_sanitized_browser_timeout(monkeypatch):
    def run(*args, **kwargs):
        raise subprocess.TimeoutExpired("osascript", 30, output="secret")

    monkeypatch.setattr(browser.subprocess, "run", run)
    with pytest.raises(browser.BrowserSessionError) as raised:
        browser.BrowserInstagramSession().cancel_pending_request()
    assert str(raised.value) == (
        "Instagram browser request cancellation could not be confirmed: "
        "Brave browser automation timed out"
    )


def test_cancellation_deadline_does_not_leak_raw_exception_message():
    def run(*args):
        raise TimeoutError("secret")

    with pytest.raises(browser.BrowserSessionError) as raised:
        browser.BrowserInstagramSession(javascript_runner=run).cancel_pending_request()
    assert str(raised.value) == (
        "Instagram browser request cancellation could not be confirmed: "
        "the browser job deadline expired"
    )


@pytest.mark.parametrize("arriving_username", ["usask.wat2do.io", "other.wat2do.io"])
def test_post_navigation_waits_for_delayed_profile_identity_but_rejects_wrong_account(
    arriving_username,
):
    navigated = False
    reads_after_navigation = 0

    def run(source, _timeout):
        nonlocal reads_after_navigation
        if "const expected = new URL" in source:
            return "ready"
        if "const anchors =" in source:
            if not navigated:
                return "usask.wat2do.io"
            reads_after_navigation += 1
            return "" if reads_after_navigation <= 2 else arriving_username
        if "activeRecipient" in source:
            return "true"
        raise AssertionError(source)

    class NavigationBrowser:
        __call__ = staticmethod(run)

        def navigate(self, url, timeout, *, reload=False):
            nonlocal navigated
            navigated = True
            assert url == "https://www.instagram.com/p/POST/"
            return "navigating"

    session = browser.BrowserInstagramSession(
        javascript_runner=NavigationBrowser(), sleep=lambda _: None
    )
    if arriving_username == "usask.wat2do.io":
        assert (
            session.navigate_post(
                "https://www.instagram.com/p/POST/", "41553815702", "usask.wat2do.io"
            )
            == "https://www.instagram.com/p/POST/"
        )
    else:
        with pytest.raises(browser.BrowserSessionError, match="does not match"):
            session.navigate_post(
                "https://www.instagram.com/p/POST/", "41553815702", "usask.wat2do.io"
            )
    assert reads_after_navigation >= 3


@pytest.mark.parametrize("reload", [False, True])
def test_post_navigation_uses_native_url_setter_without_renderer_javascript(monkeypatch, reload):
    calls = []

    def run(script, arguments, timeout):
        calls.append((script, arguments))
        assert script == browser._NAVIGATE_TAB_SCRIPT
        assert "set URL of browserTab to targetUrl" in script
        assert "execute" not in script
        return "navigating" if reload else "already_open"

    monkeypatch.setattr(browser, "_run_applescript", run)
    session = browser.BrowserInstagramSession(
        javascript_runner=browser._PinnedBraveJavascriptRunner("42", window_id="99")
    )
    assert session.navigate("https://www.instagram.com/p/TARGET/", reload=reload) == (
        "navigating" if reload else "already_open"
    )
    assert calls[0][1] == ("42", "https://www.instagram.com/p/TARGET/", "99", json.dumps(reload))


@pytest.mark.parametrize(
    ("labels", "expected"),
    [
        (["dalhousie.wat2do.io"], "dalhousie.wat2do.io"),
        (["dalhousie.wat2do.ca"], "dalhousie.wat2do.ca"),
        (["other.wat2do.dalhousie"], None),
        (["wat2do.dalhousie", "wat2do.dalhousie"], None),
        (["wat2do.dalhousie"], "wat2do.dalhousie"),
        (["dalhousie.wat2do.io", "wat2do.dalhousie"], "wat2do.dalhousie"),
        (["other.wat2do.io"], None),
        (["dalhousie.wat2do.io", "dalhousie.wat2do.io"], None),
    ],
)
def test_renamed_account_selects_saved_school_entry_without_guessing(labels, expected):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    script = (
        "const clicked = []; const labels = " + json.dumps(labels) + ";"
        "const buttons = labels.map(label => ({innerText: label, "
        "scrollIntoView() {}, click() {clicked.push(label);}}));"
        "const dialog = {querySelectorAll: () => buttons};"
        "const heading = {innerText: 'Switch accounts', closest: () => dialog};"
        "global.document = {querySelectorAll: () => [heading]};"
        "const status = " + browser._click_account_source("wat2do.dalhousie") + ";"
        "console.log(JSON.stringify({status, clicked}));"
    )
    completed = subprocess.run([node], input=script, text=True, capture_output=True)
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["clicked"] == ([] if expected is None else [expected])
    assert (result["status"] == "clicked") == (expected is not None)


def test_configured_saved_chooser_label_never_changes_canonical_account_identity():
    assert browser.school_account_username("uwaterloo") == "wat2do.uwaterloo"
    source = browser._click_account_source("wat2do.uwaterloo")
    assert 'const username = "wat2do.uwaterloo"' in source
    assert 'const switcherUsername = "wat2do.ca"' in source
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    script = (
        "const clicked = []; const labels = ['wat2do.ca', 'wat2do.uwaterloo'];"
        "const buttons = labels.map(label => ({innerText: label, "
        "scrollIntoView() {}, click() {clicked.push(label);}}));"
        "const dialog = {querySelectorAll: () => buttons};"
        "const heading = {innerText: 'Switch accounts', closest: () => dialog};"
        "global.document = {querySelectorAll: () => [heading]};"
        "const status = " + source + ";"
        "console.log(JSON.stringify({status, clicked}));"
    )
    completed = subprocess.run([node], input=script, text=True, capture_output=True)
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {"status": "clicked", "clicked": ["wat2do.ca"]}


@pytest.mark.parametrize("recipient_matches", [True, False])
def test_configured_saved_label_requires_canonical_active_username_and_recipient(recipient_matches):
    class WaterlooBrowser(AccountBrowser):
        def __call__(self, source, timeout):
            if 'const switcherUsername = "wat2do.ca"' in source:
                self.sources.append(source)
                self.username = "wat2do.uwaterloo"
                self.recipient = recipient_matches
                self.chooser = False
                return "clicked"
            return super().__call__(source, timeout)

    fake = WaterlooBrowser(username="wat2do.uwo", recipient=False)
    session = browser.BrowserInstagramSession(javascript_runner=fake)
    if recipient_matches:
        assert session.activate_account("41553815702", "wat2do.uwaterloo") == "wat2do.uwaterloo"
    else:
        with pytest.raises(browser.BrowserSessionError, match="does not match"):
            session.activate_account("41553815702", "wat2do.uwaterloo")
    assert 'activeRecipient === "41553815702"' in "\n".join(fake.sources)


def test_saved_chooser_label_is_rejected_as_the_active_identity():
    now = 0.0

    def sleep(seconds):
        nonlocal now
        now += seconds

    class StaleWaterlooBrowser(AccountBrowser):
        def __call__(self, source, timeout):
            if 'const switcherUsername = "wat2do.ca"' in source:
                self.sources.append(source)
                self.username = "wat2do.ca"
                self.recipient = True
                self.chooser = False
                return "clicked"
            return super().__call__(source, timeout)

    fake = StaleWaterlooBrowser(username="wat2do.uwo", recipient=False)
    session = browser.BrowserInstagramSession(
        javascript_runner=fake, sleep=sleep, monotonic=lambda: now
    )
    with pytest.raises(browser._BrowserPageUnavailable, match="timed out"):
        session._switch_account("wat2do.uwaterloo")
    assert sum('const switcherUsername = "wat2do.ca"' in source for source in fake.sources) == 1


@pytest.mark.parametrize("recipient_matches", [True, False])
def test_saved_entry_selection_still_verifies_active_recipient(recipient_matches):
    class RenamedBrowser(AccountBrowser):
        def __call__(self, source, timeout):
            if 'const username = "wat2do.usask"' in source:
                self.sources.append(source)
                self.username = "wat2do.usask"
                self.recipient = recipient_matches
                self.chooser = False
                return "clicked"
            return super().__call__(source, timeout)

    fake = RenamedBrowser(username="wat2do.wlu", recipient=False)
    session = browser.BrowserInstagramSession(javascript_runner=fake)
    if recipient_matches:
        assert session.activate_account("41553815702", "wat2do.usask") == "wat2do.usask"
    else:
        with pytest.raises(browser.BrowserSessionError, match="does not match"):
            session.activate_account("41553815702", "wat2do.usask")
    assert not any("location" in source for source in fake.sources)


def test_parallel_session_refuses_to_switch_to_another_account(monkeypatch):
    session = browser.BrowserInstagramSession(
        javascript_runner=lambda *args: "", allow_account_switch=False
    )
    monkeypatch.setattr(session, "poll_until", lambda predicate: predicate())
    monkeypatch.setattr(session, "current_account_username", lambda: "wat2do.ubc")
    monkeypatch.setattr(
        session, "_switch_account", lambda _: pytest.fail("Tabs cannot switch accounts in parallel")
    )
    with pytest.raises(browser.BrowserSessionError, match="account changed"):
        session._prepare_account("123", "wat2do.utm")


def test_job_deadline_still_allows_confirmed_request_cancellation():
    clock = [0.0]
    calls = []

    def run(source, timeout):
        calls.append(source)
        return "settled"

    session = browser.BrowserInstagramSession(
        javascript_runner=run, monotonic=lambda: clock[0], job_timeout_seconds=1
    )
    clock[0] = 2.0
    with pytest.raises(TimeoutError, match="deadline"):
        session.run("must not run")
    session.cancel_pending_request()
    assert len(calls) == 2
    with pytest.raises(TimeoutError):
        session.run("still expired")


def test_pool_cancels_all_registered_tabs_before_switching_account(monkeypatch):
    from types import SimpleNamespace

    calls = []
    settings = {"browser_tab_ids": ["1", "2"]}
    queue = SimpleNamespace(
        get_setting=lambda key, default=None: settings.get(key, default),
        set_setting=lambda key, value: settings.update(
            {key: list(value) if isinstance(value, list) else value}
        ),
    )

    def session(**kw):
        tab = kw["javascript_runner"]._tab_id
        return SimpleNamespace(
            tab_id=tab,
            cancel_pending_request=lambda: calls.append(("cancel", tab)),
            activate_account=lambda *args: calls.append(("switch", tab)) or "wat2do.ubc",
            navigate=lambda *args, **kwargs: calls.append(("reload", tab)),
            reset_job_deadline=lambda timeout: None,
        )

    monkeypatch.setattr(browser, "BrowserInstagramSession", session)
    monkeypatch.setattr(browser.BrowserTabPool, "ensure_capacity", lambda _, **kwargs: ["1", "2"])
    sessions, username = browser.BrowserTabPool(queue).prepare(
        SimpleNamespace(kind="digest", recipient_id="123", account_username="wat2do.ubc"), 2
    )
    assert calls == [("cancel", "1"), ("cancel", "2"), ("switch", "1"), ("reload", "2")]
    assert [s.tab_id for s in sessions] == ["2"] and username == "wat2do.ubc"


def test_pool_does_not_adopt_human_tabs_when_all_owned_tabs_are_closed(monkeypatch):
    from types import SimpleNamespace

    q = SimpleNamespace(
        get_setting=lambda key, default=None: ["1", "2"] if key == "browser_tab_ids" else default
    )
    monkeypatch.setattr(
        browser,
        "_run_applescript",
        lambda script, *args: (
            (_ for _ in ()).throw(
                browser.BrowserSessionError("The pinned Instagram tab was closed")
            )
            if script == browser._WORKER_WINDOW_SCRIPT
            else pytest.fail("No human tab adoption")
        ),
    )
    with pytest.raises(browser.BrowserSessionError, match="No registered worker window"):
        browser.BrowserTabPool(q).ensure_capacity()


def test_pool_caps_instagram_tabs_and_repairs_closed_slots(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(
        browser, "_CONTROL", browser._CONTROL.model_copy(update={"parallel_tabs": 10})
    )
    settings = {"browser_tab_ids": ["1"]}
    live = {
        "1",
        "101",
        "102",
        "103",
        "104",
        "105",
        "106",
        "107",
        "108",
        "109",
        "110",
        "111",
        "112",
        "113",
    }
    created = []

    def applescript(script, args, timeout):
        if script == browser._ACTIVATE_TAB_SCRIPT:
            return sorted(live)[0]
        if script == browser._EXECUTE_TAB_SCRIPT:
            assert args[1] == browser._VIEWPORT_SOURCE
            return '{"width":1200,"height":900}'
        if script == browser._RESTORE_ACTIVE_TAB_SCRIPT:
            return "restored"
        if script == browser._CLOSE_WORKER_TAB_SCRIPT:
            live.discard(args[0])
            return "closed"
        if script == browser._INSTAGRAM_TAB_INVENTORY_SCRIPT:
            return "\n".join(sorted(live))
        if script == browser._WORKER_WINDOW_SCRIPT:
            if args[0] not in live:
                raise browser.BrowserSessionError("The pinned Instagram tab was closed")
            return "99"
        if script == browser._WORKER_TAB_INVENTORY_SCRIPT:
            assert args[0] == "99"
            return "\n".join(tab_id for tab_id in args[1:] if tab_id in live)
        assert script == browser._CREATE_WORKER_TAB_SCRIPT
        tab_id = str(len(created) + 2)
        created.append(tab_id)
        live.add(tab_id)
        return tab_id

    q = SimpleNamespace(
        get_setting=lambda key, default=None: settings.get(key, default),
        set_setting=lambda key, value: settings.update(
            {key: list(value) if isinstance(value, list) else value}
        ),
        peek_account_username=lambda: "wat2do.ubc",
    )
    monkeypatch.setattr(browser, "_run_applescript", applescript)
    monkeypatch.setattr(
        browser,
        "BrowserInstagramSession",
        lambda **kw: SimpleNamespace(
            run=lambda _: "/",
            current_page_path=lambda: "/wat2do.ubc/",
            current_account_username=lambda: "wat2do.ubc",
            cancel_pending_request=lambda: None,
            poll_until=lambda ready: ready(),
        ),
    )
    pool = browser.BrowserTabPool(q)
    first = pool.ensure_capacity()
    assert len(first) == len(set(first)) == 10
    assert len(created) == 0
    assert pool.ensure_capacity() == first
    assert len(created) == 0
    live.remove("105")
    repaired = pool.ensure_capacity()
    assert len(repaired) == len(set(repaired)) == 10
    assert "105" not in repaired
    assert repaired == settings["browser_tab_ids"]
    assert len(created) == 1
    live.clear()
    restored = pool.ensure_capacity()
    assert len(restored) == len(set(restored)) == 10
    assert len(created) == 11
    assert settings["browser_window_id"] == "99"


def test_public_pool_records_verified_bootstrap_hint_without_navigating_targets(monkeypatch):
    from types import SimpleNamespace

    settings = {"browser_tab_ids": ["1", "2"]}
    reloads = []
    current = ["wat2do.ubc"]
    queue = SimpleNamespace(
        get_setting=lambda key, default=None: settings.get(key, default),
        set_setting=lambda key, value: settings.update({key: value}),
    )
    monkeypatch.setattr(browser.BrowserTabPool, "ensure_capacity", lambda _, **kwargs: ["1", "2"])
    monkeypatch.setattr(
        browser,
        "BrowserInstagramSession",
        lambda **kw: SimpleNamespace(
            cancel_pending_request=lambda: None,
            current_account_username=lambda: current[0],
            navigate=lambda *args, **kwargs: reloads.append(args),
            reset_job_deadline=lambda timeout: None,
            poll_until=lambda ready: ready(),
        ),
    )
    pool = browser.BrowserTabPool(queue)
    job = SimpleNamespace(
        kind="retrieval",
        account_username="wat2do.ubc",
        payload={"url": "https://www.instagram.com/p/TARGET/"},
    )
    pool.prepare(job, 2)
    assert reloads == []
    assert settings["retrieval_pool_account"] == "wat2do.ubc"
    pool.prepare(job, 2)
    assert reloads == []
    current[0] = "student.personal"
    pool.prepare(job, 2)
    assert reloads == []
    assert settings["retrieval_pool_account"] == "student.personal"


def test_fourteen_retrieval_slots_navigate_only_their_own_assigned_target(monkeypatch):
    ids = [str(index) for index in range(1, 16)]
    settings = {"browser_tab_ids": ids, "browser_window_id": "99"}
    navigations = []
    targets = [f"https://www.instagram.com/p/TARGET{index}/" for index in range(14)]

    def make_session(**kwargs):
        tab_id = kwargs["javascript_runner"]._tab_id
        page = {"url": "https://www.instagram.com/wat2do.yorku/"}

        def navigate(url, **options):
            navigations.append((tab_id, url))
            page["url"] = url

        return SimpleNamespace(
            tab_id=tab_id,
            cancel_pending_request=lambda: None,
            current_account_username=lambda: "wat2do.uwaterloo",
            reset_job_deadline=lambda timeout: None,
            navigate=navigate,
            current_page_path=lambda: page["url"].split("instagram.com", 1)[1],
            poll_until=lambda completed: (
                completed() or pytest.fail("Target must precede readiness")
            ),
            query=lambda source: {
                "state": "succeeded",
                "posts": [{**deepcopy(POST), "url": page["url"]}],
            },
        )

    monkeypatch.setattr(browser, "BrowserInstagramSession", make_session)
    monkeypatch.setattr(browser.BrowserTabPool, "ensure_capacity", lambda _, **kwargs: ids)
    queue = SimpleNamespace(
        get_setting=lambda key, default=None: settings.get(key, default),
        set_setting=lambda key, value: settings.update({key: value}),
    )
    sessions, username = browser.BrowserTabPool(queue).prepare(
        SimpleNamespace(
            kind="retrieval", account_username="wat2do.uwaterloo", payload={"url": targets[0]}
        ),
        15,
    )
    assert navigations == []
    assert username == "wat2do.uwaterloo" and [session.tab_id for session in sessions] == ids[1:]
    for session, target in zip(sessions, targets, strict=True):
        result = BrowserInstagramRetriever(session).retrieve(target, cutoff_days=7)
        assert result["target_url"] == target and result["posts"][0]["url"] == target
    assert navigations == list(zip(ids[1:], targets, strict=True))


def test_pool_waits_for_username_and_captures_the_readable_value():
    from types import SimpleNamespace

    readings = iter([None, None, "wat2do.sfu"])

    def poll(ready):
        for _ in range(3):
            if ready():
                return
        pytest.fail("Expected a readable identity")

    session = SimpleNamespace(current_account_username=lambda: next(readings), poll_until=poll)
    assert browser.BrowserTabPool._ready_username(session) == "wat2do.sfu"


def test_pool_unreadable_identity_is_transient_not_recovery():
    from types import SimpleNamespace

    def poll(ready):
        assert not ready()
        raise browser._BrowserPageUnavailable("timed out")

    session = SimpleNamespace(current_account_username=lambda: None, poll_until=poll)
    with pytest.raises(TimeoutError, match="temporarily unreadable"):
        browser.BrowserTabPool._ready_username(session)


@pytest.mark.parametrize(
    ("path", "actual_username"),
    [
        ("/", "wat2do.uwaterloo"),
        ("/", "wat2do.yorku"),
        ("/p/PUBLIC/", "wat2do.uwaterloo"),
        ("/p/PUBLIC/", "wat2do.yorku"),
        ("/", "student.personal"),
        ("/accounts/login/", None),
        ("/accounts/suspended/", None),
        ("/challenge/", None),
        ("/checkpoint/", None),
    ],
)
def test_primary_public_bootstrap_recovers_blank_routes_and_preserves_auth_guards(
    monkeypatch, path, actual_username
):
    settings = {"browser_tab_ids": ["1", "2"], "browser_window_id": "99", "paused": "existing"}
    if actual_username == "student.personal":
        settings["retrieval_pool_account"] = actual_username
    navigations = []
    page = {"path": path, "recovered": False}
    primary = SimpleNamespace()
    current_page_path = browser.BrowserInstagramSession.current_page_path

    def navigate(url, *, reload):
        navigations.append((url, reload))
        page.update(path="/" + url.rstrip("/").split("/")[-1] + "/", recovered=True)

    def session(**kwargs):
        assert kwargs["javascript_runner"]._tab_id == "1"
        assert kwargs["job_timeout_seconds"] == browser._CONTROL.interaction_timeout_seconds
        primary.read = lambda source: page["path"]
        primary._sleep = lambda seconds: None
        primary._remaining_timeout = lambda: browser._CONTROL.interaction_timeout_seconds
        primary.current_page_path = lambda: current_page_path(primary)
        primary.current_account_username = lambda: actual_username if page["recovered"] else None
        primary.navigate = navigate
        primary.poll_until = lambda ready: ready() or pytest.fail("Recovery must precede readiness")
        primary.activate_account = lambda *args: pytest.fail("Recovery cannot change login")
        return primary

    def applescript(script, arguments, timeout):
        assert script in {
            browser._WORKER_TAB_INVENTORY_SCRIPT,
            browser._INSTAGRAM_TAB_INVENTORY_SCRIPT,
        }
        return "1\n2"

    monkeypatch.setattr(
        browser, "_CONTROL", browser._CONTROL.model_copy(update={"parallel_tabs": 2})
    )
    monkeypatch.setattr(browser, "BrowserInstagramSession", session)
    monkeypatch.setattr(browser, "_run_applescript", applescript)
    queue = SimpleNamespace(
        get_setting=lambda key, default=None: settings.get(key, default),
        set_setting=lambda key, value: settings.update({key: value}),
    )
    pool = browser.BrowserTabPool(queue)
    if actual_username:
        bootstrap = None if actual_username == "student.personal" else "wat2do.uwaterloo"
        assert pool.ensure_capacity(bootstrap_username=bootstrap) == ["1", "2"]
        destination = actual_username if bootstrap is None else bootstrap
        assert navigations == [(f"https://www.instagram.com/{destination}/", True)]
        assert pool._ready_username(primary) == actual_username
    else:
        with pytest.raises(browser.BrowserSessionError, match="human account recovery"):
            pool.ensure_capacity(bootstrap_username="wat2do.uwaterloo")
        assert navigations == []
    assert settings["paused"] == "existing"


def test_readiness_waits_for_native_loading_then_reads_successfully():
    calls = [0]
    sleeps = []

    def completed():
        calls[0] += 1
        if calls[0] < 3:
            raise browser._BrowserPageUnavailable("The pinned Instagram tab is loading")
        return True

    browser.BrowserInstagramSession(sleep=sleeps.append).poll_until(completed)
    assert calls[0] == 3 and len(sleeps) == 2


def test_persistent_native_loading_obeys_readiness_deadline():
    now = [0.0]

    def loading():
        raise browser._BrowserPageUnavailable("The pinned Instagram tab is loading")

    session = browser.BrowserInstagramSession(
        monotonic=lambda: now[0],
        sleep=lambda seconds: now.__setitem__(0, now[0] + seconds),
        job_timeout_seconds=1,
    )
    with pytest.raises(browser._BrowserPageUnavailable, match="automation timed out"):
        session.poll_until(loading)
    assert now[0] == 1


@pytest.mark.parametrize(
    "error",
    [
        browser.BrowserSessionError("Instagram browser requires human account recovery"),
        browser.BrowserAccountChanged("Instagram account changed"),
        browser._BrowserPageUnavailable("Instagram primary desktop viewport did not become ready"),
    ],
)
def test_readiness_does_not_swallow_auth_account_or_desktop_errors(error):
    calls = []

    def completed():
        calls.append(True)
        raise error

    with pytest.raises(type(error)) as raised:
        browser.BrowserInstagramSession(
            sleep=lambda _: pytest.fail("Never retry this error")
        ).poll_until(completed)
    assert raised.value is error and calls == [True]


@pytest.mark.parametrize("path", ["/", "/wat2do.uwaterloo/", "/p/PUBLIC/"])
def test_current_page_path_returns_normal_routes_without_grace_or_mutation(path):
    calls = []

    def runner(source, timeout):
        calls.append(source)
        return path

    session = browser.BrowserInstagramSession(
        javascript_runner=runner, sleep=lambda _: pytest.fail("Normal routes need no grace")
    )
    assert session.current_page_path() == path
    assert calls == ["window.location.pathname"]


@pytest.mark.parametrize("path", ["/accounts/suspended/", "/challenge/", "/checkpoint/"])
def test_current_page_path_rejects_human_recovery_routes_immediately(path):
    calls = []

    def runner(source, timeout):
        calls.append(source)
        return path

    session = browser.BrowserInstagramSession(
        javascript_runner=runner, sleep=lambda _: pytest.fail("Recovery must fail immediately")
    )
    with pytest.raises(browser.BrowserSessionError, match="human account recovery"):
        session.current_page_path()
    assert calls == ["window.location.pathname"]


@pytest.mark.parametrize("settled_path", ["/wat2do.uwaterloo/", "/accounts/login/", "/checkpoint/"])
def test_current_page_path_rechecks_transient_login_and_guards_the_fresh_route(settled_path):
    readings = iter(["/accounts/login/", settled_path])
    calls = []
    now = [0.0]
    sleeps = []

    def runner(source, timeout):
        calls.append(source)
        return next(readings)

    def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    session = browser.BrowserInstagramSession(
        javascript_runner=runner,
        monotonic=lambda: now[0],
        sleep=sleep,
        job_timeout_seconds=10,
    )
    if settled_path.startswith("/accounts/login") or settled_path.startswith("/checkpoint"):
        with pytest.raises(browser.BrowserSessionError, match="human account recovery"):
            session.current_page_path()
    else:
        assert session.current_page_path() == settled_path
    assert sleeps == [browser._CONTROL.account_transition_grace_seconds]
    assert calls == ["window.location.pathname"] * 2


def test_current_page_path_login_grace_obeys_remaining_job_deadline():
    now = [0.0]
    calls = []
    sleeps = []

    def runner(source, timeout):
        calls.append((source, timeout))
        return "/accounts/login/"

    def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    session = browser.BrowserInstagramSession(
        javascript_runner=runner,
        monotonic=lambda: now[0],
        sleep=sleep,
        job_timeout_seconds=0.25,
    )
    with pytest.raises(TimeoutError, match="job exceeded its deadline"):
        session.current_page_path()
    assert sleeps == [0.25]
    assert now[0] == 0.25 and calls == [("window.location.pathname", 0.25)]


def test_query_recovers_transient_cleanup_bridge_failure_without_repeating_request():
    started = False
    failures = 0
    sleeps = []
    starts = 0

    def run(source, timeout):
        nonlocal started, failures, starts
        assert timeout <= browser._CONTROL.interaction_timeout_seconds
        if "request.controller.abort()" in source:
            if started and failures < 2:
                failures += 1
                raise browser._BrowserAutomationTransient(
                    "Brave could not run Instagram browser automation"
                )
            return "settled"
        if source.startswith("delete window"):
            return "cleared"
        if source == "start request":
            starts += 1
            started = True
            return "started"
        if "JSON.stringify" in source:
            return '{"result":{"state":"succeeded","media_ids":["123"]},"settled":true}'
        raise AssertionError(source)

    session = browser.BrowserInstagramSession(javascript_runner=run, sleep=sleeps.append)
    assert session.query("start request")["media_ids"] == ["123"]
    session.cancel_pending_request()
    assert starts == 1
    assert failures == 2
    assert len(sleeps) == 2


def test_cleanup_bridge_retry_exhaustion_keeps_account_switch_blocked():
    calls = []

    def run(source, timeout):
        calls.append(source)
        raise browser._BrowserAutomationTransient(
            "Brave could not run Instagram browser automation"
        )

    with pytest.raises(browser.BrowserSessionError, match="cancellation could not be confirmed"):
        browser.BrowserInstagramSession(
            javascript_runner=run, sleep=lambda _: None
        ).activate_account("41553815702", "usask.wat2do.io")
    assert len(calls) == browser._CONTROL.bridge_retry_limit
    assert all("request.controller.abort()" in source for source in calls)


def test_cleanup_bridge_retries_share_one_deadline_and_restore_job_deadline():
    now = 0.0
    timeouts = []

    def run(source, timeout):
        nonlocal now
        timeouts.append(timeout)
        now += timeout
        raise browser._BrowserAutomationTransient("Brave browser automation timed out")

    session = browser.BrowserInstagramSession(
        javascript_runner=run, monotonic=lambda: now, sleep=lambda _: None, job_timeout_seconds=1
    )
    with pytest.raises(browser.BrowserSessionError, match="cancellation could not be confirmed"):
        session.cancel_pending_request()
    assert len(timeouts) == 1
    assert now == browser._CONTROL.interaction_timeout_seconds
    with pytest.raises(TimeoutError, match="deadline"):
        session.run("never execute")


def test_applescript_error_reports_only_numeric_code(monkeypatch):
    def run(*args, **kwargs):
        raise subprocess.CalledProcessError(1, "osascript", stderr="sensitive page text (-600)")

    monkeypatch.setattr(browser.subprocess, "run", run)
    with pytest.raises(browser.BrowserSessionError, match="Apple Event -600") as raised:
        browser._run_applescript("source", (), 1)
    assert "sensitive" not in str(raised.value)


def test_pool_settles_excess_owned_tabs_and_keeps_reserved_primary(monkeypatch):
    from types import SimpleNamespace

    settings = {"browser_tab_ids": [str(i) for i in range(1, 21)], "browser_window_id": "99"}
    settled = []
    closed = []
    monkeypatch.setattr(
        browser, "_CONTROL", browser._CONTROL.model_copy(update={"parallel_tabs": 7})
    )

    def applescript(script, args, timeout):
        if script == browser._WORKER_TAB_INVENTORY_SCRIPT:
            return "\n".join(tab for tab in args[1:] if tab not in closed)
        if script == browser._CLOSE_WORKER_TAB_SCRIPT:
            assert args[0] in settled
            closed.append(args[0])
            return "closed"
        if script == browser._INSTAGRAM_TAB_INVENTORY_SCRIPT:
            return "\n".join([str(i) for i in range(1, 8)] + ["999"])
        if script == browser._WORKER_WINDOW_SCRIPT:
            if args[0] in closed:
                raise browser.BrowserSessionError("The pinned Instagram tab was closed")
            return "99"
        raise AssertionError(script)

    monkeypatch.setattr(browser, "_run_applescript", applescript)
    monkeypatch.setattr(
        browser,
        "BrowserInstagramSession",
        lambda **kw: SimpleNamespace(
            cancel_pending_request=lambda: settled.append(kw["javascript_runner"]._tab_id),
            run=lambda _: "/",
            current_page_path=lambda: "/wat2do.ubc/",
            current_account_username=lambda: "wat2do.ubc",
            poll_until=lambda ready: ready(),
        ),
    )
    q = SimpleNamespace(
        get_setting=lambda key, default=None: settings.get(key, default),
        set_setting=lambda key, value: settings.update({key: value}),
        peek_account_username=lambda: "wat2do.ubc",
    )
    assert browser.BrowserTabPool(q).ensure_capacity() == [str(i) for i in range(1, 8)]
    assert closed == [str(i) for i in range(8, 21)] + ["999"]
    assert "1" not in closed and "999" in closed


def test_closed_owned_document_is_settled_without_retargeting_tab():
    calls = []

    def runner(source, timeout):
        calls.append(source)
        raise browser.BrowserSessionError("The pinned Instagram tab was closed")

    browser.BrowserInstagramSession(javascript_runner=runner).cancel_pending_request()
    assert len(calls) == 1
    assert "request.controller.abort()" in calls[0]


def test_surplus_tab_timeout_closes_exact_document_and_verifies_absence(monkeypatch):
    from types import SimpleNamespace

    calls = []

    def cancel():
        raise browser.BrowserSessionError(
            "Instagram browser request cancellation could not be confirmed: Brave browser automation timed out"
        )

    monkeypatch.setattr(
        browser,
        "BrowserInstagramSession",
        lambda **kwargs: SimpleNamespace(cancel_pending_request=cancel),
    )

    def applescript(script, args, timeout):
        calls.append((script, args))
        if script == browser._CLOSE_WORKER_TAB_SCRIPT:
            return "closed"
        raise browser.BrowserSessionError("The pinned Instagram tab was closed")

    monkeypatch.setattr(browser, "_run_applescript", applescript)
    browser.BrowserTabPool._close_settled_tab("42", "99")
    assert calls == [
        (browser._CLOSE_WORKER_TAB_SCRIPT, ("42", "99")),
        (browser._WORKER_WINDOW_SCRIPT, ("42",)),
    ]


def test_surplus_tab_closure_requires_verified_absence(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(
        browser,
        "BrowserInstagramSession",
        lambda **kwargs: SimpleNamespace(cancel_pending_request=lambda: None),
    )
    monkeypatch.setattr(
        browser,
        "_run_applescript",
        lambda script, args, timeout: (
            "closed" if script == browser._CLOSE_WORKER_TAB_SCRIPT else "42"
        ),
    )
    with pytest.raises(browser.BrowserSessionError, match="closure could not be confirmed"):
        browser.BrowserTabPool._close_settled_tab("42", "99")


def test_applescript_transport_serializes_parallel_tabs_without_serializing_jobs(monkeypatch):
    running = 0
    maximum = 0
    guard = threading.Lock()
    entered = threading.Barrier(14)
    calls = []

    def run(arguments, **kwargs):
        nonlocal running, maximum
        with guard:
            running += 1
            maximum = max(maximum, running)
            calls.append(arguments[-1])
        time.sleep(0.005)
        with guard:
            running -= 1
        return subprocess.CompletedProcess(arguments, 0, stdout="started")

    def start(tab_id):
        entered.wait(timeout=3)
        return browser._run_applescript("start one async page request", (str(tab_id),), 3)

    monkeypatch.setattr(browser.subprocess, "run", run)
    with ThreadPoolExecutor(max_workers=14) as executor:
        results = list(executor.map(start, range(14)))
    assert results == ["started"] * 14
    assert len(set(calls)) == 14
    assert maximum == 1


def test_transport_lock_wait_consumes_the_same_call_budget(monkeypatch):
    clock = [0.0]
    seen = []

    def acquire(*, timeout):
        seen.append(("wait", timeout))
        clock[0] += 0.4
        return True

    def run(arguments, **kwargs):
        seen.append(("execute", kwargs["timeout"]))
        return subprocess.CompletedProcess(arguments, 0, stdout="ready")

    monkeypatch.setattr(browser.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(
        browser,
        "_APPLESCRIPT_LOCK",
        SimpleNamespace(acquire=acquire, release=lambda: seen.append(("release", None))),
    )
    monkeypatch.setattr(browser.subprocess, "run", run)
    assert browser._run_applescript("read", (), 1) == "ready"
    assert seen == [("wait", 1), ("execute", 0.6), ("release", None)]


def test_transport_timeout_waiting_for_lock_never_sends_an_event(monkeypatch):
    monkeypatch.setattr(
        browser,
        "_APPLESCRIPT_LOCK",
        SimpleNamespace(
            acquire=lambda **kwargs: False,
            release=lambda: pytest.fail("An unacquired lock cannot be released"),
        ),
    )
    monkeypatch.setattr(browser.subprocess, "run", lambda *a, **kw: pytest.fail("No event"))
    with pytest.raises(browser._BrowserAutomationTransient, match="timed out"):
        browser._run_applescript("never execute", (), 0.1)


def test_pinned_execution_never_resolves_unrelated_tabs_or_rediscovers_a_closed_target(monkeypatch):
    calls = []

    def run(script, arguments, timeout):
        calls.append((script, arguments))
        if script == browser._EXECUTE_TAB_SCRIPT:
            assert "every tab" not in script and "every window" not in script
            assert arguments == ("42", "read target", "99")
        else:
            assert script == browser._WORKER_WINDOW_SCRIPT
            assert arguments == ("42",)
        raise browser.BrowserSessionError("The pinned Instagram tab was closed")

    monkeypatch.setattr(browser, "_run_applescript", run)
    runner = browser._PinnedBraveJavascriptRunner("42", window_id="99")
    runner._viewport_ready = True
    for _ in range(2):
        with pytest.raises(browser.BrowserSessionError, match="tab was closed"):
            runner("read target", 1)
    assert len(calls) == 4


def test_pinned_tab_moved_during_request_cannot_be_treated_as_cancelled(monkeypatch):
    calls = []

    def run(script, arguments, timeout):
        calls.append(script)
        if script == browser._EXECUTE_TAB_SCRIPT:
            raise browser.BrowserSessionError("The pinned Instagram tab was closed")
        assert script == browser._WORKER_WINDOW_SCRIPT
        assert arguments == ("42",)
        return "100"

    monkeypatch.setattr(browser, "_run_applescript", run)
    session = browser.BrowserInstagramSession(
        javascript_runner=browser._PinnedBraveJavascriptRunner("42", window_id="99")
    )
    with pytest.raises(browser.BrowserSessionError, match="cancellation could not be confirmed"):
        session.cancel_pending_request()
    assert calls == [browser._EXECUTE_TAB_SCRIPT, browser._WORKER_WINDOW_SCRIPT]


def test_read_retries_transient_bridge_errors_with_one_decreasing_budget():
    clock = [0.0]
    calls = []

    def run(source, timeout):
        calls.append((source, timeout))
        if len(calls) < 3:
            raise browser._BrowserAutomationTransient("Apple Event -1719")
        return "ready"

    session = browser.BrowserInstagramSession(
        javascript_runner=run,
        monotonic=lambda: clock[0],
        sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds),
        job_timeout_seconds=1,
    )
    assert session.read("read identity") == "ready"
    assert calls == [("read identity", 1), ("read identity", 0.75), ("read identity", 0.5)]


def test_uncertain_click_is_never_repeated_by_session_or_pinned_runner(monkeypatch):
    calls = []

    def run(arguments, **kwargs):
        calls.append(arguments)
        raise subprocess.TimeoutExpired("osascript", kwargs["timeout"])

    monkeypatch.setattr(browser.subprocess, "run", run)
    runner = browser._PinnedBraveJavascriptRunner("42", window_id="99")
    runner._viewport_ready = True
    session = browser.BrowserInstagramSession(javascript_runner=runner)
    with pytest.raises(browser._BrowserAutomationTransient, match="timed out"):
        session.run("engagementButton.click()")
    assert len(calls) == 1
    assert calls[0][-3:] == ["42", "engagementButton.click()", "99"]


def test_read_exhausting_call_budget_does_not_start_another_attempt():
    clock = [0.0]
    calls = []

    def run(source, timeout):
        calls.append(timeout)
        clock[0] += timeout
        raise browser._BrowserAutomationTransient("Brave browser automation timed out")

    session = browser.BrowserInstagramSession(
        javascript_runner=run,
        monotonic=lambda: clock[0],
        sleep=lambda seconds: pytest.fail("No budget remains"),
        job_timeout_seconds=1,
    )
    with pytest.raises(browser._BrowserAutomationTransient):
        session.read("read identity")
    assert calls == [1]


def test_script_programming_errors_are_not_transient_or_retried(monkeypatch):
    calls = []

    def run(arguments, **kwargs):
        calls.append(arguments)
        raise subprocess.CalledProcessError(1, arguments, stderr="sensitive syntax (-2741)")

    monkeypatch.setattr(browser.subprocess, "run", run)
    session = browser.BrowserInstagramSession(
        javascript_runner=browser._PinnedBraveJavascriptRunner("42", window_id="99")
    )
    with pytest.raises(browser.BrowserSessionError, match="Apple Event -2741") as raised:
        session.read("read identity")
    assert not isinstance(raised.value, browser._BrowserAutomationTransient)
    assert len(calls) == 1
    assert "sensitive" not in str(raised.value)


@pytest.mark.parametrize("close_count", [0, 1, 2])
def test_account_chooser_close_is_scoped_and_unambiguous(close_count):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    script = (
        "const clicked = []; const otherClose = {closest: () => ({click: () => clicked.push('post')})};"
        "const chooserClose = {closest: () => ({click: () => clicked.push('chooser')})};"
        "const dialog = {querySelectorAll: () => Array("
        + str(close_count)
        + ").fill(chooserClose)};"
        "const heading = {innerText: 'Switch accounts', closest: () => dialog};"
        "global.document = {querySelector: () => otherClose, querySelectorAll: () => [heading]};"
        "const status = " + browser._close_account_chooser_source() + ";"
        "console.log(JSON.stringify({status, clicked}));"
    )
    result = subprocess.run([node], input=script, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "status": "clicked" if close_count == 1 else "missing",
        "clicked": ["chooser"] if close_count == 1 else [],
    }


def test_primary_page_recovery_uses_native_intended_profile_without_home(monkeypatch):
    sources = []
    navigations = []
    preparations = []

    class NavigationBrowser:
        def __call__(self, source, timeout):
            sources.append(source)
            return "settled" if "request.controller.abort()" in source else "cleared"

        def navigate(self, url, timeout, *, reload=False):
            navigations.append((url, reload))
            return "navigating"

    session = browser.BrowserInstagramSession(javascript_runner=NavigationBrowser())

    def prepare(recipient, username):
        preparations.append((recipient, username))
        if len(preparations) == 1:
            raise browser._BrowserPageUnavailable("Temporary missing controls")

    monkeypatch.setattr(session, "_prepare_account", prepare)
    assert session.activate_account("41553815702", "usask.wat2do.io") == "usask.wat2do.io"
    assert navigations == [("https://www.instagram.com/usask.wat2do.io/", True)]
    assert len(preparations) == 2
    assert not any("location" in source for source in sources)


def test_polling_caps_reads_to_interaction_deadline_and_restores_job_budget(monkeypatch):
    clock = [0.0]
    timeouts = []
    monkeypatch.setattr(
        browser, "_CONTROL", browser._CONTROL.model_copy(update={"interaction_timeout_seconds": 1})
    )

    def run(source, timeout):
        timeouts.append(timeout)
        clock[0] += timeout
        return "pending"

    session = browser.BrowserInstagramSession(
        javascript_runner=run,
        monotonic=lambda: clock[0],
        sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds),
        job_timeout_seconds=10,
    )
    with pytest.raises(browser._BrowserPageUnavailable):
        session.poll_until(lambda: session.read("read request state") == "ready")
    assert timeouts == [1]
    assert session._remaining_timeout() == 9


def test_fifteen_tab_pool_reserves_primary_and_assigns_all_fourteen_secondary_tabs(monkeypatch):
    ids = [str(tab) for tab in range(1, 16)]
    settings = {"browser_window_id": "99", "browser_tab_ids": ids}
    calls = []
    queue = SimpleNamespace(
        get_setting=lambda key, default=None: settings.get(key, default),
        set_setting=lambda key, value: settings.update({key: value}),
    )
    monkeypatch.setattr(browser.BrowserTabPool, "ensure_capacity", lambda _, **kwargs: ids)

    def session(**kwargs):
        runner = kwargs["javascript_runner"]
        assert runner._window_id == "99"
        assert kwargs["allow_account_switch"] is (runner._tab_id == "1")
        return SimpleNamespace(
            tab_id=runner._tab_id,
            cancel_pending_request=lambda: calls.append(("cancel", runner._tab_id)),
            activate_account=lambda *args: calls.append(("switch", runner._tab_id)) or "wat2do.ubc",
            navigate=lambda url, **kwargs: calls.append(("reload", runner._tab_id, url)),
            reset_job_deadline=lambda timeout: None,
        )

    monkeypatch.setattr(browser, "BrowserInstagramSession", session)
    sessions, username = browser.BrowserTabPool(queue).prepare(
        SimpleNamespace(kind="digest", recipient_id="123", account_username="wat2do.ubc"), 15
    )
    assert username == "wat2do.ubc"
    assert [session.tab_id for session in sessions] == ids[1:]
    assert calls[:15] == [("cancel", tab_id) for tab_id in ids]
    assert calls[15] == ("switch", "1")
    assert [call[1] for call in calls[16:]] == ids[1:]
    assert all(call[2] == "https://www.instagram.com/wat2do.ubc/" for call in calls[16:])


@pytest.mark.parametrize("bootstrap_username", ["wat2do.ubc", "student.personal"])
def test_closed_primary_is_repaired_first_without_promoting_a_retrieval_tab(
    monkeypatch, bootstrap_username
):
    settings = {"browser_tab_ids": ["1", "2", "3"], "browser_window_id": "99"}
    live = {"2", "3"}
    created = []
    monkeypatch.setattr(
        browser, "_CONTROL", browser._CONTROL.model_copy(update={"parallel_tabs": 3})
    )

    def applescript(script, arguments, timeout):
        if script == browser._ACTIVATE_TAB_SCRIPT:
            return "2"
        if script == browser._EXECUTE_TAB_SCRIPT:
            assert arguments[1] == browser._VIEWPORT_SOURCE
            return '{"width":1200,"height":900}'
        if script == browser._RESTORE_ACTIVE_TAB_SCRIPT:
            return "restored"
        if script == browser._WORKER_TAB_INVENTORY_SCRIPT:
            return "2\n3"
        if script == browser._WORKER_WINDOW_SCRIPT:
            raise browser.BrowserSessionError("The pinned Instagram tab was closed")
        if script == browser._INSTAGRAM_TAB_INVENTORY_SCRIPT:
            assert arguments == ("99",)
            return "\n".join(sorted(live))
        if script == browser._CREATE_WORKER_TAB_SCRIPT:
            created.append(arguments)
            live.add("4")
            return "4"
        pytest.fail("No existing secondary document should be closed")

    monkeypatch.setattr(browser, "_run_applescript", applescript)
    monkeypatch.setattr(
        browser,
        "BrowserInstagramSession",
        lambda **kwargs: SimpleNamespace(
            current_page_path=lambda: f"/{bootstrap_username}/",
            current_account_username=lambda: bootstrap_username,
            poll_until=lambda predicate: predicate(),
        ),
    )
    queue = SimpleNamespace(
        get_setting=lambda key, default=None: settings.get(key, default),
        set_setting=lambda key, value: settings.update({key: value}),
        peek_account_username=lambda: bootstrap_username,
    )
    assert browser.BrowserTabPool(queue).ensure_capacity() == ["4", "2", "3"]
    assert created == [("99", "first", f"https://www.instagram.com/{bootstrap_username}/")]
    assert settings["retrieval_pool_account"] is None


def test_owned_tab_moved_to_another_window_is_never_replaced_or_adopted(monkeypatch):
    settings = {"browser_tab_ids": ["1", "2"], "browser_window_id": "99"}

    def applescript(script, arguments, timeout):
        if script == browser._WORKER_TAB_INVENTORY_SCRIPT:
            assert arguments == ("99", "1", "2")
            return "2"
        if script == browser._WORKER_WINDOW_SCRIPT:
            assert arguments == ("1",)
            return "100"
        pytest.fail("No mutation after an owned tab leaves its registered window")

    monkeypatch.setattr(browser, "_run_applescript", applescript)
    queue = SimpleNamespace(get_setting=lambda key, default=None: settings.get(key, default))
    with pytest.raises(browser.BrowserSessionError, match="moved outside"):
        browser.BrowserTabPool(queue).ensure_capacity()


@pytest.mark.parametrize("created_ids", [["4"], ["4", "5"]])
def test_uncertain_creation_is_reconciled_without_replaying_make(monkeypatch, created_ids):
    live = {"2", "3"}
    creates = []

    def applescript(script, arguments, timeout):
        if script == browser._INSTAGRAM_TAB_INVENTORY_SCRIPT:
            return "\n".join(sorted(live))
        assert script == browser._CREATE_WORKER_TAB_SCRIPT
        creates.append(arguments)
        live.update(created_ids)
        raise browser._BrowserAutomationTransient("Brave browser automation timed out")

    monkeypatch.setattr(browser, "_run_applescript", applescript)
    if len(created_ids) == 1:
        assert (
            browser.BrowserTabPool._create_tab(
                "99", "first", "https://www.instagram.com/wat2do.ubc/"
            )
            == "4"
        )
    else:
        with pytest.raises(browser._BrowserAutomationTransient):
            browser.BrowserTabPool._create_tab(
                "99", "first", "https://www.instagram.com/wat2do.ubc/"
            )
    assert creates == [("99", "first", "https://www.instagram.com/wat2do.ubc/")]


def test_all_fifteen_cold_tabs_warm_by_exact_id_and_restore_prior_active_tab(monkeypatch):
    visual_ids = [str(tab) for tab in range(15, 0, -1)]
    active = ["15"]
    warmed = set()
    selected_indexes = []

    def run(script, arguments, timeout):
        if script == browser._ACTIVATE_TAB_SCRIPT:
            tab_id, window_id, minimum_width = arguments
            assert window_id == "99"
            assert minimum_width == "0"
            previous = active[0]
            selected_indexes.append(visual_ids.index(tab_id) + 1)
            active[0] = tab_id
            warmed.add(tab_id)
            return previous
        if script == browser._EXECUTE_TAB_SCRIPT:
            tab_id, source, window_id = arguments
            assert source == browser._VIEWPORT_SOURCE
            assert tab_id == active[0] and tab_id in warmed
            return '{"width":1592,"height":1300}'
        assert script == browser._RESTORE_ACTIVE_TAB_SCRIPT
        tab_id, previous_id, window_id = arguments
        assert active[0] == tab_id
        active[0] = previous_id
        return "restored"

    monkeypatch.setattr(browser, "_run_applescript", run)
    for tab_id in [str(tab) for tab in range(1, 16)]:
        runner = browser._PinnedBraveJavascriptRunner(tab_id, window_id="99")
        runner.warm_viewport(1)
        assert runner._viewport_ready
        assert active[0] == "15"
    assert selected_indexes == list(range(15, 0, -1))
    assert warmed == set(visual_ids)


def test_zero_viewport_is_warmed_before_any_job_source_runs(monkeypatch):
    active = ["1"]
    ready = [False]
    calls = []

    def run(script, arguments, timeout):
        if script == browser._ACTIVATE_TAB_SCRIPT:
            assert arguments == ("42", "99", "0")
            active[0] = "42"
            ready[0] = True
            calls.append("activate")
            return "1"
        if script == browser._RESTORE_ACTIVE_TAB_SCRIPT:
            assert arguments == ("42", "1", "99")
            active[0] = "1"
            calls.append("restore")
            return "restored"
        assert script == browser._EXECUTE_TAB_SCRIPT
        if arguments[1] == browser._VIEWPORT_SOURCE:
            calls.append("viewport")
            return '{"width":1200,"height":900}' if ready[0] else '{"width":0,"height":0}'
        assert ready[0]
        calls.append("job")
        return "settled"

    monkeypatch.setattr(browser, "_run_applescript", run)
    runner = browser._PinnedBraveJavascriptRunner("42", window_id="99")
    assert runner("start readonly request", 1) == "settled"
    assert runner("poll readonly request", 1) == "settled"
    assert calls == ["viewport", "activate", "viewport", "restore", "job", "job"]
    assert active[0] == "1"


@pytest.mark.parametrize("cached", [False, True])
@pytest.mark.parametrize(("primary", "initial_width"), [(True, 717), (True, 1526), (False, 717)])
def test_primary_warm_widens_only_registered_narrow_window_and_restores_selection(
    monkeypatch, cached, primary, initial_width
):
    widths = {"99": initial_width, "88": 640}
    active = ["2"]
    resized = []

    def run(script, arguments, timeout):
        if script == browser._ACTIVATE_TAB_SCRIPT:
            tab_id, window_id, requested_width = arguments
            assert (tab_id, window_id) == ("42", "99")
            minimum = int(requested_width)
            assert minimum == (browser._CONTROL.primary_minimum_viewport_width if primary else 0)
            if widths[window_id] < minimum:
                widths[window_id] = minimum
                resized.append(window_id)
            active[0] = tab_id
            return "2"
        if script == browser._RESTORE_ACTIVE_TAB_SCRIPT:
            assert arguments == ("42", "2", "99")
            active[0] = "2"
            return "restored"
        assert script == browser._EXECUTE_TAB_SCRIPT
        assert arguments == ("42", browser._VIEWPORT_SOURCE, "99")
        return json.dumps({"width": widths["99"], "height": 1300})

    monkeypatch.setattr(browser, "_run_applescript", run)
    runner = browser._PinnedBraveJavascriptRunner("42", window_id="99")
    runner._viewport_ready = cached
    runner.warm_viewport(1, primary=primary)
    assert widths == {
        "99": max(initial_width, browser._CONTROL.primary_minimum_viewport_width)
        if primary
        else initial_width,
        "88": 640,
    }
    assert resized == (["99"] if primary and initial_width < 1024 else [])
    assert active[0] == "2" and runner._viewport_ready


def test_primary_warm_reports_desktop_readiness_when_browser_viewport_stays_narrow(monkeypatch):
    now = [0.0]
    restored = []

    def run(script, arguments, timeout):
        if script == browser._ACTIVATE_TAB_SCRIPT:
            return "2"
        if script == browser._RESTORE_ACTIVE_TAB_SCRIPT:
            restored.append(arguments)
            return "restored"
        assert script == browser._EXECUTE_TAB_SCRIPT
        return '{"width":717,"height":1300}'

    monkeypatch.setattr(browser, "_run_applescript", run)
    monkeypatch.setattr(browser.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(browser.time, "sleep", lambda seconds: now.__setitem__(0, now[0] + seconds))
    runner = browser._PinnedBraveJavascriptRunner("42", window_id="99")
    with pytest.raises(browser._BrowserPageUnavailable, match="primary desktop viewport"):
        runner.warm_viewport(0.2, primary=True)
    assert restored == [("42", "2", "99")]
    assert not runner._viewport_ready


@pytest.mark.parametrize("allow_account_switch", [True, False])
def test_primary_preparation_refreshes_cached_viewport_before_control_reads_and_restores_selection(
    monkeypatch, allow_account_switch
):
    calls = []
    active = "2"
    viewport_width = 717

    def run(script, arguments, timeout):
        nonlocal active, viewport_width
        if script == browser._ACTIVATE_TAB_SCRIPT:
            assert arguments == ("42", "99", "1024")
            calls.append("activate")
            active = "42"
            viewport_width = 1526
            return "2"
        if script == browser._RESTORE_ACTIVE_TAB_SCRIPT:
            assert arguments == ("42", "2", "99")
            assert active == "42"
            calls.append("restore")
            active = "2"
            return "restored"
        assert script == browser._EXECUTE_TAB_SCRIPT
        source = arguments[1]
        if source == browser._VIEWPORT_SOURCE:
            calls.append("viewport")
            return json.dumps({"width": viewport_width, "height": 1300})
        if "request.controller.abort()" in source:
            calls.append("cancel")
            return "settled"
        if source.startswith("delete window"):
            calls.append("clear")
            return "cleared"
        assert source == browser._switch_button_state_source()
        calls.append("controls")
        return "ready" if viewport_width == 1526 else "pending"

    monkeypatch.setattr(browser, "_run_applescript", run)
    runner = browser._PinnedBraveJavascriptRunner("42", window_id="99")
    runner._viewport_ready = True
    session = browser.BrowserInstagramSession(
        javascript_runner=runner, allow_account_switch=allow_account_switch
    )

    def prepare(recipient, username):
        assert recipient == "41553815702" and username == "wat2do.uwaterloo"
        assert active == "2"
        assert session.read(browser._switch_button_state_source()) == (
            "ready" if allow_account_switch else "pending"
        )

    monkeypatch.setattr(session, "_prepare_account", prepare)
    assert session.activate_account("41553815702", "wat2do.uwaterloo") == "wat2do.uwaterloo"
    assert calls == (
        ["cancel", "clear", "activate", "viewport", "restore", "controls"]
        if allow_account_switch
        else ["cancel", "clear", "controls"]
    )


@pytest.mark.parametrize("cold_state", ["zero", "loading", "timeout"])
def test_fourteen_navigation_reads_progress_while_cold_viewport_waits(monkeypatch, cold_state):
    cold_waiting = threading.Event()
    healthy_done = threading.Event()
    healthy_count = 0
    activations = 0
    restores = []

    def subprocess_run(arguments, **kwargs):
        nonlocal healthy_count, activations
        script = arguments[2]
        supplied = arguments[4:]
        if script == browser._NAVIGATE_TAB_SCRIPT:
            output = "navigating"
        elif script == browser._ACTIVATE_TAB_SCRIPT:
            assert supplied == ["14", "99", "0"]
            activations += 1
            output = "1"
        elif script == browser._RESTORE_ACTIVE_TAB_SCRIPT:
            restores.append(supplied)
            output = "restored"
        else:
            assert script == browser._EXECUTE_TAB_SCRIPT
            tab_id, source, window_id = supplied
            if source == browser._VIEWPORT_SOURCE:
                if tab_id == "14" and activations == 0 and cold_state == "timeout":
                    raise subprocess.TimeoutExpired("osascript", kwargs["timeout"])
                if tab_id == "14" and activations == 1 and cold_state == "loading":
                    raise subprocess.CalledProcessError(
                        1, "osascript", stderr="Pinned Instagram tab is loading."
                    )
                output = (
                    '{"width":0,"height":0}'
                    if tab_id == "14" and activations < 2
                    else '{"width":1592,"height":1300}'
                )
            else:
                if tab_id != "14":
                    healthy_count += 1
                    if healthy_count == 13:
                        healthy_done.set()
                output = "ready"
        return subprocess.CompletedProcess(arguments, 0, stdout=output)

    def sleep(seconds):
        # The cold tab must restore selection and release the one transport
        # before waiting. Otherwise the other thirteen jobs cannot progress.
        cold_waiting.set()
        assert healthy_done.wait(timeout=2), "Viewport waits starved healthy tab operations"

    def retrieve(tab_id):
        runner = browser._PinnedBraveJavascriptRunner(str(tab_id), window_id="99")
        runner.navigate(f"https://www.instagram.com/p/POST{tab_id}/", 3)
        return runner("read exact target", 3)

    monkeypatch.setattr(browser.subprocess, "run", subprocess_run)
    monkeypatch.setattr(browser.time, "sleep", sleep)
    with ThreadPoolExecutor(max_workers=14) as executor:
        cold = executor.submit(retrieve, 14)
        assert cold_waiting.wait(timeout=2)
        healthy = list(executor.map(retrieve, range(1, 14)))
        assert healthy == ["ready"] * 13
        assert cold.result(timeout=2) == "ready"
    assert activations == 2
    assert restores == [["14", "1", "99"], ["14", "1", "99"]]


def test_viewport_probe_skips_native_loading_wait_but_business_source_keeps_it():
    assert (
        f"if javascriptSource is not {json.dumps(browser._VIEWPORT_SOURCE)} and loading of browserTab"
        in browser._EXECUTE_TAB_SCRIPT
    )


def test_unresponsive_initial_viewport_probe_has_short_budget_and_native_recovery(monkeypatch):
    calls = []

    def run(script, arguments, timeout):
        calls.append((script, timeout))
        if len(calls) == 1:
            assert script == browser._EXECUTE_TAB_SCRIPT
            assert 0 < timeout <= browser._CONTROL.viewport_warm_timeout_seconds
            raise browser._BrowserAutomationTransient("Brave browser automation timed out")
        if script == browser._ACTIVATE_TAB_SCRIPT:
            return "1"
        if script == browser._RESTORE_ACTIVE_TAB_SCRIPT:
            return "restored"
        assert script == browser._EXECUTE_TAB_SCRIPT
        return (
            '{"width":1592,"height":1300}' if arguments[1] == browser._VIEWPORT_SOURCE else "ready"
        )

    monkeypatch.setattr(browser, "_run_applescript", run)
    runner = browser._PinnedBraveJavascriptRunner("42", window_id="99")
    assert runner("read exact target", 30) == "ready"
    assert [script for script, _ in calls] == [
        browser._EXECUTE_TAB_SCRIPT,
        browser._ACTIVATE_TAB_SCRIPT,
        browser._EXECUTE_TAB_SCRIPT,
        browser._RESTORE_ACTIVE_TAB_SCRIPT,
        browser._EXECUTE_TAB_SCRIPT,
    ]


def test_primary_tab_cannot_be_retired_even_when_unresponsive(monkeypatch):
    monkeypatch.setattr(browser, "_run_applescript", lambda *a: pytest.fail("Never close primary"))
    session = browser.BrowserInstagramSession(
        javascript_runner=browser._PinnedBraveJavascriptRunner("1", window_id="99")
    )
    with pytest.raises(browser.BrowserSessionError, match="Only a pinned secondary"):
        session.retire_unresponsive_read_tab()


def test_secondary_retirement_closes_exact_document_and_proves_global_absence(monkeypatch):
    calls = []

    def run(script, arguments, timeout):
        calls.append((script, arguments))
        if script == browser._CLOSE_WORKER_TAB_SCRIPT:
            return "closed"
        assert script == browser._WORKER_WINDOW_SCRIPT
        raise browser._BrowserTabUnavailable("The pinned Instagram tab was closed")

    monkeypatch.setattr(browser, "_run_applescript", run)
    session = browser.BrowserInstagramSession(
        javascript_runner=browser._PinnedBraveJavascriptRunner("42", window_id="99"),
        allow_account_switch=False,
    )
    session.retire_unresponsive_read_tab()
    assert calls == [
        (browser._CLOSE_WORKER_TAB_SCRIPT, ("42", "99")),
        (browser._WORKER_WINDOW_SCRIPT, ("42",)),
    ]


@pytest.mark.parametrize("failing_index", [0, 1])
def test_pool_settlement_drains_every_tab_and_only_retires_secondaries(monkeypatch, failing_index):
    calls = []
    settings = {"browser_tab_ids": ["1", "2", "3"], "browser_window_id": "99"}
    error = browser.BrowserSessionError(
        "Instagram browser request cancellation could not be confirmed"
    )

    def session(**kwargs):
        tab_id = kwargs["javascript_runner"]._tab_id
        assert kwargs["allow_account_switch"] is (tab_id == "1")

        def cancel():
            calls.append(("cancel", tab_id))
            if tab_id == str(failing_index + 1):
                raise error

        return SimpleNamespace(
            cancel_pending_request=cancel,
            retire_unresponsive_read_tab=lambda: calls.append(("retire", tab_id)),
        )

    monkeypatch.setattr(browser, "BrowserInstagramSession", session)
    queue = SimpleNamespace(get_setting=lambda key, default=None: settings.get(key, default))
    expected = browser._BrowserTabUnavailable if failing_index else browser.BrowserSessionError
    with pytest.raises(expected):
        browser.BrowserTabPool(queue).settle_registered_tabs()
    assert [call for call in calls if call[0] == "cancel"] == [
        ("cancel", "1"),
        ("cancel", "2"),
        ("cancel", "3"),
    ]
    assert [call for call in calls if call[0] == "retire"] == (
        [("retire", "2")] if failing_index else []
    )


def test_native_navigation_preserves_actionable_recovery_failure(monkeypatch):
    def run(arguments, **kwargs):
        raise subprocess.CalledProcessError(
            1, arguments, stderr="Instagram requires human account recovery. private page text"
        )

    monkeypatch.setattr(browser.subprocess, "run", run)
    session = browser.BrowserInstagramSession(
        javascript_runner=browser._PinnedBraveJavascriptRunner("42", window_id="99")
    )
    with pytest.raises(browser.BrowserSessionError, match="human account recovery") as raised:
        session.navigate("https://www.instagram.com/wat2do.ubc/")
    assert "private" not in str(raised.value)
