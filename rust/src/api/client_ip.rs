//! Who sent a request, as the Python app sees it.
//!
//! The Python app learns its client in two steps, and the Rust server repeats both:
//!
//! 1. uvicorn's `ProxyHeadersMiddleware`: when the TCP peer is in
//!    `FORWARDED_ALLOW_IPS` (loopback by default), the client becomes the
//!    rightmost `X-Forwarded-For` entry outside that list, and the scheme
//!    comes from `X-Forwarded-Proto`.
//! 2. `core/client_ip.get_client_ip`: when that client is in `TRUSTED_PROXIES`,
//!    the real address is read from `X-Wat2Do-Viewer-IP`, then the rightmost
//!    untrusted `X-Forwarded-For` entry, then `X-Real-IP`.
//!
//! In production the frontend container calls the API over loopback, so step 1
//! applies to every request.

use std::net::IpAddr;

use axum::http::HeaderMap;

use crate::settings::Settings;

/// The TCP peer of a request: an IP address, or a test client's name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Peer(pub String);

/// IP networks and literal host names, as uvicorn and `ipaddress` parse them.
#[derive(Debug, Default)]
struct Hosts {
    networks: Vec<(IpAddr, u8)>,
    literals: Vec<String>,
}

impl Hosts {
    fn parse(entries: &[String]) -> Self {
        let mut hosts = Self::default();
        for entry in entries {
            match parse_network(entry) {
                Some(network) => hosts.networks.push(network),
                None => hosts.literals.push(entry.clone()),
            }
        }
        hosts
    }

    fn contains(&self, host: &str) -> bool {
        match host.parse::<IpAddr>() {
            Ok(address) => self
                .networks
                .iter()
                .any(|(network, prefix)| in_network(address, *network, *prefix)),
            Err(_) => self.literals.iter().any(|literal| literal == host),
        }
    }
}

fn parse_network(entry: &str) -> Option<(IpAddr, u8)> {
    let (address, prefix) = match entry.split_once('/') {
        Some((address, prefix)) => (address.parse::<IpAddr>().ok()?, prefix.parse::<u8>().ok()?),
        None => {
            let address = entry.parse::<IpAddr>().ok()?;
            (address, if address.is_ipv4() { 32 } else { 128 })
        }
    };
    let bits = if address.is_ipv4() { 32 } else { 128 };
    (prefix <= bits).then_some((address, prefix))
}

fn in_network(address: IpAddr, network: IpAddr, prefix: u8) -> bool {
    match (address, network) {
        (IpAddr::V4(address), IpAddr::V4(network)) => {
            let mask = u32::MAX.checked_shl(32 - u32::from(prefix)).unwrap_or(0);
            u32::from(address) & mask == u32::from(network) & mask
        }
        (IpAddr::V6(address), IpAddr::V6(network)) => {
            let mask = u128::MAX.checked_shl(128 - u32::from(prefix)).unwrap_or(0);
            u128::from(address) & mask == u128::from(network) & mask
        }
        _ => false,
    }
}

/// The trust lists from settings, parsed once.
#[derive(Debug)]
pub struct ProxyTrust {
    /// uvicorn's `FORWARDED_ALLOW_IPS`; "*" trusts every peer.
    forwarded: Hosts,
    forward_all: bool,
    /// `TRUSTED_PROXIES` (`ipaddress.ip_network(entry, strict=False)`; invalid entries are ignored).
    trusted: Vec<(IpAddr, u8)>,
}

impl ProxyTrust {
    pub fn new(settings: &Settings) -> Self {
        let forward_all = settings.forwarded_allow_ips.iter().any(|host| host == "*");
        let trusted = settings
            .trusted_proxies
            .iter()
            .filter_map(|entry| {
                let network = parse_network(entry);
                if network.is_none() {
                    tracing::warn!("Ignoring invalid trusted proxy entry: {entry}");
                }
                network
            })
            .collect();
        Self {
            forwarded: Hosts::parse(&settings.forwarded_allow_ips),
            forward_all,
            trusted,
        }
    }

