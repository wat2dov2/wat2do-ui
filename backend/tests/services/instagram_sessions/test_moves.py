import json
from types import SimpleNamespace

import pytest

from services.instagram_emulator import direct as direct_module
from services.instagram_emulator.device import Node
from services.instagram_sessions import moves

TOKEN = "0f6b3c1e-1234-4c5d-9e8f-abcdefabcdef"
PRE_VET = moves.ClaimTarget(
    club_id=41,
    name="TMU Pre-Vet Club",
    handle="tmuprevet",
    token=TOKEN,
    tokens=frozenset({TOKEN}),
)


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
    sent: list[tuple] = []
    thread: list[dict] = []

    def __init__(self, device, thread, opener):
        self.stale = False

    def draft(self, text):
        _Reader.drafts.append(text)

    def send_claim(self, text, *, handle, tokens):
        _Reader.sent.append((text, handle, tokens))
        return "typed and sent the claim message"

    def read(self):
        return _Reader.thread


@pytest.fixture
def reader(monkeypatch):
    _Reader.drafts = []
    _Reader.sent = []
    _Reader.thread = []
    monkeypatch.setattr(moves, "ThreadReader", _Reader)
    return _Reader


@pytest.fixture
def claims_on(monkeypatch):
    """Claim messages as they were sent before 2026-11-25 switched them off."""
    monkeypatch.setattr(
        moves, "DMS", moves.DMS.model_copy(update={"claim_sends_per_account_per_day": 6})
    )


def _log_request_handled(hours_ago, move="share", thread="TMU Pre-Vet Club"):
    """Our sitting shared or featured the post this thread asked for, ``hours_ago``."""
    ended = moves.datetime.now(moves.timezone.utc) - moves.timedelta(hours=hours_ago)
    day = ended.astimezone(moves.TORONTO).date().isoformat()
    moves.LOG_DIR.mkdir(parents=True, exist_ok=True)
    with (moves.LOG_DIR / f"{day}.jsonl").open("a") as log:
        entry = {"school": "tmu", "move": move, "thread": thread, "ok": True}
        log.write(json.dumps({**entry, "ended": ended.isoformat()}) + "\n")


@pytest.fixture
def due(claims_on):
    """The Pre-Vet thread's request was handled a day ago, so its claim follow-up is due."""
    _log_request_handled(hours_ago=moves.DMS.claim_follow_up_hours + 4)


def _args(**values):
    return SimpleNamespace(**{"thread": "TMU Pre-Vet Club", "text": "", "claim": None, **values})


def test_a_claim_draft_types_the_link_but_never_prints_it(monkeypatch, reader):
    monkeypatch.setattr(moves, "claim_target", lambda handle: PRE_VET)
    result = moves.draft(object(), _args(text="happy to share it!", claim="tmuprevet"))
    (typed,) = reader.drafts
    assert typed.startswith("happy to share it! Hey! We're happy to keep featuring your events.")
    assert f"https://tmu.wat2do.io/claim/{TOKEN}" in typed
    assert TOKEN not in json.dumps(result)


def test_claims_stay_switched_off(monkeypatch, reader):
    # Off since 2026-11-25, when claims went into other clubs' threads.
    assert moves.DMS.claim_sends_per_account_per_day == 0
    monkeypatch.setattr(moves, "claim_target", lambda handle: PRE_VET)
    with pytest.raises(moves.MoveError, match="switched off"):
        moves.claim(object(), SimpleNamespace(thread="TMU Pre-Vet Club", username="tmuprevet"))
    assert reader.sent == []


def test_a_claim_sends_the_clubs_own_link_but_never_prints_it(monkeypatch, reader, due):
    monkeypatch.setattr(moves, "claim_target", lambda handle: PRE_VET)
    result = moves.claim(object(), SimpleNamespace(thread="TMU Pre-Vet Club", username="tmuprevet"))
    ((sent, handle, tokens),) = reader.sent
    # The reader checks the thread is the club's own and any waiting draft is its link.
    assert handle == "tmuprevet" and tokens == {TOKEN}
    assert "keep featuring your events" in sent and "claim your club" in sent
    assert f"https://tmu.wat2do.io/claim/{TOKEN}" in sent
    assert result["status"] == "typed and sent the claim message"
    assert TOKEN not in json.dumps(result)


def _log_claims(count, minutes_ago):
    moves.LOG_DIR.mkdir(parents=True, exist_ok=True)
    ended = moves.datetime.now(moves.timezone.utc) - moves.timedelta(minutes=minutes_ago)
    with (moves.LOG_DIR / f"{moves._today()}.jsonl").open("a") as log:
        for _ in range(count):
            log.write(
                json.dumps(
                    {"school": "tmu", "move": "claim", "ok": True, "ended": ended.isoformat()}
                )
                + "\n"
            )
        # Another school's sends and failed tries never count.
        log.write(
            json.dumps({"school": "uwo", "move": "claim", "ok": True, "ended": ended.isoformat()})
            + "\n"
        )
        log.write(
            json.dumps({"school": "tmu", "move": "claim", "ok": False, "ended": ended.isoformat()})
            + "\n"
        )


