import pytest

from services.instagram_dms import decide as module

POST = "https://www.instagram.com/p/ABC123/"
THREAD = [
    {"from": "them", "type": "clip", "text": "", "shared_url": POST},
    {
        "from": "them",
        "type": "text",
        "text": "could you add this to your story?",
        "shared_url": None,
    },
]


def _answer(**overrides):
    return {
        "outcome": "story_repost",
        "media_url": POST,
        "reply": "Sure thing!",
        "done_reply": "All set!",
        "reason": "asked for a story repost",
        **overrides,
    }


def test_a_clear_story_request_keeps_the_models_wording() -> None:
    decision = module.checked(_answer(), THREAD)
    assert decision.outcome == "story_repost"
    assert decision.media_url == POST
    assert (decision.reply, decision.done_reply) == ("Sure thing!", "All set!")


def test_add_to_post_has_no_done_reply() -> None:
    decision = module.checked(_answer(outcome="add_to_post"), THREAD)
    assert decision.outcome == "add_to_post"
    assert decision.done_reply == ""


@pytest.mark.parametrize("outcome", ["ignore", "delete_account", None])
def test_anything_but_the_two_requests_is_ignored(outcome) -> None:
    assert module.checked(_answer(outcome=outcome), THREAD).outcome == "ignore"


def test_a_post_the_club_never_shared_is_ignored() -> None:
    decision = module.checked(_answer(media_url="https://www.instagram.com/p/OTHER/"), THREAD)
    assert decision.outcome == "ignore"


@pytest.mark.parametrize(
    "reply",
    ["visit https://spam.example", "thanks @someone", "x" * 200, ""],
)
def test_unsafe_or_overlong_wording_falls_back_to_a_short_human_reply(reply) -> None:
    decision = module.checked(_answer(reply=reply), THREAD)
    assert decision.reply in module._FALLBACK_REPLIES


def test_a_multi_line_reply_is_sent_as_one_line() -> None:
    assert module.checked(_answer(reply="Sure!\nOn it"), THREAD).reply == "Sure! On it"


def test_nothing_new_from_the_club_never_reaches_the_model(monkeypatch) -> None:
    monkeypatch.setattr(module, "run_agent", lambda *a, **k: pytest.fail("model must not run"))
    answered = [*THREAD, {"from": "us", "type": "text", "text": "Sure!", "shared_url": None}]
    assert module.decide(answered, account="wat2do.ubc", school_name="UBC") == module.IGNORE
    assert module.decide([], account="wat2do.ubc", school_name="UBC") == module.IGNORE


def test_a_model_failure_is_ignored_rather_than_answered(monkeypatch) -> None:
    def fail(*_args, **_kwargs):
        raise module.ClaudeCodeError("gave no answer")

    monkeypatch.setattr(module, "run_agent", fail)
    assert module.decide(THREAD, account="wat2do.ubc", school_name="UBC") == module.IGNORE


def test_the_thread_reaches_the_model_only_as_a_file(monkeypatch) -> None:
    seen = {}

    def run(prompt, **kwargs):
        seen["prompt"] = prompt
        seen["tools"] = kwargs["tools"]
        return _answer()

    monkeypatch.setattr(module, "run_agent", run)
    module.decide(THREAD, account="wat2do.ubc", school_name="UBC")
    assert "could you add this" not in seen["prompt"]
    assert seen["tools"] == ("Read",)
