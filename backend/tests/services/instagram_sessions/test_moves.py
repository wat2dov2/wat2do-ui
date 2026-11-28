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
    replies: list[str] = []
    sent: list[tuple] = []
    hearts: list[str] = []
    thread: list[dict] = []

    def __init__(self, device, school, thread, opener):
        self.stale = False
        self.name = thread

    def send_reply(self, text):
        _Reader.replies.append(text)
        _Reader.thread = [*_Reader.thread, {"from": "us", "text": text}]

    def heart(self):
        _Reader.hearts.append(self.name)
        return True

    def send_claim(self, text, *, handle, tokens):
        _Reader.sent.append((text, handle, tokens))
        return "typed and sent the claim message"

    def read(self):
        return _Reader.thread


@pytest.fixture
def reader(monkeypatch):
    _Reader.replies = []
    _Reader.sent = []
    _Reader.hearts = []
    _Reader.thread = []
    monkeypatch.setattr(moves, "ThreadReader", _Reader)
    monkeypatch.setattr(moves, "refuse_if_excluded", lambda handle: None)
    monkeypatch.setattr(moves.time, "sleep", lambda seconds: None)
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


def test_a_zero_daily_claim_limit_switches_claims_off(monkeypatch, reader):
    monkeypatch.setattr(
        moves, "DMS", moves.DMS.model_copy(update={"claim_sends_per_account_per_day": 0})
    )
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


def test_an_unsafe_reply_is_refused_before_anything_is_typed(reader):
    with pytest.raises(moves.MoveError, match="Refused"):
        moves.reply(object(), _args(text="dm @other for promo"))
    assert reader.replies == []


class _Calm:
    """An emulator showing no challenge."""

    def challenge(self):
        return None


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

    monkeypatch.setattr(moves, "EmulatorDevice", _Calm)
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
    monkeypatch.setattr(moves, "EmulatorDevice", _Calm)
    assert moves.main(["reply", "TMU Pre-Vet Club", "--text", "dm @x"]) == 1
    assert "Refused" in json.loads(capsys.readouterr().out)["error"]


def test_a_french_school_sends_no_dm_and_logs_no_text(monkeypatch, tmp_path, capsys, reader):
    monkeypatch.setenv("WAT2DO_SITTING_SCHOOL", "udem")
    monkeypatch.setattr(
        moves.school_service, "get_school", lambda slug: SimpleNamespace(id=3, language="fr")
    )
    reader.thread = [{"from": "them", "text": "merci!", "sender": "clubudem"}]
    monkeypatch.setattr(moves, "EmulatorDevice", _Calm)
    assert moves.main(["reply", "Club UdeM", "--text", "Avec plaisir!"]) == 1
    assert json.loads(capsys.readouterr().out) == {"error": "no DMs on French schools"}
    assert moves.main(["claim", "Club UdeM", "clubudem"]) == 1
    assert json.loads(capsys.readouterr().out) == {"error": "no DMs on French schools"}
    assert reader.replies == [] and reader.sent == []
    logged = next((tmp_path / "log").glob("*.jsonl")).read_text()
    assert "Avec plaisir" not in logged and "merci" not in logged
    # Its sitting is never told a claim follow-up is due.
    _log_request_handled(hours_ago=moves.DMS.claim_follow_up_hours + 4, thread="Club UdeM")
    row = SimpleNamespace(
        name="Club UdeM", preview="", age_days=1.0, unread=False, request=False, ours=True
    )
    monkeypatch.setattr(
        moves, "read_inbox", lambda device, user, requests: [] if requests else [row]
    )
    monkeypatch.setattr(moves, "user", lambda: 10)
    assert moves.inbox(object(), _args())["threads"][0]["claim_due"] is False


def test_ig_stories_answers_and_logs_why_each_post_was_not_shared(monkeypatch, tmp_path, capsys):
    not_shared = {
        "https://www.instagram.com/p/AAA/": "The photo sticker did not move to the post's corner"
    }
    monkeypatch.setattr(moves, "EmulatorDevice", _Calm)
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


# --- the notification agent's moves ------------------------------------------------


