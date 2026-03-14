"""
Allowed student email domains mapped to schools.
Only emails from these domains can sign up.
"""

ALLOWED_EMAIL_DOMAINS: dict[str, str] = {
    "uwaterloo.ca": "University of Waterloo",
    "edu.uwaterloo.ca": "University of Waterloo",
    "wlu.ca": "Wilfrid Laurier University",
    "mylaurier.ca": "Wilfrid Laurier University",
    "uoguelph.ca": "University of Guelph",
    "conestogac.on.ca": "Conestoga College",
}


def get_school_for_email(email: str) -> str | None:
    """Return the school for an email domain, or None if not allowed."""
    email = (email or "").strip().lower()
    if "@" not in email:
        return None
    domain = email.split("@")[-1]
    return ALLOWED_EMAIL_DOMAINS.get(domain)


def is_email_allowed(email: str) -> bool:
    """Check if the email domain is in the allowed list."""
    return get_school_for_email(email) is not None
