from contextlib import nullcontext

import pytest

from services.instagram_dms.decide import DmDecision
from services.instagram_emulator import direct as module
from services.instagram_emulator.device import Node
from services.instagram_notifications.browser_session import (
    BrowserEngagementUncertain,
    BrowserSessionError,
)

POST = "https://www.instagram.com/p/ABC123/"
THREAD = [
    {
        "from": "them",
        "type": "media_share",
        "text": "",
        "shared_url": POST,
        "sender": "club",
        "shared_owner": "club",
    }
]


class _Device:
    def __init__(self):
        self.users = []

    def wake(self):
        pass

    def use_android_user(self, user):
        self.users.append(user)

    def use_account(self, user, username):
        pass


class _Reader:
    sent: list[str] = []
    fail_read = False
    fail_send = False

    def __init__(self, device, user, thread_id):
        pass

    def read(self):
        if _Reader.fail_read:
            raise module.EmulatorError("no thread")
        return THREAD

    def send(self, text):
        if _Reader.fail_send:
            raise module.EmulatorError("no confirmation")
        _Reader.sent.append(text)


@pytest.fixture(autouse=True)
def emulator(monkeypatch):
    _Reader.sent = []
    _Reader.fail_read = _Reader.fail_send = False
    monkeypatch.setattr(module, "_ThreadReader", _Reader)
    monkeypatch.setattr(module, "exclusive", nullcontext)
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)


@pytest.fixture
def queued(monkeypatch):
    calls = []
    monkeypatch.setattr(
        module.items, "queue_instagram", lambda urls, school: calls.append((urls, school))
    )
    return calls


@pytest.fixture
def stories(monkeypatch):
    shared = []
    monkeypatch.setattr(module, "share_to_story", lambda *args: shared.append(args))
    return shared


def _handle(monkeypatch, decision, *, dry_run, school="ubc"):
    monkeypatch.setattr(module, "decide", lambda thread, **_: decision)
    return module.EmulatorDirectExecutor(device=_Device()).handle(
        "wat2do.ubc",
        "340282366841710300949128",
        school=school,
        school_name="UBC",
        dry_run=dry_run,
    )


def test_dry_run_decides_without_replying_reposting_or_queueing(
    monkeypatch, queued, stories
) -> None:
    result = _handle(monkeypatch, DmDecision("story_repost", POST, "Sure!", "Done!"), dry_run=True)
    assert result["status"] == "decided"
    assert _Reader.sent == [] and stories == [] and queued == []


def test_add_to_post_queues_the_post_then_replies_once(monkeypatch, queued) -> None:
    result = _handle(monkeypatch, DmDecision("add_to_post", POST, "Sure!"), dry_run=False)
    assert result["status"] == "replied"
    assert queued == [([POST], "ubc")]
    assert _Reader.sent == ["Sure!"]


def test_a_story_request_is_reposted_before_both_replies(monkeypatch, queued, stories) -> None:
    decision = DmDecision("story_repost", POST, "Sure!", "Done!")
    result = _handle(monkeypatch, decision, dry_run=False)
    assert result["status"] == "reposted"
    assert stories == [("ubc", "wat2do.ubc", POST)]
    assert _Reader.sent == ["Sure!", "Done!"]
    assert queued == []


def test_a_failed_story_repost_pauses_without_replying(monkeypatch) -> None:
    def fail(*_args):
        raise RuntimeError("emulator offline")

    monkeypatch.setattr(module, "share_to_story", fail)
    with pytest.raises(BrowserEngagementUncertain, match="story repost"):
        _handle(monkeypatch, DmDecision("story_repost", POST, "Sure!", "Done!"), dry_run=False)
    assert _Reader.sent == []


def test_an_unconfirmed_reply_pauses_for_a_person(monkeypatch, queued) -> None:
    _Reader.fail_send = True
    with pytest.raises(BrowserEngagementUncertain, match="reply"):
        _handle(monkeypatch, DmDecision("add_to_post", POST, "Sure!"), dry_run=False)


def test_an_unreadable_thread_fails_without_pausing(monkeypatch, queued) -> None:
    _Reader.fail_read = True
    with pytest.raises(BrowserSessionError, match="could not be read") as raised:
        _handle(monkeypatch, DmDecision("add_to_post", POST, "Sure!"), dry_run=False)
    assert not isinstance(raised.value, BrowserEngagementUncertain)
    assert queued == []


def test_ignored_threads_get_no_reply(monkeypatch, queued, stories) -> None:
    result = _handle(monkeypatch, DmDecision("ignore"), dry_run=False)
    assert result["status"] == "decided"
    assert _Reader.sent == [] and stories == [] and queued == []


