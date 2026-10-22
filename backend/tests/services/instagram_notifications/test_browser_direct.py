import pytest

from services.instagram_dms.decide import DmDecision
from services.instagram_notifications import browser_direct as module
from services.instagram_notifications.browser_session import BrowserEngagementUncertain

POST = "https://www.instagram.com/p/ABC123/"
THREAD = [{"from": "them", "type": "clip", "text": "", "shared_url": POST}]


class _Session:
    def __init__(self, *, send_state="succeeded"):
        self.queries = []
        self.send_state = send_state

    def activate_account(self, recipient_id, username):
        return username

    def query(self, source, *, read_only):
        self.queries.append(source)
        if "broadcast/text" in source:
            return {"state": self.send_state}
        return {"state": "succeeded", "items": THREAD}


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


def test_a_story_request_waits_for_the_emulator_without_replying(monkeypatch, queued) -> None:
    session = _Session()
    decision = DmDecision("story_repost", POST, "Sure!", "Done!")
    result = _handle(session, monkeypatch, decision, dry_run=False)
    assert result["status"] == "awaiting_story_repost"
    assert _sends(session) == [] and queued == []


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
