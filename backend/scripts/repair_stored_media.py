#!/usr/bin/env python3
"""Preview or repair one event/position poster or missing Instagram media.

The default is read-only. Image repairs inspect the owned S3 asset and reuse
the upload rendition rules. Missing Instagram image and video repairs require exact-post provider data;
--fetch explicitly retrieves just the target's original post through Apify.
--apply stores a new immutable asset, conditionally updates the selected row,
and refreshes its school's discovery data. It never runs AI extraction.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.exceptions import NotFoundError, ValidationError  # noqa: E402
from services.scraper.instagram_scraper import get_scraper  # noqa: E402
from services.scraper.media_repair import (  # noqa: E402
    load_media_target,
    repair_directory_image,
    repair_instagram_image,
    repair_stored_image,
    repair_stored_video,
)
from services.scraper.single_user import exact_post_results_match_targets  # noqa: E402


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("image", "instagram-image", "video", "directory-image"))
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--event-id", type=int)
    target.add_argument("--position-id", type=int)
    provider = parser.add_mutually_exclusive_group()
    provider.add_argument("--post-json", type=Path, help="Reuse one exact-post provider object")
    provider.add_argument("--fetch", action="store_true", help="Fetch this one post from Apify")
    parser.add_argument("--apply", action="store_true", help="Upload and save the previewed repair")
    args = parser.parse_args(argv)
    if args.kind not in {"video", "instagram-image"} and (args.post_json or args.fetch):
        parser.error("Provider data is only used for Instagram image and video repairs")
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        resource = "events" if args.event_id is not None else "positions"
        item_id = args.event_id if args.event_id is not None else args.position_id
        selected = load_media_target(resource, item_id)
        if args.kind == "directory-image":
            result = repair_directory_image(selected, apply=args.apply)
        elif args.kind == "image":
            result = repair_stored_image(selected, apply=args.apply)
        else:
            repair = (
                repair_instagram_image if args.kind == "instagram-image" else repair_stored_video
            )
            result = repair(selected)
            if result["status"] == "needs_source" and (args.post_json or args.fetch):
                if args.post_json:
                    post = json.loads(args.post_json.read_text())
                    if not isinstance(post, dict):
                        raise ValidationError("Provider JSON must contain one post object")
                else:
                    posts = get_scraper().scrape_posts([selected.source_url])
                    if not exact_post_results_match_targets([selected.source_url], posts):
                        raise ValidationError("Provider did not return the selected exact post")
                    post = posts[0]
                result = repair(selected, post, apply=args.apply)
        print(json.dumps({**result, "apply": args.apply}, indent=2, sort_keys=True))
        return int(
            args.apply and result["status"] not in {"updated", "already_present", "already_sized"}
        )
    except (NotFoundError, ValidationError) as exc:
        print(str(exc), file=sys.stderr)
    except Exception as exc:
        # Provider/storage exceptions may include credentials or signed URLs.
        print(f"Media repair failed ({type(exc).__name__}); no extraction was run", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
