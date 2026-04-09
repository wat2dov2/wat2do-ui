"""Security headers middleware.

Adds Content-Security-Policy and other protective headers to every response.
CSP directives are intentionally configured as a list of tuples so they are
easy to read, diff, and extend without touching string concatenation.
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from core.config import settings

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CSP directives
# ---------------------------------------------------------------------------
# Each tuple is (directive-name, space-separated sources).
# To add a new external origin (e.g. analytics), append it to the relevant
# directive — no need to touch the middleware itself.
#
# Why 'unsafe-inline' for style-src?
#   Tailwind and many UI libs inject <style> tags at runtime.  Switching to
#   hashes/nonces requires build-tool integration that isn't worth the churn
#   for a low-risk directive.  script-src does NOT include 'unsafe-inline'.
# ---------------------------------------------------------------------------

CSP_DIRECTIVES: list[tuple[str, str]] = [
    # Fallback for any directive not listed below.
    ("default-src", "'self'"),

    # Scripts: only our own bundle.  No eval, no inline (except Vite dev
    # which injects module scripts — the dev server doesn't go through this
    # middleware anyway).
    ("script-src", "'self'"),

    # Styles: self + Google Fonts stylesheet + inline (Tailwind runtime).
    ("style-src", "'self' 'unsafe-inline' https://fonts.googleapis.com"),

    # Fonts: self + Google Fonts static files.
    ("font-src", "'self' https://fonts.gstatic.com"),

    # Images: self + Supabase storage + S3 event images + Unsplash editorial
    # images + Mapbox tiles + data: URIs (SVG fallbacks) + blob: (QR generator).
    (
        "img-src",
        "'self' data: blob: "
        "https://*.supabase.co "
        "https://*.amazonaws.com "
        "https://images.unsplash.com "
        "https://api.mapbox.com "
        "https://*.tiles.mapbox.com",
    ),

    # XHR / fetch / WebSocket connections: own API + Supabase + Mapbox.
    (
        "connect-src",
        "'self' "
        "https://*.supabase.co "
        "https://api.mapbox.com "
        "https://*.tiles.mapbox.com "
        "https://events.mapbox.com",
    ),

    # Web workers used by mapbox-gl.
    ("worker-src", "'self' blob:"),

    # Disallow <object>, <embed>, <applet>.
    ("object-src", "'none'"),

    # Only allow our own origin to frame the page.
    ("frame-ancestors", "'self'"),

    # Restrict <base href> to prevent base-tag hijacking.
    ("base-uri", "'self'"),

    # Restrict form targets.
    ("form-action", "'self'"),
]

# Pre-build the header value once at import time.
_CSP_VALUE = "; ".join(f"{name} {sources}" for name, sources in CSP_DIRECTIVES)

# ---------------------------------------------------------------------------
# Other security headers (quick wins that cost nothing)
# ---------------------------------------------------------------------------
_SECURITY_HEADERS: dict[str, str] = {
    # Prevent MIME-type sniffing (stops browsers from executing uploaded files
    # as scripts if the Content-Type is wrong).
    "X-Content-Type-Options": "nosniff",

    # Clickjacking protection (redundant with frame-ancestors CSP but still
    # respected by older browsers that ignore CSP).
    "X-Frame-Options": "SAMEORIGIN",

    # Control what the Referer header leaks to other origins.
    "Referrer-Policy": "strict-origin-when-cross-origin",

    # Opt out of FLoC / Topics API tracking.
    "Permissions-Policy": "interest-cohort=()",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach security headers to every HTTP response."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        response.headers["Content-Security-Policy"] = _CSP_VALUE

        for header, value in _SECURITY_HEADERS.items():
            response.headers[header] = value

        # HSTS: tell browsers to always use HTTPS.  Only set in production —
        # sending this header over plain HTTP on localhost would lock the
        # browser into HTTPS for dev and break the workflow.
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response
