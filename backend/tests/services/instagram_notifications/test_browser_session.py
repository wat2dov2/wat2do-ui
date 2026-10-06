import json
import shutil
import subprocess

import pytest

from services.instagram_notifications import browser_session as browser


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
        return subprocess.CompletedProcess(args, 0, stdout="42" if len(calls) == 1 else "ok")

    monkeypatch.setattr(browser.subprocess, "run", run)
    runner = browser._PinnedBraveJavascriptRunner()
    assert runner("first operation", 1) == "ok"
    assert runner("second operation", 1) == "ok"
    assert calls[0][2] == browser._SELECT_TAB_SCRIPT
    assert calls[1][-2:] == ["42", "first operation"]
    assert calls[2][-2:] == ["42", "second operation"]
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
        nonlocal navigated, reads_after_navigation
        if "location.assign" in source:
            navigated = True
            return "navigating"
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

    session = browser.BrowserInstagramSession(javascript_runner=run, sleep=lambda _: None)
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


@pytest.mark.parametrize("pathname", ["/p/TARGET/", "/p/OTHER/"])
def test_post_navigation_reuses_target_and_returns_before_new_navigation(pathname):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable")
    source = browser._open_post_source("https://www.instagram.com/p/TARGET/")
    script = (
        "const navigation = []; const deferred = [];"
        "global.setTimeout = callback => deferred.push(callback);"
        "global.window = {location: {origin: 'https://www.instagram.com', pathname: "
        + json.dumps(pathname)
        + ", assign: href => navigation.push(href)}};"
        "const status = " + source + ";"
        "console.log(JSON.stringify({status, navigation, pending: deferred.length}));"
    )
    completed = subprocess.run([node], input=script, text=True, capture_output=True)
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {
        "status": "already_open" if pathname == "/p/TARGET/" else "navigating",
        "navigation": [],
        "pending": 0 if pathname == "/p/TARGET/" else 1,
    }


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
    monkeypatch.setattr(session, "poll_until", lambda predicate: None)
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
            cancel_pending_request=lambda: calls.append(("cancel", tab)),
            activate_account=lambda *args: calls.append(("switch", tab)) or "wat2do.ubc",
            run=lambda source: (
                "/" if source == "window.location.pathname" else calls.append(("reload", tab))
            ),
        )

    monkeypatch.setattr(browser, "BrowserInstagramSession", session)
    monkeypatch.setattr(browser.BrowserTabPool, "ensure_capacity", lambda _: ["1", "2"])
    sessions, username = browser.BrowserTabPool(queue).prepare(
        SimpleNamespace(kind="digest", recipient_id="123", account_username="wat2do.ubc"), 2
    )
    assert calls == [("cancel", "1"), ("cancel", "2"), ("switch", "1"), ("reload", "2")]
    assert len(sessions) == 2 and username == "wat2do.ubc"


def test_pool_does_not_adopt_human_tabs_when_all_owned_tabs_are_closed(monkeypatch):
    from types import SimpleNamespace

    q = SimpleNamespace(
        get_setting=lambda key, default=None: ["1", "2"] if key == "browser_tab_ids" else default
    )
    monkeypatch.setattr(
        browser,
        "_run_applescript",
        lambda script, *args: (
            ""
            if script == browser._WORKER_TAB_INVENTORY_SCRIPT
            else pytest.fail("No human tab adoption")
        ),
    )
    with pytest.raises(browser.BrowserSessionError, match="No registered worker window"):
        browser.BrowserTabPool(q).ensure_capacity()


def test_pool_adopts_all_instagram_tabs_and_repairs_to_minimum(monkeypatch):
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
        if script == browser._INSTAGRAM_TAB_INVENTORY_SCRIPT:
            return "\n".join(sorted(live))
        if script == browser._WORKER_WINDOW_SCRIPT:
            return "99"
        if script == browser._WORKER_TAB_INVENTORY_SCRIPT:
            return "\n".join(tab_id for tab_id in args if tab_id in live)
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
    )
    monkeypatch.setattr(browser, "_run_applescript", applescript)
    monkeypatch.setattr(
        browser,
        "BrowserInstagramSession",
        lambda **kw: SimpleNamespace(
            run=lambda _: "/",
            current_account_username=lambda: "wat2do.ubc",
            cancel_pending_request=lambda: None,
            poll_until=lambda ready: ready(),
        ),
    )
    pool = browser.BrowserTabPool(q)
    first = pool.ensure_capacity()
    assert len(first) == len(set(first)) == 14
    assert len(created) == 0
    assert pool.ensure_capacity() == first
    assert len(created) == 0
    live.remove("105")
    repaired = pool.ensure_capacity()
    assert len(repaired) == len(set(repaired)) == 13
    assert "105" not in repaired
    assert repaired == settings["browser_tab_ids"]
    assert len(created) == 0
    live.clear()
    restored = pool.ensure_capacity()
    assert len(restored) == len(set(restored)) == 10
    assert len(created) == 10
    assert settings["browser_window_id"] == "99"
