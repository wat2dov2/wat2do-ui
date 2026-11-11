//! A minimal Chrome DevTools Protocol client: numbered commands over one WebSocket,
//! each reply matched to its command by id, and events broadcast to listeners.
//!
//! Command parameters can carry a password or a security code, so neither they nor
//! the replies ever reach an error message or a log; errors name the method only.

use std::collections::HashMap;
use std::fmt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Map, Value, json};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{broadcast, oneshot};
use tokio::task::JoinHandle;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

/// One event the browser sent, with the session it belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub method: String,
    pub params: Value,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CdpError {
    /// The browser answered the command with an error.
    Protocol {
        method: String,
        code: i64,
        message: String,
    },
    /// No answer arrived in time.
    Timeout { method: String },
    /// The connection is closed or failed.
    Closed,
}

impl fmt::Display for CdpError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Protocol {
                method,
                code,
                message,
            } => write!(formatter, "{method} failed ({code}: {message})"),
            Self::Timeout { method } => write!(formatter, "{method} timed out"),
            Self::Closed => write!(formatter, "the browser connection closed"),
        }
    }
}

impl std::error::Error for CdpError {}

type Reply = Result<Value, CdpError>;
type Pending = Arc<Mutex<Option<HashMap<u64, (String, oneshot::Sender<Reply>)>>>>;
type Writer = Box<dyn futures_util::Sink<Message, Error = WsError> + Send + Unpin>;
type WsError = tokio_tungstenite::tungstenite::Error;

/// One CDP connection. Dropping it stops its reader.
pub struct Cdp {
    writer: tokio::sync::Mutex<Writer>,
    /// Commands waiting for their reply; `None` once the connection is gone.
    pending: Pending,
    events: broadcast::Sender<Event>,
    next_id: AtomicU64,
    reader: JoinHandle<()>,
}

impl Drop for Cdp {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

impl Cdp {
    /// Connect to `lightpanda serve --unix-socket <socket>`.
    pub async fn connect_unix(socket: &Path) -> Result<Self, CdpError> {
        let stream = tokio::net::UnixStream::connect(socket)
            .await
            .map_err(|_| CdpError::Closed)?;
        Self::handshake(stream).await
    }

    /// Open the WebSocket on an already connected stream.
    pub async fn handshake<S>(stream: S) -> Result<Self, CdpError>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (socket, _) = tokio_tungstenite::client_async("ws://localhost/", stream)
            .await
            .map_err(|_| CdpError::Closed)?;
        Ok(Self::over(socket))
    }

    fn over<S>(socket: WebSocketStream<S>) -> Self
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (writer, mut reader) = socket.split();
        let pending: Pending = Arc::new(Mutex::new(Some(HashMap::new())));
        let (events, _) = broadcast::channel(1024);
        let reader = tokio::spawn({
            let pending = pending.clone();
            let events = events.clone();
            async move {
                while let Some(Ok(message)) = reader.next().await {
                    let text = match message {
                        Message::Text(text) => text.to_string(),
                        Message::Binary(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                        Message::Close(_) => break,
                        _ => continue,
                    };
                    let Ok(Value::Object(message)) = serde_json::from_str::<Value>(&text) else {
                        continue;
                    };
                    dispatch(message, &pending, &events);
                }
                // Every command still waiting learns the connection is gone.
                let waiting = pending.lock().expect("pending lock").take();
                for (_, (_, reply)) in waiting.into_iter().flatten() {
                    let _ = reply.send(Err(CdpError::Closed));
                }
            }
        });
        let writer: SplitSink<WebSocketStream<S>, Message> = writer;
        Self {
            writer: tokio::sync::Mutex::new(Box::new(writer)),
            pending,
            events,
            next_id: AtomicU64::new(1),
            reader,
        }
    }

    /// Listen for events from now on.
    pub fn events(&self) -> broadcast::Receiver<Event> {
        self.events.subscribe()
    }

