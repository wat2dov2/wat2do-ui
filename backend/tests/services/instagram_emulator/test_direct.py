import pytest

from services.instagram_emulator import direct as module
from services.instagram_emulator.device import Node

POST = "https://www.instagram.com/p/ABC123/"
THREAD_READER = module.ThreadReader


@pytest.fixture(autouse=True)
def excluded(monkeypatch):
    """The handles in instagram_excluded_clubs; none unless a test adds one."""
    handles: set[str] = set()

    class _Query:
        def __init__(self):
            self.handle = None

        def select(self, *_columns):
            return self

        def eq(self, _column, value):
            self.handle = value
            return self

        def execute(self):
            rows = [{"ig_handle": self.handle}] if self.handle in handles else []
            return type("Result", (), {"data": rows})()

    monkeypatch.setattr(
        module, "get_sb", lambda: type("Db", (), {"table": lambda _self, _name: _Query()})()
    )
    return handles


def _newest_is_ours(nodes, text):
    """Whether our message is the newest one read off the screen."""
    messages = module._messages(nodes)
    return (
        bool(messages)
        and messages[-1]["from"] == "us"
        and module._as_typed(messages[-1]["text"]) == module._as_typed(text)
    )


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
    assert _newest_is_ours(PERSONAL_CHAT, "Sure!")


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
    assert _newest_is_ours(chat, "Sure thing!")


def test_a_reply_with_a_link_preview_is_still_read_as_our_text() -> None:
    reply = "you can submit it at wat2do.io/events/submit"
    chat = [
        _node("faithinsmiles", (304, 177, 582, 225), "header_title"),
        _node("", (0, 275, 1080, 1431), "message_list"),
        _node("", (419, 275, 1049, 909), "xma_bubble_container"),
        _node("Wat2Do | Campus Events", (454, 714, 881, 761), "caption_title"),
        _node(reply, (298, 930, 1059, 1344), "direct_text_message_text_view"),
    ]
    assert _newest_is_ours(chat, reply)


THREAD = "spihc.waterloo"


class _DraftDevice:
    """A thread whose composer shows whatever was typed; records every key and tap.

    ``header`` is the thread on screen: its title and, under it, its username. ``said``
    are their messages, then ``wrote`` ours, the newest last.
    """

    def __init__(
        self,
        *,
        request=False,
        echo=True,
        sends=True,
        header=(THREAD, ""),
        said=(),
        wrote=("Just shared it to our story!",),
    ):
        self.request = request
        self.echo = echo
        self.sends = sends
        self.header = header
        self.said = said
        self.wrote = wrote
        self.typed = ""
        self.sent = []
        self.taps = []
        self.backs = 0
        self.accepted = False

    def screen(self):
        title, username = self.header
        thread = [
            _node(title, (304, 156, 650, 204), "header_title"),
            _node(username, (304, 204, 650, 246), "header_subtitle"),
            _node("", (0, 275, 1080, 1431), "message_list"),
            *(
                _node(text, (179, 400 + 100 * i, 882, 480 + 100 * i))
                for i, text in enumerate(self.said)
            ),
            *(
                _node(text, (700, 900 + 100 * i, 1040, 980 + 100 * i))
                for i, text in enumerate(self.wrote)
            ),
        ]
        if not self.request or self.accepted:
            shown = self.typed if self.echo else ""
            thread.append(
                _node(shown or "Message…", (158, 1365, 621, 1496), "row_thread_composer_edittext")
            )
            thread.append(
                _node("", (904, 1400, 1041, 1495), "row_thread_composer_send_button_container")
            )
        return thread

    def find(self, pattern, nodes=None):
        return next((node for node in nodes or self.screen() if node.labelled(pattern)), None)

    def tap(self, node):
        self.taps.append(node.resource_id or node.label)
        if node.resource_id == "row_thread_composer_send_button_container" and self.sends:
            self.sent.append(self.typed)
            self.typed = ""

    def pause(self):
        pass

    def clear_field(self):
        self.typed = ""

    def type_text(self, text):
        self.typed += text

    def back(self):
        self.backs += 1


def _opened(device):
    return THREAD_READER(device, THREAD, lambda: None)


