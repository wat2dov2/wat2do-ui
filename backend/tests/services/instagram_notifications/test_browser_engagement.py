"""Offline DOM fixtures reflecting observed Instagram web action roles/labels.

The small DOM adapter exercises selectors and click behavior in Node without
launching a browser or contacting Instagram. It is not a live browser E2E test.
"""

import json
import shutil
import subprocess
from html.parser import HTMLParser

import pytest

from services.instagram_notifications import browser_engagement as engagement
from services.instagram_notifications.browser_session import BrowserSessionError


class _FixtureParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.root = {"tag": "document", "attrs": {}, "children": []}
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = {"tag": tag, "attrs": dict(attrs), "children": []}
        self.stack[-1]["children"].append(node)
        if tag not in {"img", "input", "br", "hr", "meta", "link"}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        assert self.stack[-1]["tag"] == tag
        self.stack.pop()


_DOM_ADAPTER = r"""
const clicks = [];
class Element {
  constructor(node, parent = null) {
    this.tag = node.tag; this.attrs = node.attrs; this.parent = parent; this.parentElement = parent;
    this.children = node.children.map(child => new Element(child, this));
    this.disabled = "disabled" in this.attrs;
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  matches(selector) {
    return selector.split(",").some(choice => {
      const match = choice.match(/^([a-z0-9]+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/);
      if (!match) throw new Error("Unsupported fixture selector: " + choice);
      return (!match[1] || this.tag === match[1]) &&
        (!match[2] || (match[2] in this.attrs &&
          (match[3] === undefined || this.attrs[match[2]] === match[3])));
    });
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child =>
      [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    return this.matches(selector) ? this : (this.parent?.closest(selector) || null);
  }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  getBoundingClientRect() {
    return {left: this.tag === "a" ? 10 : 300, top: 10,
      width: this.attrs["data-hidden"] ? 0 : 24, height: 24};
  }
  scrollIntoView() {}
  click() { clicks.push(this.attrs.id || "anonymous"); }
}
global.getComputedStyle = () => ({visibility: "visible", display: "block"});
"""


def _fixture(toolbar, *, extra="", duplicate_post=False, account="usask.wat2do.io"):
    post = f"""
      <article role="presentation">
        <a href="/p/TARGET123/">timestamp</a>
        <section>{toolbar}</section>
        <ul><li><button id="comment-like"><svg aria-label="Like"></svg></button></li></ul>
      </article>
    """
    return f"""
      <nav><a href="/{account}/"><img alt="{account}'s profile picture"></a></nav>
      <div role="dialog">{post}{post if duplicate_post else ""}</div>{extra}
    """


def _toolbar(*, like="Like", save="Save", repost="Repost", pressed=None, extra=""):
    pressed_attribute = f'aria-pressed="{pressed}"' if pressed is not None else ""
    return f"""
      <div role="button" id="post-like"><svg aria-label="{like}"><title>{like}</title></svg></div>
      <div role="button" id="comment"><svg aria-label="Comment"></svg></div>
      <div role="button" id="repost" {pressed_attribute}>
        <svg aria-label="{repost}"><title>{repost}</title></svg>
      </div>
      <div role="button"><svg aria-label="Share Post"></svg></div>
      <div role="button"><div role="button" id="post-save">
        <svg aria-label="{save}"><title>{save}</title></svg>
      </div></div>{extra}
    """


def _evaluate(html, action, *, click=True, current_path="/p/TARGET123/", recipient="41553815702"):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js unavailable for offline DOM fixture tests")
    parser = _FixtureParser()
    parser.feed(html)
    source = engagement._engagement_source(
        "41553815702",
        "usask.wat2do.io",
        "https://www.instagram.com/p/TARGET123/",
        action,
        click=click,
    )
    script = (
        _DOM_ADAPTER
        + f"""
      global.document = new Element({json.dumps(parser.root)});
      document.readyState = "complete";
      document.cookie = {json.dumps("ds_user_id=" + recipient)};
      global.window = {{location: {{origin: "https://www.instagram.com", pathname: {json.dumps(current_path)}}}}};
      const state = {source};
      console.log(JSON.stringify({{state: JSON.parse(state), clicks}}));
    """
    )
    completed = subprocess.run([node], input=script, text=True, capture_output=True)
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


