#!/usr/bin/env python3
"""Resize already-stored event posters to the configured rendition width.

New uploads are sized on the way in. Posters stored before that are still at
their original width, so the app would serve a 2728px file into a 250px card.
This walks the event-images bucket and rewrites anything wider, in place and at
the same URL, so nothing that references an image has to change.

Re-runnable: an image already at or below the width is skipped, so a second run
does nothing. Use --dry-run to see what would change first.
"""

from __future__ import annotations

import argparse
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants import BUCKET_EVENT_IMAGES  # noqa: E402
from core.controlbox import controlbox  # noqa: E402
from core.database import supabase_admin  # noqa: E402

_PAGE_SIZE = 100


def _resize(data: bytes, max_width: int, quality: int) -> bytes | None:
    """Return re-encoded bytes, or None when the image needs no change."""
    from PIL import Image

    with Image.open(BytesIO(data)) as im:
        im.load()
        if getattr(im, "is_animated", False) or im.width <= max_width:
            return None
        pil_format = im.format or "JPEG"
        height = max(round(im.height * (max_width / im.width)), 1)
        resized = im.resize((max_width, height), Image.LANCZOS)
        out = BytesIO()
        save_kwargs: dict = {}
        if pil_format == "JPEG":
            save_kwargs = {"exif": b"", "optimize": True, "quality": quality}
        resized.save(out, format=pil_format, **save_kwargs)
        return out.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report without writing")
    args = parser.parse_args()

    max_width = controlbox.uploads.event_image_rendition_width_pixels
    quality = controlbox.uploads.event_image_rendition_quality
    storage = supabase_admin.storage.from_(BUCKET_EVENT_IMAGES)

    scanned = resized = skipped = failed = 0
    saved_bytes = 0
    offset = 0
    while True:
        batch = storage.list(options={"limit": _PAGE_SIZE, "offset": offset})
        if not batch:
            break
        offset += len(batch)
        for entry in batch:
            name = entry.get("name")
            if not name:
                continue
            scanned += 1
            try:
                original = storage.download(name)
                shrunk = _resize(original, max_width, quality)
                if shrunk is None:
                    skipped += 1
                    continue
                saved_bytes += len(original) - len(shrunk)
                if not args.dry_run:
                    storage.update(name, shrunk)
                resized += 1
            except Exception as exc:  # noqa: BLE001 - one bad file must not stop the run
                failed += 1
                print(f"  failed {name}: {exc}", file=sys.stderr)

    verb = "would resize" if args.dry_run else "resized"
    print(
        f"scanned {scanned}, {verb} {resized}, already small {skipped}, failed {failed}, "
        f"saving {saved_bytes // 1024} KB"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
