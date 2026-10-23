"""Each busy school's wat2do logo, rebuilt from its own event posters.

Schools with at least ``school_logos.minimum_event_count`` events get the logo's
silhouette filled with their newest posters inside an outline, stored as
``schools.poster_logo_url``. Quieter schools keep a null URL and show the
standard logo everywhere.
"""

from __future__ import annotations

import logging
import random
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image, ImageChops, ImageColor, ImageFilter, ImageOps

from core.constants import BUCKET_EVENT_IMAGES, BUCKET_SCHOOL_LOGOS
from core.controlbox import controlbox
from core.database import get_sb
from core.tables import SCHOOLS
from services import school_service
from services.storage_service import storage

log = logging.getLogger(__name__)

# The app's logo artwork. Only the scheduled job (a full repository checkout)
# renders logos, so the frontend asset stays the single copy of the artwork.
LOGO_ARTWORK_PATH = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "assets"
    / "38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png"
)
# Posters are portrait; tiles keep Instagram's 4:5 shape.
_TILE_ASPECT = 1.25
_DOWNLOAD_WORKERS = 8

SchoolLogoOutcome = Literal["rendered", "cleared", "unchanged", "failed"]


@dataclass(frozen=True)
class SchoolLogoResult:
    school: str
    event_count: int
    outcome: SchoolLogoOutcome
    poster_logo_url: str | None


def logo_silhouette(artwork: Image.Image) -> Image.Image:
    """The logo's inked shapes (letters and goose) as a mask, without its white details."""
    red, green, blue, alpha = artwork.convert("RGBA").split()
    near_white = ImageChops.darker(ImageChops.darker(red, green), blue).point(
        lambda value: 255 if value > 215 else 0
    )
    opaque = alpha.point(lambda value: 255 if value > 128 else 0)
    return ImageChops.subtract(opaque, near_white)


def render_poster_logo(silhouette: Image.Image, posters: list[Image.Image], *, seed: str) -> bytes:
    """Fill the silhouette with poster tiles inside the outline; returns a PNG."""
    if not posters:
        raise ValueError("A poster logo needs at least one poster")
    control = controlbox.school_logos
    width, height = control.output_width, control.output_height
    # Shrink the shapes just enough that the outline stays inside the canvas,
    # keeping the standard logo's proportions so it can replace it anywhere.
    scale = (width - 2 * (control.outline_width + 1)) / width
    inner = silhouette.resize(
        (round(width * scale), round(height * scale)), Image.Resampling.LANCZOS
    ).point(lambda value: 255 if value > 128 else 0)
    mask = Image.new("L", (width, height), 0)
    mask.paste(inner, ((width - inner.width) // 2, (height - inner.height) // 2))

    tile_width = control.tile_width
    tile_height = round(tile_width * _TILE_ASPECT)
    tiles = [ImageOps.fit(poster.convert("RGB"), (tile_width, tile_height)) for poster in posters]
    rng = random.Random(seed)
    rng.shuffle(tiles)
    mosaic = Image.new("RGB", (width, height))
    index = 0
    for row in range(-1, height // tile_height + 2):
        # Brick-offset rows read as a wall of posters rather than a grid.
        offset = (row % 2) * tile_width // 2
        for column in range(-1, width // tile_width + 2):
            mosaic.paste(
                tiles[index % len(tiles)], (column * tile_width - offset, row * tile_height)
            )
            index += 1

    logo = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    if control.outline_width:
        outline = mask.filter(ImageFilter.MaxFilter(2 * control.outline_width + 1))
        logo.paste(ImageColor.getrgb(control.outline_color), (0, 0, width, height), outline)
    logo.paste(mosaic, (0, 0), mask)
    output = BytesIO()
    logo.save(output, format="PNG", optimize=True)
    return output.getvalue()


def refresh_school_poster_logos() -> list[SchoolLogoResult]:
    """Render or clear every school's poster logo; one school's failure never stops the rest."""
    silhouette = logo_silhouette(Image.open(LOGO_ARTWORK_PATH))
    rows = get_sb().table(SCHOOLS).select("id,slug,poster_logo_url").order("slug").execute().data
    results = []
    for row in rows or []:
        try:
            results.append(_refresh_school(row, silhouette))
        except Exception:
            log.exception("school_poster_logo_failed school=%s", row["slug"])
            results.append(SchoolLogoResult(row["slug"], 0, "failed", row.get("poster_logo_url")))
    return results


def _refresh_school(row: dict, silhouette: Image.Image) -> SchoolLogoResult:
    slug, previous_url = str(row["slug"]), row.get("poster_logo_url")
    event_count = school_service.count_school_events(int(row["id"]))
    control = controlbox.school_logos
    if event_count < control.minimum_event_count:
        if previous_url is None:
            return SchoolLogoResult(slug, event_count, "unchanged", None)
        _save_logo_url(int(row["id"]), None, previous_url)
        return SchoolLogoResult(slug, event_count, "cleared", None)

    posters = _download_posters(
        school_service.latest_school_poster_urls(int(row["id"]), control.poster_count)
    )
    if not posters:
        log.warning("school_poster_logo_without_posters school=%s", slug)
        return SchoolLogoResult(slug, event_count, "unchanged", previous_url)
    url = storage.upload_file(
        BUCKET_SCHOOL_LOGOS, render_poster_logo(silhouette, posters, seed=slug), "image/png"
    )
    _save_logo_url(int(row["id"]), url, previous_url)
    return SchoolLogoResult(slug, event_count, "rendered", url)


def _save_logo_url(school_id: int, url: str | None, previous_url: str | None) -> None:
    get_sb().table(SCHOOLS).update({"poster_logo_url": url}).eq("id", school_id).execute()
    # Delete the replaced object only after the row points away from it.
    previous_path = previous_url and storage.path_from_url(previous_url, BUCKET_SCHOOL_LOGOS)
    if previous_path:
        storage.delete_file(BUCKET_SCHOOL_LOGOS, previous_path)


def _download_posters(urls: list[str]) -> list[Image.Image]:
    paths = [path for url in urls if (path := storage.path_from_url(url, BUCKET_EVENT_IMAGES))]
    with ThreadPoolExecutor(max_workers=_DOWNLOAD_WORKERS) as pool:
        return [poster for poster in pool.map(_download_poster, paths) if poster is not None]


def _download_poster(path: str) -> Image.Image | None:
    try:
        data, _content_type = storage.download_file(BUCKET_EVENT_IMAGES, path)
        poster = Image.open(BytesIO(data))
        poster.load()
        return poster
    except Exception:
        log.warning("school_poster_logo_poster_skipped path=%s", path, exc_info=True)
        return None


@lru_cache(maxsize=64)
def email_poster_logo(poster_logo_url: str) -> bytes | None:
    """A small PNG of a school's poster logo for embedding in email, or None if unreadable."""
    path = storage.path_from_url(poster_logo_url, BUCKET_SCHOOL_LOGOS)
    if path is None:
        return None
    try:
        data, _content_type = storage.download_file(BUCKET_SCHOOL_LOGOS, path)
        logo = Image.open(BytesIO(data))
        width = controlbox.school_logos.email_width
        logo = logo.resize(
            (width, round(logo.height * width / logo.width)), Image.Resampling.LANCZOS
        )
    except Exception:
        log.warning("school_poster_logo_email_unavailable url=%s", poster_logo_url, exc_info=True)
        return None
    output = BytesIO()
    logo.save(output, format="PNG", optimize=True)
    return output.getvalue()