    /// Whether uvicorn would read forwarding headers from this peer.
    pub fn forwards(&self, peer: &str) -> bool {
        self.forward_all || (!peer.is_empty() && self.forwarded.contains(peer))
    }

    fn is_trusted(&self, host: &str) -> bool {
        host.parse::<IpAddr>().is_ok_and(|address| {
            self.trusted
                .iter()
                .any(|(network, prefix)| in_network(address, *network, *prefix))
        })
    }

    /// uvicorn's client: the peer, or the rightmost `X-Forwarded-For` entry
    /// it does not trust when the peer is a trusted forwarder.
    pub fn uvicorn_client(&self, peer: Option<&str>, headers: &HeaderMap) -> Option<String> {
        let peer = peer?;
        if !self.forwards(peer) {
            return Some(peer.to_owned());
        }
        let values: Vec<&str> = headers
            .get_all("x-forwarded-for")
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect();
        if values.is_empty() {
            return Some(peer.to_owned());
        }
        let joined = values.join(", ");
        let hosts: Vec<&str> = joined.split(',').map(str::trim).collect();
        let chosen = if self.forward_all {
            host_of(hosts[0])
        } else {
            hosts
                .iter()
                .rev()
                .map(|entry| host_of(entry))
                .find(|host| host.is_empty() || !self.forwarded.contains(host))
                .unwrap_or_else(|| host_of(hosts[0]))
        };
        // An empty X-Forwarded-For leaves the client unchanged.
        Some(if chosen.is_empty() {
            peer.to_owned()
        } else {
            chosen
        })
    }

    /// uvicorn's scheme: `X-Forwarded-Proto` from a trusted forwarder, else http.
    pub fn scheme(&self, peer: Option<&str>, headers: &HeaderMap) -> String {
        let forwarded = peer
            .filter(|peer| self.forwards(peer))
            .and_then(|_| headers.get("x-forwarded-proto"))
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|proto| matches!(*proto, "http" | "https" | "ws" | "wss"));
        forwarded.unwrap_or("http").to_owned()
    }

    /// `get_client_ip`: the best-effort real client IP.
    pub fn client_ip(&self, peer: Option<&str>, headers: &HeaderMap) -> String {
        let Some(peer) = self.uvicorn_client(peer, headers) else {
            return "unknown".to_owned();
        };
        if peer.is_empty() || !self.is_trusted(&peer) {
            return if peer.is_empty() {
                "unknown".to_owned()
            } else {
                peer
            };
        }
        let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
        if let Some(viewer) =
            header("x-wat2do-viewer-ip").and_then(|value| value.trim().parse::<IpAddr>().ok())
        {
            return viewer.to_string();
        }
        if let Some(forwarded) = header("x-forwarded-for") {
            let untrusted = forwarded
                .split(',')
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .rev()
                .find(|part| !self.is_trusted(part));
            if let Some(address) = untrusted {
                return address.to_owned();
            }
        }
        if let Some(real) = header("x-real-ip") {
            return real.trim().to_owned();
        }
        peer
    }
}

/// uvicorn's `_parse_host_port`, keeping only the host.
fn host_of(value: &str) -> String {
    if let Some(rest) = value.strip_prefix('[') {
        return match rest.find(']') {
            Some(end) if rest[end + 1..].is_empty() || rest[end + 1..].starts_with(':') => {
                rest[..end].to_owned()
            }
            _ => value.to_owned(),
        };
    }
    if value.matches(':').count() == 1 {
        let (host, port) = value.rsplit_once(':').expect("one colon");
        if port.parse::<u16>().is_ok() || port.parse::<i64>().is_ok() {
            return host.to_owned();
        }
        return value.to_owned();
    }
    value.to_owned()
}

/// `get_client_ip(request)` as an extractor, for limiters keyed by client IP.
pub struct ClientIp(pub String);