def test_an_account_sends_at_most_its_daily_claims(monkeypatch, reader, due):
    monkeypatch.setattr(moves, "claim_target", lambda handle: PRE_VET)
    _log_claims(moves.DMS.claim_sends_per_account_per_day, minutes_ago=60)
    with pytest.raises(moves.MoveError, match="for today"):
        moves.claim(object(), SimpleNamespace(thread="TMU Pre-Vet Club", username="tmuprevet"))
    assert reader.sent == []


def test_a_claim_waits_out_the_gap_after_the_last_send(monkeypatch, reader, due):
    monkeypatch.setattr(moves, "claim_target", lambda handle: PRE_VET)
    slept = []
    monkeypatch.setattr(moves.time, "sleep", slept.append)
    _log_claims(1, minutes_ago=0)
    moves.claim(object(), SimpleNamespace(thread="TMU Pre-Vet Club", username="tmuprevet"))
    (wait,) = slept
    assert moves.DMS.claim_send_gap_min_seconds - 5 <= wait <= moves.DMS.claim_send_gap_max_seconds
    assert len(reader.sent) == 1


class _Table:
    """One table of a fake database: filters by ``eq``, records inserts."""

    def __init__(self, rows, inserted):
        self.rows = rows
        self.inserted = inserted
        self.filters = {}
        self.row = None

    def select(self, *_columns):
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def ilike(self, *_args):
        return self

    def limit(self, _count):
        return self

    def insert(self, row):
        self.row = {**row, "claim_token": "new-token"}
        self.inserted.append(self.row)
        return self

    def execute(self):
        if self.row is not None:
            rows = [self.row]
        else:
            rows = [r for r in self.rows if all(r.get(k) == v for k, v in self.filters.items())]
        return SimpleNamespace(data=rows)


@pytest.fixture
def database(monkeypatch):
    tables = {
        "clubs": [
            {
                "id": 41,
                "school_id": 7,
                "club_name": "TMU Pre-Vet Club",
                "ig": "@TMUPreVet",
                "created_by": None,
            }
        ],
        "instagram_excluded_clubs": [],
        "club_members": [],
        "outreach_leads": [
            {"club_id": 41, "claim_token": "old-token", "status": "claimed"},
            {"club_id": 41, "claim_token": TOKEN, "status": "new"},
        ],
    }
    inserted: list[dict] = []
    db = SimpleNamespace(table=lambda name: _Table(tables[name], inserted))
    monkeypatch.setattr(moves, "get_sb", lambda: db)
    monkeypatch.setattr(direct_module, "get_sb", lambda: db)
    return SimpleNamespace(tables=tables, inserted=inserted)


def test_a_claim_target_carries_every_token_of_its_club(database):
    target = moves.claim_target("tmuprevet")
    assert (target.club_id, target.handle, target.token) == (41, "tmuprevet", TOKEN)
    assert target.tokens == {"old-token", TOKEN.casefold()}
    assert database.inserted == []


def test_a_club_that_asked_to_be_left_out_has_no_claim_target(database):
    database.tables["instagram_excluded_clubs"].append({"ig_handle": "tmuprevet"})
    with pytest.raises(moves.EmulatorError, match="left out"):
        moves.claim_target("tmuprevet")


def _log_sent_claim(day, result):
    moves.LOG_DIR.mkdir(parents=True, exist_ok=True)
    entry = {"school": "tmu", "move": "claim", "ok": True, "ended": f"{day}T15:00:00+00:00"}
    # Every move's log line names its thread, as `main` writes it.
    entry["thread"] = result["thread"]
    with (moves.LOG_DIR / f"{day}.jsonl").open("a") as log:
        log.write(json.dumps({**entry, "result": result}) + "\n")


@pytest.mark.parametrize(
    "handled",
    [
        # Nothing handled in this thread: a claim never goes out on its own.
        None,
        # Shared just now: the claim waits for the follow-up a day later.
        ("share", 1),
        ("feature", 1),
        # Shared a day ago, but in another thread.
        ("share", 30, "GiveBack"),
    ],
)
def test_a_claim_only_follows_up_a_day_after_the_request(monkeypatch, reader, claims_on, handled):
    if handled:
        move, hours, *thread = handled
        _log_request_handled(
            hours_ago=hours, move=move, thread=thread[0] if thread else "TMU Pre-Vet Club"
        )
    monkeypatch.setattr(moves, "claim_target", lambda handle: PRE_VET)
    with pytest.raises(moves.MoveError, match="Not due"):
        moves.claim(object(), SimpleNamespace(thread="TMU Pre-Vet Club", username="tmuprevet"))
    assert reader.sent == []


