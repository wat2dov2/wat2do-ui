import json
import shutil
import subprocess

import pytest

from services.instagram_notifications import browser_digest


@pytest.mark.parametrize(
    "source",
    (
        browser_digest._open_more_source(),
        browser_digest._switch_button_state_source(),
        browser_digest._click_switch_accounts_source(),
        browser_digest._account_chooser_state_source(),
        browser_digest._click_account_source("usask.wat2do.io"),
        browser_digest._current_account_username_source(),
        browser_digest._recipient_is_active_source("41553815702"),
        browser_digest._close_account_chooser_source(),
        browser_digest._digest_query_source("18083776211391703"),
    ),
)
def test_generated_browser_sources_are_valid_javascript(source: str) -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is unavailable for JavaScript syntax validation")

    completed = subprocess.run(
        [node, "--check"],
        input=source,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr


def test_switcher_sources_render_unambiguous_css_selector_quotes() -> None:
    rendered = "\n".join(
        (
            browser_digest._open_more_source(),
            browser_digest._switch_button_state_source(),
            browser_digest._account_chooser_state_source(),
            browser_digest._click_account_source("usask.wat2do.io"),
            browser_digest._close_account_chooser_source(),
        )
    )

    assert "querySelector('[aria-label=\"Settings\"]')" in rendered
    assert "querySelectorAll('button,[role=\"button\"]')" in rendered
    assert "querySelectorAll('h1,[role=\"heading\"]')" in rendered
    assert "closest('[role=\"dialog\"]')" in rendered
    assert 'scrollIntoView({behavior: "instant", block: "center"})' in rendered


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


@pytest.mark.parametrize(
    "username",
    ("usask.wat2do.io", "wat2do.ca", "utm.wat2do.ca"),
)
def test_resolver_accepts_configured_account_username_formats(username: str) -> None:
    resolver = browser_digest.BrowserInstagramDigestResolver(
        javascript_runner=lambda *_args: (_ for _ in ()).throw(
            browser_digest.BrowserDigestError("browser reached")
        )
    )

    with pytest.raises(browser_digest.BrowserDigestError, match="browser reached"):
        resolver.resolve("41553815702", username, "18083776211391703")


def test_resolver_switches_once_to_requested_account_and_returns_only_media_ids() -> None:
    sources: list[str] = []
    current_username = "ulaval.wat2do.io"
    recipient_active = False
    menu_open = False
    chooser_open = False

    def run_javascript(source: str, _timeout: float) -> str:
        nonlocal chooser_open, current_username, menu_open, recipient_active
        sources.append(source)
        if source.startswith("delete window"):
            return "cleared"
        if "JSON.stringify(window" in source and "DigestQuery" in source:
            return json.dumps(
                {
                    "state": "succeeded",
                    "media_ids": ["3972507549568243928", "3972418544474819476"],
                    "page_count": 1,
                }
            )
        if "const anchor = [...document.querySelectorAll" in source:
            return current_username
        if "activeRecipient" in source:
            return "true" if recipient_active else "false"
        if "const settings =" in source:
            menu_open = True
            return "clicked"
        if 'const username = "usask.wat2do.io"' in source:
            current_username = "usask.wat2do.io"
            recipient_active = True
            chooser_open = False
            return "clicked"
        if "const button" in source and "Switch accounts" in source:
            chooser_open = True
            menu_open = False
            return "clicked"
        if 'h1,[role="heading"]' in source and "some(element" in source:
            return "ready" if chooser_open else "pending"
        if "some(element" in source and "Switch accounts" in source:
            return "ready" if menu_open else "pending"
        if "fetch(" in source:
            return "started"
        raise AssertionError(f"Unexpected JavaScript source: {source}")

    resolution = browser_digest.BrowserInstagramDigestResolver(
        javascript_runner=run_javascript,
        sleep=lambda _seconds: None,
    ).resolve(
        "41553815702",
        "usask.wat2do.io",
        "18083776211391703",
    )

    assert resolution == browser_digest.DigestResolution(
        account_username="usask.wat2do.io",
        media_ids=("3972507549568243928", "3972418544474819476"),
        page_count=1,
    )
    rendered_sources = "\n".join(sources)
    assert "sessionid" not in rendered_sources.lower()
    assert "18083776211391703" in rendered_sources
    assert "41553815702" in rendered_sources
    assert rendered_sources.count('const username = "usask.wat2do.io"') == 1
    assert "ulaval.wat2do.io" not in rendered_sources


def test_resolver_rejects_unmapped_account_without_switching() -> None:
    sources: list[str] = []

    def run_javascript(source: str, _timeout: float) -> str:
        sources.append(source)
        if "const anchor = [...document.querySelectorAll" in source:
            return "ulaval.wat2do.io"
        if "const settings =" in source:
            return "clicked"
        if "some(element" in source and "Switch accounts" in source:
            return "ready"
        if 'h1,[role="heading"]' in source and "some(element" in source:
            return "ready"
        if 'const username = "usask.wat2do.io"' in source:
            return "missing"
        raise AssertionError(f"Unexpected JavaScript source: {source}")

    resolver = browser_digest.BrowserInstagramDigestResolver(
        javascript_runner=run_javascript,
        sleep=lambda _seconds: None,
    )

    with pytest.raises(
        browser_digest.BrowserDigestError,
        match="Matching Instagram browser account is unavailable",
    ):
        resolver.resolve(
            "41553815702",
            "usask.wat2do.io",
            "18083776211391703",
        )

    rendered_sources = "\n".join(sources)
    assert rendered_sources.count('const username = "usask.wat2do.io"') == 1
    assert "fetch(" not in rendered_sources


def test_apple_events_permission_error_has_actionable_sanitized_message(monkeypatch) -> None:
    error = subprocess.CalledProcessError(
        1,
        ["osascript"],
        stderr="Executing JavaScript through AppleScript is turned off. secret-cookie",
    )
    monkeypatch.setattr(
        browser_digest.subprocess, "run", lambda *_args, **_kwargs: (_ for _ in ()).throw(error)
    )

    with pytest.raises(browser_digest.BrowserDigestError) as raised:
        browser_digest._execute_brave_javascript("document.title", 1)

    assert str(raised.value) == (
        "Enable Brave View > Developer > Allow JavaScript from Apple Events"
    )
    assert "secret-cookie" not in str(raised.value)


@pytest.mark.parametrize("slow", [True, False])
def test_resolver_recovers_page_before_querying(slow: bool) -> None:
    now = 0.0
    navigations = 0
    reads = 0
    queries = 0

    def sleep(seconds: float) -> None:
        nonlocal now
        now += seconds

    def run(source: str, _timeout: float) -> str:
        nonlocal navigations, reads, queries
        if "location.replace" in source:
            navigations += 1
            return "navigating"
        if "const anchor =" in source:
            reads += 1
            return "usask.wat2do.io" if navigations or (slow and reads >= 3) else ""
        if "activeRecipient" in source:
            return "true"
        if "some(element" in source:
            return "pending"
        if "fetch(" in source:
            queries += 1
            return "started"
        if "JSON.stringify(window" in source:
            return json.dumps({"state": "succeeded", "media_ids": ["123"], "page_count": 1})
        if source.startswith("delete window"):
            return "cleared"
        if "const settings =" in source:
            return "missing"
        raise AssertionError(source)

    result = browser_digest.BrowserInstagramDigestResolver(
        javascript_runner=run, sleep=sleep, monotonic=lambda: now
    ).resolve("41553815702", "usask.wat2do.io", "cache-1")
    assert result.media_ids == ("123",)
    assert navigations == (0 if slow else 1)
    assert queries == 1


def test_resolver_stops_after_one_failed_page_recovery() -> None:
    now = 0.0
    sources: list[str] = []

    def sleep(seconds: float) -> None:
        nonlocal now
        now += seconds

    def run(source: str, _timeout: float) -> str:
        sources.append(source)
        return "missing" if "const settings =" in source else ""

    with pytest.raises(browser_digest.BrowserDigestError):
        browser_digest.BrowserInstagramDigestResolver(
            javascript_runner=run, sleep=sleep, monotonic=lambda: now
        ).resolve("41553815702", "usask.wat2do.io", "cache-1")
    assert sum("location.replace" in source for source in sources) == 1
    assert not any("fetch(" in source for source in sources)


def test_recipient_mismatch_never_queries_or_retries_navigation() -> None:
    sources: list[str] = []

    def run(source: str, _timeout: float) -> str:
        sources.append(source)
        return "usask.wat2do.io" if "const anchor =" in source else "false"

    with pytest.raises(browser_digest.BrowserDigestError, match="does not match"):
        browser_digest.BrowserInstagramDigestResolver(javascript_runner=run).resolve(
            "41553815702", "usask.wat2do.io", "cache-1"
        )
    assert not any("fetch(" in source or "location.replace" in source for source in sources)


def test_closed_tab_waits_for_new_tab_before_reading_identity(monkeypatch) -> None:
    responses = iter(
        [
            "",
            "",
            "usask.wat2do.io",
            "usask.wat2do.io",
            "true",
            "pending",
            "started",
            '{"state":"succeeded","media_ids":["123"],"page_count":1}',
            "cleared",
        ]
    )
    calls: list[list[str]] = []

    def run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout=next(responses))

    monkeypatch.setattr(browser_digest.subprocess, "run", run)
    result = browser_digest.BrowserInstagramDigestResolver(sleep=lambda _: None).resolve(
        "41553815702", "usask.wat2do.io", "cache-1"
    )
    assert result.media_ids == ("123",)
    assert all(args[2] == browser_digest._APPLE_SCRIPT for args in calls)
    assert not any("location.replace" in args[-1] for args in calls)


def test_stopped_browser_error_is_actionable(monkeypatch) -> None:
    def run(*args, **kwargs):
        raise subprocess.CalledProcessError(1, "osascript", stderr="Brave is not running.")

    monkeypatch.setattr(browser_digest.subprocess, "run", run)
    with pytest.raises(browser_digest.BrowserDigestError, match="Open Brave"):
        browser_digest._execute_brave_javascript("document.title", 1)


def test_missing_switch_controls_recovers_then_rechecks_recipient(monkeypatch) -> None:
    sources: list[str] = []
    recovered = False

    def run(source: str, _timeout: float) -> str:
        nonlocal recovered
        sources.append(source)
        if "location.replace" in source:
            recovered = True
            return "navigating"
        if "const anchor =" in source:
            return "usask.wat2do.io" if recovered else "ulaval.wat2do.io"
        if "activeRecipient" in source:
            return "false"
        if "const settings =" in source:
            return "missing"
        return "pending"

    with pytest.raises(browser_digest.BrowserDigestError, match="does not match"):
        browser_digest.BrowserInstagramDigestResolver(javascript_runner=run).resolve(
            "41553815702", "usask.wat2do.io", "cache-1"
        )
    assert recovered
    assert not any("fetch(" in source for source in sources)
