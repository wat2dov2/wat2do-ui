//! The upload routes as clients see them (`backend/tests/routers/test_uploads.py`):
//! what is stored, and every refusal before a database read. S3 is a
//! recorder; nothing leaves the process.

use std::io::Cursor;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body as HttpBody;
use axum::http::{Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use image::{DynamicImage, ImageFormat};
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::api::auth::test_tokens;
use crate::api::client_ip::Peer;
use crate::api::{AppState, router};
use crate::settings::{Settings, test_settings};
use crate::storage::recording::{self, Recorder};

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut out = Vec::new();
    DynamicImage::new_rgb8(width, height)
        .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .unwrap();
    out
}

fn form(filename: &str, content_type: &str, data: &[u8]) -> Vec<u8> {
    let mut body = format!(
        "--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(data);
    body.extend_from_slice(b"\r\n--b--\r\n");
    body
}

struct Call<'a> {
    path: &'a str,
    token: Option<String>,
    peer: &'a str,
    body: Vec<u8>,
    content_length: Option<&'a str>,
}

impl<'a> Call<'a> {
    fn new(path: &'a str, body: Vec<u8>) -> Self {
        Self {
            path,
            token: None,
            peer: "testclient",
            body,
            content_length: None,
        }
    }

    fn signed_in(mut self, subject: &str) -> Self {
        self.token = Some(test_tokens::access_token(subject));
        self
    }

    async fn send(self) -> (StatusCode, Value, Recorder) {
        let settings: &'static Settings = Box::leak(Box::new(test_settings(&[])));
        // Nothing listens here: a test that reached the database would fail.
        let db = crate::db::connect_lazy(
            "postgres://localhost:1/none".parse().unwrap(),
            1,
            Duration::from_secs(1),
            Duration::from_millis(200),
            false,
        );
        let mut state = AppState::new(settings, db, None).unwrap();
        let (storage, recorder) =
            recording::storage("wat2do-test-media", "https://media.wat2do.io");
        state.storage = Arc::new(storage);
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri(self.path)
            .header(header::HOST, "testserver")
            .header(header::CONTENT_TYPE, "multipart/form-data; boundary=b");
        if let Some(token) = &self.token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        if let Some(length) = self.content_length {
            builder = builder.header(header::CONTENT_LENGTH, length);
        }
        let mut request = builder.body(HttpBody::from(self.body)).unwrap();
        request.extensions_mut().insert(Peer(self.peer.to_owned()));
        let response = crate::api::app(router(state))
            .oneshot(request)
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
            recorder,
        )
    }
}

fn stored(recorder: &Recorder) -> Vec<crate::storage::recording::Recorded> {
    recorder.0.lock().unwrap().clone()
}

#[tokio::test]
async fn a_qr_asset_is_stored_and_its_url_returned() {
    // test_upload_qr_asset_success, test_upload_png_does_not_set_content_disposition,
    // test_upload_ignores_user_supplied_filename_extension
    let (status, body, recorder) = Call::new(
        "/uploads/qr-asset",
        form("evil.html", "image/png", &png(4, 4)),
    )
    .signed_in("auth-qr-1")
    .send()
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let url = body["url"].as_str().unwrap();
    assert!(url.starts_with("https://media.wat2do.io/qr-assets/") && url.ends_with(".png"));
    let puts = stored(&recorder);
    assert_eq!(puts.len(), 1);
    // The key is the public URL's path below STORAGE_PUBLIC_BASE_URL.
    assert_eq!(url, format!("https://media.wat2do.io/{}", puts[0].key()));
    assert!(puts[0].body.starts_with(b"\x89PNG"));
    assert_eq!(puts[0].header("content-type"), Some("image/png"));
    assert_eq!(puts[0].header("content-disposition"), None);
}

