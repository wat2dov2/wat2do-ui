import pytest

from services.instagram_dms.decide import DmDecision
from services.instagram_notifications import browser_direct as module
from services.instagram_notifications.browser_session import BrowserEngagementUncertain

POST = "https://www.instagram.com/p/ABC123/"
THREAD = [{"from": "them", "type": "clip", "text": "", "shared_url": POST}]


class _Session:
    def __init__(self, *, send_state="succeeded", thread_payload=None):
        self.queries = []
        self.send_state = send_state
        self.thread_payload = thread_payload or {"state": "succeeded", "items": THREAD}

    def activate_account(self, recipient_id, username):
        return username

    def query(self, source, *, read_only):
        self.queries.append(source)
        if "broadcast/text" in source:
            return {"state": self.send_state}
        return self.thread_payload


@pytest.fixture
def queued(monkeypatch):
    calls = []
    monkeypatch.setattr(
        module.items, "queue_instagram", lambda urls, school: calls.append((urls, school))
    )
    return calls


def _handle(session, monkeypatch, decision, *, dry_run):
    monkeypatch.setattr(module, "decide", lambda thread, **_: decision)
    return module.BrowserInstagramDirectExecutor(session=session).handle(
        "12342599092",
        "wat2do.ubc",
        "340282366841710300949128",
        school="ubc",
        school_name="UBC",
        dry_run=dry_run,
    )


def _sends(session):
    return [source for source in session.queries if "broadcast/text" in source]


def test_dry_run_decides_without_replying_or_queueing(monkeypatch, queued) -> None:
    session = _Session()
    result = _handle(session, monkeypatch, DmDecision("add_to_post", POST, "Sure!"), dry_run=True)
    assert result["status"] == "decided"
    assert result["outcome"] == "add_to_post"
    assert _sends(session) == [] and queued == []


def test_add_to_post_queues_the_post_then_replies_once(monkeypatch, queued) -> None:
    session = _Session()
    result = _handle(session, monkeypatch, DmDecision("add_to_post", POST, "Sure!"), dry_run=False)
    assert result["status"] == "replied"
    assert queued == [([POST], "ubc")]
    assert len(_sends(session)) == 1 and '"Sure!"' in _sends(session)[0]


@pytest.fixture
def stories(monkeypatch):
    shared = []
    monkeypatch.setattr(module, "share_to_story", lambda *args: shared.append(args))
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)
    return shared


def test_a_story_request_is_reposted_before_both_replies(monkeypatch, queued, stories) -> None:
    session = _Session()
    decision = DmDecision("story_repost", POST, "Sure!", "Done!")
    result = _handle(session, monkeypatch, decision, dry_run=False)
    assert result["status"] == "reposted"
    assert stories == [("ubc", "wat2do.ubc", POST)]
    sends = _sends(session)
    assert len(sends) == 2 and '"Sure!"' in sends[0] and '"Done!"' in sends[1]
    assert queued == []


def test_a_failed_story_repost_pauses_without_replying(monkeypatch, queued) -> None:
    def fail(*_args):
        raise RuntimeError("emulator offline")

    monkeypatch.setattr(module, "share_to_story", fail)
    session = _Session()
    decision = DmDecision("story_repost", POST, "Sure!", "Done!")
    with pytest.raises(BrowserEngagementUncertain, match="story repost"):
        _handle(session, monkeypatch, decision, dry_run=False)
    assert _sends(session) == []


def test_dry_run_never_reposts_a_story(monkeypatch, queued, stories) -> None:
    session = _Session()
    decision = DmDecision("story_repost", POST, "Sure!", "Done!")
    result = _handle(session, monkeypatch, decision, dry_run=True)
    assert result["status"] == "decided"
    assert stories == [] and _sends(session) == []


def test_ignored_threads_get_no_reply(monkeypatch, queued) -> None:
    session = _Session()
    result = _handle(session, monkeypatch, DmDecision("ignore"), dry_run=False)
    assert result["status"] == "decided"
    assert _sends(session) == [] and queued == []


def test_an_unconfirmed_reply_pauses_for_a_person(monkeypatch, queued) -> None:
    session = _Session(send_state="failed")
    with pytest.raises(BrowserEngagementUncertain):
        _handle(session, monkeypatch, DmDecision("add_to_post", POST, "Sure!"), dry_run=False)


@pytest.mark.parametrize("thread_id", ["", "12a", "1" * 41, None])
def test_thread_ids_are_validated(thread_id) -> None:
    with pytest.raises(ValueError):
        module.validate_thread_id(thread_id)


def test_an_unreadable_thread_names_the_failed_step_and_status(monkeypatch, queued) -> None:
    session = _Session(
        thread_payload={"state": "failed", "reason": "http_error", "http_status": 400}
    )
    with pytest.raises(
        module.BrowserSessionError, match=r"could not be read: http_error \(HTTP 400\)"
    ):
        _handle(session, monkeypatch, DmDecision("ignore"), dry_run=True)
    assert _sends(session) == [] and queued == []
