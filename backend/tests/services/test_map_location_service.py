import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest

from services import map_location_service


def _place(name, lon, lat, *, category="building", kind="university", region="CA-ON", **address):
    return {
        "name": name,
        "lon": str(lon),
        "lat": str(lat),
        "category": category,
        "type": kind,
        "address": {**address, "ISO3166-2-lvl4": region},
    }


WATERLOO = (-80.5449, 43.4723)


def _search(results):
    """A Nominatim stand-in answering each query from ``results``, recording the order asked."""
    asked = []

    def search(query):
        asked.append(query)
        return results.get(query, [])

    return search, asked


def test_locate_skips_same_named_stops_and_keeps_the_building():
    location = "Davis Centre, University of Waterloo, Waterloo, ON"
    search, asked = _search(
        {
            location: [
                _place(
                    "Davis Centre",
                    -80.5426,
                    43.4730,
                    category="amenity",
                    kind="taxi",
                    city="Waterloo",
                ),
                _place(
                    "Davis Centre",
                    -80.5418,
                    43.4728,
                    category="highway",
                    kind="bus_stop",
                    city="Waterloo",
                ),
                _place(
                    "William G. Davis Computer Research Centre", -80.5422, 43.4727, city="Waterloo"
                ),
            ]
        }
    )

    assert map_location_service.locate(location, WATERLOO, search, {}) == (-80.5422, 43.4727)
    assert asked == [location]


def test_locate_tries_the_building_and_city_when_the_full_location_finds_nothing():
    location = (
        "Mathematics & Computer (MC), University of Waterloo, 200 University Ave W, Waterloo, ON"
    )
    building = _place("Mathematics & Computer Building", -80.5439, 43.4720, city="Waterloo")
    search, asked = _search({"Mathematics & Computer, Waterloo, ON": [building]})

    assert map_location_service.locate(location, WATERLOO, search, {}) == (-80.5439, 43.4720)
    assert asked == [
        location,
        "Mathematics & Computer, University of Waterloo",
        "Mathematics & Computer, Waterloo, ON",
    ]


def test_locate_falls_back_from_a_room_to_the_building_that_holds_it():
    location = "Mates Office, Student Life Centre, University of Waterloo, 200 University Ave W, Waterloo, ON"
    building = _place("Student Life Centre", -80.5451, 43.4718, city="Waterloo")
    search, asked = _search({"Student Life Centre, University of Waterloo": [building]})

    assert map_location_service.locate(location, WATERLOO, search, {}) == (-80.5451, 43.4718)
    assert asked[-1] == "Student Life Centre, University of Waterloo"


def test_locate_uses_a_college_only_as_the_area_to_search():
    location = "Howard W. Rundle Building, Fanshawe College, 137 Dundas St, London, ON"
    main_campus = _place("Fanshawe College", -81.2, 43.01, city="London")
    search, asked = _search(
        {query: [main_campus] for query in ("Fanshawe College, London, ON", "Fanshawe College")}
    )

    assert map_location_service.locate(location, (-81.2737, 43.0096), search, {}) is None
    assert "Howard W. Rundle Building, Fanshawe College" in asked
    assert not any(query.startswith("Fanshawe College") for query in asked)


def test_locate_never_pins_a_campus_building_at_the_campus_mailing_address():
    location = "Arts Lecture Hall, University of Waterloo, 200 University Ave W, Waterloo, ON"
    campus_address = _place(
        None,
        -80.5450,
        43.4690,
        category="place",
        kind="house",
        house_number="200",
        road="University Avenue West",
        city="Waterloo",
    )
    search, asked = _search({"200 University Ave W, Waterloo, ON": [campus_address]})

    assert map_location_service.locate(location, WATERLOO, search, {}) is None
    assert "200 University Ave W, Waterloo, ON" not in asked


def test_locate_places_an_off_campus_venue_at_its_street_address():
    location = "Columbia Icefield, 220 Columbia Street West, Waterloo, ON"
    address = _place(
        None,
        -80.5521,
        43.4776,
        category="place",
        kind="house",
        house_number="220",
        road="Columbia Street West",
        city="Waterloo",
    )
    wrong_number = _place(
        None,
        -80.5500,
        43.4770,
        category="place",
        kind="house",
        house_number="22",
        road="Columbia Street West",
        city="Waterloo",
    )
    search, asked = _search({"220 Columbia Street West, Waterloo, ON": [wrong_number, address]})

    assert map_location_service.locate(location, WATERLOO, search, {}) == (-80.5521, 43.4776)
    assert asked[-1] == "220 Columbia Street West, Waterloo, ON"


def test_locate_matches_abbreviated_street_types_and_directions():
    location = "123 Slater St, Ottawa, ON"
    address = _place(
        None,
        -75.6980,
        45.4210,
        category="building",
        kind="office",
        house_number="123",
        road="Slater Street",
        city="Ottawa",
    )
    search, _ = _search({location: [address]})

    assert map_location_service.locate(location, WATERLOO, search, {}) == (-75.6980, 45.4210)