@pytest.fixture
def agent(monkeypatch, tmp_path, reader):
    monkeypatch.setattr(moves.notification, "STATE_DIR", tmp_path / "agent")
    monkeypatch.setattr(moves.notification, "_PAUSED", tmp_path / "agent" / "paused.json")
    monkeypatch.setattr(moves, "EmulatorDevice", _Calm)
    return reader


def _logged(move, thread="TMU Pre-Vet Club", minutes_ago=5, **extra):
    moves.LOG_DIR.mkdir(parents=True, exist_ok=True)
    ended = moves.datetime.now(moves.timezone.utc) - moves.timedelta(minutes=minutes_ago)
    entry = {
        "school": "tmu",
        "move": move,
        "thread": thread,
        "ok": True,
        "ended": ended.isoformat(),
    }
    with (moves.LOG_DIR / f"{moves._today()}.jsonl").open("a") as log:
        log.write(json.dumps({**entry, **extra}) + "\n")


def test_a_reply_answers_each_message_of_theirs_once(agent, capsys):
    agent.thread = [{"from": "them", "text": "can you repost this?", "sender": "tmuprevet"}]
    assert moves.main(["reply", "TMU Pre-Vet Club", "--text", "Sure, done!"]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "thread": "TMU Pre-Vet Club",
        "status": "reply sent",
    }
    # Our reply is now the newest message: nothing more until they write again.
    assert moves.main(["reply", "TMU Pre-Vet Club", "--text", "Done again!"]) == 1
    assert "already answered" in json.loads(capsys.readouterr().out)["error"]
    # A follow-up question the same day gets its own answer.
    agent.thread = [*agent.thread, {"from": "them", "text": "how do we submit an event?"}]
    assert moves.main(["reply", "TMU Pre-Vet Club", "--text", "At wat2do.io/submit"]) == 0
    assert agent.replies == ["Sure, done!", "At wat2do.io/submit"]
    # The log keeps when it was sent, never what.
    assert "Sure, done!" not in next(moves.LOG_DIR.glob("*.jsonl")).read_text()


def test_a_thread_gets_at_most_its_daily_replies(agent):
    agent.thread = [{"from": "them", "text": "one more question", "sender": "tmuprevet"}]
    for _ in range(moves.DMS.replies_per_thread_per_day):
        _logged("reply")
    with pytest.raises(moves.MoveError, match="replies today"):
        moves.reply(_Calm(), _args(text="Sure!"))
    assert agent.replies == []


def test_an_account_sends_at_most_its_daily_replies(agent):
    for number in range(moves.DMS.replies_per_account_per_day):
        _logged("reply", thread=f"club {number}")
    with pytest.raises(moves.MoveError, match="for today"):
        moves.reply(_Calm(), _args(text="Sure, done!"))
    assert agent.replies == []


@pytest.mark.parametrize(
    "words",
    [
        "please stop featuring our events",
        "Can you ask us first before you post?",
        "We don't want to be tracked, remove us",
        "please take this down",
        "Merci d'arreter de partager nos evenements",
    ],
)
def test_a_thread_that_asked_to_be_left_out_gets_nothing(agent, words):
    agent.thread = [{"from": "them", "text": words, "sender": "tmuprevet"}]
    for move, args in (
        (moves.reply, _args(text="Sure, done!")),
        (moves.heart, _args()),
        (moves.accept, _args()),
        (moves.boost, _args(post="https://www.instagram.com/p/ABC123/")),
    ):
        with pytest.raises(moves.MoveError, match="left out"):
            move(_Calm(), args)
    assert agent.replies == [] and agent.hearts == []


def test_an_opt_out_is_acknowledged_once(agent):
    agent.thread = [{"from": "them", "text": "please stop featuring us", "sender": "tmuprevet"}]
    _logged("opt-out")
    moves.reply(_Calm(), _args(text="Got it, sorry about that!"))
    assert agent.replies == ["Got it, sorry about that!"]


