"""Instagram intended-recipient ID to canonical school name mappings.

Used by the process-single-user workflow when the webhook payload includes
``intended_recipient_id`` but no explicit ``school``.
"""

RECIPIENT_ID_TO_SCHOOL: dict[str, str] = {
    "76214170483": "University of Waterloo",
    "78383689040": "University of Toronto Mississauga",
}
