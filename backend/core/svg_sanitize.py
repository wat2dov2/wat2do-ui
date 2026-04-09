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
5. Sanitize ``<style>`` elements and inline ``style`` attributes to
   remove CSS-based attack vectors (``@import``, ``url()``,
   ``expression()``, ``-moz-binding``, ``behavior:``).
6. Re-serialize the cleaned tree.

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

# ── Dangerous CSS patterns ───────────────────────────────────────────
# CSS properties/functions that can load external resources, execute
# expressions, or trigger XSS.  Applied to both <style> element text
# and inline style="..." attributes.
#
# @import url(...)       — loads external stylesheets (data exfil)
# url(...)               — loads external resources (fonts, backgrounds)
# expression(...)        — IE CSS expression (arbitrary JS)
# -moz-binding: url(...) — old Firefox XBL bindings (arbitrary JS)
# behavior: url(...)     — IE DHTML behaviors (arbitrary JS)
#
# We strip lines/declarations matching these rather than removing the
# entire <style>, because legitimate SVGs (Illustrator, Inkscape) rely
# on <style> for basic fills, fonts, and class-based styling.
_CSS_DANGEROUS_RE = re.compile(
    r"""
      @import\b          # @import rule (loads external stylesheet)
    | expression\s*\(    # IE CSS expression (JS execution)
    | -moz-binding\s*:   # Firefox XBL binding (JS execution)
    | behavior\s*:       # IE DHTML behavior (JS execution)
    | url\s*\(           # url() function (external resource load)
    """,
    re.IGNORECASE | re.VERBOSE,
)

# ── Safe URI scheme allowlist ─────────────────────────────────────────
# Instead of trying to blocklist dangerous schemes (javascript:, vbscript:,
# etc.), we allowlist known-safe schemes.  This is more robust because new
# dangerous schemes or encoding tricks cannot bypass it.
#
# Allowed:
#   - http: / https:  — normal links
#   - data:image/<raster> — inline raster images (png, jpeg, webp, gif)
#     (data:image/svg+xml is NOT allowed — nested SVGs can contain <script>)
#   - Fragment-only (#id) and relative paths — safe, no scheme at all
#
# The scheme is extracted *after* stripping all ASCII whitespace from the
# value prefix, defeating attacks like "java\nscript:" or "java&#9;script:"
# where the XML parser resolves &#10;/&#9; into literal whitespace that
# browsers silently strip when evaluating URI schemes.
_SAFE_URI_SCHEME_RE = re.compile(
    r"^(https?:|data:image/(?!svg\+xml)[a-z]+[;,]|#|/[^/])",
    re.IGNORECASE,
)

# Characters browsers strip from URI schemes before evaluating them.
# Covers tab (\t), newline (\n), carriage return (\r), and space.
_SCHEME_WHITESPACE_RE = re.compile(r"[\t\n\r ]+")

# Maximum prefix length to inspect when extracting the scheme.
# "data:image/svg+xml;..." is ~22 chars — 40 is generous.
_SCHEME_PREFIX_LEN = 40

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

    # Strip BOM and decode to text.  XML (and therefore SVG) can be
    # encoded as UTF-8, UTF-16 LE, or UTF-16 BE.  Browsers silently
    # handle all three, so we must detect SVG in each encoding to
    # prevent Content-Type spoofing (e.g. uploading a UTF-16 SVG as
    # "image/png" to bypass sanitization).
    if head.startswith(b"\xef\xbb\xbf"):
        # UTF-8 BOM
        head = head[3:]
        encoding = "utf-8"
    elif head.startswith(b"\xff\xfe"):
        # UTF-16 LE BOM
        head = head[2:]
        encoding = "utf-16-le"
    elif head.startswith(b"\xfe\xff"):
        # UTF-16 BE BOM
        head = head[2:]
        encoding = "utf-16-be"
    elif b"\x00" in head[:4]:
        # No BOM but null bytes in the first 4 bytes suggest UTF-16.
        # UTF-16 BE "<" is 0x00 0x3C; UTF-16 LE "<" is 0x3C 0x00.
        encoding = "utf-16-be" if head[0:1] == b"\x00" else "utf-16-le"
    else:
        encoding = "utf-8"

    try:
        text = head.decode(encoding, errors="strict").lstrip()
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


def _sanitize_css(text: str) -> str:
    """Remove dangerous constructs from CSS text.

    Strips entire lines/declarations that contain ``@import``,
    ``url()``, ``expression()``, ``-moz-binding``, or ``behavior:``.
    Returns the cleaned CSS string (may be empty).
    """
    if not text:
        return text
    # Process line by line.  A single @import or url() taints the whole
    # line — attempting to surgically remove just the function call is
    # fragile and easy to bypass with creative whitespace/comments.
    cleaned_lines: list[str] = []
    for line in text.splitlines(keepends=True):
        if _CSS_DANGEROUS_RE.search(line):
            logger.warning(
                "SVG sanitizer: stripped dangerous CSS line: %s",
                line.strip()[:120],
            )
            continue
        cleaned_lines.append(line)
    return "".join(cleaned_lines)


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

        # <style> elements: keep the element but sanitize its CSS text to
        # strip @import, url(), expression(), -moz-binding, behavior:.
        # If nothing survives, remove the empty <style> entirely.
        if _local_name(child.tag) == "style":
            if child.text:
                child.text = _sanitize_css(child.text)
            if not (child.text and child.text.strip()):
                logger.warning("SVG sanitizer: removed empty/dangerous <style> element")
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

        # Inline style attributes: sanitize CSS to strip url(),
        # expression(), @import, etc.  If nothing survives, remove
        # the attribute entirely.
        if attr_lower == "style":
            cleaned = _sanitize_css(value)
            if cleaned and cleaned.strip():
                el.attrib[attr] = cleaned
            else:
                to_remove.append(attr)
            continue

        # URI attributes: only allow known-safe schemes.  Strip
        # whitespace from the scheme prefix first — browsers ignore
        # whitespace in schemes, so "java\nscript:" executes as
        # "javascript:" but would bypass a naive regex.
        if attr_lower in _URI_ATTRS:
            stripped = _SCHEME_WHITESPACE_RE.sub("", value[:_SCHEME_PREFIX_LEN])
            # Allow empty/relative values, fragment refs, and safe schemes.
            # Block everything else (javascript:, vbscript:, data:text/html, ...).
            if stripped and not _SAFE_URI_SCHEME_RE.match(stripped):
                to_remove.append(attr)
                continue

    for attr in to_remove:
        logger.warning(
            "SVG sanitizer: stripped dangerous attribute %s from <%s>",
            attr,
            _local_name(el.tag),
        )
        del el.attrib[attr]
