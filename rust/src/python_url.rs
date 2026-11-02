//! Python's `urllib.parse.urlsplit`, for validators whose accept/reject decisions must
//! not change when they move from Python to Rust. WHATWG parsers (the `url` crate)
//! normalize hosts and paths that Python keeps, so they cannot stand in here.

/// `urllib.parse.SplitResult`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SplitUrl {
    pub scheme: String,
    pub netloc: String,
    pub path: String,
    pub query: String,
    pub fragment: String,
}

/// `urlsplit(url)`; `Err` where Python raises `ValueError`.
pub fn urlsplit(url: &str) -> Result<SplitUrl, String> {
    let url = url.trim_start_matches(|character: char| character <= ' ');
    let url: String = url
        .chars()
        .filter(|character| !matches!(character, '\t' | '\r' | '\n'))
        .collect();
    let mut rest = url.as_str();
    let mut scheme = String::new();
    if let Some(colon) = rest.find(':')
        && colon > 0
    {
        let candidate = &rest[..colon];
        let first = candidate.chars().next().expect("non-empty scheme");
        if first.is_ascii_alphabetic()
            && candidate
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "+-.".contains(character))
        {
            scheme = candidate.to_ascii_lowercase();
            rest = &rest[colon + 1..];
        }
    }
    let mut netloc = String::new();
    if let Some(after) = rest.strip_prefix("//") {
        let end = after.find(['/', '?', '#']).unwrap_or(after.len());
        netloc = after[..end].to_owned();
        rest = &after[end..];
        if netloc.contains('[') != netloc.contains(']') {
            return Err("Invalid IPv6 URL".to_owned());
        }
    }
    let (rest, fragment) = rest.split_once('#').unwrap_or((rest, ""));
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    Ok(SplitUrl {
        scheme,
        netloc,
        path: path.to_owned(),
        query: query.to_owned(),
        fragment: fragment.to_owned(),
    })
}

impl SplitUrl {
    fn userinfo(&self) -> Option<&str> {
        self.netloc.rsplit_once('@').map(|(userinfo, _)| userinfo)
    }

    fn hostinfo(&self) -> &str {
        self.netloc
            .rsplit_once('@')
            .map_or(self.netloc.as_str(), |(_, host)| host)
    }

    /// `.hostname`: lowercased, without credentials, port or IPv6 brackets.
    pub fn hostname(&self) -> Option<String> {
        let host = self.hostinfo();
        let host = if let Some((_, bracketed)) = host.split_once('[') {
            bracketed.split(']').next().unwrap_or_default()
        } else {
            host.split(':').next().unwrap_or_default()
        };
        (!host.is_empty()).then(|| host.to_lowercase())
    }

    /// `.username`.
    pub fn username(&self) -> Option<String> {
        self.userinfo()
            .map(|userinfo| userinfo.split(':').next().unwrap_or_default().to_owned())
    }

    /// `.password`.
    pub fn password(&self) -> Option<String> {
        self.userinfo()
            .and_then(|userinfo| userinfo.split_once(':'))
            .map(|(_, password)| password.to_owned())
    }

    /// `.port`; `Err` where Python raises `ValueError`.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_like_python() {
        let split = urlsplit(" HTTPS://User:Pw@WWW.Instagram.com:443/p/AB\tC/?x=1#y").unwrap();
        assert_eq!(split.scheme, "https");
        assert_eq!(split.netloc, "User:Pw@WWW.Instagram.com:443");
        assert_eq!(split.path, "/p/ABC/");
        assert_eq!(split.query, "x=1");
        assert_eq!(split.fragment, "y");
        assert_eq!(split.hostname().as_deref(), Some("www.instagram.com"));
        assert_eq!(split.username().as_deref(), Some("User"));
        assert_eq!(split.password().as_deref(), Some("Pw"));
        assert_eq!(split.port(), Ok(Some(443)));
        assert!(urlsplit("https://[::1/").is_err());
        assert_eq!(
            urlsplit("https://host:x/").unwrap().port().map_err(|_| ()),
            Err(())
        );
        let bare = urlsplit("instagram.com/p/x").unwrap();
        assert_eq!(
            (
                bare.scheme.as_str(),
                bare.netloc.as_str(),
                bare.path.as_str()
            ),
            ("", "", "instagram.com/p/x")
        );
    }
}
