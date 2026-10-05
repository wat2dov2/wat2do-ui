import pytest

from services.instagram_publishing import selection


def test_external_choices_accept_original_copy_and_preserve_order():
    picks = [
        selection.CarouselPick(
            event_id=i, sticker_labels=["Free Pizza", "Reg. Required", "Meet Friends"]
        )
        for i in [3, 1]
    ]
    selection.validate_picks([{"id": i} for i in range(1, 5)], picks)
    assert [pick.event_id for pick in picks] == [3, 1]
    assert picks[0].sticker_labels == ["Free Pizza", "Reg. Required", "Meet Friends"]


@pytest.mark.parametrize(
    "labels",
    [
        ["Free", "free"],
        ["Free Pizza", "Free Pizza"],
        [""],
        ["Registrations Required"],
        ["One Two Three Four Five Six"],
        ["free Pizza"],
        ["Free pizza"],
        ["One", "Two", "Three", "Four", "Five"],
    ],
)
def test_invalid_copy_fails_before_saving(labels):
    with pytest.raises(ValueError):
        selection.CarouselPick(event_id=1, sticker_labels=labels)


def test_four_distinct_stickers_and_whitespace_normalization():
    pick = selection.CarouselPick(
        event_id=1, sticker_labels=[" Free  Pizza ", "Reg. Required", "Cash Prizes", "$5 Entry"]
    )
    assert pick.sticker_labels == ["Free Pizza", "Reg. Required", "Cash Prizes", "$5 Entry"]


@pytest.mark.parametrize("ids", [[999], [1, 1]])
def test_invalid_event_selection_fails(ids):
    with pytest.raises(ValueError):
        selection.validate_picks(
            [{"id": 1}], [selection.CarouselPick(event_id=i, sticker_labels=["Free"]) for i in ids]
        )


def test_empty_pool_accepts_only_empty_choices():
    selection.validate_picks([], [])
    with pytest.raises(ValueError):
        selection.validate_picks([], [selection.CarouselPick(event_id=1, sticker_labels=["Free"])])


def test_editorial_threshold_can_keep_more_than_publication_capacity():
    candidates = [{"id": i} for i in range(1, 16)]
    picks = [
        selection.CarouselPick(event_id=event["id"], sticker_labels=["Free"])
        for event in candidates
    ]
    selection.validate_picks(candidates, picks)
    draft = selection.DraftSelection(
        account_key="uwaterloo",
        window_end="2026-10-04T13:00:00Z",
        caption_intro="",
        cover_body="",
        picks=picks,
    )
    assert len(draft.picks) == 15


def test_editorial_threshold_can_reject_the_entire_eligible_pool():
    selection.validate_picks([{"id": 1}], [])


@pytest.mark.parametrize(
    "field,value",
    [
        ("title", " "),
        ("artist", ""),
        ("chart_url", "javascript:alert(1)"),
        ("checked_on", "not-a-date"),
    ],
)
def test_invalid_song_recommendations_are_rejected(field, value):
    from pydantic import ValidationError

    from schemas.instagram_publishing import InstagramSongSuggestion

    song = dict(
        title="Song",
        artist="Artist",
        chart_name="Toronto",
        chart_url="https://music.apple.com/ca/",
        checked_on="2026-10-05",
    )
    song[field] = value
    with pytest.raises(ValidationError):
        InstagramSongSuggestion.model_validate(song)
