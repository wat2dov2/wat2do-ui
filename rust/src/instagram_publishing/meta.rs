//! A small Graph API client (`services/instagram_publishing/meta.py`) for
//! carousel publishing, token refreshes and each account's own stats.
//!
//! Requests carry the same query strings and form bodies Python's httpx sent,
//! encoded the way `urllib.parse.urlencode` encodes them.

use std::time::Duration;

use anyhow::{Result, anyhow, bail};
use serde_json::{Map, Value};

use crate::controlbox::INSTAGRAM_PUBLISHING;

/// Where the Graph API lives; tests point a client at a local stand-in.
pub const GRAPH_HOST: &str = "https://graph.instagram.com";
/// Everything `instagram_business_basic` reads about an account.
pub const PROFILE_FIELDS: &str =
    "id,username,name,profile_picture_url,followers_count,follows_count,media_count";
/// Everything it reads about one of the account's posts.
pub const MEDIA_FIELDS: &str = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";

/// `urlencode(pairs)`: `quote_plus` on each key and value, which keeps only
/// letters, digits and `_.-~`.
pub fn urlencode(pairs: &[(&str, &str)]) -> String {
    fn quote_plus(text: &str) -> String {
        let mut out = String::new();
        for byte in text.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'-' | b'~' => {
                    out.push(byte as char)
                }
                b' ' => out.push('+'),
                _ => out.push_str(&format!("%{byte:02X}")),
            }
        }
        out
    }
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", quote_plus(key), quote_plus(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// The account's identity as the Graph API reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub id: String,
    pub username: String,
}

/// A new long-lived token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefreshedToken {
    pub access_token: String,
    pub expires_in: i64,
}

/// `MetaInstagramClient`.
pub struct MetaClient {
    host: String,
    access_token: String,
    http: wreq::Client,
    poll_interval: Duration,
}

impl MetaClient {
    pub fn new(access_token: &str) -> Result<Self> {
        Self::with_host(GRAPH_HOST, access_token)
    }

    /// A client for the Graph API at `host` (a stand-in in tests).
    pub fn with_host(host: &str, access_token: &str) -> Result<Self> {
        Ok(Self {
            host: host.trim_end_matches('/').to_owned(),
            access_token: access_token.to_owned(),
            http: wreq::Client::builder()
                .timeout(Duration::from_secs_f64(
                    INSTAGRAM_PUBLISHING.meta_request_timeout_seconds,
                ))
                // httpx follows no redirects unless asked.
                .redirect(wreq::redirect::Policy::none())
                .build()?,
            poll_interval: Duration::from_secs_f64(INSTAGRAM_PUBLISHING.meta_poll_interval_seconds),
        })
    }

    /// Wait this long between container status checks (tests wait less).
    pub fn poll_interval(mut self, interval: Duration) -> Self {
        self.poll_interval = interval;
        self
    }

    fn versioned(&self, path: &str) -> String {
        format!(
            "{}/{}{path}",
            self.host, INSTAGRAM_PUBLISHING.graph_api_version
        )
    }

    pub async fn get_identity(&self) -> Result<Identity> {
        let payload = self.get("/me", &[("fields", "id,username")]).await?;
        Ok(Identity {
            id: required_string(&payload, "id")?,
            username: required_string(&payload, "username")?,
        })
    }

    pub async fn get_profile(&self) -> Result<Map<String, Value>> {
        self.get("/me", &[("fields", PROFILE_FIELDS)]).await
    }

    pub async fn list_recent_media(&self, limit: usize) -> Result<Vec<Value>> {
        let limit = limit.to_string();
        let payload = self
            .get("/me/media", &[("fields", MEDIA_FIELDS), ("limit", &limit)])
            .await?;
        match payload.get("data") {
            Some(Value::Array(media)) => Ok(media.clone()),
            _ => bail!("Instagram API response did not include media"),
        }
    }

