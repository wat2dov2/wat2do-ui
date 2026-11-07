//! Every body in `testdata/forms.json` (FastAPI's answers for a route with
//! `file: UploadFile = File(...)`) reads the same way here, whole or in
//! pieces.

use axum::http::HeaderMap;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};

use super::*;

/// What the generator's route answered: the file, or FastAPI's error.
fn outcome(result: Result<Option<FormValue>, ApiError>) -> (u16, Value) {
    let value = match result {
        Ok(value) => value,
        Err(ApiError::Http { status, detail }) => {
            return (status.as_u16(), json!({ "detail": detail }));
        }
        Err(other) => panic!("unexpected {other:?}"),
    };
    match required_file(value, "file") {
        Ok(file) => (
            200,
            json!({
                "filename": file.filename,
                "content_type": file.content_type,
                "size": file.size,
                "data": STANDARD.encode(&file.data),
            }),
        ),
        Err(issue) => (422, json!({ "detail": [*issue] })),
    }
}

fn headers(content_type: &Value) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Value::String(content_type) = content_type {
        headers.insert(header::CONTENT_TYPE, content_type.parse().unwrap());
    }
    headers
}

#[tokio::test]
async fn forms_read_like_starlette() {
    let corpus: Vec<Value> = serde_json::from_str(include_str!("testdata/forms.json")).unwrap();
    for case in &corpus {
        let body = STANDARD.decode(case["body"].as_str().unwrap()).unwrap();
        let headers = headers(&case["content_type"]);
        let expected: Value = serde_json::from_str(case["response"].as_str().unwrap()).unwrap();
        let whole =
            outcome(read_field(&headers, Body::from(body.clone()), "file", usize::MAX).await);
        assert_eq!(
            whole,
            (case["status"].as_u64().unwrap() as u16, expected),
            "{}",
            case["name"]
        );
        // The same body arriving in small pieces reads the same.
        for size in [1, 7, 64] {
            let chunks: Vec<Result<Vec<u8>, std::io::Error>> =
                body.chunks(size).map(|chunk| Ok(chunk.to_vec())).collect();
            let stream = Body::from_stream(futures_util::stream::iter(chunks));
            let pieces = outcome(read_field(&headers, stream, "file", usize::MAX).await);
            assert_eq!(pieces, whole, "{} in {size}-byte chunks", case["name"]);
        }
    }
    assert!(corpus.len() > 60);
}

fn part(name: &str, data: &[u8], filename: Option<&str>) -> Vec<u8> {
    let mut part =
        format!("--XyZboundary\r\nContent-Disposition: form-data; name=\"{name}\"").into_bytes();
    if let Some(filename) = filename {
        part.extend_from_slice(format!("; filename=\"{filename}\"").as_bytes());
    }
    part.extend_from_slice(b"\r\n\r\n");
    part.extend_from_slice(data);
    part.extend_from_slice(b"\r\n");
    part
}

/// Starlette's limits on one form, too large to keep as fixtures (the
/// messages are the ones it answered when the corpus was recorded).
#[tokio::test]
async fn starlettes_form_limits() {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "multipart/form-data; boundary=XyZboundary".parse().unwrap(),
    );
    let png = part("file", b"png", Some("a.png"));
    let end = b"--XyZboundary--\r\n".to_vec();
    let read = |body: Vec<u8>| {
        let headers = headers.clone();
        async move { outcome(read_field(&headers, Body::from(body), "file", usize::MAX).await) }
    };
    let at_limit = [
        part("other", &vec![b'x'; 1024 * 1024], None),
        png.clone(),
        end.clone(),
    ]
    .concat();
    assert_eq!(read(at_limit).await.0, 200);
    let over = [
        part("other", &vec![b'x'; 1024 * 1024 + 1], None),
        png.clone(),
        end.clone(),
    ]
    .concat();
    assert_eq!(
        read(over).await,
        (
            400,
            json!({"detail": "Part exceeded maximum size of 1024KB."})
        )
    );
    let fields: Vec<u8> = (0..1001)
        .flat_map(|i| part(&format!("f{i}"), b"v", None))
        .chain(end.clone())
        .collect();
    assert_eq!(
        read(fields).await,
        (
            400,
            json!({"detail": "Too many fields. Maximum number of fields is 1000."})
        )
    );
    let files: Vec<u8> = (0..1001)
        .flat_map(|i| part(&format!("f{i}"), b"v", Some("v.txt")))
        .chain(end.clone())
        .collect();
    assert_eq!(
        read(files).await,
        (
            400,
            json!({"detail": "Too many files. Maximum number of files is 1000."})
        )
    );
    let thousand: Vec<u8> = (0..999)
        .flat_map(|i| part(&format!("f{i}"), b"v", None))
        .chain(png)
        .chain(end)
        .collect();
    assert_eq!(read(thousand).await.0, 200);
}

#[tokio::test]
async fn only_the_kept_bytes_are_held_but_every_byte_is_counted() {
    let body = b"--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\n\r\n0123456789\r\n--b--\r\n";
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "multipart/form-data; boundary=b".parse().unwrap(),
    );
    let Some(FormValue::File(file)) = read_field(&headers, Body::from(body.to_vec()), "file", 4)
        .await
        .unwrap()
    else {
        panic!("expected a file");
    };
    assert_eq!((file.size, file.data.as_slice()), (10, b"0123".as_slice()));
}

#[test]
fn options_headers_split_like_python() {
    assert_eq!(
        parse_options_header("multipart/form-data; boundary=\"a;b\"; charset=utf-8"),
        (
            "multipart/form-data".to_owned(),
            vec![
                ("boundary".to_owned(), "a;b".to_owned()),
                ("charset".to_owned(), "utf-8".to_owned())
            ]
        )
    );
    assert_eq!(
        parse_options_header(" Text/Plain "),
        ("text/plain".to_owned(), Vec::new())
    );
    assert_eq!(parse_options_header(""), (String::new(), Vec::new()));
    // An unbalanced quote does not hang, and keeps the rest together.
    assert_eq!(
        parse_options_header("form-data; name=\"a;b"),
        (
            "form-data".to_owned(),
            vec![("name".to_owned(), "\"a;b".to_owned())]
        )
    );
    assert_eq!(unquote_plus("a+b%20c%C3%A9%zz%4"), "a b cé%zz%4");
}
