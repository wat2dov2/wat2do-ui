"""How official a club looks, out of 100, from what the outreach sweep already read.

A club listed in its school's or union's directory, or with a site of its own, with an
address on the school's or its own domain, a steady record of events and positions,
an Instagram account and a formal name scores high; a group with none of these, or a
confession or meme account, scores low. Each lead keeps the signals behind its score,
so the admin page can say why.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from core.controlbox import controlbox

CONTROL = controlbox.outreach.formality
INFORMAL_ACCOUNT = "informal_account"
_HOST = re.compile(r"^https?://(?:www\.)?([^/?#]+)", re.IGNORECASE)


@dataclass(frozen=True)
class ClubFacts:
    club_name: str
    ig: str | None
    club_page: str | None
    email: str | None
    listings: int
    # How many clubs list a page on the same host as this club's page.
    page_host_clubs: int
    school_domains: list[str]


def score(club: ClubFacts) -> tuple[int, list[str]]:
    """The club's formality out of 100 and the signals that earned it."""
    signals = [
        signal
        for signal in (
            _page_signal(club),
            _email_signal(club.email, club.school_domains),
            _listings_signal(club.listings),
            "instagram" if club.ig else None,
            "formal_name" if _has_word(club.club_name, CONTROL.formal_words) else None,
        )
        if signal
    ]
    total = sum(CONTROL.points[signal] for signal in signals)
    if _has_word(f"{club.club_name} {club.ig or ''}", CONTROL.informal_words):
        return min(total, CONTROL.informal_cap), [*signals, INFORMAL_ACCOUNT]
    return total, signals


def _page_signal(club: ClubFacts) -> str | None:
    match = _HOST.match(club.club_page or "")
    if match is None:
        return None
    host = match.group(1).lower()
    if any(host == link or host.endswith(f".{link}") for link in CONTROL.link_hosts):
        return None
    if club.page_host_clubs >= CONTROL.directory_min_clubs:
        return "directory_page"
    return "own_website"


def _email_signal(email: str | None, school_domains: list[str]) -> str | None:
    if not email:
        return None
    domain = email.rpartition("@")[2].lower()
    if domain.endswith(".edu") or any(
        domain == school or domain.endswith(f".{school}") for school in school_domains
    ):
        return "school_email"
    if domain in CONTROL.free_email_domains:
        return "free_email"
    return "own_domain_email"


def _listings_signal(listings: int) -> str | None:
    if listings >= CONTROL.many_listings:
        return "many_listings"
    if listings >= CONTROL.some_listings:
        return "some_listings"
    if listings >= 1:
        return "few_listings"
    return None


def _has_word(text: str, words: list[str]) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in words)