    /// `refresh_access_token`: the unversioned endpoint, with the token as a
    /// query parameter rather than a header.
    pub async fn refresh_access_token(&self) -> Result<RefreshedToken> {
        let url = format!(
            "{}/refresh_access_token?{}",
            self.host,
            urlencode(&[
                ("grant_type", "ig_refresh_token"),
                ("access_token", &self.access_token),
            ])
        );
        let payload = response_json(self.http.get(url).send().await).await?;
        let access_token = required_string(&payload, "access_token")?;
        match payload.get("expires_in").and_then(Value::as_i64) {
            Some(expires_in) if expires_in > 0 => Ok(RefreshedToken {
                access_token,
                expires_in,
            }),
            _ => bail!("Instagram token refresh did not include a valid expiry"),
        }
    }

    pub async fn create_image_container(&self, user_id: &str, image_url: &str) -> Result<String> {
        let payload = self
            .post(
                &format!("/{user_id}/media"),
                &[("image_url", image_url), ("is_carousel_item", "true")],
            )
            .await?;
        required_string(&payload, "id")
    }

    pub async fn create_carousel_container(
        &self,
        user_id: &str,
        child_ids: &[String],
        caption: &str,
    ) -> Result<String> {
        let children = child_ids.join(",");
        let payload = self
            .post(
                &format!("/{user_id}/media"),
                &[
                    ("media_type", "CAROUSEL"),
                    ("children", &children),
                    ("caption", caption),
                ],
            )
            .await?;
        required_string(&payload, "id")
    }

    pub async fn publish(&self, user_id: &str, creation_id: &str) -> Result<String> {
        let payload = self
            .post(
                &format!("/{user_id}/media_publish"),
                &[("creation_id", creation_id)],
            )
            .await?;
        required_string(&payload, "id")
    }

    pub async fn get_permalink(&self, media_id: &str) -> Result<String> {
        let payload = self
            .get(&format!("/{media_id}"), &[("fields", "permalink")])
            .await?;
        required_string(&payload, "permalink")
    }

    /// Poll a container until Meta has processed it.
    pub async fn wait_until_ready(&self, container_id: &str) -> Result<()> {
        for _ in 0..INSTAGRAM_PUBLISHING.meta_poll_attempts {
            let payload = self
                .get(
                    &format!("/{container_id}"),
                    &[("fields", "status_code,status")],
                )
                .await?;
            let status_code = payload
                .get("status_code")
                .filter(|value| crate::pyjson::truthy(value))
                .map(crate::pyjson::str)
                .unwrap_or_default()
                .to_uppercase();
            if status_code == "FINISHED" {
                return Ok(());
            }
            if status_code == "ERROR" || status_code == "EXPIRED" {
                let detail = payload
                    .get("status")
                    .filter(|value| crate::pyjson::truthy(value))
                    .map(crate::pyjson::str)
                    .unwrap_or(status_code);
                bail!("Meta media container failed: {detail}");
            }
            tokio::time::sleep(self.poll_interval).await;
        }
        bail!("Meta media container did not become ready before the timeout")
    }

    async fn get(&self, path: &str, params: &[(&str, &str)]) -> Result<Map<String, Value>> {
        let url = format!("{}?{}", self.versioned(path), urlencode(params));
        response_json(
            self.http
                .get(url)
                .bearer_auth(&self.access_token)
                .send()
                .await,
        )
        .await
    }

    async fn post(&self, path: &str, data: &[(&str, &str)]) -> Result<Map<String, Value>> {
        response_json(
            self.http
                .post(self.versioned(path))
                .bearer_auth(&self.access_token)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(urlencode(data))
                .send()
                .await,
        )
        .await
    }
}

/// `_response_json`: the JSON object Meta answered with, or its error
/// message. A transport error never names the URL, which can carry a token.
async fn response_json(
    response: Result<wreq::Response, wreq::Error>,
) -> Result<Map<String, Value>> {
    let response = response.map_err(|error| anyhow!("{}", error.without_uri()))?;
    let status = response.status();
    let body = response
        .bytes()
        .await
        .map_err(|error| anyhow!("{}", error.without_uri()))?;
    let Ok(payload) = serde_json::from_slice::<Value>(&body) else {
        bail!("Meta Graph API returned HTTP {}", status.as_u16());
    };
    if status.is_client_error() || status.is_server_error() {
        let message = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .filter(|message| crate::pyjson::truthy(message))
            .map(crate::pyjson::str);
        bail!(
            "{}",
            message.unwrap_or_else(|| format!("Meta Graph API returned HTTP {}", status.as_u16()))
        );
    }
    match payload {
        Value::Object(payload) => Ok(payload),
        _ => bail!("Meta Graph API returned an invalid response"),
    }
}

