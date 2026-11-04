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
const USES_PARAMS: [&str; 16] = [
    "", "ftp", "hdl", "prospero", "http", "imap", "https", "shttp", "rtsp", "rtsps", "rtspu",
    "sip", "sips", "mms", "sftp", "tel",
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
        if netloc.contains('[') {
            check_bracketed_netloc(&netloc)?;
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
    check_netloc(&netloc)?;
    Ok(Split {
        scheme,
        netloc,
        path: url,
        query,
        fragment,
    })
}

/// `_check_bracketed_netloc`: the text between the first `[` and the next
/// `]` must be an IPv6 address or an IPvFuture literal.
fn check_bracketed_netloc(netloc: &str) -> Result<(), String> {
    let after_open = netloc.split_once('[').map_or("", |(_, after)| after);
    let hostname = after_open.split(']').next().unwrap_or_default();
    if let Some(future) = hostname.strip_prefix('v') {
        let valid = future.split_once('.').is_some_and(|(version, rest)| {
            !version.is_empty()
                && version.chars().all(|c| c.is_ascii_hexdigit())
                && !rest.is_empty()
                && !rest.contains('\n')
        });
        return if valid {
            Ok(())
        } else {
            Err("IPvFuture address is invalid".to_owned())
        };
    }
    let address = hostname.split('%').next().unwrap_or_default();
    match address.parse::<std::net::Ipv6Addr>() {
        Ok(_) if !hostname.ends_with('%') => Ok(()),
        _ if address.parse::<std::net::Ipv4Addr>().is_ok() => {
            Err("An IPv4 address cannot be in brackets".to_owned())
        }
        _ => Err(format!(
            "{address:?} does not appear to be an IPv4 or IPv6 address"
        )),
    }
}

/// `_checknetloc`: a non-ASCII host must not hide URL delimiters behind NFKC.
fn check_netloc(netloc: &str) -> Result<(), String> {
    use unicode_normalization::UnicodeNormalization;
    if netloc.is_ascii() {
        return Ok(());
    }
    let stripped: String = netloc
        .chars()
        .filter(|c| !matches!(c, '@' | ':' | '#' | '?'))
        .collect();
    let normalized: String = stripped.nfkc().collect();
    if normalized != stripped && normalized.contains(['/', '?', '#', '@', ':']) {
        return Err(format!(
            "netloc '{netloc}' contains invalid characters under NFKC normalization"
        ));
    }
    Ok(())
}

/// `urllib.parse.urlparse(url)`: `urlsplit`'s parts and the last path
/// segment's `;params`.
pub fn urlparse(url: &str) -> Result<(Split, String), String> {
    let mut parts = urlsplit(url, "")?;
    let (path, params) = split_params(&parts.scheme, &parts.path);
    parts.path = path;
    Ok((parts, params))
}

/// `urllib.parse`'s always-safe characters besides letters and digits, and
/// the space `quote_plus` turns into `+`.
const QUOTE_PLUS: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'_')
    .remove(b'.')
    .remove(b'-')
    .remove(b'~')
    .remove(b' ');

/// `quote_plus(value, safe="")`.
pub fn quote_plus(value: &str) -> String {
    percent_encoding::utf8_percent_encode(value, QUOTE_PLUS)
        .to_string()
        .replace(' ', "+")
}

/// `urlencode(pairs)`.
pub fn urlencode(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(name, value)| format!("{}={}", quote_plus(name), quote_plus(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// `unquote(value)` repeated until nothing changes.
pub fn unquote_fully(value: &str) -> String {
    let mut decoded = value.to_owned();
    loop {
        let next = percent_encoding::percent_decode_str(&decoded)
            .decode_utf8_lossy()
            .into_owned();
        if next == decoded {
            return decoded;
        }
        decoded = next;
    }
}

impl Split {
    /// `f"{scheme}://{netloc}"` when both are set.
    pub fn origin(&self) -> Option<String> {
        (!self.scheme.is_empty() && !self.netloc.is_empty())
            .then(|| format!("{}://{}", self.scheme, self.netloc))
    }

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

    fn parsed(url: &str) -> (String, String, String, String, String, String) {
        let (parts, params) = urlparse(url).unwrap();
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            params,
            parts.query,
            parts.fragment,
        )
    }

    #[test]
    fn urlparse_matches_python() {
        // Each expectation is Python 3.12's urlparse.
        let owned = |values: [&str; 6]| {
            (
                values[0].to_owned(),
                values[1].to_owned(),
                values[2].to_owned(),
                values[3].to_owned(),
                values[4].to_owned(),
                values[5].to_owned(),
            )
        };
        assert_eq!(
            parsed("https://utsg.wat2do.io/api/auth/google/callback"),
            owned([
                "https",
                "utsg.wat2do.io",
                "/api/auth/google/callback",
                "",
                "",
                ""
            ])
        );
        assert_eq!(
            parsed("HTTPS://a.io:443/p;x/q;y=1?z#f"),
            owned(["https", "a.io:443", "/p;x/q", "y=1", "z", "f"])
        );
        assert_eq!(parsed("/p;a"), owned(["", "", "/p", "a", "", ""]));
        assert_eq!(parsed("p;a;b"), owned(["", "", "p", "a;b", "", ""]));
        assert_eq!(parsed("tel:1;x"), owned(["tel", "", "1", "x", "", ""]));
        assert_eq!(
            parsed(" \thttp://a\n.io/x"),
            owned(["http", "a.io", "/x", "", "", ""])
        );
        assert_eq!(
            parsed("1http://a"),
            owned(["", "", "1http://a", "", "", ""])
        );
        assert_eq!(parsed("//a/b"), owned(["", "a", "/b", "", "", ""]));
        assert!(urlparse("http://[::1]:8000/x").is_ok());
        assert!(urlparse("http://[::1/x").is_err());
        assert!(urlparse("http://::1]/x").is_err());
        assert_eq!(
            urlparse("http://[127.0.0.1]/").unwrap_err(),
            "An IPv4 address cannot be in brackets"
        );
        assert!(urlparse("http://[v1.fe]/").is_ok());
        assert!(urlparse("http://a[::1]/").is_ok());
        assert!(urlparse("http://a\u{FF03}b.io/").is_err());
        assert!(urlparse("http://caf\u{e9}.io/").is_ok());
        assert_eq!(
            urlparse("https://User@UTSG.wat2do.io:8443/x")
                .unwrap()
                .0
                .origin()
                .as_deref(),
            Some("https://User@UTSG.wat2do.io:8443")
        );
        assert_eq!(urlparse("/x").unwrap().0.origin(), None);
    }

    #[test]
    fn quoting_matches_urllib() {
        assert_eq!(
            quote_plus("x y/:?&=+~*'()\u{e9}"),
            "x+y%2F%3A%3F%26%3D%2B~%2A%27%28%29%C3%A9"
        );
        assert_eq!(
            urlencode(&[
                ("token", "abc"),
                ("email", "a+b@c.io"),
                ("returnTo", "/p?s=1")
            ]),
            "token=abc&email=a%2Bb%40c.io&returnTo=%2Fp%3Fs%3D1"
        );
        assert_eq!(unquote_fully("%252F%252Fevil"), "//evil");
        assert_eq!(unquote_fully("/a%zz%2"), "/a%zz%2");
        assert_eq!(unquote_fully("/%C3%A9%FF"), "/\u{e9}\u{fffd}");
    }

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
