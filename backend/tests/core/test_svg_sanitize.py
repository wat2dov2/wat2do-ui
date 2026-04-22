"""Tests for core.svg_sanitize — SVG XSS prevention."""

import pytest

from core.svg_sanitize import looks_like_svg, sanitize_svg


class TestSanitizeSvg:
    """Verify that dangerous SVG content is stripped at upload time."""

    # ── Valid SVGs pass through (minus dangerous parts) ───────────────

    def test_clean_svg_preserved(self):
        """A benign SVG passes through sanitization intact."""
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="50" height="50"/></svg>'
        result = sanitize_svg(svg)
        assert b"<rect" in result
        assert b"<svg" in result or b":svg" in result

    def test_preserves_style_attributes(self):
        """Non-dangerous attributes like style, fill, stroke are kept."""
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="red" stroke="black"/></svg>'
        result = sanitize_svg(svg)
        assert b'fill="red"' in result
        assert b'stroke="black"' in result

    # ── Script elements removed ───────────────────────────────────────

    def test_strips_script_element(self):
        """<script> tags are removed entirely."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<script>alert('xss')</script>"
            b"<rect width='50' height='50'/>"
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"<script" not in result
        assert b"alert" not in result
        assert b"<rect" in result

    def test_strips_nested_script(self):
        """Scripts nested inside groups are still removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<g><script>alert(1)</script></g>"
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"<script" not in result
        assert b"alert" not in result

    # ── foreignObject removed ─────────────────────────────────────────

    def test_strips_foreignobject(self):
        """<foreignObject> (embeds arbitrary HTML) is removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<foreignObject><body><script>alert(1)</script></body></foreignObject>"
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"foreignObject" not in result.lower()
        assert b"alert" not in result

    # ── Event handler attributes stripped ──────────────────────────────

    def test_strips_onload(self):
        """onload attribute is removed."""
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="50" height="50"/></svg>'
        result = sanitize_svg(svg)
        assert b"onload" not in result
        assert b"alert" not in result

    def test_strips_onclick(self):
        """onclick attribute is removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<rect width="50" height="50" onclick="alert(1)"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"onclick" not in result

    def test_strips_onerror(self):
        """onerror attribute is removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<image href="x" onerror="alert(1)"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"onerror" not in result

    # ── javascript: URI attributes stripped ────────────────────────────

    def test_strips_javascript_href(self):
        """href="javascript:..." is removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="javascript:alert(1)"><text>click</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"javascript" not in result

    def test_strips_xlink_href_javascript(self):
        """xlink:href="javascript:..." is removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg" '
            b'xmlns:xlink="http://www.w3.org/1999/xlink">'
            b'<a xlink:href="javascript:alert(1)"><text>click</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"javascript" not in result

    def test_strips_javascript_newline_entity_bypass(self):
        """&#10; (newline) in scheme: java&#10;script: is blocked.

        The XML parser resolves &#10; to a literal newline.  Browsers
        strip whitespace from URI schemes, executing the script.  The
        sanitizer must strip whitespace before checking the scheme.
        """
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="java&#10;script:alert(1)"><text>click</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"script:" not in result

    def test_strips_javascript_tab_entity_bypass(self):
        """&#9; (tab) in scheme is blocked."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="java&#9;script:alert(1)"><text>click</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"script:" not in result

    def test_strips_javascript_cr_entity_bypass(self):
        """&#13; (carriage return) in scheme is blocked."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="java&#13;script:alert(1)"><text>click</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"script:" not in result

    def test_strips_xlink_href_whitespace_bypass(self):
        """xlink:href with whitespace-obfuscated javascript: is blocked."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg" '
            b'xmlns:xlink="http://www.w3.org/1999/xlink">'
            b'<a xlink:href="java&#10;script:alert(1)"><text>click</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"script:" not in result

    def test_strips_vbscript_whitespace_bypass(self):
        """vbscript with embedded whitespace entity is blocked."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="vb&#10;script:alert(1)"><text>click</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"script:" not in result

    def test_safe_href_preserved(self):
        """Non-javascript hrefs are kept."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="https://example.com"><text>link</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"https://example.com" in result

    def test_safe_http_href_preserved(self):
        """Plain http: links are kept."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="http://example.com"><text>link</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"http://example.com" in result

    def test_fragment_href_preserved(self):
        """Fragment-only hrefs (#id) are kept."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="#section1"><text>link</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"#section1" in result

    def test_relative_path_href_preserved(self):
        """Relative path hrefs are kept."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="/images/icon.png"><text>link</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"/images/icon.png" in result

    def test_empty_href_preserved(self):
        """Empty href is kept (not dangerous)."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href=""><text>link</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b'href=""' in result

    # ── data: URI handling ────────────────────────────────────────────

    def test_strips_data_uri_non_image(self):
        """data: URIs that are not images are removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><text>x</text></a>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"data:text/html" not in result

    def test_allows_data_image_uri(self):
        """data:image/... URIs are safe and preserved."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<image href="data:image/png;base64,iVBOR..."/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"data:image/png" in result

    # ── <use> element removed ────────────────────────────────────────

    def test_strips_use_element(self):
        """<use> is removed — it can pull in external SVGs with scripts."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg" '
            b'xmlns:xlink="http://www.w3.org/1999/xlink">'
            b'<use xlink:href="https://evil.com/payload.svg#fragment"/>'
            b'<rect width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"<use" not in result
        assert b"evil.com" not in result
        assert b"<rect" in result

    def test_strips_use_with_data_svg_uri(self):
        """<use href="data:image/svg+xml,..."> is removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<use href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"<use" not in result

    # ── Animation elements removed ────────────────────────────────────

    def test_strips_animate(self):
        """<animate> is removed — can inject javascript: via runtime attribute manipulation."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="https://safe.com"><text>link</text>'
            b'<animate attributeName="href" to="javascript:alert(1)" begin="0s"/>'
            b"</a></svg>"
        )
        result = sanitize_svg(svg)
        assert b"<animate" not in result
        assert b"javascript" not in result
        # The <a> and <text> survive
        assert b"<text" in result or b":text" in result

    def test_strips_animatetransform(self):
        """<animateTransform> is removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<rect width='50' height='50'>"
            b'<animateTransform attributeName="transform" type="rotate" '
            b'from="0" to="360" dur="1s"/>'
            b"</rect></svg>"
        )
        result = sanitize_svg(svg)
        assert b"animatetransform" not in result.lower()

    def test_strips_animatemotion(self):
        """<animateMotion> is removed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<circle r="5"><animateMotion path="M0,0 L100,100" dur="1s"/></circle>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"animatemotion" not in result.lower()

    # ── data:image/svg+xml URIs blocked ───────────────────────────────

    def test_strips_data_svg_uri_in_href(self):
        """data:image/svg+xml in href is blocked (nested SVG can contain scripts)."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<a href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+">'
            b"<text>x</text></a>"
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"data:image/svg+xml" not in result

    def test_strips_data_svg_uri_in_image(self):
        """data:image/svg+xml in <image> href is blocked."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<image href="data:image/svg+xml,&lt;svg&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/svg&gt;"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"data:image/svg+xml" not in result

    def test_allows_data_raster_image_uris(self):
        """data:image/png and other raster formats are still allowed."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<image href="data:image/png;base64,iVBOR..."/>'
            b'<image href="data:image/jpeg;base64,/9j/..."/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"data:image/png" in result
        assert b"data:image/jpeg" in result

    # ── iframe / embed / object removed ───────────────────────────────

    def test_strips_iframe(self):
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<iframe src="https://evil.com"></iframe>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"iframe" not in result

    def test_strips_embed(self):
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<embed src="https://evil.com"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"embed" not in result.lower()

    # ── Invalid input rejected ────────────────────────────────────────

    def test_rejects_non_xml(self):
        """Non-XML content raises ValueError."""
        with pytest.raises(ValueError, match="Invalid XML"):
            sanitize_svg(b"this is not xml at all")

    def test_rejects_non_svg_root(self):
        """XML with a non-svg root element raises ValueError."""
        with pytest.raises(ValueError, match="expected <svg>"):
            sanitize_svg(b"<html><body>hello</body></html>")

    def test_rejects_html_disguised_as_svg(self):
        """HTML content claiming to be SVG is rejected."""
        with pytest.raises(ValueError, match="expected <svg>"):
            sanitize_svg(b"<div><script>alert(1)</script></div>")

    # ── XML bomb / entity expansion attacks ────────────────────────────

    def test_rejects_xml_bomb_billion_laughs(self):
        """An XML bomb (billion laughs) is rejected, not expanded."""
        # This payload would expand to ~3 GB with a naive parser.
        xml_bomb = (
            b'<?xml version="1.0"?>'
            b"<!DOCTYPE lolz ["
            b'  <!ENTITY lol "lol">'
            b'  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">'
            b'  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">'
            b'  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">'
            b'  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">'
            b'  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">'
            b'  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">'
            b'  <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">'
            b'  <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">'
            b"]>"
            b'<svg xmlns="http://www.w3.org/2000/svg">&lol9;</svg>'
        )
        with pytest.raises(ValueError, match="Invalid XML"):
            sanitize_svg(xml_bomb)

    def test_rejects_external_entity(self):
        """External entity references (XXE) are blocked."""
        xxe = (
            b'<?xml version="1.0"?>'
            b"<!DOCTYPE svg ["
            b'  <!ENTITY xxe SYSTEM "file:///etc/passwd">'
            b"]>"
            b'<svg xmlns="http://www.w3.org/2000/svg">&xxe;</svg>'
        )
        with pytest.raises(ValueError, match="Invalid XML"):
            sanitize_svg(xxe)

    # ── CSS-based attack vectors (style elements & attributes) ─────────

    def test_strips_style_with_import(self):
        """<style> with @import is dangerous — loads external stylesheet."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<style>@import url('https://evil.com/exfil.css');</style>"
            b'<rect width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"@import" not in result
        assert b"evil.com" not in result
        assert b"<rect" in result

    def test_strips_style_with_url_function(self):
        """<style> with url() is dangerous — loads external resources."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<style>.bg { background: url('https://evil.com/track.gif'); }</style>"
            b'<rect width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"url(" not in result
        assert b"evil.com" not in result

    def test_strips_style_with_expression(self):
        """<style> with expression() is dangerous — IE JS execution."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<style>.x { width: expression(alert(1)); }</style>"
            b'<rect width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"expression" not in result
        assert b"alert" not in result

    def test_strips_style_with_moz_binding(self):
        """<style> with -moz-binding is dangerous — Firefox XBL."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<style>.x { -moz-binding: url('https://evil.com/xbl.xml#xss'); }</style>"
            b'<rect width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"-moz-binding" not in result
        assert b"evil.com" not in result

    def test_strips_style_with_behavior(self):
        """<style> with behavior: is dangerous — IE DHTML behaviors."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<style>.x { behavior: url('exploit.htc'); }</style>"
            b'<rect width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"behavior" not in result
        assert b"exploit.htc" not in result

    def test_preserves_safe_style_element(self):
        """<style> with only safe CSS (fills, fonts, classes) is preserved."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<style>.cls-1 { fill: red; stroke: #000; stroke-width: 2; }</style>"
            b'<rect class="cls-1" width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"<style" in result or b":style" in result
        assert b"fill: red" in result
        assert b"stroke: #000" in result

    def test_partially_sanitizes_style_element(self):
        """<style> with mixed safe/dangerous rule blocks keeps only safe rule blocks.

        The sanitizer splits on ``}`` so minified CSS (Illustrator / Figma
        exports) can retain legitimate declarations when one block is
        dangerous.  Note: ``@import`` is not wrapped in braces, so it
        attaches to the next ``}``-terminated chunk — that whole chunk
        is dropped.  Safe blocks with their own ``}`` terminator (the
        ``.safe`` block before ``@import``) are retained.
        """
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<style>\n"
            b".safe { fill: blue; }\n"
            b".middle { stroke: red; }\n"
            b".bad { background: url('https://evil.com/track.gif'); }\n"
            b".also-safe { opacity: 0.5; }\n"
            b"</style>"
            b'<rect width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        # Declarations in their own { ... } blocks before and after the
        # dangerous one survive — only .bad (which is surrounded by `}`
        # on both sides) is stripped.
        assert b"fill: blue" in result
        assert b"stroke: red" in result
        assert b"opacity: 0.5" in result
        assert b"url(" not in result
        assert b"evil.com" not in result

    def test_minified_style_preserves_safe_declarations(self):
        """Regression for audit U13: a minified single-line <style> keeps
        the legitimate ``text{fill:red}`` even when a sibling rule is
        stripped for a dangerous ``url(...)``.

        Under the old line-based sanitizer the whole line died and
        Illustrator / Figma exports came out blank — that's what U13
        flagged as a functional regression.
        """
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<style>text{fill:red}body{background:url(http://attacker.com/x.png)}</style>"
            b'<rect width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"text{fill:red}" in result
        assert b"url(" not in result
        assert b"attacker.com" not in result

    def test_removes_fully_dangerous_style_element(self):
        """<style> with only dangerous CSS is removed entirely."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<style>@import url('https://evil.com/exfil.css');</style>"
            b'<rect width="50" height="50"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        # The entire <style> element should be gone when all content is stripped
        assert b"<style" not in result and b":style" not in result

    def test_strips_inline_style_with_url(self):
        """Inline style attribute with url() is sanitized."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<rect width=\"50\" height=\"50\" style=\"background: url('https://evil.com/track.gif');\"/>"
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"url(" not in result
        assert b"evil.com" not in result

    def test_strips_inline_style_with_expression(self):
        """Inline style attribute with expression() is sanitized."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<rect width="50" height="50" style="width: expression(alert(1));"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"expression" not in result
        assert b"alert" not in result

    def test_preserves_safe_inline_style(self):
        """Inline style attribute with safe CSS is preserved."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b'<rect width="50" height="50" style="fill: red; opacity: 0.5;"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"fill: red" in result
        assert b"opacity: 0.5" in result

    # ── Combined attack vectors ───────────────────────────────────────

    def test_combined_attack_fully_sanitized(self):
        """An SVG with multiple attack vectors is fully cleaned."""
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">'
            b"<script>document.cookie</script>"
            b'<rect width="50" height="50" onclick="fetch(\'https://evil.com\')"/>'
            b'<a href="javascript:void(0)"><text>click me</text></a>'
            b"<foreignObject><body>evil</body></foreignObject>"
            b'<circle cx="50" cy="50" r="40" fill="blue"/>'
            b"</svg>"
        )
        result = sanitize_svg(svg)
        assert b"<script" not in result
        assert b"onload" not in result
        assert b"onclick" not in result
        assert b"javascript" not in result
        assert b"foreignObject" not in result.lower()
        assert b"document.cookie" not in result
        # Safe elements survive
        assert b"<circle" in result or b":circle" in result
        assert b"<rect" in result or b":rect" in result
        assert b'fill="blue"' in result


class TestLooksLikeSvg:
    """Verify content-based SVG detection to prevent Content-Type spoofing."""

    def test_detects_basic_svg(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="50" height="50"/></svg>'
        assert looks_like_svg(svg) is True

    def test_detects_svg_with_xml_declaration(self):
        svg = b'<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'
        assert looks_like_svg(svg) is True

    def test_detects_svg_with_doctype(self):
        svg = (
            b'<?xml version="1.0"?>'
            b'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" '
            b'"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'
            b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        )
        assert looks_like_svg(svg) is True

    def test_detects_svg_with_leading_whitespace(self):
        svg = b'   \n\t  <svg xmlns="http://www.w3.org/2000/svg"></svg>'
        assert looks_like_svg(svg) is True

    def test_detects_svg_with_bom(self):
        svg = b'\xef\xbb\xbf<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        assert looks_like_svg(svg) is True

    def test_rejects_png_bytes(self):
        """PNG magic bytes are not SVG."""
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        assert looks_like_svg(png) is False

    def test_rejects_jpeg_bytes(self):
        """JPEG magic bytes are not SVG."""
        jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 100
        assert looks_like_svg(jpeg) is False

    def test_rejects_gif_bytes(self):
        """GIF magic bytes are not SVG."""
        gif = b"GIF89a" + b"\x00" * 100
        assert looks_like_svg(gif) is False

    def test_rejects_webp_bytes(self):
        """WebP magic bytes are not SVG."""
        webp = b"RIFF" + b"\x00" * 4 + b"WEBP" + b"\x00" * 100
        assert looks_like_svg(webp) is False

    def test_rejects_html(self):
        """HTML is not SVG."""
        assert looks_like_svg(b"<html><body>hello</body></html>") is False

    def test_rejects_plain_text(self):
        """Plain text is not SVG."""
        assert looks_like_svg(b"this is not svg at all") is False

    def test_rejects_empty_bytes(self):
        assert looks_like_svg(b"") is False

    def test_rejects_non_utf8_binary(self):
        """Binary data that cannot be decoded as UTF-8 is not SVG."""
        assert looks_like_svg(b"\x80\x81\x82\x83\x84") is False

    # ── UTF-16 detection (defense-in-depth) ──────────────────────────

    def test_detects_utf16_le_with_bom(self):
        """UTF-16 LE SVG with BOM is detected."""
        svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        raw = b"\xff\xfe" + svg.encode("utf-16-le")
        assert looks_like_svg(raw) is True

    def test_detects_utf16_be_with_bom(self):
        """UTF-16 BE SVG with BOM is detected."""
        svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        raw = b"\xfe\xff" + svg.encode("utf-16-be")
        assert looks_like_svg(raw) is True

    def test_detects_utf16_le_without_bom(self):
        """UTF-16 LE SVG without BOM (null byte heuristic) is detected."""
        svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        raw = svg.encode("utf-16-le")
        assert looks_like_svg(raw) is True

    def test_detects_utf16_be_without_bom(self):
        """UTF-16 BE SVG without BOM (null byte heuristic) is detected."""
        svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        raw = svg.encode("utf-16-be")
        assert looks_like_svg(raw) is True

    def test_utf16_svg_is_sanitized(self):
        """A UTF-16 encoded SVG with a script tag is detected and sanitizable."""
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        raw = svg.encode("utf-16")
        assert looks_like_svg(raw) is True
        result = sanitize_svg(raw)
        assert b"<script" not in result
        assert b"alert" not in result

    # ── Regression: audit U1 – DOCTYPE internal subset ───────────────

    def test_detects_svg_with_doctype_internal_subset(self):
        """Audit U1: a DOCTYPE with an internal subset that contains
        ``<!ENTITY ... >`` must not trick the detector into thinking the
        DOCTYPE ended at the entity's ``>``.  The parse-based detector
        correctly skips the whole DOCTYPE and finds ``<svg>`` beyond.
        """
        malicious = (
            b"<!DOCTYPE svg [\n"
            b'<!ENTITY x "foo">\n'
            b"]>\n"
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<script>alert(1)</script>"
            b"</svg>"
        )
        assert looks_like_svg(malicious) is True

    # ── Regression: audit U2 – leading XML comment ───────────────────

    def test_detects_svg_with_leading_comment(self):
        """Audit U2: a leading ``<!-- ... -->`` must not cause the
        detector to skip sanitization.  The fallback loop strips the
        comment before inspecting the first element.
        """
        malicious = (
            b"<!-- harmless -->\n"
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<script>alert(1)</script>"
            b"</svg>"
        )
        assert looks_like_svg(malicious) is True

    # ── Regression: audit U3 – non-xml / multiple PIs ────────────────

    def test_detects_svg_with_non_xml_processing_instruction(self):
        """Audit U3.1: a PI whose target is not ``xml`` must not fool
        the detector.  Old code only stripped ``<?xml ...?>`` — any
        other PI prefix bypassed detection.
        """
        malicious = (
            b"<?Some-Other-PI?>"
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<script>alert(1)</script>"
            b"</svg>"
        )
        assert looks_like_svg(malicious) is True

    def test_detects_svg_with_multiple_processing_instructions(self):
        """Audit U3.2: two PIs in a row (``<?xml?>`` then
        ``<?xml-stylesheet?>``) must not bypass detection.  The
        preamble-stripping loop consumes all PIs, not just one.
        """
        malicious = (
            b'<?xml version="1.0"?>\n'
            b'<?xml-stylesheet href="x"?>\n'
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<script>alert(1)</script>"
            b"</svg>"
        )
        assert looks_like_svg(malicious) is True

    # ── Regression: audit U4 – oversized leading preamble ────────────

    def test_detects_svg_with_oversized_leading_preamble(self):
        """Audit U4: an attacker padding >4 KiB of leading comment must
        not bypass detection.  The scan window is at least 64 KiB and
        the fallback loop walks past all whitespace/comments.
        """
        huge_lead = (
            b"<!-- "
            + b"x" * 5000
            + b" -->\n"
            + b'<svg xmlns="http://www.w3.org/2000/svg">'
              b"<script>alert(1)</script>"
              b"</svg>"
        )
        assert looks_like_svg(huge_lead) is True

    def test_detects_svg_with_combined_bypass_attempts(self):
        """All four bypass techniques stacked must still be detected."""
        payload = (
            b"<!-- pad " + b"y" * 3000 + b" -->\n"
            b"<?xml version='1.0'?>\n"
            b"<?xml-stylesheet href='a'?>\n"
            b"<!DOCTYPE svg [\n"
            b"<!ENTITY e \"bar\">\n"
            b"]>\n"
            b'<svg xmlns="http://www.w3.org/2000/svg">'
            b"<script>alert(1)</script>"
            b"</svg>"
        )
        assert looks_like_svg(payload) is True