def test_a_featured_request_a_day_old_is_due_for_its_claim(monkeypatch, reader, claims_on):
    _log_request_handled(hours_ago=moves.DMS.claim_follow_up_hours + 1, move="feature")
    monkeypatch.setattr(moves, "claim_target", lambda handle: PRE_VET)
    moves.claim(object(), SimpleNamespace(thread="TMU Pre-Vet Club", username="tmuprevet"))
    assert len(reader.sent) == 1


def test_the_inbox_marks_threads_whose_claim_follow_up_is_due(monkeypatch, reader):
    def row(name, ours):
        return SimpleNamespace(
            name=name, preview="Sent 1d ago", age_days=1.0, unread=False, request=False, ours=ours
        )

    rows = [
        row("TMU Pre-Vet Club", True),
        # They wrote since our reply: a person answers first.
        row("GiveBack", False),
        # Shared only an hour ago.
        row("tmublueprint", True),
        # Already claimed.
        row("tmaps105", True),
        # Never asked for anything.
        row("iraniantmu", True),
    ]
    monkeypatch.setattr(
        moves, "read_inbox", lambda device, user, requests: [] if requests else rows
    )
    monkeypatch.setattr(moves, "user", lambda: 10)
    day = moves.DMS.claim_follow_up_hours + 4
    for thread, hours in (
        ("TMU Pre-Vet Club", day),
        ("GiveBack", day),
        ("tmublueprint", 1),
        ("tmaps105", day),
    ):
        _log_request_handled(hours_ago=hours, thread=thread)
    _log_sent_claim(moves._today(), {"thread": "tmaps105", "club_id": 9})
    listed = {
        thread["name"]: thread["claim_due"] for thread in moves.inbox(object(), _args())["threads"]
    }
    assert listed == {
        "TMU Pre-Vet Club": True,
        "GiveBack": False,
        "tmublueprint": False,
        "tmaps105": False,
        "iraniantmu": False,
    }


@pytest.mark.parametrize(
    "result",
    [
        # A send logged since 2026-11-25 names the club by its ID...
        {"thread": "tmuprevet", "claim_for": "Renamed Club", "club_id": 41},
        # ...and one logged before by its name only.
        {"thread": "TMU Pre-Vet Club", "claim_for": "TMU Pre-Vet Club"},
    ],
)
def test_a_club_is_sent_its_claim_message_once_ever(database, result):
    _log_sent_claim("2026-11-20", result)
    with pytest.raises(moves.MoveError, match="already sent"):
        moves.claim_target("tmuprevet")


def test_another_schools_or_a_failed_claim_does_not_count_as_sent(database):
    moves.LOG_DIR.mkdir(parents=True, exist_ok=True)
    with (moves.LOG_DIR / "2026-11-20.jsonl").open("a") as log:
        for school, ok in (("uwo", True), ("tmu", False)):
            entry = {
                "school": school,
                "move": "claim",
                "ok": ok,
                "ended": "2026-11-20T15:00:00+00:00",
            }
            log.write(json.dumps({**entry, "result": {"club_id": 41}}) + "\n")
    assert moves.claim_target("tmuprevet").club_id == 41


def test_a_sitting_never_sees_a_claim_link_it_reads(monkeypatch, reader):
    link = f"https://tmu.wat2do.io/claim/{TOKEN}"
    reader.thread = [{"from": "us", "text": f"Takes one click: {link} Thank you!"}]
    row = SimpleNamespace(
        name="TMU Pre-Vet Club",
        preview=f"You: Takes one click: {link}",
        age_days=0.5,
        unread=False,
        request=False,
        ours=True,
    )
    monkeypatch.setattr(moves, "read_inbox", lambda device, user, requests: [row])
    monkeypatch.setattr(moves, "user", lambda: 10)
    read = moves.read(object(), _args())
    listed = moves.inbox(object(), _args())
    assert read["messages"][0]["text"] == "Takes one click: [claim link] Thank you!"
    assert listed["threads"][0]["preview"] == "You: Takes one click: [claim link]"
    assert TOKEN not in json.dumps([read, listed])


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


def test_ig_stories_answers_and_logs_why_each_post_was_not_shared(monkeypatch, tmp_path, capsys):
    not_shared = {
        "https://www.instagram.com/p/AAA/": "The photo sticker did not move to the post's corner"
    }
    monkeypatch.setattr(moves, "EmulatorDevice", object)
    monkeypatch.setattr(moves, "_story_carousel", lambda: {"id": "batch-1"})
    monkeypatch.setattr(
        moves.stories,
        "share",
        lambda device, school, batch_id: moves.stories.Story(shared=2, total=3, failed=not_shared),
    )
    assert moves.main(["stories"]) == 0
    assert json.loads(capsys.readouterr().out) == {"shared": 2, "of": 3, "not_shared": not_shared}
    (entry,) = [
        json.loads(line)
        for line in next((tmp_path / "log").glob("*.jsonl")).read_text().splitlines()
    ]
    assert entry["move"] == "stories" and entry["result"]["not_shared"] == not_shared
