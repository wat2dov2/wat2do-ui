"""Tests for core.client_ip — proxy trust, header extraction."""

from types import SimpleNamespace

from core.client_ip import _trusted_networks, get_client_ip


def _make_request(peer_host, headers=None):
    """Build a stand-in Request object with .client.host and .headers."""
    return SimpleNamespace(
        client=SimpleNamespace(host=peer_host),
        headers=headers or {},
    )


class TestTrustedNetworks:
    """P2: the default config is loopback only; 172.x must NOT be trusted."""

    def test_only_loopback_trusted_by_default(self):
        nets = _trusted_networks()
        str_nets = [str(n) for n in nets]
        assert "127.0.0.1/32" in str_nets
        assert "::1/128" in str_nets
        # The old dangerous default must be gone.
        assert "172.16.0.0/12" not in str_nets


class TestGetClientIp:
    def test_untrusted_peer_returns_peer(self):
        # Peer from the internet — don't trust XFF even if present.
        req = _make_request(
            "8.8.8.8",
            headers={
                "x-forwarded-for": "1.2.3.4",
                "x-wat2do-viewer-ip": "9.9.9.9",
            },
        )
        assert get_client_ip(req) == "8.8.8.8"

    def test_trusted_peer_prefers_cloudfront_function_viewer_ip(self):
        req = _make_request(
            "127.0.0.1",
            headers={
                "x-wat2do-viewer-ip": "203.0.113.25",
                "x-forwarded-for": "198.51.100.10, 192.0.2.8",
            },
        )

        assert get_client_ip(req) == "203.0.113.25"

    def test_trusted_peer_accepts_ipv6_cloudfront_function_viewer_ip(self):
        req = _make_request(
            "127.0.0.1",
            headers={"x-wat2do-viewer-ip": "2001:0db8:0000:0000::1"},
        )

        assert get_client_ip(req) == "2001:db8::1"

    def test_invalid_cloudfront_function_header_falls_back_to_xff(self):
        req = _make_request(
            "127.0.0.1",
            headers={
                "x-wat2do-viewer-ip": "not-an-ip",
                "x-forwarded-for": "5.5.5.5",
            },
        )

        assert get_client_ip(req) == "5.5.5.5"

    def test_trusted_peer_reads_xff_rightmost(self):
        req = _make_request(
            "127.0.0.1",
            headers={"x-forwarded-for": "5.5.5.5, 6.6.6.6"},
        )
        # Rightmost untrusted entry is 6.6.6.6.
        assert get_client_ip(req) == "6.6.6.6"

    def test_docker_bridge_no_longer_trusted(self):
        """172.17.0.X is no longer in the trusted list; XFF is ignored."""
        req = _make_request(
            "172.17.0.5",
            headers={"x-forwarded-for": "1.2.3.4"},
        )
        # With the tightened default, the peer itself is returned.
        assert get_client_ip(req) == "172.17.0.5"

    def test_no_client_returns_unknown(self):
        req = SimpleNamespace(client=None, headers={})
        assert get_client_ip(req) == "unknown"
