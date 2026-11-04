//! URL splitting and joining with the exact rules of Python's `urllib.parse`.
//!
//! Directory agents report URLs as they appear in a page, and a page names its
//! poster relative to itself; the Brave worker's validators accept or refuse
//! Instagram URLs. Code that checks or resolves those strings keeps them as
//! written (no percent-encoding or normalisation), the way the Python services
//! did, so stored URLs and validation decisions do not change when a service
//! moves. WHATWG parsers (the `url` crate) normalise hosts and paths that Python
//! keeps, so they cannot stand in here.

/// Schemes `urljoin` resolves relative references against.
const USES_RELATIVE: [&str; 20] = [
    "", "ftp", "http", "gopher", "nntp", "imap", "wais", "file", "https", "shttp", "mms",
    "prospero", "rtsp", "rtsps", "rtspu", "sftp", "svn", "svn+ssh", "ws", "wss",
];
/// Schemes whose URLs carry a `//netloc`.
const USES_NETLOC: [&str; 27] = [
    "",
    "ftp",
    "http",
    "gopher",
    "nntp",
    "telnet",
    "imap",
    "wais",
    "file",
    "mms",
    "https",
    "shttp",
    "snews",
    "prospero",
    "rtsp",
    "rtsps",
    "rtspu",
    "rsync",
    "svn",
    "svn+ssh",
    "sftp",
    "nfs",
    "git",
    "git+ssh",
    "ws",
    "wss",
    "itms-services",
];
/// Schemes whose last path segment may carry `;params`.
const USES_PARAMS: [&str; 15] = [
    "", "ftp", "hdl", "prospero", "http", "imap", "https", "shttp", "rtsp", "rtsps", "rtspu",
    "sip", "sips", "mms", "sftp",
];

fn is_c0_or_space(c: char) -> bool {
    c <= ' '
}

/// `urlsplit`'s five parts.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Split {
    pub scheme: String,
    pub netloc: String,
    pub path: String,
    pub query: String,
    pub fragment: String,
}

/// `urllib.parse.urlsplit(url, default_scheme)`; `Err` with Python's `ValueError`
/// message where Python raises.
pub fn urlsplit(url: &str, default_scheme: &str) -> Result<Split, String> {
    let mut url: String = url
        .trim_start_matches(is_c0_or_space)
        .chars()
        .filter(|c| !matches!(c, '\t' | '\r' | '\n'))
        .collect();
    let mut scheme: String = default_scheme
        .trim_matches(is_c0_or_space)
        .chars()
        .filter(|c| !matches!(c, '\t' | '\r' | '\n'))
        .collect();
    if let Some(colon) = url.find(':')
        && colon > 0
        && url.as_bytes()[0].is_ascii_alphabetic()
        && url[..colon]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        scheme = url[..colon].to_ascii_lowercase();
        url = url[colon + 1..].to_owned();
    }
    let mut netloc = String::new();
    if let Some(rest) = url.strip_prefix("//") {
        let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        netloc = rest[..end].to_owned();
        url = rest[end..].to_owned();
        if netloc.contains('[') != netloc.contains(']') {
            return Err("Invalid IPv6 URL".to_owned());
        }
    }
    let mut fragment = String::new();
    if let Some((before, after)) = url.split_once('#') {
        fragment = after.to_owned();
        url = before.to_owned();
    }
    let mut query = String::new();
    if let Some((before, after)) = url.split_once('?') {
        query = after.to_owned();
        url = before.to_owned();
    }
    Ok(Split {
        scheme,
        netloc,
        path: url,
        query,
        fragment,
    })
}

impl Split {
    fn userinfo(&self) -> Option<&str> {
        self.netloc.rsplit_once('@').map(|(userinfo, _)| userinfo)
    }

    fn hostinfo(&self) -> &str {
        self.netloc
            .rsplit_once('@')
            .map_or(self.netloc.as_str(), |(_, host)| host)
    }

    /// `SplitResult.hostname`: the host without user, port or brackets, lowercased.
    pub fn hostname(&self) -> Option<String> {
        let hostinfo = self.hostinfo();
        let host = match hostinfo.split_once('[') {
            Some((_, bracketed)) => bracketed.split_once(']').map_or(bracketed, |(h, _)| h),
            None => hostinfo.split_once(':').map_or(hostinfo, |(h, _)| h),
        };
        if host.is_empty() {
            return None;
        }
        // A scoped IPv6 address keeps its zone's case.
        Some(match host.split_once('%') {
            Some((address, zone)) => format!("{}%{zone}", address.to_lowercase()),
            None => host.to_lowercase(),
        })
    }

    /// `SplitResult.username`.
    pub fn username(&self) -> Option<String> {
        self.userinfo()
            .map(|userinfo| userinfo.split(':').next().unwrap_or_default().to_owned())
    }