def test_a_reply_is_typed_confirmed_and_sent() -> None:
    device = _DraftDevice()
    _opened(device).send_reply("Sure, done!")
    assert device.sent == ["Sure, done!"]
    assert device.taps == [
        "row_thread_composer_edittext",
        "row_thread_composer_send_button_container",
    ]
    # The keyboard, then the thread, are closed.
    assert device.backs == 2


def test_a_reply_never_goes_into_another_thread_left_open() -> None:
    device = _DraftDevice(header=("UWaterloo ViVA Club", ""))
    with pytest.raises(module.ThreadMismatch):
        _opened(device).send_reply("Sure, done!")
    assert device.sent == [] and device.taps == [] and device.typed == ""


def test_a_stale_draft_is_cleared_and_never_sent() -> None:
    device = _DraftDevice()
    device.typed = "an old draft nobody approved"
    _opened(device).send_reply("Sure, done!")
    assert device.sent == ["Sure, done!"]


def test_a_request_must_be_accepted_before_a_reply() -> None:
    with pytest.raises(module.EmulatorError, match="accept it first"):
        _opened(_DraftDevice(request=True)).send_reply("Sure!")


def test_a_reply_that_does_not_show_in_the_composer_is_never_sent() -> None:
    device = _DraftDevice(echo=False)
    with pytest.raises(module.EmulatorError, match="did not show"):
        _opened(device).send_reply("hi")
    assert device.sent == []


def test_a_request_is_accepted_once(monkeypatch) -> None:
    device = _DraftDevice(request=True)

    def accept(dev):
        dev.accepted = True

    monkeypatch.setattr(module, "accept_request", accept)
    assert _opened(device).accept() is True
    assert _opened(device).accept() is False


@pytest.mark.parametrize(
    ("said", "left_out"),
    [
        ("please stop featuring our events", True),
        ("Can you ask us first before you post?", True),
        ("We don't want to be tracked", True),
        ("could you repost this?", False),
        ("thank you so much!", False),
    ],
)
def test_asking_to_be_left_out_is_read_from_their_words(said, left_out) -> None:
    assert module.asks_to_be_left_out([{"from": "them", "text": said}]) is left_out
    assert module.asks_to_be_left_out([{"from": "us", "text": said}]) is False


TOKEN = "0f6b3c1e-1234"
CLAIM = f"Hey! We're happy to keep featuring your events. https://tmu.wat2do.io/claim/{TOKEN} Thank you!"
SEND = "row_thread_composer_send_button_container"


def _send_claim(device, message=CLAIM, *, thread=THREAD, handle=THREAD, tokens=(TOKEN,)):
    return THREAD_READER(device, thread, lambda: None).send_claim(
        message, handle=handle, tokens=frozenset(tokens)
    )


def test_a_claim_message_is_typed_into_an_empty_thread_and_sent() -> None:
    device = _DraftDevice()
    outcome = _send_claim(device)
    assert device.sent == [CLAIM]
    assert device.taps == ["row_thread_composer_edittext", SEND]
    # The keyboard and then the thread are closed.
    assert device.backs == 2
    assert outcome == "typed and sent the claim message"


def test_a_claim_draft_left_waiting_is_sent_as_it_is() -> None:
    device = _DraftDevice()
    device.typed = CLAIM
    outcome = _send_claim(device, "a different message")
    assert device.sent == [CLAIM]
    assert device.taps == [SEND] and device.backs == 1
    assert outcome == "sent the claim message that was waiting in the thread"


def test_a_thread_holding_another_unsent_reply_sends_nothing() -> None:
    device = _DraftDevice()
    device.typed = "hey, welcome! could you send the post here?"
    with pytest.raises(module.ReplyWaiting):
        _send_claim(device)
    assert device.sent == [] and device.taps == []


def test_a_claim_still_in_the_composer_after_send_fails_loudly() -> None:
    with pytest.raises(module.EmulatorError, match="still in the composer"):
        _send_claim(_DraftDevice(sends=False))


def test_a_claim_is_never_typed_into_another_thread_left_open() -> None:
    # 2026-11-25: a read left UWaterloo ViVA's thread open, and SPIHC's claim went into it.
    device = _DraftDevice(header=("UWaterloo ViVA Club", ""))
    with pytest.raises(module.ThreadMismatch):
        _send_claim(device)
    assert device.typed == "" and device.sent == [] and device.taps == []


