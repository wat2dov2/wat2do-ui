#!/usr/bin/env python3
"""Make the missing event image thumbnails in a local copy of the media bucket.

--media-dir is a folder laid out like the bucket, ``<bucket>/<file>``.
Each poster in its ``event-images`` folder without a thumbnail gets one next to
it, made by the same function uploads use.
Existing thumbnails are left alone, so the script can be rerun.
It only reads and writes local files; syncing them to the bucket is separate.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants import BUCKET_EVENT_IMAGES  # noqa: E402
from core.controlbox import controlbox  # noqa: E402
from core.exceptions import ValidationError  # noqa: E402
from services.image_thumbnails import Thumbnail, thumbnail_path  # noqa: E402


def make_thumbnail(poster: Path) -> str:
    """Write *poster*'s thumbnail beside it and return "made", or "failed" if it is not an image."""
    try:
        thumbnail = Thumbnail.EVENT_IMAGE.make(poster.read_bytes())
    except ValidationError:
        return "failed"
    target = poster.with_name(thumbnail_path(poster.name))
    # Written aside and renamed, so an interrupted run never leaves a partial
    # thumbnail that a rerun would skip.
    partial = target.with_name(f".{target.name}.partial")
    partial.write_bytes(thumbnail)
    partial.replace(target)
    return "made"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    args = parser.parse_args(argv)

    folder = args.media_dir / BUCKET_EVENT_IMAGES
    if not folder.is_dir():
        parser.error(f"{folder} is not a folder")
    suffix = controlbox.uploads.thumbnail_suffix
    files = {path.name for path in folder.iterdir() if path.is_file()}
    posters = sorted(
        folder / name for name in files if not name.startswith(".") and not name.endswith(suffix)
    )
    missing = [path for path in posters if thumbnail_path(path.name) not in files]

    counts: Counter[str] = Counter(already_had=len(posters) - len(missing))
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for poster, outcome in zip(
            missing, pool.map(make_thumbnail, missing, chunksize=16), strict=True
        ):
            counts[outcome] += 1
            if outcome == "failed":
                print(f"Not an image: {poster.name}", file=sys.stderr)

    print(
        f"{len(posters)} posters: made {counts['made']} thumbnails, "
        f"{counts['already_had']} already had one, {counts['failed']} could not be read"
    )
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
