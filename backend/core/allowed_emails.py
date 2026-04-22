"""
Allowed student email domains mapped to schools.
Only emails from these domains can sign up.
"""

import logging
import unicodedata

log = logging.getLogger(__name__)

ALLOWED_EMAIL_DOMAINS: dict[str, str] = {
    "uwaterloo.ca": "University of Waterloo",
    "edu.uwaterloo.ca": "University of Waterloo",
    "wlu.ca": "Wilfrid Laurier University",
    "mylaurier.ca": "Wilfrid Laurier University",
    "uoguelph.ca": "University of Guelph",
    "conestogac.on.ca": "Conestoga College",
}


def _has_control_chars(value: str) -> bool:
    """Return True if *value* contains ASCII control characters (including CR/LF/NUL).

    Used to reject header-injection and smuggled-payload email inputs before
    the value reaches Supabase or the allowlist lookup.
    """
    return any(ord(c) < 0x20 or ord(c) == 0x7F for c in value)


def _normalize_domain(domain: str) -> str | None:
    """Return the ASCII/punycode form of *domain*, or None if it's unparseable.

    A5: Unicode homograph attacks (e.g. ``uwaterloо.ca`` with a Cyrillic ``о``)
    otherwise bypass the ASCII allowlist.  Applying NFKC normalisation and
    IDNA encoding folds look-alikes down to their punycode form so the
    allowlist check is performed on the canonical ASCII domain.
    """
    try:
        normalised = unicodedata.normalize("NFKC", domain)
        return normalised.encode("idna").decode("ascii").lower()
    except (UnicodeError, UnicodeDecodeError) as e:
        log.warning("Failed to normalise email domain %r: %s", domain, e)
        return None


def get_school_for_email(email: str) -> str | None:
    """Return the school for an email domain, or None if not allowed.

    Rejects inputs with embedded ``@`` in the local part (e.g. smuggled
    header-injection payloads like ``a@b@uwaterloo.ca``).  Splits on the
    LAST ``@`` so a legitimate ``user@sub.uwaterloo.ca`` still maps, but
    the split must produce *exactly* two parts.

    A5: Applies Unicode NFKC normalisation + IDNA encoding to the domain
    before the dictionary lookup so Cyrillic/Greek homographs of allowed
    domains resolve to their punycode form (never in ``ALLOWED_EMAIL_DOMAINS``)
    rather than silently bypassing the check.  Also rejects inputs containing
    ASCII control characters, which would otherwise reach Supabase unfiltered.
    """
    email = (email or "").strip()
    if not email or _has_control_chars(email):
        return None
    email = email.lower()
    # ``rsplit("@", 1)`` returns 1 element if no ``@`` is present, and at most 2
    # even when the input contains many.  A legitimate email has exactly one ``@``
    # — so we require ``count("@") == 1`` AND a non-empty local part.
    if email.count("@") != 1:
        return None
    local, _, domain = email.rpartition("@")
    if not local or not domain:
        return None
    canonical = _normalize_domain(domain)
    if canonical is None:
        return None
    return ALLOWED_EMAIL_DOMAINS.get(canonical)


def is_email_allowed(email: str) -> bool:
    """Check if the email domain is in the allowed list."""
    return get_school_for_email(email) is not None