def test_the_thread_is_opened_from_its_row_every_time() -> None:
    opened = []
    device = _DraftDevice()
    THREAD_READER(device, THREAD, lambda: opened.append(THREAD)).send_claim(
        CLAIM, handle=THREAD, tokens=frozenset({TOKEN})
    )
    assert opened == [THREAD] and device.sent == [CLAIM]


def test_a_thread_whose_sender_is_not_the_club_sends_nothing() -> None:
    # Concordia 2026-11-25: C.U.T.E.A.'s thread got the students' union's claim.
    device = _DraftDevice(header=("C.U.T.E.A. 🍃", "cutea.concordia"))
    with pytest.raises(module.ThreadMismatch, match="not csuconcordia"):
        _send_claim(device, thread="C.U.T.E.A. 🍃", handle="csuconcordia")
    assert device.sent == [] and device.taps == []


def test_a_sender_who_asked_to_be_left_out_gets_nothing(excluded) -> None:
    excluded.add("v1vaclub")
    device = _DraftDevice(header=("UWaterloo ViVA Club", "v1vaclub"))
    with pytest.raises(module.LeftOut):
        _send_claim(device, thread="UWaterloo ViVA Club", handle="v1vaclub")
    assert device.sent == [] and device.taps == []


@pytest.mark.parametrize(
    "said",
    [
        "Hi, please don't post our events anymore",
        "Could you stop featuring us?",
        "We would prefer not to be posted, thank you",
        "Can you take our post down?",
        "Merci de ne plus publier nos evenements",
    ],
)
def test_a_thread_asking_to_be_left_out_gets_nothing(said) -> None:
    device = _DraftDevice(said=(said,))
    with pytest.raises(module.LeftOut):
        _send_claim(device)
    assert device.sent == [] and device.taps == []


def test_a_request_to_share_is_not_taken_for_leaving_out() -> None:
    device = _DraftDevice(said=("Hey! Could you share our post to your story?",))
    assert _send_claim(device) == "typed and sent the claim message"


def test_a_claim_never_follows_their_unanswered_message() -> None:
    # A claim only follows up our last reply; whatever they wrote since needs a person.
    device = _DraftDevice(said=("Thanks! Also, could you share our next post?",), wrote=())
    with pytest.raises(module.ClaimRefused, match="not the newest"):
        _send_claim(device)
    assert device.sent == [] and device.taps == []


def test_a_thread_that_already_got_a_claim_link_gets_no_other() -> None:
    device = _DraftDevice(wrote=(CLAIM,))
    with pytest.raises(module.ClaimRefused, match="already got a claim link"):
        _send_claim(device)
    assert device.sent == [] and device.taps == []


def test_a_waiting_claim_draft_for_another_club_is_never_sent() -> None:
    device = _DraftDevice()
    device.typed = "Hey! https://tmu.wat2do.io/claim/aaaa-bbbb Thank you!"
    with pytest.raises(module.ClaimRefused, match="another club"):
        _send_claim(device)
    assert device.sent == [] and device.taps == []


def test_nothing_is_sent_once_the_thread_on_screen_changed() -> None:
    device = _DraftDevice()
    type_text = device.type_text

    def type_and_leave(text):
        type_text(text)
        device.header = ("UWaterloo ViVA Club", "")

    device.type_text = type_and_leave
    with pytest.raises(module.ThreadMismatch):
        _send_claim(device)
    assert device.sent == []


class _ComposerDevice:
    """A thread's composer: its hint while empty, a paste goes in at the cursor."""

    HINT = "Message…"

    def __init__(self, text="", cursor=None, delete_extra=0):
        self.text = text
        self.cursor = len(text) if cursor is None else cursor
        self.delete_extra = delete_extra
        self.cleared = False

    def find(self, pattern, nodes=None):
        shown = self.text or self.HINT
        return _node(shown, (158, 1365, 621, 1496), "row_thread_composer_edittext")

    def tap(self, node):
        pass

    def move_to_end(self):
        self.cursor = len(self.text)

    def paste(self):
        self.text = self.text[: self.cursor] + POST + self.text[self.cursor :]
        self.cursor += len(POST)

    def pause(self):
        pass

    def delete_backward(self, count):
        count += self.delete_extra
        self.text = self.text[: self.cursor - count] + self.text[self.cursor :]
        self.cursor -= count

    def clear_field(self):
        self.text, self.cursor, self.cleared = "", 0, True


