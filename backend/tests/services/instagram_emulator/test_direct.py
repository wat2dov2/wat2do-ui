import pytest

from services.instagram_dms.decide import DmDecision
from services.instagram_emulator import direct as module
from services.instagram_emulator.device import Node
from services.instagram_emulator.inbox import InboxRow
from services.instagram_notifications.browser_session import (
    BrowserEngagementUncertain,
    BrowserSessionError,
)

POST = "https://www.instagram.com/p/ABC123/"
# The executor tests swap in _Reader; the reader's own tests use the real one.
THREAD_READER = module._ThreadReader
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
    free = 5000

    def __init__(self):
        self.users = []

    def reclaim_data(self):
        return _Device.free

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
    stale = False

    def __init__(self, device, opener):
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
    _Reader.fail_read = _Reader.fail_send = _Reader.stale = False
    _Device.free = 5000
    monkeypatch.setattr(module, "_ThreadReader", _Reader)


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


@pytest.fixture
def accepted(monkeypatch):
    calls = []
    monkeypatch.setattr(module, "accept_request", lambda device: calls.append(device))
    return calls


def _handle(monkeypatch, decision, *, dry_run, request=False):
    monkeypatch.setattr(module, "decide", lambda thread, **_: decision)
    row = InboxRow("Club", "Could you share this?", 0.1, unread=True, request=request)
    return module.EmulatorDirectExecutor(device=_Device()).handle(
        row,
        account_username="wat2do.ubc",
        school="ubc",
        school_name="UBC",
        dry_run=dry_run,
    )


def test_dry_run_decides_without_replying_reposting_or_queueing(
    monkeypatch, queued, stories
) -> None:
    result = _handle(monkeypatch, DmDecision("story_repost", POST, "just shared it!"), dry_run=True)
    assert result["status"] == "decided"
    assert _Reader.sent == [] and stories == [] and queued == []


def test_add_to_post_queues_the_post_then_replies_once(monkeypatch, queued) -> None:
    result = _handle(monkeypatch, DmDecision("add_to_post", POST, "Sure!"), dry_run=False)
    assert result["status"] == "replied"
    assert queued == [([POST], "ubc")]
    assert _Reader.sent == ["Sure!"]


def test_a_story_request_is_reposted_before_its_reply(monkeypatch, queued, stories) -> None:
    decision = DmDecision("story_repost", POST, "just shared it!")
    result = _handle(monkeypatch, decision, dry_run=False)
    assert result["status"] == "reposted"
    assert stories == [("ubc", "wat2do.ubc", POST)]
    assert _Reader.sent == ["just shared it!"]
    assert queued == []


def test_a_plain_reply_is_sent_without_queueing_or_reposting(
    monkeypatch, queued, stories, accepted
) -> None:
    decision = DmDecision("reply", reply="send us the post here and we'll take a look")
    result = _handle(monkeypatch, decision, dry_run=False, request=True)
    assert result["status"] == "replied"
    assert _Reader.sent == ["send us the post here and we'll take a look"]
    assert stories == [] and queued == [] and len(accepted) == 1


def test_a_failed_story_repost_pauses_without_replying(monkeypatch) -> None:
    def fail(*_args):
        raise RuntimeError("emulator offline")

    monkeypatch.setattr(module, "share_to_story", fail)
    with pytest.raises(BrowserEngagementUncertain, match="story repost"):
        _handle(monkeypatch, DmDecision("story_repost", POST, "just shared it!"), dry_run=False)
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


def test_a_request_is_accepted_only_when_we_answer_it(monkeypatch, queued, accepted) -> None:
    _handle(monkeypatch, DmDecision("ignore"), dry_run=False, request=True)
    assert accepted == []
    _handle(monkeypatch, DmDecision("add_to_post", POST, "Sure!"), dry_run=False, request=True)
    assert len(accepted) == 1 and _Reader.sent == ["Sure!"]


def test_an_inbox_thread_is_never_accepted(monkeypatch, queued, accepted) -> None:
    _handle(monkeypatch, DmDecision("add_to_post", POST, "Sure!"), dry_run=False)
    assert accepted == []


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
    assert module._newest_is_ours(PERSONAL_CHAT, "Sure!")


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
    assert module._newest_is_ours(chat, "Sure thing!")


def test_a_reply_with_a_link_preview_is_still_read_as_our_text() -> None:
    reply = "you can submit it at wat2do.io/events/submit"
    chat = [
        _node("faithinsmiles", (304, 177, 582, 225), "header_title"),
        _node("", (0, 275, 1080, 1431), "message_list"),
        _node("", (419, 275, 1049, 909), "xma_bubble_container"),
        _node("Wat2Do | Campus Events", (454, 714, 881, 761), "caption_title"),
        _node(reply, (298, 930, 1059, 1344), "direct_text_message_text_view"),
    ]
    assert module._newest_is_ours(chat, reply)