impl axum::extract::FromRequestParts<super::AppState> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &super::AppState,
    ) -> Result<Self, Self::Rejection> {
        let peer = parts.extensions.get::<Peer>().map(|peer| peer.0.as_str());
        Ok(Self(state.trust.client_ip(peer, &parts.headers)))
    }
}

/// `hash_client_ip`: a keyed (HMAC-SHA256) hash of a client IP, so abuse
/// limits and forensics never store the raw address. The `ip:v1` domain and
/// `POSTER_HASH_SECRET` match `qr_code_scans.ip_hash`, so one IP hashes the
/// same everywhere.
pub fn hash_client_ip(client_ip: &str, secret: &str) -> anyhow::Result<String> {
    use hmac::Mac;
    anyhow::ensure!(
        !secret.is_empty(),
        "POSTER_HASH_SECRET is required to hash client IPs"
    );
    let mut mac =
        hmac::Hmac::<sha2::Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC takes any key");
    mac.update(format!("ip:v1:{client_ip}").as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::test_settings;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.append(
                axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                value.parse().unwrap(),
            );
        }
        map
    }

    fn trust() -> ProxyTrust {
        ProxyTrust::new(&test_settings(&[]))
    }

    // `get_client_ip` cases from backend/tests/core/test_client_ip.py. Their
    // peers reach `get_client_ip` directly, so uvicorn's step is skipped by
    // trusting no forwarder.
    fn without_uvicorn() -> ProxyTrust {
        ProxyTrust::new(&test_settings(&[("FORWARDED_ALLOW_IPS", "none")]))
    }

    #[test]
    fn only_loopback_is_trusted_by_default() {
        let trust = trust();
        assert!(trust.is_trusted("127.0.0.1"));
        assert!(trust.is_trusted("::1"));
        assert!(!trust.is_trusted("172.17.0.5"));
    }

    #[test]
    fn untrusted_peer_returns_peer() {
        let request = headers(&[
            ("x-forwarded-for", "1.2.3.4"),
            ("x-wat2do-viewer-ip", "9.9.9.9"),
        ]);
        assert_eq!(
            without_uvicorn().client_ip(Some("8.8.8.8"), &request),
            "8.8.8.8"
        );
    }

    #[test]
    fn trusted_peer_prefers_the_cloudfront_viewer_ip() {
        let request = headers(&[
            ("x-wat2do-viewer-ip", "203.0.113.25"),
            ("x-forwarded-for", "198.51.100.10, 192.0.2.8"),
        ]);
        assert_eq!(
            without_uvicorn().client_ip(Some("127.0.0.1"), &request),
            "203.0.113.25"
        );
        let ipv6 = headers(&[("x-wat2do-viewer-ip", "2001:0db8:0000:0000::1")]);
        assert_eq!(
            without_uvicorn().client_ip(Some("127.0.0.1"), &ipv6),
            "2001:db8::1"
        );
    }

    #[test]
    fn invalid_viewer_ip_falls_back_to_forwarded_for() {
        let request = headers(&[
            ("x-wat2do-viewer-ip", "not-an-ip"),
            ("x-forwarded-for", "5.5.5.5"),
        ]);
        assert_eq!(
            without_uvicorn().client_ip(Some("127.0.0.1"), &request),
            "5.5.5.5"
        );
        let rightmost = headers(&[("x-forwarded-for", "5.5.5.5, 6.6.6.6")]);
        assert_eq!(
            without_uvicorn().client_ip(Some("127.0.0.1"), &rightmost),
            "6.6.6.6"
        );
        let real = headers(&[("x-real-ip", " 7.7.7.7 ")]);
        assert_eq!(
            without_uvicorn().client_ip(Some("127.0.0.1"), &real),
            "7.7.7.7"
        );
        assert_eq!(
            without_uvicorn().client_ip(Some("127.0.0.1"), &HeaderMap::new()),
            "127.0.0.1"
        );
    }

    #[test]
    fn docker_bridge_is_not_trusted_and_no_peer_is_unknown() {
        let request = headers(&[("x-forwarded-for", "1.2.3.4")]);
        assert_eq!(
            without_uvicorn().client_ip(Some("172.17.0.5"), &request),
            "172.17.0.5"
        );
        assert_eq!(trust().client_ip(None, &HeaderMap::new()), "unknown");
        assert_eq!(
            trust().client_ip(Some("testclient"), &HeaderMap::new()),
            "testclient"
        );
    }

    #[test]
    fn production_chain_matches_uvicorn_then_get_client_ip() {
        // CloudFront sets the viewer IP and X-Forwarded-For; the ALB appends the
        // CloudFront edge; Next.js forwards over loopback without appending.
        let request = headers(&[
            ("x-wat2do-viewer-ip", "203.0.113.9"),
            ("x-forwarded-for", "203.0.113.9, 130.176.1.1"),
            ("x-forwarded-proto", "https"),
        ]);
        let trust = trust();
        assert_eq!(
            trust.uvicorn_client(Some("127.0.0.1"), &request).as_deref(),
            Some("130.176.1.1")
        );
        // uvicorn already replaced the loopback peer, so get_client_ip sees an
        // untrusted edge address and returns it.
        assert_eq!(trust.client_ip(Some("127.0.0.1"), &request), "130.176.1.1");
        assert_eq!(trust.scheme(Some("127.0.0.1"), &request), "https");
        assert_eq!(trust.scheme(Some("10.0.0.5"), &request), "http");
        assert_eq!(trust.client_ip(Some("10.0.0.5"), &request), "10.0.0.5");
    }

    #[test]
    fn uvicorn_parses_ports_and_falls_back_to_the_first_entry() {
        let trust = trust();
        let ported = headers(&[("x-forwarded-for", "198.51.100.1:4567")]);
        assert_eq!(
            trust.uvicorn_client(Some("127.0.0.1"), &ported).as_deref(),
            Some("198.51.100.1")
        );
        let bracketed = headers(&[("x-forwarded-for", "[2001:db8::1]:80")]);
        assert_eq!(
            trust.uvicorn_client(Some("::1"), &bracketed).as_deref(),
            Some("2001:db8::1")
        );
        let all_trusted = headers(&[("x-forwarded-for", "127.0.0.1, ::1")]);
        assert_eq!(
            trust
                .uvicorn_client(Some("127.0.0.1"), &all_trusted)
                .as_deref(),
            Some("127.0.0.1")
        );
        let repeated = headers(&[
            ("x-forwarded-for", "1.1.1.1"),
            ("x-forwarded-for", "2.2.2.2"),
        ]);
        assert_eq!(
            trust
                .uvicorn_client(Some("127.0.0.1"), &repeated)
                .as_deref(),
            Some("2.2.2.2")
        );
        let empty = headers(&[("x-forwarded-for", "")]);
        assert_eq!(
            trust.uvicorn_client(Some("127.0.0.1"), &empty).as_deref(),
            Some("127.0.0.1")
        );
    }

    #[test]
    fn networks_match_like_ipaddress() {
        let trust = ProxyTrust::new(&test_settings(&[(
            "TRUSTED_PROXIES",
            r#"["10.0.0.0/8", "bogus"]"#,
        )]));
        assert!(trust.is_trusted("10.1.2.3"));
        assert!(!trust.is_trusted("11.0.0.1"));
    }

    #[test]
    fn client_ips_hash_like_python() {
        // hmac.new(b"testsecret", b"ip:v1:1.2.3.4", hashlib.sha256).hexdigest()
        assert_eq!(
            hash_client_ip("1.2.3.4", "testsecret").unwrap(),
            "928926712c09c8a8eb1a57fa364523379534466a075f715ec2c86fcd5bcda417"
        );
        assert!(hash_client_ip("1.2.3.4", "").is_err());
    }
}