def test_reading_a_shared_link_leaves_a_waiting_draft_as_it_was() -> None:
    waiting = "Hey! One small ask: https://tmu.wat2do.io/claim/abc Thank you!"
    device = _ComposerDevice(waiting)
    assert THREAD_READER(device, THREAD, lambda: None)._read_back_link() == POST
    assert device.text == waiting and not device.cleared


def test_a_link_pasted_inside_a_draft_is_taken_out_again() -> None:
    device = _ComposerDevice("Hey there, thanks!", cursor=4)
    device.move_to_end = lambda: None  # the cursor stays where the tap put it
    assert THREAD_READER(device, THREAD, lambda: None)._read_back_link() == POST
    assert device.text == "Hey there, thanks!"


def test_an_empty_composer_is_cleared_after_its_hint_was_replaced() -> None:
    device = _ComposerDevice()
    assert THREAD_READER(device, THREAD, lambda: None)._read_back_link() == POST
    assert device.cleared and device.text == ""


def test_a_draft_that_changes_while_the_link_is_read_fails_loudly() -> None:
    device = _ComposerDevice("Thanks for reaching out!", delete_extra=1)
    with pytest.raises(module.EmulatorError, match="unsent draft changed"):
        THREAD_READER(device, THREAD, lambda: None)._read_back_link()


def _thread(*messages):
    composer = _node("Message…", (158, 1365, 621, 1496), "row_thread_composer_edittext")
    return [_node("", (0, 275, 1080, 1431), "message_list"), *messages, composer]


def test_a_hint_under_our_reply_is_not_a_message() -> None:
    request = _node("could you share our post?", (179, 600, 882, 700))
    sent = _node("Just shared it!", (700, 1200, 1040, 1250))
    hint = _node("Tap and hold to imagine with AI. Try it", (600, 1270, 1040, 1310))
    assert _newest_is_ours(_thread(request, sent, hint), "just shared it!")


def test_a_banner_over_the_thread_is_not_a_message() -> None:
    request = _node("could you share our post?", (179, 400, 882, 550))
    sent = _node("Sure, send it here!", (354, 798, 1057, 1048))
    tray = _node("", (0, 1189, 1080, 1344), "message_composer_tray_container")
    banner = _node("Your notifications are off.", (364, 1238, 716, 1280))
    turn_on = _node("Turn on", (487, 1291, 593, 1333))
    chat = _thread(request, sent, tray, banner, turn_on)
    assert _newest_is_ours(chat, "sure, send it here!")


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


# Laurier Audiology Association's chat: their post bubble cut off at the top of the
# screen, with no owner and no media, under it their request, then our answer.
CUT_OFF_CHAT = [
    _node("Laurier Audiology Association", (304, 156, 650, 204), "header_title"),
    _node("", (304, 204, 650, 246), "header_subtitle", "Active 24m ago"),
    _node("", (0, 275, 1080, 2188), "message_list"),
    _node("", (147, 275, 777, 431), "xma_bubble_container"),
    _node("laurier_audiology_association HEAR ME OUT", (182, 305, 742, 396), "caption_title"),
    _node("Could you repost this on your story?", (179, 461, 882, 611)),
    _node("YESTERDAY 6:53 AM", (0, 718, 1080, 801)),
    _node("Sure, which post?", (850, 900, 1040, 950)),
    _node("This one!", (179, 1000, 400, 1050)),
]
# The same chat scrolled up: the post in full; our answer and the newest message are
# now below the screen.
REVEALED_CHAT = [
    _node("Laurier Audiology Association", (304, 156, 650, 204), "header_title"),
    _node("", (0, 275, 1080, 2188), "message_list"),
    _node("", (147, 581, 777, 1655), "xma_bubble_container"),
    _node("laurier_audiology_association", (289, 622, 751, 676), "title"),
    _node("", (147, 717, 777, 1494), "media_container"),
    _node("laurier_audiology_association HEAR ME OUT", (182, 1529, 742, 1620), "caption_title"),
    _node("Could you repost this on your story?", (179, 1685, 882, 1835)),
    _node("YESTERDAY 6:53 AM", (0, 1942, 1080, 2025)),
    _node("Sure, which post?", (850, 2124, 1040, 2174)),
]


