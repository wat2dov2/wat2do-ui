from core import allowed_emails
from services import school_service


def _stub_loaded(monkeypatch):
    """Mark allowed_emails as already loaded so school_service doesn't hit Supabase."""
    monkeypatch.setattr(allowed_emails, "_loaded", True)


def test_search_schools_matches_domain_fragment(monkeypatch):
    _stub_loaded(monkeypatch)
    monkeypatch.setattr(
        school_service,
        "ALLOWED_EMAIL_DOMAINS",
        {
            "uwaterloo.ca": "University of Waterloo",
            "mit.edu": "Massachusetts Institute of Technology",
            "nyu.edu": "New York University",
            "columbia.edu": "Columbia University",
        },
    )

    assert school_service.search_schools("mit.edu") == [
        "Massachusetts Institute of Technology",
    ]


def test_search_schools_returns_empty_list_for_blank_query(monkeypatch):
    _stub_loaded(monkeypatch)
    monkeypatch.setattr(
        school_service,
        "ALLOWED_EMAIL_DOMAINS",
        {"uwaterloo.ca": "University of Waterloo"},
    )

    assert school_service.search_schools("   ") == []
