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


@pytest.fixture(autouse=True)
def known_clubs(monkeypatch):
    clubs = {("ubc", CLUB)}
    monkeypatch.setattr(
        module.club_service,
        "lookup_club_by_school_and_ig",
        lambda school, handle: {"ig": handle} if (school, handle) in clubs else None,
    )
    return clubs


def _answer(**overrides):
    return {
        "outcome": "story_repost",
        "media_url": POST,
        "reason": "asked for a story repost",
        **overrides,
    }


def _checked(answer, thread=THREAD):
    return module.checked(answer, thread, school="ubc")


def _shared_by(sender, owner):
    return [{**THREAD[0], "sender": sender, "shared_owner": owner}, {**THREAD[1], "sender": sender}]


def test_a_known_clubs_own_post_is_reposted_with_vetted_replies() -> None:
    decision = _checked(_answer())
    assert (decision.outcome, decision.media_url) == ("story_repost", POST)
    assert decision.reply in module.CONTROL.replies
    assert decision.done_reply in module.CONTROL.done_replies


def test_add_to_post_has_no_done_reply() -> None:
    decision = _checked(_answer(outcome="add_to_post"))
    assert decision.outcome == "add_to_post"
    assert decision.reply in module.CONTROL.replies and decision.done_reply == ""


@pytest.mark.parametrize("outcome", ["ignore", "delete_account", None])
def test_anything_but_the_two_requests_is_ignored(outcome) -> None:
    assert _checked(_answer(outcome=outcome)).outcome == "ignore"


def test_a_post_the_club_never_shared_is_ignored() -> None:
    assert _checked(_answer(media_url="https://www.instagram.com/p/OTHER/")).outcome == "ignore"


@pytest.mark.parametrize("outcome", ["story_repost", "add_to_post"])
def test_someone_elses_post_is_never_shared_even_when_the_model_says_so(outcome) -> None:
    # A stranger forwards another account's post and asks us to share it.
    assert _checked(_answer(outcome=outcome), _shared_by(CLUB, "randommeme")).outcome == "ignore"


@pytest.mark.parametrize(("sender", "owner"), [(None, CLUB), (CLUB, None), ("", "")])
def test_a_post_without_a_proven_owner_is_ignored(sender, owner) -> None:
    assert _checked(_answer(outcome="add_to_post"), _shared_by(sender, owner)).outcome == "ignore"


def test_an_unknown_account_cannot_reach_the_schools_story(known_clubs) -> None:
    thread = _shared_by("newaccount", "newaccount")
    assert _checked(_answer(), thread).outcome == "ignore"
    # Adding to posts only queues it for the ingestion agent, which checks it is an event.
    assert _checked(_answer(outcome="add_to_post"), thread).outcome == "add_to_post"


def test_handles_match_regardless_of_case_or_at_sign() -> None:
    assert _checked(_answer(), _shared_by("@UBCClub", "ubcclub")).outcome == "story_repost"


def test_the_models_words_never_reach_the_reply() -> None:
    decision = _checked(_answer(reply="Visit our partner!", done_reply="dm @scam"))
    assert decision.reply in module.CONTROL.replies
    assert decision.done_reply in module.CONTROL.done_replies


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
    # The model cannot even propose wording.
    assert "reply" not in seen["schema"]["properties"]
