"""
Allowed student email domains mapped to schools.
Only emails from these domains can sign up.

The {domain -> school slug} mapping is stored in the Supabase
``school_email_domains`` table (joined to ``schools``) and is loaded
lazily on first lookup.  Falls back to a hardcoded UWaterloo entry if
Supabase is unreachable so the app still boots.

School display names, aliases, and timezones live in
``core.constants.school_mappings`` - not loaded here.
"""

import logging
import unicodedata

log = logging.getLogger(__name__)

# Hardcoded safety net so the app still resolves UWaterloo emails if
# Supabase is unreachable at first-lookup time.  The seed migration
# 20260610180000 writes the same entries to ``school_email_domains`` so
# the values match.
FALLBACK_DOMAINS: dict[str, str] = {
    "uwaterloo.ca": "uwaterloo",
    "edu.uwaterloo.ca": "uwaterloo",
}

# Dynamic mapping of domain -> school slug.  Lazily populated on first
# lookup from the ``school_email_domains`` table.  Tests can monkeypatch
# this dict directly; set ``_loaded`` to True to skip the Supabase load.
ALLOWED_EMAIL_DOMAINS: dict[str, str] = {}
_loaded: bool = False


def _has_control_chars(value: str) -> bool:
    """Return True if *value* contains ASCII control characters (including CR/LF/NUL).

    Used to reject header-injection and smuggled-payload email inputs before
    the value reaches Supabase or the allowlist lookup.
    """
    return any(ord(c) < 0x20 or ord(c) == 0x7F for c in value)


def _normalize_domain(domain: str) -> str | None:
    """Return the ASCII/punycode form of *domain*, or None if it's unparseable.

    Unicode homograph attacks (e.g. ``uwaterloо.ca`` with a Cyrillic ``о``)
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


def load_allowed_domains() -> None:
    """Populate ``ALLOWED_EMAIL_DOMAINS`` from Supabase, merging fallback entries.

    Idempotent - sets ``_loaded`` so subsequent calls are no-ops.  Imported
    lazily inside the function so module import doesn't trigger a Supabase
    client construction (matters for scripts and tests).
    """
    global _loaded
    ALLOWED_EMAIL_DOMAINS.clear()
    ALLOWED_EMAIL_DOMAINS.update(FALLBACK_DOMAINS)

    try:
        from core.database import get_sb
        from core.tables import SCHOOL_EMAIL_DOMAINS

        sb = get_sb()
        res_domains = sb.table(SCHOOL_EMAIL_DOMAINS).select("domain, schools(name)").execute()
        for row in res_domains.data or []:
            domain = row.get("domain")
            school = (row.get("schools") or {}).get("name")
            if not domain or not school:
                continue
            canonical = _normalize_domain(domain)
            if canonical and canonical not in ALLOWED_EMAIL_DOMAINS:
                ALLOWED_EMAIL_DOMAINS[canonical] = school.strip().lower()
    except Exception as e:
        log.error("Failed to load school email domains from Supabase: %s", e)

    _loaded = True


def _ensure_loaded() -> None:
    if not _loaded:
        load_allowed_domains()


def get_school_for_email(email: str) -> str | None:
    """Return the school slug for an email domain, or None if not allowed.

    Rejects inputs with embedded ``@`` in the local part (e.g. smuggled
    header-injection payloads like ``a@b@uwaterloo.ca``).  Splits on the
    LAST ``@`` so a legitimate ``user@sub.uwaterloo.ca`` still maps, but
    the split must produce *exactly* two parts.

    Applies Unicode NFKC normalisation + IDNA encoding to the domain
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
    # - so we require ``count("@") == 1`` AND a non-empty local part.
    if email.count("@") != 1:
        return None
    local, _, domain = email.rpartition("@")
    if not local or not domain:
        return None
    canonical = _normalize_domain(domain)
    if canonical is None:
        return None
    _ensure_loaded()
    return ALLOWED_EMAIL_DOMAINS.get(canonical)


def is_email_allowed(email: str) -> bool:
    """Check if the email domain is in the allowed list."""
    return get_school_for_email(email) is not None
