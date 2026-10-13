//! Quick ask: the floating window's question goes to /api/desktop/ask (the terminal's assistant, same
//! tools and daily AI allowance) and the answer streams back as server-sent events, passed on to the
//! window as `ask://event`. The token stays here; the window never sees it. Only a question the person
//! typed and sent starts a run, and closing or pressing Stop ends it.

use crate::api::{send, ApiError};
use crate::state::{self, AppState};
use crate::windows::QUICK;
use futures_util::StreamExt;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

fn emit(app: &AppHandle, v: serde_json::Value) {
    let _ = app.emit_to(QUICK, "ask://event", v);
}

/// Pull complete `data: ...` events out of the buffer, leaving any partial one. Works on bytes, so a
/// character split across two network chunks is never garbled. Pure.
pub fn drain_events(buf: &mut Vec<u8>) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    while let Some(end) = buf.windows(2).position(|w| w == b"\n\n") {
        let raw: Vec<u8> = buf.drain(..end + 2).collect();
        let block = String::from_utf8_lossy(&raw);
        let data: String = block.lines().filter_map(|l| l.strip_prefix("data:")).map(str::trim_start).collect::<Vec<_>>().join("\n");
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
            out.push(v);
        }
    }
    out
}

pub fn start(app: &AppHandle, messages: Vec<Message>) {
    // A new question replaces one still running, quietly: the window already shows the new one.
    if let Some(h) = app.state::<AppState>().ask.lock().unwrap().take() {
        h.abort();
    }
    let a = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(e) = stream(&a, messages).await {
            state::on_error(&a, &e);
            emit(&a, serde_json::json!({ "type": "error", "message": e.to_string() }));
        }
        emit(&a, serde_json::json!({ "type": "end" }));
    });
    *app.state::<AppState>().ask.lock().unwrap() = Some(handle);
}

/// Stop the answer in progress (Stop, Esc or a new question); the window is told it ended.
pub fn cancel(app: &AppHandle) {
    let running = app.state::<AppState>().ask.lock().unwrap().take();
    if let Some(h) = running {
        h.abort();
        emit(app, serde_json::json!({ "type": "end" }));
    }
}

async fn stream(app: &AppHandle, messages: Vec<Message>) -> Result<(), ApiError> {
    let messages: Vec<Message> = messages
        .into_iter()
        .filter(|m| (m.role == "user" || m.role == "assistant") && !m.content.trim().is_empty())
        .rev()
        .take(20)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let api = app.state::<AppState>().api();
    let req = api.authed(Method::POST, "/api/desktop/ask")?.timeout(Duration::from_secs(320)).json(&serde_json::json!({ "messages": messages }));
    let res = send(req).await?;
    let mut body = res.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|_| ApiError::Offline)?;
        buf.extend_from_slice(&chunk);
        for ev in drain_events(&mut buf) {
            emit(app, ev);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse() {
        let mut buf = b"data: {\"type\":\"text\",\"text\":\"Hel\"}\n\ndata: {\"type\":\"text\",\"text\":\"lo \xc3".to_vec();
        let ev = drain_events(&mut buf);
        assert_eq!(ev.len(), 1);
        buf.extend_from_slice(b"\xa9\"}\n\ndata: {\"type\"");
        let ev = drain_events(&mut buf);
        assert_eq!(ev[0]["text"], "lo \u{e9}");
        assert_eq!(buf, b"data: {\"type\"");
        buf.extend_from_slice(b":\"done\"}\n\n");
        assert_eq!(drain_events(&mut buf)[0]["type"], "done");
    }
}
