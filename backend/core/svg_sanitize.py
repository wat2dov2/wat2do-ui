"""SVG sanitization to prevent stored XSS.

SVG files can embed ``<script>`` tags, event-handler attributes
(``onload``, ``onclick``, ...), ``<foreignObject>`` (embeds arbitrary
HTML), ``xlink:href="javascript:..."`` URIs, and more.  Since the
backend accepts SVG uploads for club logos and QR assets, every SVG
must be sanitized before it reaches Supabase storage.

Strategy:
1. Parse with ``defusedxml`` to block entity-expansion attacks (billion
   laughs / XML bombs) that could OOM-crash the process.
2. Verify the payload is well-formed XML with an ``<svg>`` root.
3. Walk the element tree and remove dangerous elements entirely.
4. Strip dangerous attributes (event handlers, javascript: URIs).
5. Re-serialize the cleaned tree.

This runs at upload time — the stored file is always the sanitized
version, so the attack surface is eliminated regardless of how
Supabase storage serves the file.
"""

import re
import xml.etree.ElementTree as ET
from io import BytesIO

import defusedxml.ElementTree as DefusedET
from defusedxml import DTDForbidden, EntitiesForbidden, ExternalReferenceForbidden

from core.logging import logger

# Register common SVG/XLink namespaces so ET.write() doesn't mangle
# them into "ns0:", "ns1:", etc.
ET.register_namespace("", "http://www.w3.org/2000/svg")
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")

# ── Dangerous elements (removed entirely, including children) ─────────
# Keep this set lowercase; comparisons are done after lowering.
_DANGEROUS_ELEMENTS: set[str] = {
    "script",
    "foreignobject",
    "iframe",
    "object",
    "embed",
    "applet",
    "math",            # MathML can embed scripts
    "handler",         # SVG animation event handler element
    "set",             # can trigger via event attributes
    # <use> can pull in external SVGs (including script-bearing ones) via
    # xlink:href / href, and the referenced content is rendered inline.
    # Even data:image/svg+xml URIs bypass the URI check because it
    # intentionally allows data:image/* for raster images.
    "use",
    # SVG animation elements can manipulate attribute values at runtime,
    # e.g. <animate attributeName="href" to="javascript:alert(1)"/>.
    # Static attribute scanning cannot catch these runtime injections.
    "animate",
    "animatetransform",
    "animatemotion",
}

# ── Dangerous attribute patterns ──────────────────────────────────────
# Event handlers: any attribute starting with "on" (onclick, onload, onerror, ...).
_EVENT_HANDLER_RE = re.compile(r"^on", re.IGNORECASE)

# Attributes whose *values* can carry javascript:/data: payloads.
_URI_ATTRS: set[str] = {
    "href",
    "xlink:href",
    "src",
    "action",
    "formaction",
    "data",
    "background",
}

# Block javascript:, vbscript:, and dangerous data: URIs.
# data:image/svg+xml is blocked because nested SVGs can contain <script>;
# the sanitizer cannot recurse into base64-encoded payloads.
# Other data:image/* (png, jpeg, webp, gif) are safe raster formats.
_DANGEROUS_URI_RE = re.compile(
    r"^\s*(javascript|vbscript|data\s*:(?!image/(?!svg\+xml)))",
    re.IGNORECASE,
)

# Namespace-unaware local-name extraction: "{http://...}tagname" -> "tagname"
_LOCAL_NAME_RE = re.compile(r"\{[^}]*\}")


def _local_name(tag: str) -> str:
    """Return the local name of a possibly namespace-qualified tag."""
    return _LOCAL_NAME_RE.sub("", tag).lower()


def _attr_local_name(attr: str) -> str:
    """Return the local name of a possibly namespace-qualified attribute."""
    return _LOCAL_NAME_RE.sub("", attr).lower()


def looks_like_svg(raw: bytes) -> bool:
    """Return ``True`` if *raw* appears to be SVG content.

    SVG files are XML with an ``<svg`` root element.  We peek at the first
    4 KiB (skipping any leading whitespace, BOM, or XML declaration) and
    look for the ``<svg`` tag.  This catches SVG payloads regardless of
    the ``Content-Type`` the client claims, preventing sanitizer bypass
    via Content-Type spoofing.
    """
    # Only inspect the first 4 KiB — enough to find the root element
    # without scanning multi-megabyte raster images.
    head = raw[:4096]

    # Strip UTF-8 BOM if present.
    if head.startswith(b"\xef\xbb\xbf"):
        head = head[3:]

    # Decode to text for case-insensitive matching; SVG is always XML
    # (UTF-8/UTF-16/ASCII).  If decoding fails it cannot be valid SVG.
    try:
        text = head.decode("utf-8", errors="strict").lstrip()
    except (UnicodeDecodeError, ValueError):
        return False

    # Strip XML declaration (<?xml ...?>) if present.
    if text.startswith("<?xml"):
        close = text.find("?>")
        if close != -1:
            text = text[close + 2:].lstrip()

    # Strip DOCTYPE if present.
    if text.upper().startswith("<!DOCTYPE"):
        close = text.find(">")
        if close != -1:
            text = text[close + 1:].lstrip()

    # Check for <svg (case-insensitive) — may be namespaced.
    text_lower = text.lower()
    return text_lower.startswith("<svg") or text_lower.startswith("<!doctype svg")


def sanitize_svg(raw: bytes) -> bytes:
    """Sanitize SVG content, returning cleaned SVG bytes.

    Raises ``ValueError`` if the input is not valid XML or does not have
    an ``<svg>`` root element.
    """
    # ── Parse ─────────────────────────────────────────────────────────
    try:
        tree = DefusedET.parse(BytesIO(raw))
    except (DTDForbidden, EntitiesForbidden, ExternalReferenceForbidden) as exc:
        raise ValueError(f"Invalid XML: {exc}") from exc
    except ET.ParseError as exc:
        raise ValueError(f"Invalid XML: {exc}") from exc

    root = tree.getroot()
    if _local_name(root.tag) != "svg":
        raise ValueError(
            f"Root element is <{_local_name(root.tag)}>, expected <svg>"
        )

    # ── Walk and clean ────────────────────────────────────────────────
    _clean_element(root)

    # ── Serialize ─────────────────────────────────────────────────────
    out = BytesIO()
    tree.write(out, xml_declaration=True, encoding="utf-8")
    return out.getvalue()


def _clean_element(el: ET.Element) -> None:
    """Recursively remove dangerous children and attributes from *el*."""

    # Remove dangerous child elements (iterate over a copy so we can mutate).
    for child in list(el):
        if _local_name(child.tag) in _DANGEROUS_ELEMENTS:
            logger.warning(
                "SVG sanitizer: stripped dangerous element <%s>",
                _local_name(child.tag),
            )
            el.remove(child)
            continue
        # Recurse into safe children.
        _clean_element(child)

    # Strip dangerous attributes.
    to_remove: list[str] = []
    for attr, value in el.attrib.items():
        attr_lower = _attr_local_name(attr)

        # Event handler attributes (onclick, onload, etc.)
        if _EVENT_HANDLER_RE.match(attr_lower):
            to_remove.append(attr)
            continue

        # URI attributes with javascript:/vbscript:/data: schemes
        if attr_lower in _URI_ATTRS and _DANGEROUS_URI_RE.search(value):
            to_remove.append(attr)
            continue

    for attr in to_remove:
        logger.warning(
            "SVG sanitizer: stripped dangerous attribute %s from <%s>",
            attr,
            _local_name(el.tag),
        )
        del el.attrib[attr]
