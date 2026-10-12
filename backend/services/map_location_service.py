"""Coordinates for event map locations, found once with OpenStreetMap's Nominatim.

Events carry their place's stored coordinates, so the map draws from the feed
alone. Every place an event names waits in ``map_locations`` until a backend
worker looks it up. Workers claim one place at a time across every server, so
the whole app keeps to one request a second as Nominatim's usage policy requires.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import unicodedata
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

import httpx

from core.controlbox import controlbox
from core.database import get_sb
from core.tables import MAP_LOCATIONS
from schemas.event import MapCoordinates
from services import school_service
from services.event_feed_revalidation import event_feed_revalidation_service

log = logging.getLogger(__name__)
CONTROL = controlbox.event_discovery.map_geocoding

_STREET_NUMBER = re.compile(r"^\d+[a-z]?(?:-\d+)?\s+\S", re.IGNORECASE)
# A campus's mailing address is shared by every building on it, so it never
# places a named building.
_CAMPUS = re.compile(r"universit|college|campus|polytechni", re.IGNORECASE)
# Provinces, states, postal codes and countries never narrow a search to one city.
_REGION = re.compile(r"^(?:[A-Z]{2,3}(?:\s+[A-Z0-9][A-Z0-9 -]*)?|Canada|USA|United States)$")
# Results that share a building's name but are not the building itself.
_NOT_A_VENUE = {
    ("amenity", kind)
    for kind in (
        "atm",
        "bench",
        "bicycle_parking",
        "charging_station",
        "drinking_water",
        "fountain",
        "parking",
        "parking_entrance",
        "post_box",
        "taxi",
        "telephone",
        "toilets",
        "vending_machine",
        "waste_basket",
    )
}
_NOT_A_VENUE_CATEGORIES = {"highway", "public_transport", "railway", "entrance"}
_STREET_WORDS = {
    "st": "street",
    "ave": "avenue",
    "av": "avenue",
    "rd": "road",
    "blvd": "boulevard",
    "boul": "boulevard",
    "dr": "drive",
    "ln": "lane",
    "cres": "crescent",
    "ct": "court",
    "pl": "place",
    "ter": "terrace",
    "hwy": "highway",
    "pkwy": "parkway",
    "cir": "circle",
    "sq": "square",
    "n": "north",
    "s": "south",
    "e": "east",
    "w": "west",
    "nord": "north",
    "sud": "south",
    "est": "east",
    "ouest": "west",
    "o": "west",
    "rue": "street",
    "chemin": "road",
    "ch": "road",
}
_STOP_WORDS = {"the", "of", "at", "in", "and", "de", "du", "des", "la", "le", "les"}
# "Québec City" is "Québec" in OpenStreetMap addresses.
_PLACE_WORDS = {"city", "ville", "town"}
# Address parts that name a place itself. A county such as "Region of Waterloo"
# also covers its neighbouring cities, so it never confirms one.
_LOCALITY_KEYS = (
    "city",
    "town",
    "village",
    "municipality",
    "hamlet",
    "suburb",
    "city_district",
    "borough",
    "quarter",
    "neighbourhood",
)


def run(stopping: threading.Event) -> None:
    """Look up waiting places until ``stopping`` is set, refreshing the feeds of schools with new pins."""
    refresh = _FeedRefresh()
    with httpx.Client(
        headers={"User-Agent": CONTROL.user_agent}, timeout=CONTROL.request_timeout_seconds
    ) as client:
        while not stopping.is_set():
            try:
                looked_up = look_up_next(lambda query, center: _search(client, query, center))
            except Exception:
                # The claim lapses after its lease, so the place is tried again later.
                log.exception("Map location lookup failed")
                looked_up = None
            if looked_up is None:
                refresh.flush()
                stopping.wait(CONTROL.idle_poll_seconds)
                continue
            school, found = looked_up
            if found:
                refresh.add(school)
            refresh.flush_when_due()
        refresh.flush()


def look_up_next(
    search: Callable[[str, tuple[float, float]], list[dict]],
) -> tuple[str, bool] | None:
    """Claim, look up and store the next waiting place.

    Returns its school and whether it was found, or None when no place is waiting
    or another worker is mid-lookup. Stored coordinates reach every event at that
    place through the database.
    """
    retry_before = datetime.now(timezone.utc) - timedelta(days=CONTROL.not_found_retry_days)
    claimed = (
        get_sb()
        .rpc(
            "claim_map_location",
            {
                "p_lease_seconds": CONTROL.claim_lease_seconds,
                "p_retry_before": retry_before.isoformat(),
            },
        )
        .execute()
        .data
    )
    if not claimed:
        return None
    place = claimed[0]
    school = school_service.get_school_by_id(place["school_id"])
    slug = school.slug if school is not None else ""
    center = controlbox.event_discovery.views.map_campus_centers.get(slug)
    coordinates = (
        locate(
            place["map_location"],
            center,
            lambda query: search(query, center),
            CONTROL.known_places.get(slug, {}),
        )
        if center is not None
        else None
    )
    (
        get_sb()
        .table(MAP_LOCATIONS)
        .update(
            {
                "coordinates": list(coordinates) if coordinates else None,
                "looked_up_at": datetime.now(timezone.utc).isoformat(),
                "claimed_until": None,
            }
        )
        .eq("school_id", place["school_id"])
        .eq("map_location", place["map_location"])
        .execute()
    )
    return slug, coordinates is not None


class _FeedRefresh:
    """Schools whose feeds gain pins, refreshed together at most once per interval."""

    def __init__(self) -> None:
        self._schools: set[str] = set()
        self._flushed_at = time.monotonic()

    def add(self, school: str) -> None:
        self._schools.add(school)

    def flush_when_due(self) -> None:
        if time.monotonic() - self._flushed_at >= CONTROL.feed_refresh_seconds:
            self.flush()

    def flush(self) -> None:
        self._flushed_at = time.monotonic()
        if self._schools:
            event_feed_revalidation_service.revalidate_schools(
                sorted(self._schools), resources=("events",)
            )
            self._schools.clear()


def locate(
    map_location: str,
    center: tuple[float, float],
    search: Callable[[str], list[dict]],
    known_places: dict[str, MapCoordinates],
) -> MapCoordinates | None:
    """A known campus building named in ``map_location``, else the first acceptable
    Nominatim result, most specific query first."""
    known = {_place_key(name): coordinates for name, coordinates in known_places.items()}
    for part in map_location.split(","):
        if coordinates := known.get(_place_key(part)):
            return coordinates
    for query, accept in _queries(map_location, center):
        for candidate in search(query):
            if accept(candidate):
                return (float(candidate["lon"]), float(candidate["lat"]))
    return None


def _queries(
    map_location: str, center: tuple[float, float]
) -> list[tuple[str, Callable[[dict], bool]]]:
    parts = [part.strip() for part in map_location.split(",") if part.strip()]
    street = next((index for index, part in enumerate(parts) if _STREET_NUMBER.match(part)), None)
    on_campus = any(_CAMPUS.search(part) for part in parts)
    locality = [
        part for part in parts[1:] if not _STREET_NUMBER.match(part) and not _CAMPUS.search(part)
    ]
    city = next((part for part in reversed(locality) if not _REGION.match(part)), None)
    # "ON" or "CA 94720" names the province or state every result must be in.
    region = next(
        (part[:2] for part in reversed(parts[1:]) if _REGION.match(part) and part[:2].isalpha()),
        None,
    )
    # Nominatim searches inside a named campus or college, where most buildings are mapped.
    campus = next(
        (part for part in parts[1:] if _CAMPUS.search(part) and not _STREET_NUMBER.match(part)),
        None,
    )
    # The named places before the street and city, most specific first: a room or
    # bar, then the building that holds it. A school or college names the area, not the venue.
    end = min(
        street if street is not None else len(parts),
        parts.index(city) if city in parts[1:] else len(parts),
    )
    names = parts[:1] + [part for part in parts[1:end] if not _CAMPUS.search(part)]

    def accept_venue(name: str) -> Callable[[dict], bool]:
        # Building codes such as "(MC)" are campus shorthand, not part of a mapped name.
        venue = re.sub(r"\s*\([^)]*\)", "", name)
        return lambda candidate: (
            _in_region(candidate, region) and _is_venue(candidate, venue, city, center)
        )

    queries = []
    if street != 0:
        queries.append((map_location, accept_venue(names[0])))
        for name in names:
            venue = re.sub(r"\s*\([^)]*\)", "", name)
            if campus:
                queries.append((f"{venue}, {campus}", accept_venue(name)))
            queries.append((", ".join([venue, *locality[-2:]]), accept_venue(name)))
    if street is not None and (street == 0 or not on_campus):
        address = parts[street]
        queries.append(
            (
                ", ".join(parts[street:]),
                lambda candidate: (
                    _in_region(candidate, region)
                    and _is_address(candidate, address)
                    and _in_city(candidate, city)
                ),
            )
        )
    return list({query: (query, accept) for query, accept in queries}.values())


def _search(client: httpx.Client, query: str, center: tuple[float, float]) -> list[dict]:
    longitude, latitude = center
    radius = CONTROL.search_radius_degrees
    started = time.monotonic()
    try:
        response = client.get(
            CONTROL.search_url,
            params={
                "q": query,
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": CONTROL.candidate_count,
                # A preference, not a limit: off-campus venues name their own city.
                "viewbox": f"{longitude - radius},{latitude + radius},{longitude + radius},{latitude - radius}",
            },
        )
        response.raise_for_status()
        return response.json()
    finally:
        time.sleep(max(0.0, CONTROL.request_interval_seconds - (time.monotonic() - started)))


def _is_venue(candidate: dict, venue: str, city: str | None, center: tuple[float, float]) -> bool:
    category, kind = candidate.get("category"), candidate.get("type")
    if category in _NOT_A_VENUE_CATEGORIES or (category, kind) in _NOT_A_VENUE:
        return False
    expected = _words(venue) - _STOP_WORDS
    if not expected or not expected <= _words(candidate.get("name") or ""):
        return False
    if city is None:
        # A bare building name belongs to this campus, never a namesake elsewhere.
        radius = CONTROL.search_radius_degrees
        return (
            abs(float(candidate["lon"]) - center[0]) <= radius
            and abs(float(candidate["lat"]) - center[1]) <= radius
        )
    return _in_city(candidate, city)


def _in_city(candidate: dict, city: str | None) -> bool:
    address = candidate.get("address") or {}
    places = _words(" ".join(address.get(key, "") for key in _LOCALITY_KEYS))
    return city is None or _words(city) - _PLACE_WORDS <= places


def _in_region(candidate: dict, region: str | None) -> bool:
    found = (candidate.get("address") or {}).get("ISO3166-2-lvl4", "")
    return region is None or found.endswith(f"-{region}")


def _is_address(candidate: dict, address: str) -> bool:
    number, _, street = address.partition(" ")
    found = candidate.get("address") or {}
    return found.get("house_number", "").lower() == number.lower() and _street(
        found.get("road", "")
    ) == _street(street)


def _street(value: str) -> set[str]:
    return {_STREET_WORDS.get(word, word) for word in _words(value)}


def _place_key(name: str) -> frozenset[str]:
    # "Mathematics & Computer (MC)" names the same building as "Mathematics and Computer Building".
    words = _words(re.sub(r"\([^)]*\)", "", name)) - _STOP_WORDS - {"building"}
    return frozenset("centre" if word == "center" else word for word in words)


def _words(value: str) -> set[str]:
    plain = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return {word for word in re.split(r"[^a-z0-9]+", plain) if word}
