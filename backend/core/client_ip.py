"""Resolve the real client IP behind a reverse proxy.

The ``get_client_ip`` function checks whether the direct peer
(``request.client.host``) is a trusted proxy.  If so, it extracts the
real client address from the ``X-Forwarded-For`` or ``X-Real-IP``
headers that the proxy sets.  Otherwise it falls back to the direct
peer address.

Trusted proxies are configured via ``settings.trusted_proxies`` (a list
of IPs or CIDR ranges, e.g. ``["172.16.0.0/12", "127.0.0.1"]``).

**Why rightmost untrusted IP?**  ``X-Forwarded-For`` is a chain where
each proxy appends the address it received the request from.  Entries
to the left can be forged by the client, but the *rightmost* entry was
appended by the last proxy we trust - so the rightmost IP that is NOT
one of our own proxies is the most reliable client address.
"""

import ipaddress
import logging

from fastapi import Request

from core.config import settings

log = logging.getLogger(__name__)


def _trusted_networks() -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    """Parse ``settings.trusted_proxies`` into network objects."""
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for entry in settings.trusted_proxies:
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            log.warning("Ignoring invalid trusted proxy entry: %s", entry)
    return networks


def _is_trusted(addr: str) -> bool:
    """Return True if *addr* belongs to any configured trusted network."""
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return any(ip in net for net in _trusted_networks())


def _trusted_viewer_ip(value: str | None) -> str | None:
    """Validate the viewer IP supplied by the CloudFront request function."""
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def get_client_ip(request: Request) -> str:
    """Return the best-effort real client IP for *request*.

    Resolution order:

    1. If the direct peer (``request.client.host``) is **not** a trusted
       proxy, return it directly - the headers cannot be trusted.
    2. ``X-Wat2Do-Viewer-IP``: prefer the viewer address overwritten by the
       production CloudFront request function.
    3. ``X-Forwarded-For``: walk the comma-separated list from right to
       left and return the first (rightmost) IP that is not a trusted
       proxy.  This is the address appended by the outermost trusted
       proxy and is the most reliable.
    4. ``X-Real-IP``: if ``X-Forwarded-For`` is absent or yields
       nothing, fall back to this single-value header.
    5. ``request.client.host`` as a last resort.
    """
    peer = request.client.host if request.client else None

    # If the direct peer is not a trusted proxy, headers may be forged.
    if not peer or not _is_trusted(peer):
        return peer or "unknown"

    viewer_ip = _trusted_viewer_ip(request.headers.get("x-wat2do-viewer-ip"))
    if viewer_ip:
        return viewer_ip

    # X-Forwarded-For: rightmost untrusted entry.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # The header is a comma-separated list:
        #   client, proxy1, proxy2
        # Walk from the right to find the first non-trusted address.
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        for addr in reversed(parts):
            if not _is_trusted(addr):
                return addr

    # X-Real-IP: single-value fallback set by nginx.
    x_real = request.headers.get("x-real-ip")
    if x_real:
        return x_real.strip()

    # Nothing usable in headers - fall back to the peer address (the proxy).
    return peer
