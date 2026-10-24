from unittest.mock import Mock

import pytest

from services.instagram_publishing import curation


def _packet(events=None):
    return {
        "account_key": "uwaterloo",
        "window_end": "2026-10-12T13:00:00+00:00",
        "caption_intro": "Fresh events at uwaterloo",
        "status": "needs_review",
        "events": [{"id": 17, "title": "Pizza Night"}] if events is None else events,
        "excluded_clubs": [],
    }


def _answer(**overrides):
    return {
        "picks": [{"event_id": 17, "sticker_labels": ["Free Pizza"]}],
        "cover_body": "Pizza Night with free slices.",
        "caption_intro": "",
        "notes": "",
        **overrides,
    }


@pytest.fixture
def saved(monkeypatch):
    save = Mock(return_value={"outcome": "saved"})
    monkeypatch.setattr(curation, "save_review_draft", save)
    monkeypatch.setattr(curation, "_write_packet", lambda *args: None)
    return save


def test_answer_is_saved(monkeypatch, saved):
    monkeypatch.setattr(curation, "_run", lambda prompt, workdir: _answer())
    assert curation.curate_school(_packet()) == "saved"
    selection = saved.call_args.args[0]
    assert selection.picks[0].event_id == 17
    assert selection.caption_intro == "Fresh events at uwaterloo"


def test_rejected_answer_is_retried_with_the_reason(monkeypatch, saved):
    prompts = []
    lowercase = [{"event_id": 17, "sticker_labels": ["free pizza"]}]
    answers = iter([_answer(picks=lowercase), _answer()])
    monkeypatch.setattr(
        curation, "_run", lambda prompt, workdir: prompts.append(prompt) or next(answers)
    )
    assert curation.curate_school(_packet()) == "saved"
    assert "Sticker words must start with capital letters" in prompts[1]


def test_repeated_rejection_fails_without_saving(monkeypatch, saved):
    lowercase = [{"event_id": 17, "sticker_labels": ["free pizza"]}]
    monkeypatch.setattr(curation, "_run", lambda prompt, workdir: _answer(picks=lowercase))
    with pytest.raises(ValueError):
        curation.curate_school(_packet())
    saved.assert_not_called()


def test_school_without_events_saves_empty_draft_without_claude(monkeypatch, saved):
    run = Mock()
    monkeypatch.setattr(curation, "_run", run)
    assert curation.curate_school(_packet(events=[])) == "saved"
    run.assert_not_called()
    assert saved.call_args.args[0].picks == []


def test_curate_all_counts_outcomes_and_skips_existing_drafts(monkeypatch):
    monkeypatch.setattr(curation, "remove_leftovers", lambda prefix: None)
    monkeypatch.setattr(curation, "refresh_expiring_tokens", lambda: {"failed": 0})
    monkeypatch.setattr(
        curation,
        "list_draft_candidates",
        lambda: [_packet(), {**_packet(), "account_key": "uoft"}, {"status": "published"}],
    )
    outcomes = {"uwaterloo": "saved"}

    def curate(packet):
        if packet["account_key"] not in outcomes:
            raise RuntimeError("agent failed")
        return outcomes[packet["account_key"]]

    monkeypatch.setattr(curation, "curate_school", curate)
    assert curation.curate_all() == {"saved": 1, "failed": 1}
