from services.outreach import service

ROW = {
    "id": "99999999-9999-4999-8999-999999999992",
    "club_id": 10,
    "email": "boardgames@example.com",
    "email_source_url": "https://example.com/clubs/board-games",
    "email_found_by": "club_page",
    "status": "new",
    "notes": "",
    "found_at": "2026-10-28T00:00:00Z",
    "formality": None,
    "formality_signals": [],
    "club": {
        "club_name": "Board Games Club",
        "school_id": 7,
        "school": {"slug": "uwaterloo", "name": "University of Waterloo"},
    },
}


def test_a_lead_invites_the_club_to_claim_the_page_we_made_for_it():
    lead = service._lead({**ROW, "club": dict(ROW["club"])}, listings=4)

    assert lead.club_url == "https://uwaterloo.wat2do.io/clubs/10"
    assert lead.listings == 4 and lead.school_name == "University of Waterloo"
    assert "Board Games Club" in lead.email_subject
    for text in (lead.email_body, lead.follow_up):
        assert lead.club_url in text
        assert "Claim club" in text
        assert "University of Waterloo" in text
        assert service.CONTROL.sender_name in text
        assert "{{" not in text and "—" not in text
    assert "made a page for you and added your events" in lead.email_body