#[tokio::test]
async fn claim_proofs_need_a_signed_in_sender() {
    let (status, _, recorder) = Call::new(
        "/uploads/claim-proof",
        form("p.png", "image/png", &png(4, 4)),
    )
    .signed_in("auth-claim-1")
    .send()
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(stored(&recorder)[0].key().starts_with("claim-proofs/"));
}

#[tokio::test]
async fn claim_proofs_can_be_screen_recordings() {
    let recording = b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  ";
    let (status, body, recorder) = Call::new(
        "/uploads/claim-proof",
        form("RPReplay.mov", "video/quicktime", recording),
    )
    .signed_in("auth-claim-1")
    .send()
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let puts = stored(&recorder);
    assert!(puts[0].key().starts_with("claim-proofs/") && puts[0].key().ends_with(".mov"));
    assert_eq!(puts[0].body, recording);
    assert_eq!(puts[0].header("content-type"), Some("video/quicktime"));
}

#[tokio::test]
async fn signed_in_uploads_refuse_anonymous_senders() {
    // test_upload_qr_asset_requires_auth, test_replacing_existing_event_image_still_requires_auth
    for path in [
        "/uploads/qr-asset",
        "/uploads/claim-proof",
        "/uploads/avatar",
        "/uploads/event-image/1",
        "/uploads/club-logo/1",
    ] {
        let (status, body, recorder) = Call::new(path, form("p.png", "image/png", &png(4, 4)))
            .send()
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(body, json!({"detail": "Not authenticated"}), "{path}");
        assert!(stored(&recorder).is_empty());
    }
}

#[tokio::test]
async fn anonymous_visitors_may_upload_a_poster() {
    // test_unsigned_event_image_accepts_anonymous_visitors
    let (status, body, recorder) = Call::new(
        "/uploads/event-image",
        form("poster.png", "image/png", &png(4, 4)),
    )
    .send()
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let url = body["url"].as_str().unwrap();
    assert!(url.starts_with("https://media.wat2do.io/event-images/"));
    // The poster's thumbnail is stored first, next to it.
    let puts = stored(&recorder);
    assert_eq!(puts.len(), 2);
    assert_eq!(url, format!("https://media.wat2do.io/{}", puts[1].key()));
    assert_eq!(puts[0].key(), crate::storage::thumbnail_key(puts[1].key()));
    assert_eq!(puts[0].header("content-type"), Some("image/webp"));
}

#[tokio::test]
async fn files_are_checked_against_their_bucket() {
    // test_upload_qr_asset_rejects_invalid_mime
    let (status, body, _) = Call::new(
        "/uploads/qr-asset",
        form("notes.txt", "text/plain", b"hello"),
    )
    .signed_in("auth-check-1")
    .send()
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["detail"],
        "File type text/plain not allowed. Accepted: image/jpeg, image/png, image/webp, image/svg+xml"
    );
    // test_svg_disguised_as_png_blocked_on_non_svg_bucket
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert('xss')</script></svg>";
    let (status, body, recorder) =
        Call::new("/uploads/event-image", form("evil.png", "image/png", svg))
            .peer_ip("10.1.0.1")
            .send()
            .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["detail"].as_str().unwrap().contains("SVG"));
    assert!(stored(&recorder).is_empty());
    // test_upload_svg_rejects_invalid_xml
    let (status, body, _) = Call::new(
        "/uploads/qr-asset",
        form("bad.svg", "image/svg+xml", b"not xml at all"),
    )
    .signed_in("auth-check-1")
    .send()
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["detail"].as_str().unwrap().contains("SVG"));
    // A file over the bucket's limit is a 413 even without a Content-Length.
    let big = vec![0u8; 2 * 1024 * 1024 + 1];
    let (status, body, _) = Call::new("/uploads/qr-asset", form("big.png", "image/png", &big))
        .signed_in("auth-check-2")
        .send()
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        body["detail"],
        "Uploaded file could not be decoded as a valid image."
    );
    let huge = vec![0u8; 5 * 1024 * 1024 + 1];
    let (status, body, _) = Call::new("/uploads/qr-asset", form("big.png", "image/png", &huge))
        .signed_in("auth-check-3")
        .send()
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(body["detail"], "File too large. Max 5 MB.");
}