    /// Send one command, to the browser or to `session`, and wait for its reply.
    pub async fn call(
        &self,
        session: Option<&str>,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, CdpError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (reply, answer) = oneshot::channel();
        match self.pending.lock().expect("pending lock").as_mut() {
            Some(pending) => pending.insert(id, (method.to_owned(), reply)),
            None => return Err(CdpError::Closed),
        };
        let mut command = json!({"id": id, "method": method, "params": params});
        if let Some(session) = session {
            command["sessionId"] = json!(session);
        }
        let sent = self
            .writer
            .lock()
            .await
            .send(Message::text(command.to_string()))
            .await;
        if sent.is_err() {
            self.forget(id);
            return Err(CdpError::Closed);
        }
        match tokio::time::timeout(timeout, answer).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err(CdpError::Closed),
            Err(_) => {
                self.forget(id);
                Err(CdpError::Timeout {
                    method: method.to_owned(),
                })
            }
        }
    }

    /// Close the WebSocket politely.
    pub async fn close(&self) {
        let _ = self.writer.lock().await.close().await;
    }

    fn forget(&self, id: u64) {
        if let Some(pending) = self.pending.lock().expect("pending lock").as_mut() {
            pending.remove(&id);
        }
    }
}

/// Route one message: a reply to its waiting command, an event to the listeners.
fn dispatch(mut message: Map<String, Value>, pending: &Pending, events: &broadcast::Sender<Event>) {
    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        let waiting = pending
            .lock()
            .expect("pending lock")
            .as_mut()
            .and_then(|pending| pending.remove(&id));
        let Some((method, reply)) = waiting else {
            return;
        };
        let answer = match message.remove("error") {
            Some(error) => Err(CdpError::Protocol {
                method,
                code: error.get("code").and_then(Value::as_i64).unwrap_or(0),
                message: error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            }),
            None => Ok(message.remove("result").unwrap_or(Value::Null)),
        };
        let _ = reply.send(answer);
        return;
    }
    if let Some(Value::String(method)) = message.remove("method") {
        let _ = events.send(Event {
            method,
            params: message.remove("params").unwrap_or(Value::Null),
            session_id: message
                .remove("sessionId")
                .and_then(|session| session.as_str().map(str::to_owned)),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::DuplexStream;
    use tokio_tungstenite::accept_async;

    const SECOND: Duration = Duration::from_secs(1);

    /// A connected client and the server end of its WebSocket.
    async fn pair() -> (Cdp, WebSocketStream<DuplexStream>) {
        let (client, server) = tokio::io::duplex(64 * 1024);
        let (cdp, server) = tokio::join!(Cdp::handshake(client), accept_async(server));
        (
            cdp.expect("client handshake"),
            server.expect("server handshake"),
        )
    }

    async fn next_command(server: &mut WebSocketStream<DuplexStream>) -> Value {
        loop {
            match server.next().await.expect("a message").expect("readable") {
                Message::Text(text) => return serde_json::from_str(&text).expect("json"),
                _ => continue,
            }
        }
    }

    async fn send(server: &mut WebSocketStream<DuplexStream>, value: Value) {
        server
            .send(Message::text(value.to_string()))
            .await
            .expect("server sends");
    }

    #[tokio::test]
    async fn replies_are_matched_to_their_commands_by_id() {
        let (cdp, mut server) = pair().await;
        let server = tokio::spawn(async move {
            let first = next_command(&mut server).await;
            let second = next_command(&mut server).await;
            assert_eq!(first["method"], "Browser.getVersion");
            assert_eq!(first.get("sessionId"), None);
            assert_eq!(second["method"], "Runtime.evaluate");
            assert_eq!(second["sessionId"], "S1");
            assert_eq!(second["params"]["expression"], "1 + 1");
            // Answered out of order, with an event in between.
            send(
                &mut server,
                json!({"id": second["id"], "result": {"value": 2}}),
            )
            .await;
            send(
                &mut server,
                json!({"method": "Page.loadEventFired", "params": {}, "sessionId": "S1"}),
            )
            .await;
            send(
                &mut server,
                json!({"id": first["id"], "result": {"product": "Lightpanda"}}),
            )
            .await;
            server
        });
        let mut events = cdp.events();
        let (version, sum) = tokio::join!(
            cdp.call(None, "Browser.getVersion", json!({}), SECOND),
            cdp.call(
                Some("S1"),
                "Runtime.evaluate",
                json!({"expression": "1 + 1"}),
                SECOND
            ),
        );
        assert_eq!(version.unwrap(), json!({"product": "Lightpanda"}));
        assert_eq!(sum.unwrap(), json!({"value": 2}));
        let event = events.recv().await.unwrap();
        assert_eq!(event.method, "Page.loadEventFired");
        assert_eq!(event.session_id.as_deref(), Some("S1"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn a_protocol_error_names_the_method_but_never_the_parameters() {
        let (cdp, mut server) = pair().await;
        tokio::spawn(async move {
            let command = next_command(&mut server).await;
            send(
                &mut server,
                json!({"id": command["id"], "error": {"code": -32602, "message": "Invalid parameters"}}),
            )
            .await;
            server
        });
        let error = cdp
            .call(
                Some("S1"),
                "Input.insertText",
                json!({"text": "hunter2"}),
                SECOND,
            )
            .await
            .unwrap_err();
        assert_eq!(
            error,
            CdpError::Protocol {
                method: "Input.insertText".into(),
                code: -32602,
                message: "Invalid parameters".into()
            }
        );
        assert!(!error.to_string().contains("hunter2"));
    }

    #[tokio::test]
    async fn an_unanswered_command_times_out_and_a_late_reply_is_ignored() {
        let (cdp, mut server) = pair().await;
        let (seen, saw) = oneshot::channel();
        let server = tokio::spawn(async move {
            let command = next_command(&mut server).await;
            seen.send(command["id"].clone()).unwrap();
            server
        });
        let error = cdp
            .call(None, "Page.navigate", json!({}), Duration::from_millis(50))
            .await
            .unwrap_err();
        assert_eq!(
            error,
            CdpError::Timeout {
                method: "Page.navigate".into()
            }
        );
        let id = saw.await.unwrap();
        let mut server = server.await.unwrap();
        send(&mut server, json!({"id": id, "result": {}})).await;
        // The connection keeps working after the late reply.
        let server = tokio::spawn(async move {
            let command = next_command(&mut server).await;
            send(
                &mut server,
                json!({"id": command["id"], "result": {"ok": true}}),
            )
            .await;
            server
        });
        let answer = cdp
            .call(None, "Browser.getVersion", json!({}), SECOND)
            .await;
        assert_eq!(answer.unwrap(), json!({"ok": true}));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn waiting_commands_fail_when_the_browser_goes_away() {
        let (cdp, mut server) = pair().await;
        tokio::spawn(async move {
            next_command(&mut server).await;
            server.close(None).await.unwrap();
        });
        let error = cdp
            .call(None, "Browser.getVersion", json!({}), SECOND)
            .await
            .unwrap_err();
        assert_eq!(error, CdpError::Closed);
        // Later commands fail at once instead of waiting for their timeout.
        let error = cdp
            .call(
                None,
                "Browser.getVersion",
                json!({}),
                Duration::from_secs(30),
            )
            .await
            .unwrap_err();
        assert_eq!(error, CdpError::Closed);
    }

    #[tokio::test]
    async fn non_json_and_unknown_replies_are_ignored() {
        let (cdp, mut server) = pair().await;
        tokio::spawn(async move {
            let command = next_command(&mut server).await;
            server.send(Message::text("not json")).await.unwrap();
            send(&mut server, json!({"id": 999_999, "result": {}})).await;
            send(&mut server, json!({"id": command["id"]})).await;
            server
        });
        let answer = cdp
            .call(None, "Target.closeTarget", json!({}), SECOND)
            .await;
        assert_eq!(answer.unwrap(), Value::Null);
    }

    #[tokio::test]
    async fn it_speaks_over_a_unix_socket() {
        let directory = tempfile::tempdir().unwrap();
        let socket = directory.path().join("cdp.sock");
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut server = accept_async(stream).await.unwrap();
            loop {
                let Some(Ok(Message::Text(text))) = server.next().await else {
                    return;
                };
                let command: Value = serde_json::from_str(&text).unwrap();
                let reply = json!({"id": command["id"], "result": {"method": command["method"]}});
                server.send(Message::text(reply.to_string())).await.unwrap();
            }
        });
        let cdp = Cdp::connect_unix(&socket).await.unwrap();
        let answer = cdp.call(None, "Browser.close", json!({}), SECOND).await;
        assert_eq!(answer.unwrap(), json!({"method": "Browser.close"}));
        cdp.close().await;
    }
}