@pytest.mark.parametrize(("action", "clicked_id"), [("like", "post-like"), ("save", "post-save")])
def test_targets_post_toolbar_not_comment_likes_or_nested_wrapper(action, clicked_id):
    result = _evaluate(_fixture(_toolbar()), action)
    assert result == {"state": {"status": "clicked"}, "clicks": [clicked_id]}


@pytest.mark.parametrize(
    ("action", "labels"),
    [
        ("like", {"like": "Unlike"}),
        ("save", {"save": "Remove"}),
        ("repost", {"repost": "Undo repost"}),
        ("repost", {"pressed": "true"}),
    ],
)
def test_active_actions_are_never_toggled_off(action, labels):
    result = _evaluate(_fixture(_toolbar(**labels)), action)
    assert result == {"state": {"status": "already_done"}, "clicks": []}


def test_observed_repost_without_explicit_state_is_unsupported():
    assert _evaluate(_fixture(_toolbar()), "repost") == {
        "state": {"status": "unsupported"},
        "clicks": [],
    }


def test_explicitly_inactive_native_repost_is_supported():
    assert _evaluate(_fixture(_toolbar(pressed="false")), "repost") == {
        "state": {"status": "clicked"},
        "clicks": ["repost"],
    }


@pytest.mark.parametrize("action", ["like", "save", "repost"])
def test_inspection_never_clicks(action):
    assert _evaluate(_fixture(_toolbar(pressed="false")), action, click=False) == {
        "state": {"status": "ready"},
        "clicks": [],
    }


@pytest.mark.parametrize(
    ("html", "arguments", "reason"),
    [
        (_fixture(_toolbar()), {"current_path": "/p/WRONG/"}, "wrong_post"),
        (_fixture(_toolbar()), {"recipient": "99999"}, "wrong_account"),
        (_fixture(_toolbar(), account="other.wat2do.io"), {}, "wrong_account"),
        (_fixture(_toolbar(), duplicate_post=True), {}, "ambiguous_post"),
        (
            _fixture(_toolbar(extra='<button id="second"><svg aria-label="Like"></svg></button>')),
            {},
            "ambiguous_control",
        ),
        (
            _fixture(_toolbar(), extra='<div role="dialog"><button>Challenge</button></div>'),
            {},
            "blocked",
        ),
    ],
)
def test_ambiguous_or_wrong_context_fails_without_clicking(html, arguments, reason):
    assert _evaluate(html, "like", **arguments) == {
        "state": {"status": "failed", "reason": reason},
        "clicks": [],
    }


def test_hidden_duplicate_action_is_ignored():
    html = _fixture(
        _toolbar(
            extra="""
      <button data-hidden="yes"><svg aria-label="Like" data-hidden="yes"></svg></button>
    """
        )
    )
    assert _evaluate(html, "like")["clicks"] == ["post-like"]


class FakeSession:
    def __init__(self, states):
        self.states = iter(states)
        self.sources = []
        self.calls = []
        self.reads = []
        self.mutations = []

    def activate_account(self, recipient_id, username):
        self.calls.append(("activate", recipient_id, username))
        return username

    def navigate_post(self, url, recipient_id, username):
        self.calls.append(("navigate", url, recipient_id, username))
        return url

    def run(self, source):
        self.mutations.append(source)
        self.sources.append(source)
        return json.dumps({"status": next(self.states)})

    def read(self, source):
        self.reads.append(source)
        self.sources.append(source)
        return json.dumps({"status": next(self.states)})

    def poll_until(self, completed):
        for _ in range(3):
            if completed():
                return
        raise BrowserSessionError("Instagram browser automation timed out")


def _execute(session, action="like"):
    executor = engagement.BrowserInstagramEngagementExecutor(session=session)
    recipient, username, url = (
        "41553815702",
        "usask.wat2do.io",
        "https://www.instagram.com/p/TARGET123/",
    )
    username, url = executor._prepare(recipient, username, url)
    result = executor._state(recipient, username, url, action, click=True)
    return executor._complete(recipient, username, url, action, result)