def test_an_excluded_club_gets_nothing(agent, monkeypatch):
    agent.thread = [{"from": "them", "text": "can you repost this?", "sender": "tmuprevet"}]

    def refuse(handle):
        if handle == "tmuprevet":
            raise moves.LeftOut("left out")

    monkeypatch.setattr(moves, "refuse_if_excluded", refuse)
    with pytest.raises(moves.MoveError, match="left out"):
        moves.heart(_Calm(), _args())


def test_a_heart_goes_once_to_the_thread_asked_for(agent):
    agent.thread = [{"from": "them", "text": "thank you!!", "sender": "tmuprevet"}]
    moves.heart(_Calm(), _args())
    _logged("heart")
    with pytest.raises(moves.MoveError, match="already got a heart"):
        moves.heart(_Calm(), _args())
    assert agent.hearts == ["TMU Pre-Vet Club"]


def test_a_post_is_boosted_once(agent, monkeypatch):
    post = "https://www.instagram.com/p/ABC123/"
    agent.thread = [{"from": "them", "shared_url": post, "shared_owner": "tmuprevet"}]
    done = []
    monkeypatch.setattr(moves, "like_and_repost", lambda device, user, url: done.append("liked"))
    monkeypatch.setattr(moves.items, "request_carousel", lambda url, *, school: done.append(url))
    monkeypatch.setattr(moves, "share_to_story", lambda device, school, url: done.append("story"))
    monkeypatch.setattr(moves, "user", lambda: 10)

    class _Roomy(_Calm):
        def free_data_megabytes(self):
            return 10_000

    result = moves.boost(_Roomy(), _args(post=post))
    assert result == {"status": "shared to the story", "post": post, "liked_and_reposted": True}
    assert done == ["liked", post, "story"]
    _logged("boost", post=post)
    with pytest.raises(moves.MoveError, match="already boosted"):
        moves.boost(_Roomy(), _args(post=post))
    # A post a sitting shared to the story counts too.
    other = "https://www.instagram.com/p/SHARED/"
    agent.thread = [{"from": "them", "shared_url": other, "shared_owner": "tmuprevet"}]
    _logged("share", result={"post": other})
    with pytest.raises(moves.MoveError, match="already boosted"):
        moves.boost(_Roomy(), _args(post=other))


def test_a_challenge_stops_the_move_and_rests_the_account(agent, monkeypatch, capsys):
    class _Challenged:
        def challenge(self):
            return "Confirm you're human to use your account"

    monkeypatch.setattr(moves, "EmulatorDevice", _Challenged)
    assert moves.main(["heart", "TMU Pre-Vet Club"]) == 1
    assert "Stopped" in json.loads(capsys.readouterr().out)["error"]
    assert moves.notification.paused_until("tmu") is not None
    # Every move that acts waits out the rest; looking still works.
    monkeypatch.setattr(moves, "EmulatorDevice", _Calm)
    assert moves.main(["reply", "TMU Pre-Vet Club", "--text", "hi"]) == 1
    assert "paused until" in json.loads(capsys.readouterr().out)["error"]
    assert moves.main(["read", "TMU Pre-Vet Club"]) == 0


