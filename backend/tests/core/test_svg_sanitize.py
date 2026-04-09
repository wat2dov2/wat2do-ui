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