def test_executor_clicks_once_and_waits_for_positive_confirmation():
    session = FakeSession(["clicked", "ready", "already_done"])
    assert _execute(session) == {"action": "like", "status": "succeeded"}
    assert session.calls == [
        ("activate", "41553815702", "usask.wat2do.io"),
        ("navigate", "https://www.instagram.com/p/TARGET123/", "41553815702", "usask.wat2do.io"),
    ]
    assert len(session.mutations) == 1 and len(session.reads) == 2
    assert sum("if (!true)" in source for source in session.sources) == 1
    assert sum("if (!false)" in source for source in session.sources) == 2


def test_verification_timeout_does_not_click_again():
    session = FakeSession(["clicked", "ready", "ready", "ready"])
    with pytest.raises(BrowserSessionError, match="timed out"):
        _execute(session)
    assert sum("if (!true)" in source for source in session.sources) == 1


def test_action_confirmation_retries_bridge_reads_without_repeating_click():
    from services.instagram_notifications.browser_session import (
        BrowserInstagramSession,
        _BrowserAutomationTransient,
    )

    reads = []

    def run(source, timeout):
        reads.append(source)
        assert "if (!false)" in source
        if len(reads) == 1:
            raise _BrowserAutomationTransient("Apple Event -1719")
        return json.dumps({"status": "already_done"})

    session = BrowserInstagramSession(javascript_runner=run, sleep=lambda _: None)
    executor = engagement.BrowserInstagramEngagementExecutor(session=session)
    result = executor._complete(
        "41553815702",
        "usask.wat2do.io",
        "https://www.instagram.com/p/TARGET123/",
        "like",
        {"action": "like", "status": "clicked"},
    )
    assert result == {"action": "like", "status": "succeeded"}
    assert len(reads) == 2


def test_unsupported_repost_is_reported_without_claiming_success():
    session = FakeSession(["unsupported"])
    result = _execute(session, "repost")
    assert result["status"] == "unsupported"
    assert "no explicit" in result["reason"]


def test_invalid_url_and_action_fail_before_touching_browser():
    session = FakeSession([])
    executor = engagement.BrowserInstagramEngagementExecutor(session=session)
    for url, action in [
        ("https://attacker.test", "like"),
        ("https://instagram.com/p/A/", "delete"),
    ]:
        with pytest.raises(BrowserSessionError):
            if action == "delete":
                executor._state("41553815702", "usask.wat2do.io", url, action, click=True)
            else:
                executor.engage_post("41553815702", "usask.wat2do.io", url)
    assert session.calls == []


def test_standalone_post_uses_author_prefixed_timestamp_without_article():
    html = (
        "<nav><a href='/usask.wat2do.io/'><img alt=\"usask.wat2do.io's profile picture\"></a></nav>"
        "<main><div><section>" + _toolbar() + "</section>"
        "<a href='/club/p/TARGET123/'>timestamp</a></div>"
        "<div><a href='/club/p/RECOMMENDED/'>suggested post</a></div></main>"
    )
    assert _evaluate(html, "like", click=False) == {"state": {"status": "ready"}, "clicks": []}
    assert _evaluate(html, "save", click=False) == {"state": {"status": "ready"}, "clicks": []}


def test_other_post_toolbar_is_excluded_by_its_own_permalink():
    extra_post = (
        "<article><section>" + _toolbar() + "</section>"
        "<a href='/club/p/OTHER/'>other post timestamp</a></article>"
    )
    assert _evaluate(_fixture(_toolbar(), extra=extra_post), "like")["clicks"] == ["post-like"]


def test_toolbar_without_target_permalink_is_not_guessed():
    html = _fixture(_toolbar()).replace("/p/TARGET123/", "/p/OTHER/")
    assert _evaluate(html, "like") == {
        "state": {"status": "failed", "reason": "ambiguous_post"},
        "clicks": [],
    }


