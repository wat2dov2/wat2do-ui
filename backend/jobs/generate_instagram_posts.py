#!/usr/bin/env python3
"""Read Instagram candidates or save Codex-curated drafts for admin review."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from fastapi.encoders import jsonable_encoder

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.instagram_publishing import (  # noqa: E402
    list_draft_candidates,
    refresh_expiring_tokens,
    save_review_draft,
)
from services.instagram_publishing.selection import DraftSelection  # noqa: E402

logging.basicConfig(level=logging.INFO)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("candidates", help="Read enabled accounts and eligible event data")
    commands.add_parser(
        "refresh-tokens", help="Refresh expiring tokens without displaying credentials"
    )
    save = commands.add_parser("save", help="Validate and save one account's editorial choices")
    save.add_argument("selection_file", type=Path)
    args = parser.parse_args()
    if args.command == "candidates":
        result = list_draft_candidates()
    elif args.command == "refresh-tokens":
        result = refresh_expiring_tokens()
    else:
        selection = DraftSelection.model_validate_json(args.selection_file.read_text())
        result = save_review_draft(selection)
    print(json.dumps(jsonable_encoder(result), sort_keys=True))
    return 1 if args.command == "refresh-tokens" and result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
