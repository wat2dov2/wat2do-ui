import json
from types import SimpleNamespace

import pytest

from services.instagram_emulator.device import Node
from services.instagram_sessions import moves

TOKEN = "0f6b3c1e-1234-4c5d-9e8f-abcdefabcdef"


@pytest.fixture(autouse=True)
def sitting(monkeypatch, tmp_path):
    monkeypatch.setenv("WAT2DO_SITTING_SCHOOL", "tmu")
    monkeypatch.setenv("WAT2DO_SITTING_DIR", str(tmp_path))
    # The worker holds the emulator for the sitting; a move never takes the lock itself.
    monkeypatch.setenv("WAT2DO_EMULATOR_HELD", "1")
    monkeypatch.setattr(moves, "LOG_DIR", tmp_path / "log")
    monkeypatch.setattr(
        moves.school_service,
        "get_school",
        lambda slug: SimpleNamespace(id=7, name="Toronto Metropolitan University", language="en"),
    )


@pytest.mark.parametrize(
    "reply",
    [
        "follow @someone for more",
        "email me at someone@gmail.com",
        "click https://bit.ly/xyz",
        "your code is 123456",
        "x" * 400,
        "",
    ],
)
def test_unsafe_replies_are_refused(reply):
    assert moves.safe_reply(reply) is None


def test_a_safe_reply_is_plain_one_line_ascii():
    assert (
        moves.safe_reply("Just shared it,\n good luck! 🎉 Café")
        == "Just shared it, good luck! Cafe"
    )
    assert moves.safe_reply("email team@wat2do.io or see wat2do.io/events/submit")


class _Reader:
    drafts: list[str] = []
    thread: list[dict] = []

    def __init__(self, device, opener):
        self.stale = False

    def draft(self, text):
        _Reader.drafts.append(text)

    def read(self):
        return _Reader.thread


@pytest.fixture
def reader(monkeypatch):
    _Reader.drafts = []
    _Reader.thread = []
    monkeypatch.setattr(moves, "ThreadReader", _Reader)
    return _Reader


def _args(**values):
    return SimpleNamespace(**{"thread": "TMU Pre-Vet Club", "text": "", "claim": None, **values})


def test_a_claim_draft_types_the_link_but_never_prints_it(monkeypatch, reader):
    monkeypatch.setattr(moves, "claim_token", lambda handle: ("TMU Pre-Vet Club", TOKEN))
    result = moves.draft(object(), _args(text="happy to share it!", claim="tmuprevet"))
    (typed,) = reader.drafts
    assert typed.startswith("happy to share it! Hey! One small ask")
    assert f"https://tmu.wat2do.io/claim/{TOKEN}" in typed
    assert TOKEN not in json.dumps(result)


def test_a_draft_needs_something_to_type(reader):
    with pytest.raises(moves.MoveError, match="Nothing to type"):
        moves.draft(object(), _args())


def test_an_unsafe_reply_is_refused_before_anything_is_typed(reader):
    with pytest.raises(moves.MoveError, match="Refused"):
        moves.draft(object(), _args(text="dm @other for promo"))
    assert reader.drafts == []


class _Screen:
    def __init__(self, nodes):
        self.nodes = nodes
        self.tapped = []
        self.taps_at = []

    def screen(self):
        return self.nodes

    def tap(self, node):
        self.tapped.append(node.label)

    def adb(self, *args):
        self.taps_at.append(args)


SEND = Node("Send", "", (900, 1400, 1060, 1480))
OK = Node("OK", "", (400, 900, 680, 980))


@pytest.mark.parametrize("label", ["Send", "send", "Send post", "Send separately"])
def test_nothing_that_sends_can_be_tapped_by_label(label):
    device = _Screen([SEND, OK])
    with pytest.raises(moves.MoveError, match="Refused"):
        moves.tap(device, SimpleNamespace(at=None, label=label))
    assert device.tapped == []


def test_nothing_that_sends_can_be_tapped_by_point():
    device = _Screen([SEND, OK])
    with pytest.raises(moves.MoveError, match="Send button"):
        moves.tap(device, SimpleNamespace(at="950,1440", label=None))
    moves.tap(device, SimpleNamespace(at="500,940", label=None))
    moves.tap(device, SimpleNamespace(at=None, label="ok"))
    assert device.taps_at == [("shell", "input", "tap", "500", "940")]
    assert device.tapped == ["OK"]


def test_only_a_post_they_shared_in_the_thread_can_be_acted_on(monkeypatch, reader):
    post = "https://www.instagram.com/p/ABC123/"
    reader.thread = [{"from": "them", "shared_url": post, "shared_owner": "tmuprevet"}]
    requested = []
    monkeypatch.setattr(
        moves.items, "request_carousel", lambda url, *, school: requested.append((url, school))
    )
    assert moves.feature(object(), _args(post=post))["post"] == post
    with pytest.raises(moves.MoveError, match="not shared by them"):
        moves.feature(object(), _args(post="https://www.instagram.com/p/OTHER/"))
    reader.thread = [{"from": "us", "shared_url": post, "shared_owner": "wat2do.tmu"}]
    with pytest.raises(moves.MoveError, match="not shared by them"):
        moves.feature(object(), _args(post=post))
    assert requested == [(post, "tmu")]


def test_each_move_logs_its_times_and_never_message_text(monkeypatch, tmp_path, reader, capsys):
    reader.thread = [{"from": "them", "text": "secret words", "sender": "tmuprevet"}]

    class _Device:
        pass

    monkeypatch.setattr(moves, "EmulatorDevice", _Device)
    assert moves.main(["read", "TMU Pre-Vet Club"]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["messages"][0]["text"] == "secret words"
    (entry,) = [
        json.loads(line)
        for line in next((tmp_path / "log").glob("*.jsonl")).read_text().splitlines()
    ]
    assert entry["move"] == "read" and entry["ok"] and entry["started"] <= entry["ended"]
    assert "secret words" not in json.dumps(entry)


def test_a_refused_move_exits_nonzero_with_its_reason(monkeypatch, capsys, reader):
    monkeypatch.setattr(moves, "EmulatorDevice", object)
    assert moves.main(["draft", "TMU Pre-Vet Club", "--text", "dm @x"]) == 1
    assert "Refused" in json.loads(capsys.readouterr().out)["error"]