def test_a_dry_run_reads_the_recording_and_touches_nothing(monkeypatch, tmp_path, capsys):
    recording = tmp_path / "thread.json"
    post = "https://www.instagram.com/p/ABC123/"
    recording.write_text(
        json.dumps(
            {
                "thread": "TMU Pre-Vet Club",
                "messages": [
                    {
                        "from": "them",
                        "text": "repost pls",
                        "shared_url": post,
                        "shared_owner": "tmuprevet",
                    }
                ],
                "inbox": [],
            }
        )
    )
    monkeypatch.setenv(moves.notification.DRY_RUN, str(recording))
    monkeypatch.setattr(moves, "EmulatorDevice", None)
    assert moves.main(["read", "TMU Pre-Vet Club"]) == 0
    assert json.loads(capsys.readouterr().out)["messages"][0]["text"] == "repost pls"
    assert moves.main(["boost", "TMU Pre-Vet Club", "--post", post]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "boost done"
    assert (
        moves.main(["boost", "TMU Pre-Vet Club", "--post", "https://www.instagram.com/p/X/"]) == 0
    )
    assert "not shared by them" in json.loads(capsys.readouterr().out)["error"]
    assert json.loads(recording.read_text())["done"] == ["boost"]
    assert not moves.LOG_DIR.exists()


def test_a_notification_run_never_sends_a_claim(monkeypatch, capsys, reader):
    monkeypatch.setenv(moves.notification.RUN, "1")
    monkeypatch.setattr(moves, "EmulatorDevice", _Calm)
    assert moves.main(["claim", "TMU Pre-Vet Club", "tmuprevet"]) == 1
    assert "follow-up" in json.loads(capsys.readouterr().out)["error"]
    assert reader.sent == []


def test_ig_milestone_story_is_turned_off(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(moves, "EmulatorDevice", _Calm)
    monkeypatch.setattr(moves.milestones, "post_story", lambda *a, **k: calls.append(k))
    assert moves.main(["milestone-story", "--followers", "200"]) == 1
    assert json.loads(capsys.readouterr().out) == {"error": "Milestone stories are turned off"}
    assert calls == []


@pytest.fixture
def correction_setup(monkeypatch, reader):
    from datetime import datetime as real_datetime
    from datetime import timezone as utc_zone
    from uuid import uuid4

    reader.thread = [{"from": "them", "text": "the date is wrong", "sender": "tmuprevet"}]
    monkeypatch.setattr(
        moves.school_service,
        "get_school",
        lambda slug: SimpleNamespace(id=7, timezone="America/Toronto", name="TMU", language="en"),
    )
    monkeypatch.setattr(
        moves, "_club_events", lambda handle: [{"id": 5}] if handle == "tmuprevet" else []
    )
    first = SimpleNamespace(
        id=uuid4(),
        dtstart_utc=real_datetime(2026, 12, 1, 23, 0, tzinfo=utc_zone.utc),
        dtend_utc=real_datetime(2026, 12, 2, 1, 0, tzinfo=utc_zone.utc),
        duration=None,
        tz="America/Toronto",
    )
    monkeypatch.setattr(
        moves.event_service, "get_event", lambda event_id: SimpleNamespace(occurrences=[first])
    )
    updates = []
    monkeypatch.setattr(
        moves.event_service,
        "update_event_and_occurrences",
        lambda event_id, patch, occurrences: updates.append((event_id, patch, occurrences)),
    )
    revalidated = []
    monkeypatch.setattr(
        moves.event_feed_revalidation_service,
        "revalidate_schools",
        lambda schools, resources: revalidated.append(schools),
    )
    return SimpleNamespace(first=first, updates=updates, revalidated=revalidated)


def _fix(**values):
    base = {
        "thread": "TMU Pre-Vet Club",
        "event": 5,
        "title": None,
        "location": None,
        "start": None,
        "end": None,
        "cancelled": False,
    }
    return SimpleNamespace(**{**base, **values})


def test_a_correction_moves_the_event_through_the_apps_own_edit(correction_setup):
    result = moves.fix_event(object(), _fix(start="2026-12-03T19:00", location="SLC 201"))
    ((event_id, patch, (moved,)),) = correction_setup.updates
    assert event_id == 5
    assert patch == {"location": "SLC 201", "map_location": None}
    # 7 PM Toronto is midnight UTC, and the event keeps its two hours.
    assert moved.id == correction_setup.first.id
    assert moved.dtstart_utc.isoformat() == "2026-12-04T00:00:00+00:00"
    assert moved.dtend_utc.isoformat() == "2026-12-04T02:00:00+00:00"
    assert result == {"event": 5, "fixed": ["dates", "location", "map_location"]}
    assert correction_setup.revalidated == [["tmu"]]


def test_a_correction_only_touches_the_senders_own_events(correction_setup):
    with pytest.raises(moves.MoveError, match="not one of tmuprevet's events"):
        moves.fix_event(object(), _fix(event=6, title="Something else"))
    assert correction_setup.updates == []


def test_a_correction_needs_something_to_fix(correction_setup):
    with pytest.raises(moves.MoveError, match="Nothing to fix"):
        moves.fix_event(object(), _fix())