#[tokio::test]
async fn svgs_are_sanitized_and_served_as_attachments() {
    // test_upload_svg_sanitizes_script_tags, test_svg_disguised_as_png_still_sanitized,
    // test_svg_disguised_as_png_corrects_content_type, test_upload_svg_sets_content_disposition_attachment
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert('xss')</script><rect width=\"50\" height=\"50\"/></svg>";
    for declared in ["image/svg+xml", "image/png"] {
        let (status, body, recorder) =
            Call::new("/uploads/qr-asset", form("logo.png", declared, svg))
                .signed_in("auth-svg-1")
                .send()
                .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert!(body["url"].as_str().unwrap().ends_with(".svg"));
        let put = stored(&recorder)[0].clone();
        let text = String::from_utf8(put.body.clone()).unwrap();
        assert!(!text.contains("<script") && !text.contains("alert") && text.contains("<rect"));
        assert_eq!(put.header("content-type"), Some("image/svg+xml"));
        assert_eq!(put.header("content-disposition"), Some("attachment"));
    }
}

#[tokio::test]
async fn an_oversized_content_length_is_refused_after_the_sender_is_known() {
    // test_upload_rejects_oversized_content_length_without_reading_body
    let declared = (5 * 1024 * 1024 + 4 * 1024 + 1).to_string();
    let call = |path| {
        let mut call = Call::new(path, form("big.png", "image/png", &png(4, 4)));
        call.content_length = Some(Box::leak(declared.clone().into_boxed_str()));
        call
    };
    let (status, body, recorder) = call("/uploads/qr-asset")
        .signed_in("auth-length-1")
        .send()
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(body, json!({"detail": "File too large. Max 5 MB."}));
    assert!(stored(&recorder).is_empty());
    // Without a sender, authentication answers first.
    let (status, _, _) = call("/uploads/qr-asset").send().await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // test_upload_accepts_at_limit_content_length: the slack allows the framing.
    let at_limit = (5 * 1024 * 1024 + 4 * 1024).to_string();
    let mut call = Call::new("/uploads/qr-asset", form("ok.png", "image/png", &png(4, 4)));
    call.content_length = Some(Box::leak(at_limit.into_boxed_str()));
    let (status, _, _) = call.signed_in("auth-length-2").send().await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn the_file_and_path_are_validated_like_fastapi() {
    let (status, body, _) = Call::new("/uploads/qr-asset", b"--b--\r\n".to_vec())
        .signed_in("auth-422-1")
        .send()
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body,
        json!({"detail": [{"type": "missing", "loc": ["body", "file"], "msg": "Field required", "input": null}]})
    );
    // A malformed body is refused before the sender is even checked.
    let (status, body, _) = Call::new("/uploads/event-image/1", b"garbage".to_vec())
        .send()
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"detail": "Invalid multipart data."}));
}

#[tokio::test]
async fn uploads_are_limited_per_sender() {
    for _ in 0..30 {
        let (status, _, _) = Call::new("/uploads/qr-asset", form("p.txt", "text/plain", b"x"))
            .signed_in("auth-limit-1")
            .send()
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (status, body, _) = Call::new(
        "/uploads/claim-proof",
        form("p.png", "image/png", &png(4, 4)),
    )
    .signed_in("auth-limit-1")
    .send()
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["detail"], crate::api::messages::RATE_LIMIT_EXCEEDED);
    let (status, _, _) = Call::new(
        "/uploads/claim-proof",
        form("p.png", "image/png", &png(4, 4)),
    )
    .signed_in("auth-limit-2")
    .send()
    .await;
    assert_eq!(status, StatusCode::OK);
}

impl<'a> Call<'a> {
    fn peer_ip(mut self, peer: &'a str) -> Self {
        self.peer = peer;
        self
    }
}