def test_locate_rejects_a_same_named_venue_in_another_city():
    location = "On the Rox, University of Waterloo, Waterloo, ON"
    elsewhere = _place(
        "On The Rox", -93.28, 44.97, category="amenity", kind="bar", city="Minneapolis"
    )
    search, _ = _search({location: [elsewhere], "On the Rox, Waterloo, ON": [elsewhere]})

    assert map_location_service.locate(location, WATERLOO, search, {}) is None


def _claimed(map_location, school_id=7):
    return [{"school_id": school_id, "map_location": map_location, "coordinates": None}]


@pytest.fixture
def searched(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.map_location_service")
    monkeypatch.setattr(
        map_location_service.school_service,
        "get_school_by_id",
        lambda school_id: SimpleNamespace(slug="uwaterloo") if school_id == 7 else None,
    )
    asked = []

    def search(query, center):
        asked.append((query, center))
        if query == "Student Life Centre, Waterloo, ON":
            return [_place("Student Life Centre", -80.5450, 43.4720, city="Waterloo")]
        return []

    return search, asked


def test_look_up_next_claims_one_place_and_stores_it_found(fake_sb, searched):
    search, asked = searched
    fake_sb.set_response(data=_claimed("Student Life Centre, Waterloo, ON"))

    assert map_location_service.look_up_next(search) == ("uwaterloo", True)

    (name, params), _ = fake_sb.rpc.call_args
    retry = timedelta(days=map_location_service.CONTROL.not_found_retry_days)
    assert name == "claim_map_location"
    assert params["p_lease_seconds"] == map_location_service.CONTROL.claim_lease_seconds
    assert abs(
        datetime.now(timezone.utc) - retry - datetime.fromisoformat(params["p_retry_before"])
    ) < timedelta(minutes=1)
    stored = fake_sb.update.call_args.args[0]
    assert stored["coordinates"] == [-80.5450, 43.4720]
    assert stored["claimed_until"] is None
    assert stored["looked_up_at"]
    fake_sb.eq.assert_any_call("school_id", 7)
    fake_sb.eq.assert_any_call("map_location", "Student Life Centre, Waterloo, ON")
    assert {center for _, center in asked} == {(-80.5449, 43.4723)}


def test_look_up_next_stores_a_place_it_cannot_find_so_it_waits_for_the_retry_period(
    fake_sb, searched
):
    search, _ = searched
    fake_sb.set_response(data=_claimed("Nowhere, Waterloo, ON"))

    assert map_location_service.look_up_next(search) == ("uwaterloo", False)

    stored = fake_sb.update.call_args.args[0]
    assert stored["coordinates"] is None
    assert stored["looked_up_at"]


def test_look_up_next_stores_a_place_at_a_school_without_a_map_unsearched(fake_sb, searched):
    search, asked = searched
    fake_sb.set_response(data=_claimed("Student Life Centre, Waterloo, ON", school_id=99))

    assert map_location_service.look_up_next(search) == ("", False)

    assert asked == []
    assert fake_sb.update.call_args.args[0]["coordinates"] is None


def test_look_up_next_waits_when_nothing_is_claimed(fake_sb, searched):
    search, asked = searched

    assert map_location_service.look_up_next(search) is None

    assert asked == []
    fake_sb.update.assert_not_called()


def test_look_up_next_leaves_the_claim_to_lapse_when_nominatim_fails(fake_sb, searched):
    fake_sb.set_response(data=_claimed("Student Life Centre, Waterloo, ON"))

    def unavailable(query, center):
        raise httpx.ConnectError("offline")

    with pytest.raises(httpx.ConnectError):
        map_location_service.look_up_next(unavailable)

    fake_sb.update.assert_not_called()


def test_run_refreshes_feeds_of_schools_that_gained_pins_and_survives_failures(monkeypatch):
    stopping = threading.Event()
    results = iter(
        [
            ("uwaterloo", True),
            ("uwaterloo", False),
            ("ubc", True),
            RuntimeError("database unavailable"),
        ]
    )

    def look_up_next(search):
        result = next(results)
        if isinstance(result, Exception):
            raise result
        return result

    waits = []

    def wait(seconds):
        waits.append(seconds)
        stopping.set()
        return True

    monkeypatch.setattr(map_location_service, "look_up_next", look_up_next)
    monkeypatch.setattr(stopping, "wait", wait)
    revalidate = MagicMock()
    monkeypatch.setattr(
        map_location_service.event_feed_revalidation_service, "revalidate_schools", revalidate
    )

    map_location_service.run(stopping)

    revalidate.assert_called_once_with(["ubc", "uwaterloo"], resources=("events",))
    assert waits == [map_location_service.CONTROL.idle_poll_seconds]


def test_search_identifies_wat2do_and_waits_between_requests(monkeypatch):
    requests = []
    pauses = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=[])

    monkeypatch.setattr(map_location_service.time, "sleep", pauses.append)
    with httpx.Client(
        transport=httpx.MockTransport(handler), headers={"User-Agent": "wat2do-test"}
    ) as client:
        assert (
            map_location_service._search(client, "Davis Centre, Waterloo, ON", (-80.5449, 43.4723))
            == []
        )

    (request,) = requests
    assert request.url.params["q"] == "Davis Centre, Waterloo, ON"
    assert request.url.params["format"] == "jsonv2"
    assert request.url.params["addressdetails"] == "1"
    assert request.headers["User-Agent"] == "wat2do-test"
    assert len(pauses) == 1 and pauses[0] > 0


