//! One vision completion from OpenAI's chat API (`extractor.openai_completion`),
//! retried the way the Python SDK retries it.

use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

const CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
/// The Python SDK's defaults: two retries, 0.5 s doubling to at most 8 s,
/// and ten minutes for a whole request (five seconds to connect).
const MAX_RETRIES: u32 = 2;
const INITIAL_RETRY_DELAY: f64 = 0.5;
const MAX_RETRY_DELAY: f64 = 8.0;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// The user message: the prompt, then each image after an `Image N:` marker,
/// which the model keys `image_index` off.
fn messages(system: &str, prompt: &str, image_urls: &[String]) -> Value {
    let mut content = vec![json!({"type": "text", "text": prompt})];
    for (index, url) in image_urls.iter().enumerate() {
        content.push(json!({"type": "text", "text": format!("Image {index}:")}));
        content.push(json!({"type": "image_url", "image_url": {"url": url}}));
    }
    json!([
        {"role": "system", "content": system},
        {"role": "user", "content": content},
    ])
}

/// `_should_retry`: the server's `x-should-retry`, else timeouts, conflicts,
/// rate limits and server errors.
fn should_retry(status: u16, should_retry_header: Option<&str>) -> bool {
    match should_retry_header {
        Some("true") => true,
        Some("false") => false,
        _ => matches!(status, 408 | 409 | 429) || status >= 500,
    }
}

/// `_parse_retry_after_header`: `retry-after-ms`, else `retry-after` in seconds.
fn retry_after(headers: &wreq::header::HeaderMap) -> Option<f64> {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<f64>().ok())
    };
    header("retry-after-ms")
        .map(|milliseconds| milliseconds / 1000.0)
        .or_else(|| header("retry-after"))
}

/// `_calculate_retry_timeout`: a server's wait of up to a minute, else
/// exponential backoff with up to 25% jitter.
fn retry_delay(retries_done: u32, server_wait: Option<f64>) -> Duration {
    if let Some(wait) = server_wait.filter(|wait| *wait > 0.0 && *wait <= 60.0) {
        return Duration::from_secs_f64(wait);
    }
    let sleep = (INITIAL_RETRY_DELAY * 2f64.powi(retries_done as i32)).min(MAX_RETRY_DELAY);
    let jitter = 1.0 - 0.25 * fastrand::f64();
    Duration::from_secs_f64((sleep * jitter).max(0.0))
}

/// Send one request (with the SDK's retries) and return the reply's text.
async fn request(api_key: &str, body: &Value) -> Result<String> {
    let client = wreq::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .build()?;
    let mut retries_done = 0;
    loop {
        let sent = client
            .post(CHAT_COMPLETIONS_URL)
            .bearer_auth(api_key)
            .json(body)
            .send()
            .await;
        let response = match sent {
            Ok(response) => response,
            Err(error)
                if retries_done < MAX_RETRIES && (error.is_timeout() || error.is_connect()) =>
            {
                tokio::time::sleep(retry_delay(retries_done, None)).await;
                retries_done += 1;
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let should = should_retry(
                status,
                response
                    .headers()
                    .get("x-should-retry")
                    .and_then(|value| value.to_str().ok()),
            );
            if should && retries_done < MAX_RETRIES {
                let wait = retry_after(response.headers());
                tokio::time::sleep(retry_delay(retries_done, wait)).await;
                retries_done += 1;
                continue;
            }
            bail!("OpenAI answered {status}");
        }
        let reply: Value = response.json().await.context("OpenAI reply")?;
        return Ok(model_text(&reply)?.unwrap_or_default());
    }
}

/// `response.choices[0].message.content`; `None` when the model sent no text.
fn model_text(reply: &Value) -> Result<Option<String>> {
    let Some(choice) = reply["choices"]
        .as_array()
        .and_then(|choices| choices.first())
    else {
        bail!("OpenAI reply has no choices");
    };
    Ok(choice["message"]["content"].as_str().map(str::to_owned))
}

/// `openai_completion`: the model's reply to `prompt` and the images, `""`
/// when it sent no text, or `None` when there is no key or the call failed
/// (logged without the provider's message, which may quote the input).
pub async fn vision_completion(
    api_key: &str,
    model: &str,
    system: &str,
    prompt: &str,
    image_urls: &[String],
) -> Option<String> {
    if api_key.is_empty() {
        tracing::warn!("OpenAI extraction client unavailable");
        return None;
    }
    let body = json!({
        "messages": messages(system, prompt, image_urls),
        "model": model,
    });
    match request(api_key, &body).await {
        Ok(text) => Some(text),
        Err(_) => {
            tracing::warn!("OpenAI extraction call failed");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_image_follows_its_marker() {
        // test_openai_completion_marks_each_image_before_its_block
        let urls = vec![
            "data:image/png;base64,AA".to_owned(),
            "https://x/b.png".to_owned(),
        ];
        let messages = messages("system", "prompt", &urls);
        assert_eq!(messages[0], json!({"role": "system", "content": "system"}));
        assert_eq!(
            messages[1]["content"],
            json!([
                {"type": "text", "text": "prompt"},
                {"type": "text", "text": "Image 0:"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA"}},
                {"type": "text", "text": "Image 1:"},
                {"type": "image_url", "image_url": {"url": "https://x/b.png"}},
            ])
        );
    }

    #[tokio::test]
    async fn no_key_means_no_call() {
        // test_openai_completion_returns_none_without_key_or_on_provider_failure
        assert_eq!(vision_completion("", "m", "s", "p", &[]).await, None);
    }

    #[test]
    fn retries_follow_the_sdk() {
        assert!(should_retry(429, None));
        assert!(should_retry(500, None));
        assert!(should_retry(408, None));
        assert!(should_retry(409, None));
        assert!(!should_retry(400, None));
        assert!(!should_retry(500, Some("false")));
        assert!(should_retry(400, Some("true")));
        assert_eq!(retry_delay(0, Some(2.5)), Duration::from_secs_f64(2.5));
        // A server wait over a minute is ignored for the backoff.
        assert!(retry_delay(0, Some(120.0)) <= Duration::from_millis(500));
        let second = retry_delay(1, None);
        assert!(second >= Duration::from_millis(750) && second <= Duration::from_secs(1));
        assert!(retry_delay(10, None) <= Duration::from_secs(8));
    }

    #[test]
    fn the_reply_text_is_the_first_choice() {
        assert_eq!(
            model_text(&json!({"choices": [{"message": {"content": "{}"}}]})).unwrap(),
            Some("{}".to_owned())
        );
        assert_eq!(
            model_text(&json!({"choices": [{"message": {"content": null}}]})).unwrap(),
            None
        );
        assert!(model_text(&json!({"choices": []})).is_err());
    }
}
