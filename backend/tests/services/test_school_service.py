from services import school_service


def test_search_schools_matches_domain_fragment(monkeypatch):
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
    monkeypatch.setattr(
        school_service,
        "ALLOWED_EMAIL_DOMAINS",
        {"uwaterloo.ca": "University of Waterloo"},
    )

    assert school_service.search_schools("   ") == []
