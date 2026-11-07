#!/usr/bin/env python3
"""Make the missing club logo thumbnails in media storage.

Lists the organization-logos folder of STORAGE_BUCKET_NAME. Each raster logo
without a thumbnail beside it is downloaded, and its thumbnail is made by the
same function uploads use and stored as an immutable WebP, as an upload would.
SVG logos have no thumbnail. Existing thumbnails are left alone and each one is
written in one request, so an interrupted run is finished by running it again.
--dry-run only lists the folder and counts what a run would make.

On the Mac, run it from the deployed release with production's settings:

    (set -a; . ~/wat2do-data/config/backend.env; set +a
     cd ~/wat2do-data/releases/current/backend
     ~/wat2do-data/venv/bin/python scripts/make_club_logo_thumbnails.py --dry-run)
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants import BUCKET_CLUB_LOGOS  # noqa: E402
from core.controlbox import controlbox  # noqa: E402
from services.image_thumbnails import Thumbnail, thumbnail_path  # noqa: E402
from services.storage_service import storage  # noqa: E402

PROGRESS_EVERY = 100


def make_thumbnail(name: str) -> str:
    """Store logo *name*'s thumbnail and return "made", or "failed" with the reason printed."""
    try:
        storage.make_thumbnail(BUCKET_CLUB_LOGOS, name)
    except Exception as exc:
        # One unreadable or vanished logo must not stop the rest; a rerun retries it.
        print(f"No thumbnail for {name}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return "failed"
    return "made"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="only list the logos and count; store nothing"
    )
    parser.add_argument("--workers", type=int, default=4, help="logos made at once (default 4)")
    args = parser.parse_args(argv)

    files = storage.list_files(BUCKET_CLUB_LOGOS)
    logos = sorted(name for name in files if not name.endswith(controlbox.uploads.thumbnail_suffix))
    raster = [name for name in logos if Thumbnail.of(BUCKET_CLUB_LOGOS, name) is not None]
    missing = [name for name in raster if thumbnail_path(name) not in files]
    counts: Counter[str] = Counter(
        already_had=len(raster) - len(missing), svg=len(logos) - len(raster)
    )

    if args.dry_run:
        megabytes = sum(files[name] for name in missing) / 1_000_000
        print(
            f"{len(logos)} logos: {len(missing)} need a thumbnail "
            f"({megabytes:.1f} MB to download), {counts['already_had']} already have one, "
            f"{counts['svg']} are SVGs"
        )
        return 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for done, outcome in enumerate(pool.map(make_thumbnail, missing), start=1):
            counts[outcome] += 1
            if done % PROGRESS_EVERY == 0:
                print(f"{done}/{len(missing)} logos done", file=sys.stderr, flush=True)

    print(
        f"{len(logos)} logos: made {counts['made']} thumbnails, "
        f"{counts['already_had']} already had one, {counts['svg']} are SVGs, "
        f"{counts['failed']} failed"
    )
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