class _ScrollingDevice:
    """Serves the thread's screen, each upward scroll showing the next screen up."""

    def __init__(self, *screens):
        self.screens = list(screens)
        self.scrolls = 0

    def screen(self):
        return self.screens[min(self.scrolls, len(self.screens) - 1)]

    def scroll_up(self):
        self.scrolls += 1


def _reader(device, monkeypatch):
    reader = THREAD_READER(device, "Laurier Audiology Association", lambda: None)
    links = []

    def shared_link(from_bottom, owner):
        links.append((device.scrolls, from_bottom, owner))
        return POST

    monkeypatch.setattr(reader, "_shared_link", shared_link)
    monkeypatch.setattr(reader, "_profile_username", lambda: "laurier_audiology_association")
    return reader, links


def test_a_share_cut_off_at_the_top_is_scrolled_into_view_and_read(monkeypatch) -> None:
    device = _ScrollingDevice(CUT_OFF_CHAT, CUT_OFF_CHAT, REVEALED_CHAT)
    reader, links = _reader(device, monkeypatch)
    thread = reader.read()
    assert [(m["from"], m["type"], m["text"]) for m in thread] == [
        ("them", "media_share", "HEAR ME OUT"),
        ("them", "text", "Could you repost this on your story?"),
        ("us", "text", "Sure, which post?"),
        ("them", "text", "This one!"),
    ]
    assert thread[0]["shared_owner"] == "laurier_audiology_association"
    assert thread[0]["shared_url"] == POST
    # Copied once the post shows its owner, as the newest share on that screen.
    assert links == [(2, 0, "laurier_audiology_association")]
    assert thread[-1]["sender"] == "laurier_audiology_association"


def test_a_share_that_never_shows_its_owner_is_left_unread(monkeypatch) -> None:
    device = _ScrollingDevice(CUT_OFF_CHAT)
    reader, links = _reader(device, monkeypatch)
    thread = reader.read()
    assert device.scrolls == module._REVEAL_SCROLLS and links == []
    assert len(thread) == 4 and thread[0]["shared_owner"] is None


def test_screens_join_where_the_lower_one_begins() -> None:
    lower = module._messages(CUT_OFF_CHAT)[1:]
    upper = module._messages(REVEALED_CHAT)
    assert module._start_of(lower, upper) == 1
    # Scrolled so far that nothing of the lower screen is left: nowhere to join.
    assert module._start_of(lower, upper[:1]) is None


class _ProfileDevice:
    def __init__(self, *, group=False):
        self.group = group
        self.backs = 0

    def find(self, pattern, nodes=None):
        return _node("Laurier Audiology Association", (304, 156, 650, 204), "header_title")

    def tap(self, node):
        pass

    def tap_when(self, pattern):
        if self.group:
            raise module.EmulatorError("no profile")

    def wait_for(self, pattern):
        return _node("laurier_audiology_association", (169, 128, 805, 275), "action_bar_title")

    def back(self):
        self.backs += 1


def test_an_online_sender_is_named_by_their_profile() -> None:
    device = _ProfileDevice()
    username = THREAD_READER(device, THREAD, lambda: None)._profile_username()
    assert username == "laurier_audiology_association"
    assert device.backs == 2


def test_a_group_chat_has_no_one_sender() -> None:
    device = _ProfileDevice(group=True)
    assert THREAD_READER(device, THREAD, lambda: None)._profile_username() is None
    assert device.backs == 1


def test_a_club_that_opts_out_is_left_out_once_by_its_plain_handle(monkeypatch) -> None:
    calls: list[tuple] = []

    class _Query:
        def upsert(self, row, **options):
            calls.append((row, options))
            return self

        def execute(self):
            return None

    tables: list[str] = []
    monkeypatch.setattr(
        module,
        "get_sb",
        lambda: type("Db", (), {"table": lambda _self, name: tables.append(name) or _Query()})(),
    )
    module.exclude_club("@UWViVA", reason="Asked in wat2do.uwaterloo's DMs")
    assert tables == ["instagram_excluded_clubs"]
    assert calls == [
        (
            {"ig_handle": "uwviva", "reason": "Asked in wat2do.uwaterloo's DMs"},
            {"on_conflict": "ig_handle", "ignore_duplicates": True},
        )
    ]


