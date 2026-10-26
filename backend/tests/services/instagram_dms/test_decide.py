import pytest

from services.instagram_dms import decide as module

POST = "https://www.instagram.com/p/ABC123/"
CLUB = "ubcclub"
THREAD = [
    {
        "from": "them",
        "sender": CLUB,
        "type": "clip",
        "text": "",
        "shared_url": POST,
        "shared_owner": CLUB,
    },
    {
        "from": "them",
        "sender": CLUB,
        "type": "text",
        "text": "could you add this to your story?",
        "shared_url": None,
        "shared_owner": None,
    },
]


def _answer(**overrides):
    return {
        "outcome": "story_repost",
        "media_url": POST,
        "reply": "just shared it, good luck!",
        "reason": "asked for a story repost",
        **overrides,
    }


def _checked(answer, thread=THREAD):
    return module.checked(answer, thread)


def _shared_by(sender, owner):
    return [{**THREAD[0], "sender": sender, "shared_owner": owner}, {**THREAD[1], "sender": sender}]


def test_a_shared_post_is_reposted_with_the_models_reply() -> None:
    decision = _checked(_answer())
    assert (decision.outcome, decision.media_url) == ("story_repost", POST)
    assert decision.reply == "just shared it, good luck!"


def test_a_plain_reply_needs_no_shared_post() -> None:
    decision = _checked(_answer(outcome="reply", media_url=None, reply="send us the post here!"))
    assert (decision.outcome, decision.reply, decision.media_url) == (
        "reply",
        "send us the post here!",
        None,
    )


@pytest.mark.parametrize("outcome", ["ignore", "delete_account", None])
def test_unknown_outcomes_are_ignored(outcome) -> None:
    assert _checked(_answer(outcome=outcome)).outcome == "ignore"


def test_a_post_the_club_never_shared_is_ignored() -> None:
    assert _checked(_answer(media_url="https://www.instagram.com/p/OTHER/")).outcome == "ignore"


def test_any_account_can_reach_the_schools_story() -> None:
    # An exec forwards their club's post, or an account we do not list shares its own.
    for sender, owner in [("someexec", CLUB), ("newaccount", "newaccount")]:
        assert _checked(_answer(), _shared_by(sender, owner)).outcome == "story_repost"


def test_any_account_can_ask_for_a_carousel_spot() -> None:
    # The admin reviews every carousel, so a forwarded post is as good as the club's own.
    for sender, owner in [("someexec", CLUB), (None, CLUB)]:
        assert _checked(_answer(outcome="feature"), _shared_by(sender, owner)).outcome == "feature"


@pytest.mark.parametrize("outcome", ["story_repost", "feature"])
@pytest.mark.parametrize("owner", [None, ""])
def test_a_post_without_a_readable_owner_is_ignored(outcome, owner) -> None:
    assert _checked(_answer(outcome=outcome), _shared_by(CLUB, owner)).outcome == "ignore"


def test_a_correction_needs_no_shared_post() -> None:
    decision = _checked(_answer(outcome="correction", media_url=None, reply="thanks, will fix it"))
    assert (decision.outcome, decision.media_url) == ("correction", None)


def test_an_opt_out_needs_to_know_whose_club_to_leave_out() -> None:
    opt_out = _answer(outcome="opt_out", media_url=None, reply="got it, we will stop")
    assert _checked(opt_out, _shared_by("@UBCClub", CLUB)).outcome == "opt_out"
    assert module.sender(_shared_by("@UBCClub", CLUB)) == "ubcclub"
    assert _checked(opt_out, _shared_by(None, CLUB)).outcome == "ignore"


def test_a_correction_carries_only_what_they_wrote_since_our_last_message() -> None:
    thread = [
        {"from": "them", "text": "old news"},
        {"from": "us", "text": "done!"},
        {"from": "them", "text": "the swap moved to oct 21"},
        {"from": "them", "text": "", "shared_url": POST},
        {"from": "them", "text": "10am to 2:30pm"},
    ]
    assert module.their_latest_words(thread) == "the swap moved to oct 21\n10am to 2:30pm"


@pytest.mark.parametrize(
    "reply",
    [
        "dm @scam for a collab",
        "email us at someone@gmail.com",
        "check out https://evil.example/win",
        "visit bit.ly/free",
        "call 4165550123",
        "",
        None,
        "x" * 301,
    ],
)
def test_an_unsafe_reply_means_no_answer_at_all(reply) -> None:
    assert _checked(_answer(reply=reply)).outcome == "ignore"
    assert _checked(_answer(outcome="reply", reply=reply)).outcome == "ignore"


@pytest.mark.parametrize(
    ("reply", "typed"),
    [
        (
            "you can submit it at wat2do.io/events/submit!",
            "you can submit it at wat2do.io/events/submit!",
        ),
        ("check https://ubc.wat2do.io.", "check https://ubc.wat2do.io."),
        ("c'est fait, bonne soiree  \n a bientot", "c'est fait, bonne soiree a bientot"),
        ("c\u2019est partag\u00e9 \U0001f389", "c'est partage"),
        ("email team@wat2do.io about that", "email team@wat2do.io about that"),
    ],
)
def test_a_safe_reply_is_one_typeable_line(reply, typed) -> None:
    assert module.safe_reply(reply) == typed


def test_nothing_new_from_the_club_never_reaches_the_model(monkeypatch) -> None:
    monkeypatch.setattr(module, "run_agent", lambda *a, **k: pytest.fail("model must not run"))
    answered = [
        *THREAD,
        {
            "from": "us",
            "sender": None,
            "type": "text",
            "text": "Sure!",
            "shared_url": None,
            "shared_owner": None,
        },
    ]
    assert (
        module.decide(answered, account="wat2do.ubc", school="ubc", school_name="UBC")
        == module.IGNORE
    )
    assert module.decide([], account="wat2do.ubc", school="ubc", school_name="UBC") == module.IGNORE


def test_a_model_failure_is_ignored_rather_than_answered(monkeypatch) -> None:
    def fail(*_args, **_kwargs):
        raise module.ClaudeCodeError("gave no answer")

    monkeypatch.setattr(module, "run_agent", fail)
    assert (
        module.decide(THREAD, account="wat2do.ubc", school="ubc", school_name="UBC")
        == module.IGNORE
    )


def test_the_thread_reaches_the_model_only_as_a_file(monkeypatch) -> None:
    seen = {}

    def run(prompt, **kwargs):
        seen["prompt"] = prompt
        seen["tools"] = kwargs["tools"]
        seen["schema"] = kwargs["schema"]
        return _answer()

    monkeypatch.setattr(module, "run_agent", run)
    module.decide(THREAD, account="wat2do.ubc", school="ubc", school_name="UBC")
    assert "could you add this" not in seen["prompt"]
    assert seen["tools"] == ("Read",)
    assert "https://ubc.wat2do.io" in seen["prompt"] and "{{" not in seen["prompt"]
