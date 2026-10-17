import json
from unittest.mock import Mock

import pytest

from services.instagram_publishing import curation

CHART = {"name": "Top 100: Canada", "url": "https://music.apple.com/ca/playlist/top-100"}
TRACKS = [{"title": "Song A", "artist": "Artist A"}, {"title": "Song B", "artist": "Artist B"}]


def _packet(events=None):
    return {
        "account_key": "uwaterloo",
        "window_end": "2026-10-12T13:00:00+00:00",
        "caption_intro": "Fresh events at uwaterloo",
        "status": "needs_review",
        "music_chart": CHART,
        "recent_songs": [],
        "events": [{"id": 17, "title": "Pizza Night"}] if events is None else events,
        "excluded_clubs": [],
    }


def _answer(**overrides):
    return {
        "picks": [{"event_id": 17, "sticker_labels": ["Free Pizza"]}],
        "cover_body": "Pizza Night with free slices.",
        "caption_intro": "",
        "song_number": 1,
        "notes": "",
        **overrides,
    }


@pytest.fixture
def saved(monkeypatch):
    save = Mock(return_value={"outcome": "saved"})
    monkeypatch.setattr(curation, "save_review_draft", save)
    monkeypatch.setattr(curation, "_write_packet", lambda *args: None)
    return save


def test_answer_is_saved_with_the_chosen_chart_song(monkeypatch, saved):
    monkeypatch.setattr(curation, "_run", lambda prompt, workdir: _answer())
    assert curation.curate_school(_packet(), TRACKS) == "saved"
    selection = saved.call_args.args[0]
    assert selection.picks[0].event_id == 17
    assert selection.caption_intro == "Fresh events at uwaterloo"
    assert selection.suggested_song.title == "Song B"
    assert selection.suggested_song.chart_name == "Top 100: Canada"


def test_rejected_answer_is_retried_with_the_reason(monkeypatch, saved):
    prompts = []
    answers = iter([_answer(song_number=9), _answer(song_number=None)])
    monkeypatch.setattr(
        curation, "_run", lambda prompt, workdir: prompts.append(prompt) or next(answers)
    )
    assert curation.curate_school(_packet(), TRACKS) == "saved"
    assert "song_number must be between 0 and 1" in prompts[1]
    assert saved.call_args.args[0].suggested_song is None


def test_repeated_rejection_fails_without_saving(monkeypatch, saved):
    monkeypatch.setattr(curation, "_run", lambda prompt, workdir: _answer(song_number=9))
    with pytest.raises(ValueError):
        curation.curate_school(_packet(), TRACKS)
    saved.assert_not_called()


def test_school_without_events_saves_empty_draft_without_claude(monkeypatch, saved):
    run = Mock()
    monkeypatch.setattr(curation, "_run", run)
    assert curation.curate_school(_packet(events=[]), TRACKS) == "saved"
    run.assert_not_called()
    assert saved.call_args.args[0].picks == []


def test_unreadable_chart_offers_previous_verified_songs():
    previous = {
        **TRACKS[0],
        "chart_name": CHART["name"],
        "chart_url": CHART["url"],
        "checked_on": "2026-10-10",
    }
    assert curation.offered_songs({**_packet(), "recent_songs": [previous]}, None) == [previous]


def test_chart_tracks_read_page_data(monkeypatch):
    data = {"sections": [{"items": [{"title": "Song A", "artistName": "Artist A"}]}]}
    page = (
        f'<script type="application/json" id="serialized-server-data">{json.dumps(data)}</script>'
    )
    response = Mock(text=page, raise_for_status=Mock())
    monkeypatch.setattr(curation.httpx, "get", lambda *args, **kwargs: response)
    assert curation.chart_tracks(CHART["url"]) == [TRACKS[0]]


def test_curate_all_counts_outcomes_and_skips_existing_drafts(monkeypatch):
    monkeypatch.setattr(curation, "remove_leftovers", lambda prefix: None)
    monkeypatch.setattr(curation, "refresh_expiring_tokens", lambda: {"failed": 0})
    monkeypatch.setattr(curation, "chart_tracks", lambda url: TRACKS)
    monkeypatch.setattr(
        curation,
        "list_draft_candidates",
        lambda: [_packet(), {**_packet(), "account_key": "uoft"}, {"status": "published"}],
    )
    outcomes = {"uwaterloo": "saved"}

    def curate(packet, tracks):
        if packet["account_key"] not in outcomes:
            raise RuntimeError("agent failed")
        return outcomes[packet["account_key"]]

    monkeypatch.setattr(curation, "curate_school", curate)
    assert curation.curate_all() == {"saved": 1, "failed": 1}
