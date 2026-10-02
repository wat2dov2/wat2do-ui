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


@pytest.mark.parametrize("ids", [[999], [1, 1], []])
def test_invalid_event_selection_fails(ids):
    with pytest.raises(ValueError):
        selection.validate_picks(
            [{"id": 1}], [selection.CarouselPick(event_id=i, sticker_labels=["Free"]) for i in ids]
        )


def test_empty_pool_accepts_only_empty_choices():
    selection.validate_picks([], [])
    with pytest.raises(ValueError):
        selection.validate_picks([], [selection.CarouselPick(event_id=1, sticker_labels=["Free"])])
