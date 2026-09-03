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
