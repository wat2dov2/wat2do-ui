import pytest

from services.instagram_publishing import curation
from services.instagram_publishing.curation import _validate_selected_ids


def _candidates():
    return [
        {"id": 10, "title": "Study Jam", "source_image_url": None},
        {"id": 11, "title": "Arts Night", "source_image_url": "https://example.com/11.jpg"},
    ]


def test_validate_selected_ids_preserves_the_models_order():
    result = _validate_selected_ids(
        {"event_ids": [11, 10]},
        _candidates(),
        maximum_count=2,
    )

    assert result == [11, 10]


@pytest.mark.parametrize(
    ("payload", "maximum_count", "message"),
    [
        ({"event_ids": [10, 10]}, 2, "repeated"),
        ({"event_ids": [12]}, 2, "unknown"),
        ({"event_ids": [10, 11]}, 1, "too many"),
    ],
)
def test_validate_selected_ids_rejects_invalid_selections(payload, maximum_count, message):
    with pytest.raises(ValueError, match=message):
        _validate_selected_ids(
            payload,
            _candidates(),
            maximum_count=maximum_count,
        )


def test_select_candidate_ids_uses_text_only_structured_output(monkeypatch):
    calls = []

    class FakeResponses:
        def parse(self, **kwargs):
            calls.append(kwargs)
            return type(
                "Response",
                (),
                {
                    "output_parsed": curation._CurationResponse(
                        event_ids=[11, 10],
                    )
                },
            )()

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

    monkeypatch.setattr(curation, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(curation.settings, "openai_api_key", "test-key")

    result = curation.select_candidate_ids(_candidates(), maximum_count=2)

    assert result == [11, 10]
    assert calls[0]["text_format"] is curation._CurationResponse
    assert calls[0]["store"] is False
    assert calls[0]["reasoning"] == {"effort": "low"}
    content = calls[0]["input"][0]["content"]
    assert [part["type"] for part in content] == ["input_text"]
    assert '"event_id": 10' in content[0]["text"]
    assert "source_image_url" not in content[0]["text"]
