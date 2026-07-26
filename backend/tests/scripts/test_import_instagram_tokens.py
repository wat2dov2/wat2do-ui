from pathlib import Path

import pytest

from scripts.import_instagram_tokens import parse_token_file


def test_parse_token_file_reads_only_the_leading_private_token_block(tmp_path: Path):
    path = tmp_path / "tokens.txt"
    path.write_text(
        "dalhouse=first-secret\nmcgill=second-secret\n\nDashboard export\n178414\n",
        encoding="utf-8",
    )

    assert parse_token_file(path) == [
        ("dalhouse", "first-secret"),
        ("mcgill", "second-secret"),
    ]


def test_parse_token_file_rejects_duplicate_labels(tmp_path: Path):
    path = tmp_path / "tokens.txt"
    path.write_text("mcgill=first\nmcgill=second\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Duplicate token label"):
        parse_token_file(path)
