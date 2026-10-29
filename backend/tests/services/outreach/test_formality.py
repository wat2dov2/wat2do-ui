import pytest

from services.outreach.formality import ClubFacts, score


def facts(**overrides):
    base = {
        "club_name": "Board Games Club",
        "ig": "uwboardgames",
        "club_page": "https://clubs.wusa.ca/club/12",
        "email": "boardgames@uwaterloo.ca",
        "listings": 14,
        "page_host_clubs": 300,
        "school_domains": ["uwaterloo.ca"],
    }
    return ClubFacts(**{**base, **overrides})


def test_a_directory_listed_active_club_on_a_school_address_scores_100():
    assert score(facts()) == (
        100,
        ["directory_page", "school_email", "many_listings", "instagram", "formal_name"],
    )


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        # A page on a host few clubs share is the club's own site.
        ({"page_host_clubs": 1}, (90, ["own_website"])),
        ({"club_page": "https://linktr.ee/uwboardgames"}, (65, [])),
        ({"club_page": None}, (65, [])),
        ({"email": "games@boardgames.org"}, (95, ["own_domain_email"])),
        ({"email": "uwboardgames@gmail.com"}, (85, ["free_email"])),
        ({"email": "games@cs.uwaterloo.ca"}, (100, ["school_email"])),
        ({"email": "games@umich.edu", "school_domains": []}, (100, ["school_email"])),
        ({"email": None}, (75, [])),
        ({"listings": 4}, (90, ["some_listings"])),
        ({"listings": 1}, (83, ["few_listings"])),
        ({"ig": None, "club_name": "Board Games"}, (85, [])),
    ],
)
def test_each_signal_adds_its_points(overrides, expected):
    value, signals = score(facts(**overrides))
    assert value == expected[0]
    assert set(expected[1]) <= set(signals)


def test_confession_and_meme_accounts_are_capped_however_busy():
    value, signals = score(facts(club_name="UW Confessions", ig="uwconfessions"))
    assert value == 10 and signals[-1] == "informal_account"
    assert score(facts(club_name="Chill Group", ig="uw.memes.daily"))[0] == 10


def test_an_informal_group_with_nothing_official_scores_low():
    assert score(
        facts(club_name="Friday hangs", ig=None, club_page=None, email=None, listings=1)
    ) == (8, ["few_listings"])