    /// `SplitResult.password`.
    pub fn password(&self) -> Option<String> {
        self.userinfo()
            .and_then(|userinfo| userinfo.split_once(':'))
            .map(|(_, password)| password.to_owned())
    }

    /// `SplitResult.port`; `Err` with Python's `ValueError` message where it raises.
    pub fn port(&self) -> Result<Option<u16>, String> {
        let host = self.hostinfo();
        let port = if host.contains('[') {
            host.split_once(']')
                .map(|(_, rest)| rest.split_once(':').map_or("", |(_, port)| port))
                .unwrap_or("")
        } else {
            host.split_once(':').map_or("", |(_, port)| port)
        };
        if port.is_empty() {
            return Ok(None);
        }
        if !port.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(format!(
                "Port could not be cast to integer value as '{port}'"
            ));
        }
        port.parse::<u32>()
            .ok()
            .filter(|port| *port <= 65_535)
            .map(|port| Some(port as u16))
            .ok_or_else(|| "Port out of range 0-65535".to_owned())
    }
}

/// `urlunsplit`.
fn urlunsplit(scheme: &str, netloc: &str, path: &str, query: &str, fragment: &str) -> String {
    let mut url = path.to_owned();
    if !netloc.is_empty()
        || (!scheme.is_empty() && USES_NETLOC.contains(&scheme))
        || url.starts_with("//")
    {
        if !url.is_empty() && !url.starts_with('/') {
            url.insert(0, '/');
        }
        url = format!("//{netloc}{url}");
    }
    if !scheme.is_empty() {
        url = format!("{scheme}:{url}");
    }
    if !query.is_empty() {
        url = format!("{url}?{query}");
    }
    if !fragment.is_empty() {
        url = format!("{url}#{fragment}");
    }
    url
}

/// `urlparse`'s split of `;params` off the last path segment.
fn split_params(scheme: &str, path: &str) -> (String, String) {
    if !USES_PARAMS.contains(&scheme) || !path.contains(';') {
        return (path.to_owned(), String::new());
    }
    let at = match path.rfind('/') {
        Some(slash) => match path[slash..].find(';') {
            Some(offset) => slash + offset,
            None => return (path.to_owned(), String::new()),
        },
        None => path.find(';').unwrap_or(path.len()),
    };
    (path[..at].to_owned(), path[at + 1..].to_owned())
}

/// `urlunparse`.
fn urlunparse(parts: &Split, params: &str) -> String {
    let path = if params.is_empty() {
        parts.path.clone()
    } else {
        format!("{};{params}", parts.path)
    };
    urlunsplit(
        &parts.scheme,
        &parts.netloc,
        &path,
        &parts.query,
        &parts.fragment,
    )
}