# The mcmaster chat of 2026-11-25 as the app drew it: our heart pills under their messages.
REACTED_CHAT = [
    _node("baddiesatmac", (304, 156, 556, 204), "header_title"),
    _node("", (0, 275, 1080, 2251), "message_list"),
    _node("NOV 19, 3:05 PM", (0, 1532, 1080, 1615)),
    _node("YAY love uuu💖💖", (179, 1673, 533, 1723)),
    _node("❤", (176, 1754, 223, 1801)),
    _node("Mentioned you in their story", (184, 1844, 596, 1882)),
    _node("❤", (176, 1972, 223, 2019)),
    _node("Thank you ❤️❤️", (710, 2088, 1027, 2138)),
]


def test_a_reaction_pill_belongs_to_the_message_above_it() -> None:
    messages = module._messages(REACTED_CHAT)
    assert [(m["from"], m["text"], m["reactions"]) for m in messages] == [
        ("them", "YAY love uuu💖💖", "❤"),
        ("them", "Mentioned you in their story", "❤"),
        ("us", "Thank you ❤️❤️", ""),
    ]


class _HeartDevice:
    def __init__(self, nodes, *, shows=True):
        self.nodes = list(nodes)
        self.shows = shows
        self.double_taps = []

    def screen(self):
        return self.nodes

    def double_tap(self, node):
        self.double_taps.append(node.text)
        if self.shows:
            x1, _y1, _x2, y2 = node.bounds
            self.nodes.append(_node("❤", (x1, y2 + 10, x1 + 47, y2 + 57)))

    def watch(self, look, seconds=None):
        return look(self.nodes)


HEART_CHAT = [
    _node(THREAD, (304, 156, 650, 204), "header_title"),
    _node("", (0, 275, 1080, 2251), "message_list"),
    _node("Sure, done!", (850, 1500, 1040, 1550)),
    _node("thank you so much!!", (179, 1700, 600, 1750)),
]


def test_a_heart_goes_on_their_newest_message_once() -> None:
    device = _HeartDevice(HEART_CHAT)
    assert _opened(device).heart() is True
    assert device.double_taps == ["thank you so much!!"]
    # The pill now shows, so a second heart does nothing.
    assert _opened(device).heart() is False
    assert device.double_taps == ["thank you so much!!"]


def test_a_heart_that_never_shows_fails() -> None:
    with pytest.raises(module.EmulatorError, match="did not show the heart"):
        _opened(_HeartDevice(HEART_CHAT, shows=False)).heart()


# angrygooseinuw's request from wat2do.brocku on 2026-11-26: the header shows the
# username, the prompt the display name a notification gives.
REQUEST = [
    _node("Back", (0, 128, 147, 275), "header_left_button"),
    _node("wat2do.brocku", (304, 156, 572, 204), "header_title"),
    _node("Business chat", (304, 204, 902, 246), "header_subtitle"),
    _node("", (0, 275, 1080, 1900), "message_list"),
    _node(
        "Accept message request from Wat2Do | Sharing events @ brocku",
        (42, 1910, 1038, 2001),
        "thread_disabled_title",
    ),
]


def test_a_request_is_named_by_its_prompt_and_then_by_its_username() -> None:
    assert module._names_thread(REQUEST, "Wat2Do | Sharing events @ brocku")
    assert module._names_thread(REQUEST, "wat2do.brocku")
    assert not module._names_thread(REQUEST, "Wat2Do | Sharing events @ utsg")
    # Accepted: the prompt is gone, and the username the header showed still names it.
    reader = module.ThreadReader(object(), "Wat2Do | Sharing events @ brocku", lambda: None)
    reader._require_thread(REQUEST)
    reader._require_thread(REQUEST[:4])
    with pytest.raises(module.ThreadMismatch):
        module.ThreadReader(
            object(), "Wat2Do | Sharing events @ brocku", lambda: None
        )._require_thread(REQUEST[:4])