def test_a_school_without_an_emulator_account_is_refused(monkeypatch) -> None:
    with pytest.raises(BrowserSessionError, match="not logged in"):
        _handle(monkeypatch, DmDecision("ignore"), dry_run=False, school="not-a-school")


@pytest.mark.parametrize("thread_id", ["", "12a", "1" * 41, None])
def test_thread_ids_are_validated(thread_id) -> None:
    with pytest.raises(ValueError):
        module.validate_thread_id(thread_id)


def _node(text, bounds, resource_id="", description=""):
    return Node(text, description, bounds, resource_id)


# The spihc.waterloo business chat as the app drew it: a shared reel, then a request.
BUSINESS_CHAT = [
    _node("spihc.waterloo", (304, 156, 569, 204), "header_title"),
    _node("", (304, 204, 650, 246), "header_subtitle", "Business chat"),
    _node("", (0, 275, 1080, 2251), "message_list"),
    _node("spihc.waterloo", (373, 300, 707, 356)),
    _node("View profile", (438, 376, 643, 420), "ig_text"),
    _node("MON 11:36 PM", (0, 422, 1080, 505)),
    _node("", (147, 537, 777, 1609), "xma_bubble_container"),
    _node("spihc.waterloo", (289, 578, 589, 632), "title"),
    _node("", (147, 673, 777, 1450), "media_container"),
    _node("spihc.waterloo Want to win a gift card?", (182, 1485, 742, 1574), "caption_title"),
    _node("Hey! Could you share it to your story?", (179, 1639, 882, 2089)),
    _node("Tap and hold to react", (147, 2126, 455, 2164)),
    _node("Message…", (158, 2185, 621, 2316), "row_thread_composer_edittext"),
]

# A personal chat: our shared post on the right, then their reply on the left.
PERSONAL_CHAT = [
    _node("Tony Qiu", (304, 156, 455, 204), "header_title"),
    _node("", (304, 204, 650, 246), "header_subtitle", "tony_q04"),
    _node("", (0, 275, 1080, 2251), "message_list"),
    _node("SEP 21, 5:53 PM", (0, 826, 1080, 909)),
    _node("", (464, 941, 1059, 1866), "xma_bubble_container"),
    _node("vybin_org", (571, 982, 771, 1036), "title"),
    _node("", (464, 1040, 1059, 1700), "media_container"),
    _node("OCT 4, 11:43 PM", (0, 1898, 1080, 1981)),
    _node("Hi", (179, 2039, 220, 2089)),
    _node("Sure!", (850, 2095, 1040, 2140)),
]


def test_a_business_chat_reads_the_sender_and_the_shared_reel() -> None:
    assert module._sender(BUSINESS_CHAT) == "spihc.waterloo"
    messages = module._messages(BUSINESS_CHAT)
    assert [(m["from"], m["type"]) for m in messages] == [
        ("them", "media_share"),
        ("them", "text"),
    ]
    assert messages[0]["shared_owner"] == "spihc.waterloo"
    assert messages[0]["text"] == "Want to win a gift card?"
    assert messages[1]["text"] == "Hey! Could you share it to your story?"


def test_a_personal_chat_takes_the_username_and_tells_our_side_apart() -> None:
    assert module._sender(PERSONAL_CHAT) == "tony_q04"
    messages = module._messages(PERSONAL_CHAT)
    assert [(m["from"], m["type"], m["shared_owner"]) for m in messages] == [
        ("us", "media_share", "vybin_org"),
        ("them", "text", None),
        ("us", "text", None),
    ]
    assert module._our_texts(PERSONAL_CHAT) == ["Sure!"]


def test_a_scrolled_chat_still_reads_our_replies_after_a_time_only_separator() -> None:
    # The profile card and the dated separator have scrolled away while typing.
    chat = [
        _node("spihc.waterloo", (304, 156, 569, 204), "header_title"),
        _node("", (0, 275, 1080, 1340), "message_list"),
        _node("Hey! Could you share it to your story?", (179, 570, 882, 1020)),
        _node("Tap and hold to react", (147, 1057, 455, 1095)),
        _node("11:26 PM", (0, 1127, 1080, 1210)),
        _node("Sure thing!", (813, 1268, 1027, 1318)),
    ]
    assert [(m["from"], m["text"]) for m in module._messages(chat)] == [
        ("them", "Hey! Could you share it to your story?"),
        ("us", "Sure thing!"),
    ]
    assert module._our_texts(chat) == ["Sure thing!"]


def test_a_display_name_alone_is_not_taken_as_a_username() -> None:
    chat = [
        _node("UWaterloo ViVA Club", (304, 156, 600, 204), "header_title"),
        _node("", (304, 204, 650, 246), "header_subtitle", "Active 18m ago"),
    ]
    assert module._sender(chat) is None