/// `urllib.parse.urljoin(base, url)`; `None` where Python raises.
pub fn urljoin(base: &str, url: &str) -> Option<String> {
    if base.is_empty() {
        return Some(url.to_owned());
    }
    if url.is_empty() {
        return Some(base.to_owned());
    }
    let base_parts = urlsplit(base, "").ok()?;
    let (bpath, bparams) = split_params(&base_parts.scheme, &base_parts.path);
    let mut parts = urlsplit(url, &base_parts.scheme).ok()?;
    let (path, mut params) = split_params(&parts.scheme, &parts.path);
    parts.path = path;

    if parts.scheme != base_parts.scheme || !USES_RELATIVE.contains(&parts.scheme.as_str()) {
        return Some(url.to_owned());
    }
    if USES_NETLOC.contains(&parts.scheme.as_str()) {
        if !parts.netloc.is_empty() {
            return Some(urlunparse(&parts, &params));
        }
        parts.netloc = base_parts.netloc.clone();
    }
    if parts.path.is_empty() && params.is_empty() {
        parts.path = bpath;
        params = bparams;
        if parts.query.is_empty() {
            parts.query = base_parts.query.clone();
        }
        return Some(urlunparse(&parts, &params));
    }

    let mut base_segments: Vec<&str> = bpath.split('/').collect();
    if base_segments.last() != Some(&"") {
        base_segments.pop();
    }
    let segments: Vec<&str> = if parts.path.starts_with('/') {
        parts.path.split('/').collect()
    } else {
        let mut joined: Vec<&str> = base_segments;
        joined.extend(parts.path.split('/'));
        // Drop empty inner segments that would double slashes on re-joining.
        if joined.len() > 2 {
            let last = joined.len() - 1;
            let inner: Vec<&str> = joined[1..last]
                .iter()
                .copied()
                .filter(|s| !s.is_empty())
                .collect();
            let mut filtered = vec![joined[0]];
            filtered.extend(inner);
            filtered.push(joined[last]);
            joined = filtered;
        }
        joined
    };
    let mut resolved: Vec<&str> = Vec::new();
    for segment in &segments {
        match *segment {
            ".." => {
                resolved.pop();
            }
            "." => {}
            other => resolved.push(other),
        }
    }
    if matches!(segments.last(), Some(&".") | Some(&"..")) {
        resolved.push("");
    }
    let joined = resolved.join("/");
    parts.path = if joined.is_empty() {
        "/".to_owned()
    } else {
        joined
    };
    Some(urlunparse(&parts, &params))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostnames_follow_python() {
        let host = |url: &str| urlsplit(url, "").ok().and_then(|split| split.hostname());
        assert_eq!(
            host("https://User@Clubs.Example.EDU:8443/x"),
            Some("clubs.example.edu".into())
        );
        assert_eq!(host("https://[::1]:80/x"), Some("::1".into()));
        assert_eq!(host("https:///x"), None);
        assert_eq!(host("mailto:a@b.c"), None);
        assert_eq!(host("https://[::1/x"), None);
        assert_eq!(
            urlsplit("https://[::1/x", ""),
            Err("Invalid IPv6 URL".to_owned())
        );
        assert_eq!(urlsplit("HTTPS://a/b", "").unwrap().scheme, "https");
        assert_eq!(urlsplit("1http://a/b", "").unwrap().scheme, "");
        assert_eq!(
            urlsplit(" \thttps://a/b?q#f", "").unwrap(),
            Split {
                scheme: "https".into(),
                netloc: "a".into(),
                path: "/b".into(),
                query: "q".into(),
                fragment: "f".into(),
            }
        );
    }

    #[test]
    fn credentials_and_ports_follow_python() {
        let split = urlsplit(" HTTPS://User:Pw@WWW.Instagram.com:443/p/AB\tC/?x=1#y", "").unwrap();
        assert_eq!(split.scheme, "https");
        assert_eq!(split.netloc, "User:Pw@WWW.Instagram.com:443");
        assert_eq!(split.path, "/p/ABC/");
        assert_eq!(split.query, "x=1");
        assert_eq!(split.fragment, "y");
        assert_eq!(split.hostname().as_deref(), Some("www.instagram.com"));
        assert_eq!(split.username().as_deref(), Some("User"));
        assert_eq!(split.password().as_deref(), Some("Pw"));
        assert_eq!(split.port(), Ok(Some(443)));
        assert!(urlsplit("https://host:x/", "").unwrap().port().is_err());
        assert_eq!(
            urlsplit("https://host:70000/", "").unwrap().port(),
            Err("Port out of range 0-65535".to_owned())
        );
        let bare = urlsplit("instagram.com/p/x", "").unwrap();
        assert_eq!(
            (
                bare.scheme.as_str(),
                bare.netloc.as_str(),
                bare.path.as_str()
            ),
            ("", "", "instagram.com/p/x")
        );
    }

    #[test]
    fn joins_like_python() {
        // Expected values come from Python 3.12's urllib.parse.urljoin.
        let base = "https://events.example.edu/events/jam/";
        for (reference, expected) in [
            (
                "/img/p.png?a=1&b=2",
                "https://events.example.edu/img/p.png?a=1&b=2",
            ),
            ("//cdn.example.edu/p.png", "https://cdn.example.edu/p.png"),
            ("p.png", "https://events.example.edu/events/jam/p.png"),
            ("../p.png", "https://events.example.edu/events/p.png"),
            ("../../../../p.png", "https://events.example.edu/p.png"),
            ("./", "https://events.example.edu/events/jam/"),
            ("..", "https://events.example.edu/events/"),
            ("?x=1", "https://events.example.edu/events/jam/?x=1"),
            ("#top", "https://events.example.edu/events/jam/#top"),
            (
                "http://insecure.example.edu/p.png",
                "http://insecure.example.edu/p.png",
            ),
            (
                "https://cdn.example.edu/a b.png",
                "https://cdn.example.edu/a b.png",
            ),
            (
                "https://CDN.example.edu/p.png?",
                "https://CDN.example.edu/p.png",
            ),
            ("data:image/png;base64,AAA", "data:image/png;base64,AAA"),
            (
                "img;v=2/p.png",
                "https://events.example.edu/events/jam/img;v=2/p.png",
            ),
            (
                "p.png;v=2",
                "https://events.example.edu/events/jam/p.png;v=2",
            ),
            ("a//b/./c", "https://events.example.edu/events/jam/a/b/c"),
            ("", base),
        ] {
            assert_eq!(
                urljoin(base, reference).as_deref(),
                Some(expected),
                "{reference}"
            );
        }
        assert_eq!(
            urljoin("https://a.edu/x/page", "y.png").as_deref(),
            Some("https://a.edu/x/y.png")
        );
        assert_eq!(
            urljoin("https://a.edu", "y.png").as_deref(),
            Some("https://a.edu/y.png")
        );
        assert_eq!(urljoin(base, "https://[bad/p.png"), None);
    }
}
