#!/usr/bin/env python3
"""Validate and securely import manually generated Instagram access tokens."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.instagram_publishing.credentials import import_access_token  # noqa: E402


def parse_token_file(path: Path) -> list[tuple[str, str]]:
    """Read the leading ``label=token`` block without logging token values."""
    tokens: list[tuple[str, str]] = []
    labels: set[str] = set()
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line:
            if tokens:
                break
            continue
        if "=" not in line:
            raise ValueError(f"Expected label=token on line {line_number}")
        label, token = (part.strip() for part in line.split("=", 1))
        if not label or not token:
            raise ValueError(f"Expected non-empty label and token on line {line_number}")
        if label in labels:
            raise ValueError(f"Duplicate token label {label!r} on line {line_number}")
        labels.add(label)
        tokens.append((label, token))
    if not tokens:
        raise ValueError("Token file did not contain any label=token entries")
    return tokens


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "token_file",
        type=Path,
        help="Path to a private file whose leading lines are label=token entries",
    )
    args = parser.parse_args()

    imported_account_keys: set[str] = set()
    for label, token in parse_token_file(args.token_file):
        credentials = import_access_token(token)
        if credentials.account_key in imported_account_keys:
            raise RuntimeError(
                f"More than one supplied token resolved to {credentials.account_key}"
            )
        imported_account_keys.add(credentials.account_key)
        print(
            f"{label} -> {credentials.account_key} "
            f"(@{credentials.instagram_username}, {credentials.instagram_user_id})"
        )
    print(f"Imported {len(imported_account_keys)} Instagram account token(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