# Captured from the live post toolbar before and after the approved repost.
_OBSERVED_REPOST_INACTIVE = "M19.998 9.497a1 1 0 0 0-1 1v4.228a3.274 3.274 0 0 1-3.27 3.27h-5.313l1.791-1.787a1 1 0 0 0-1.412-1.416L7.29 18.287a1.004 1.004 0 0 0-.294.707v.001c0 .023.012.042.013.065a.923.923 0 0 0 .281.643l3.502 3.504a1 1 0 0 0 1.414-1.414l-1.797-1.798h5.318a5.276 5.276 0 0 0 5.27-5.27v-4.228a1 1 0 0 0-1-1Zm-6.41-3.496-1.795 1.795a1 1 0 1 0 1.414 1.414l3.5-3.5a1.003 1.003 0 0 0 0-1.417l-3.5-3.5a1 1 0 0 0-1.414 1.414l1.794 1.794H8.27A5.277 5.277 0 0 0 3 9.271V13.5a1 1 0 0 0 2 0V9.271a3.275 3.275 0 0 1 3.271-3.27Z"
_OBSERVED_REPOST_ACTIVE = "M16 6.001a1 1 0 0 0 .924-1.382.998.998 0 0 0-.217-.326l-3.5-3.5a1 1 0 1 0-1.414 1.414l1.794 1.794H8.27A5.277 5.277 0 0 0 3 9.271V13.5a1 1 0 1 0 2 0V9.271a3.275 3.275 0 0 1 3.271-3.27h7.73Zm3.998 3.496a1 1 0 0 0-1 1v4.228a3.274 3.274 0 0 1-3.27 3.27H7.996a1.001 1.001 0 0 0-.706 1.708l3.502 3.504a.997.997 0 0 0 1.414 0 1 1 0 0 0 0-1.414l-1.797-1.798h5.317a5.276 5.276 0 0 0 5.271-5.27v-4.228a1 1 0 0 0-1-1Zm-5.205-.51-3.905 3.906-1.681-1.681a1 1 0 1 0-1.414 1.414l2.388 2.388a1 1 0 0 0 1.414 0l4.612-4.614a1 1 0 1 0-1.414-1.414Z"


@pytest.mark.parametrize(
    "glyph,status,clicks",
    [
        (_OBSERVED_REPOST_INACTIVE, "clicked", ["repost"]),
        (_OBSERVED_REPOST_ACTIVE, "already_done", []),
        ("unknown-future-glyph", "unsupported", []),
    ],
)
def test_live_native_repost_glyphs_without_pressed_state(glyph, status, clicks):
    toolbar = _toolbar().replace(
        "<title>Repost</title>", f'<title>Repost</title><path d="{glyph}"></path>'
    )
    assert _evaluate(_fixture(toolbar), "repost") == {"state": {"status": status}, "clicks": clicks}


def test_active_repost_badge_outside_toolbar_cannot_mark_post_reposted():
    toolbar = _toolbar().replace(
        "<title>Repost</title>",
        f'<title>Repost</title><path d="{_OBSERVED_REPOST_INACTIVE}"></path>',
    )
    badge = f'<div><svg aria-label="Repost"><path d="{_OBSERVED_REPOST_ACTIVE}"></path></svg></div>'
    assert _evaluate(_fixture(toolbar, extra=badge), "repost") == {
        "state": {"status": "clicked"},
        "clicks": ["repost"],
    }


def test_post_job_navigates_once_and_completes_like_then_repost():
    session = FakeSession(["clicked", "already_done", "clicked", "already_done"])
    result = engagement.BrowserInstagramEngagementExecutor(session=session).engage_post(
        "41553815702", "usask.wat2do.io", "https://www.instagram.com/p/TARGET123/"
    )
    assert result["status"] == "succeeded"
    assert list(result["actions"]) == ["like", "repost"]
    assert all(action["status"] == "succeeded" for action in result["actions"].values())
    assert [call[0] for call in session.calls] == ["activate", "navigate"]


def test_post_retry_preserves_completed_like_and_only_finishes_repost():
    session = FakeSession(["already_done", "clicked", "already_done"])
    result = engagement.BrowserInstagramEngagementExecutor(session=session).engage_post(
        "41553815702", "usask.wat2do.io", "https://www.instagram.com/p/TARGET123/"
    )
    assert result["actions"]["like"]["status"] == "already_done"
    assert result["actions"]["repost"]["status"] == "succeeded"
    assert len(session.calls) == 2