def test_locate_keeps_a_bare_building_name_on_campus():
    location = "Hagey Hall"
    namesake = _place("Hagey Hall", -79.38, 43.65, city="Toronto")
    building = _place("J.G. Hagey Hall of the Humanities", -80.5420, 43.4686, city="Waterloo")
    search, _ = _search({location: [namesake, building]})

    assert map_location_service.locate(location, WATERLOO, search, {}) == (-80.5420, 43.4686)


def test_locate_matches_a_city_named_with_its_place_word():
    location = "Pavillon Alphonse-Desjardins, Université Laval, Québec City"
    building = _place(
        "Pavillon Alphonse-Desjardins", -71.2747, 46.7817, region="CA-QC", city="Québec"
    )
    search, _ = _search({location: [building]})

    assert map_location_service.locate(location, (-71.2747, 46.7817), search, {}) == (
        -71.2747,
        46.7817,
    )


def test_locate_rejects_a_namesake_in_a_neighbouring_city_of_the_same_region():
    location = "The Lounge, University of Waterloo, Waterloo, ON"
    salon = _place(
        "The Grooming Lounge",
        -80.31,
        43.36,
        category="shop",
        kind="hairdresser",
        city="Cambridge",
        county="Region of Waterloo",
    )
    search, _ = _search({location: [salon], "The Lounge, Waterloo, ON": [salon]})

    assert map_location_service.locate(location, WATERLOO, search, {}) is None


def test_locate_rejects_a_same_named_city_in_another_country():
    location = "Sheridan, Western University, London, ON"
    england = _place("Sheridan Place", -0.33, 51.57, kind="yes", region="GB-ENG", city="London")
    search, _ = _search({location: [england], "Sheridan, London, ON": [england]})

    assert map_location_service.locate(location, (-81.2737, 43.0096), search, {}) is None


def test_locate_rejects_the_same_street_address_in_another_city():
    location = "Alumni Ventures, 183 Madison Avenue, New York, NY"
    elsewhere = _place(
        None,
        -73.65,
        40.60,
        category="place",
        kind="house",
        region="US-NY",
        house_number="183",
        road="Madison Avenue",
        village="Island Park",
    )
    manhattan = _place(
        None,
        -73.98,
        40.75,
        category="place",
        kind="house",
        region="US-NY",
        house_number="183",
        road="Madison Avenue",
        city="New York",
        borough="Manhattan",
    )
    search, _ = _search({"183 Madison Avenue, New York, NY": [elsewhere, manhattan]})

    assert map_location_service.locate(location, (-73.9965, 40.7295), search, {}) == (-73.98, 40.75)


def test_locate_uses_a_known_building_before_searching():
    known = {
        "Davis Centre": (-80.54204, 43.4725),
        "University Community Centre": (-81.27617, 43.00866),
    }
    search, asked = _search({})

    assert map_location_service.locate(
        "Davis Center (DC), University of Waterloo, 200 University Ave W, Waterloo, ON",
        WATERLOO,
        search,
        known,
    ) == (-80.54204, 43.4725)
    # A bar inside a known building is placed at that building.
    assert map_location_service.locate(
        "Mustang Lounge, University Community Centre, Western University, London, ON",
        WATERLOO,
        search,
        known,
    ) == (-81.27617, 43.00866)
    assert asked == []


def test_look_up_next_uses_the_school_known_places(fake_sb, searched, monkeypatch):
    search, asked = searched
    places = {"uwaterloo": {"Davis Centre": (-80.54204, 43.4725)}}
    monkeypatch.setattr(
        map_location_service,
        "CONTROL",
        map_location_service.CONTROL.model_copy(update={"known_places": places}),
    )
    fake_sb.set_response(data=_claimed("Davis Centre, Waterloo, ON"))

    assert map_location_service.look_up_next(search) == ("uwaterloo", True)

    assert fake_sb.update.call_args.args[0]["coordinates"] == [-80.54204, 43.4725]
    assert asked == []