/// `_required_string`: a present, truthy field, as `str()` writes it.
fn required_string(payload: &Map<String, Value>, field: &str) -> Result<String> {
    match payload.get(field) {
        Some(value) if crate::pyjson::truthy(value) => Ok(crate::pyjson::str(value)),
        _ => Err(anyhow!("Instagram API response did not include {field}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instagram_publishing::fake_http::{json_reply, serve};
    use serde_json::json;

    #[tokio::test]
    async fn identity_reads_the_versioned_host_with_a_bearer_token() {
        // test_get_identity_uses_instagram_login_host_and_bearer_token
        let graph = serve(|_| {
            json_reply(json!({"id": "37640733598873542", "username": "dalhousie.wat2do.io"}))
        })
        .await;
        let client = MetaClient::with_host(&graph.url, "secret-token").unwrap();
        assert_eq!(
            client.get_identity().await.unwrap(),
            Identity {
                id: "37640733598873542".into(),
                username: "dalhousie.wat2do.io".into()
            }
        );
        let [request] = graph.recorded().try_into().unwrap();
        assert_eq!(request.method, "GET");
        assert_eq!(request.target, "/v25.0/me?fields=id%2Cusername");
        assert_eq!(request.header("authorization"), Some("Bearer secret-token"));
    }

    #[tokio::test]
    async fn refreshes_use_the_unversioned_endpoint_without_a_header() {
        // test_refresh_access_token_uses_unversioned_refresh_endpoint
        let graph = serve(|_| {
            json_reply(json!({"access_token": "refreshed-token", "token_type": "bearer", "expires_in": 5_184_000}))
        })
        .await;
        let client = MetaClient::with_host(&graph.url, "current-token").unwrap();
        assert_eq!(
            client.refresh_access_token().await.unwrap(),
            RefreshedToken {
                access_token: "refreshed-token".into(),
                expires_in: 5_184_000
            }
        );
        let [request] = graph.recorded().try_into().unwrap();
        assert_eq!(
            request.target,
            "/refresh_access_token?grant_type=ig_refresh_token&access_token=current-token"
        );
        assert_eq!(request.header("authorization"), None);

        let graph = serve(|_| json_reply(json!({"access_token": "t", "expires_in": 0}))).await;
        let client = MetaClient::with_host(&graph.url, "current-token").unwrap();
        assert_eq!(
            client.refresh_access_token().await.unwrap_err().to_string(),
            "Instagram token refresh did not include a valid expiry"
        );
    }

    #[tokio::test]
    async fn stats_read_the_profile_and_newest_media() {
        // test_account_stats_read_profile_and_newest_media
        let graph = serve(|request| {
            if request.target.starts_with("/v25.0/me/media") {
                json_reply(json!({"data": [{"id": "1790"}]}))
            } else {
                json_reply(json!({"id": "1784", "followers_count": 12}))
            }
        })
        .await;
        let client = MetaClient::with_host(&graph.url, "secret-token").unwrap();
        assert_eq!(client.get_profile().await.unwrap()["followers_count"], 12);
        assert_eq!(
            client.list_recent_media(25).await.unwrap(),
            vec![json!({"id": "1790"})]
        );
        let targets: Vec<String> = graph.recorded().into_iter().map(|r| r.target).collect();
        assert_eq!(
            targets,
            [
                format!("/v25.0/me?{}", urlencode(&[("fields", PROFILE_FIELDS)])),
                format!(
                    "/v25.0/me/media?{}",
                    urlencode(&[("fields", MEDIA_FIELDS), ("limit", "25")])
                ),
            ]
        );
    }

    #[tokio::test]
    async fn carousels_post_the_forms_python_posted() {
        let graph = serve(|request| {
            if request.method == "GET" {
                json_reply(json!({"status_code": "FINISHED"}))
            } else {
                json_reply(json!({"id": "container-1"}))
            }
        })
        .await;
        let client = MetaClient::with_host(&graph.url, "token").unwrap();
        client
            .create_image_container("1784", "https://media.test/a b.jpg")
            .await
            .unwrap();
        client
            .create_carousel_container("1784", &["c1".into(), "c2".into()], "Hi ~ *you*")
            .await
            .unwrap();
        client.publish("1784", "carousel-1").await.unwrap();
        client.wait_until_ready("container-1").await.unwrap();
        let requests = graph.recorded();
        let bodies: Vec<(String, String)> = requests
            .iter()
            .map(|request| (request.target.clone(), request.text()))
            .collect();
        assert_eq!(
            bodies,
            [
                (
                    "/v25.0/1784/media".to_owned(),
                    "image_url=https%3A%2F%2Fmedia.test%2Fa+b.jpg&is_carousel_item=true".to_owned()
                ),
                (
                    "/v25.0/1784/media".to_owned(),
                    "media_type=CAROUSEL&children=c1%2Cc2&caption=Hi+~+%2Ayou%2A".to_owned()
                ),
                (
                    "/v25.0/1784/media_publish".to_owned(),
                    "creation_id=carousel-1".to_owned()
                ),
                (
                    "/v25.0/container-1?fields=status_code%2Cstatus".to_owned(),
                    String::new()
                ),
            ]
        );
        assert_eq!(
            requests[0].header("content-type"),
            Some("application/x-www-form-urlencoded")
        );
    }

    #[tokio::test]
    async fn graph_errors_and_failed_containers_say_what_meta_said() {
        let graph = serve(|request| match request.target.as_str() {
            target if target.starts_with("/v25.0/bad") => (
                400,
                "application/json",
                br#"{"error": {"message": "Invalid parameter"}}"#.to_vec(),
            ),
            target if target.starts_with("/v25.0/html") => (502, "text/html", b"<html>".to_vec()),
            _ => json_reply(json!({"status_code": "ERROR", "status": "Error: image too small"})),
        })
        .await;
        let client = MetaClient::with_host(&graph.url, "token").unwrap();
        assert_eq!(
            client.get_permalink("bad").await.unwrap_err().to_string(),
            "Invalid parameter"
        );
        assert_eq!(
            client.get_permalink("html").await.unwrap_err().to_string(),
            "Meta Graph API returned HTTP 502"
        );
        assert_eq!(
            client
                .wait_until_ready("container")
                .await
                .unwrap_err()
                .to_string(),
            "Meta media container failed: Error: image too small"
        );
        let pending = serve(|_| json_reply(json!({"status_code": "IN_PROGRESS"}))).await;
        let client = MetaClient::with_host(&pending.url, "token")
            .unwrap()
            .poll_interval(Duration::ZERO);
        assert_eq!(
            client
                .wait_until_ready("container")
                .await
                .unwrap_err()
                .to_string(),
            "Meta media container did not become ready before the timeout"
        );
        assert_eq!(
            pending.recorded().len(),
            INSTAGRAM_PUBLISHING.meta_poll_attempts as usize
        );
    }

    #[test]
    fn forms_are_encoded_as_urlencode_does() {
        assert_eq!(
            urlencode(&[("fields", "id,username"), ("limit", "25")]),
            "fields=id%2Cusername&limit=25"
        );
        assert_eq!(
            urlencode(&[("caption", "Fun night ~ 50% off * café\n#tag @club")]),
            "caption=Fun+night+~+50%25+off+%2A+caf%C3%A9%0A%23tag+%40club"
        );
    }

    #[test]
    fn required_fields_must_be_truthy() {
        let payload = serde_json::json!({"id": 17841400000000001_u64, "empty": "", "zero": 0});
        let payload = payload.as_object().unwrap();
        assert_eq!(required_string(payload, "id").unwrap(), "17841400000000001");
        for field in ["empty", "zero", "missing"] {
            assert_eq!(
                required_string(payload, field).unwrap_err().to_string(),
                format!("Instagram API response did not include {field}")
            );
        }
    }
}