class _ThreadDevice:
    """Serves screens in order, the last one forever, and records what was typed."""

    def __init__(self, screens):
        self.screens = screens
        self.typed = []

    def screen(self):
        return self.screens.pop(0) if len(self.screens) > 1 else self.screens[0]

    def find(self, pattern, nodes):
        return next((node for node in nodes if node.labelled(pattern)), None)

    def tap(self, node):
        pass

    def tap_when(self, pattern):
        pass

    def type_text(self, text):
        self.typed.append(text)

    def pause(self):
        pass


def _thread(*messages):
    composer = _node("Message…", (158, 1365, 621, 1496), "row_thread_composer_edittext")
    return [_node("", (0, 275, 1080, 1431), "message_list"), *messages, composer]


def test_a_reply_is_confirmed_even_when_older_messages_scroll_away() -> None:
    older = _node("Sure!", (850, 400, 1040, 450))
    request = _node("could you share our post?", (179, 600, 882, 700))
    sent = _node("just shared it!", (700, 1200, 1040, 1250))
    device = _ThreadDevice([_thread(older, request), _thread(request), _thread(request, sent)])
    THREAD_READER(device, lambda: None).send("just shared it!")
    assert device.typed == ["just shared it!"]


def test_a_reply_that_never_appears_is_not_confirmed() -> None:
    request = _node("could you share our post?", (179, 600, 882, 700))
    device = _ThreadDevice([_thread(request)])
    with pytest.raises(module.EmulatorError, match="did not appear"):
        THREAD_READER(device, lambda: None).send("just shared it!")


def test_a_display_name_alone_is_not_taken_as_a_username() -> None:
    chat = [
        _node("UWaterloo ViVA Club", (304, 156, 600, 204), "header_title"),
        _node("", (304, 204, 650, 246), "header_subtitle", "Active 18m ago"),
    ]
    assert module._sender(chat) is None


# sightandsmile_utsc's chat: a reel drawn as a bare media card, then their request.
REEL_CARD_CHAT = [
    _node("Sight & Smile @ UTSC", (304, 156, 650, 204), "header_title"),
    _node("sightandsmile_utsc", (304, 204, 650, 246), "header_subtitle"),
    _node("", (0, 275, 1080, 2251), "message_list"),
    _node("YESTERDAY 6:14 PM", (0, 942, 1080, 1025)),
    _node("", (147, 1057, 593, 1859), "media_container"),
    _node("", (179, 1089, 242, 1152), "profile_attribution_picture", "Profile picture"),
    _node("sightandsmile_utsc", (263, 1098, 561, 1142), "title_text"),
    _node("", (614, 1363, 698, 1447), "forwarding_shortcut_button", "Forward message"),
    _node("We just posted, could you repost it on your story?", (179, 1889, 882, 2089)),
    _node("Tap and hold to react", (147, 2126, 455, 2164)),
]


def test_a_reel_drawn_as_a_bare_card_is_a_shared_post_with_its_forward_button() -> None:
    messages = module._messages(REEL_CARD_CHAT)
    assert [(m["from"], m["type"], m["shared_owner"]) for m in messages] == [
        ("them", "media_share", "sightandsmile_utsc"),
        ("them", "text", None),
    ]
    forward = module._forward_button(REEL_CARD_CHAT, messages[0]["media"])
    assert forward is not None and forward.resource_id == "forwarding_shortcut_button"


def test_a_thread_whose_newest_message_is_over_a_week_old_is_left_alone(
    monkeypatch, queued, stories
) -> None:
    _Reader.stale = True
    result = _handle(
        monkeypatch, DmDecision("story_repost", POST, "just shared it!"), dry_run=False
    )
    assert (result["status"], result["outcome"]) == ("decided", "ignore")
    assert _Reader.sent == [] and stories == [] and queued == []


def test_dates_tell_a_week_old_thread_from_a_recent_one() -> None:
    assert not module._newest_message_is_old(BUSINESS_CHAT)  # "MON 11:36 PM"
    assert module._newest_message_is_old(PERSONAL_CHAT)  # "OCT 4, 11:43 PM"
    assert not module._newest_message_is_old(REEL_CARD_CHAT)  # "YESTERDAY 6:14 PM"


def test_an_online_sender_is_named_by_their_header_avatar() -> None:
    chat = [
        _node("UTSC AfterHours", (304, 156, 600, 204), "header_title"),
        _node("", (304, 204, 650, 246), "header_subtitle", "Active now"),
        _node("", (178, 154, 273, 249), "header_avatar", "Open story of utscafterhours"),
    ]
    assert module._sender(chat) == "utscafterhours"


def test_a_story_request_waits_while_the_emulator_is_low_on_storage(
    monkeypatch, queued, stories, accepted
) -> None:
    _Device.free = 100
    decision = DmDecision("story_repost", POST, "just shared it!")
    with pytest.raises(BrowserSessionError, match="low on storage") as raised:
        _handle(monkeypatch, decision, dry_run=False, request=True)
    assert not isinstance(raised.value, BrowserEngagementUncertain)
    assert stories == [] and accepted == [] and _Reader.sent == []
