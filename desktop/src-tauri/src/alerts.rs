//! Native notifications, and the alerts poller: every few minutes (the person's choice, at least two)
//! the app asks /api/desktop/notifications what is new since it last asked (Edge findings and other bell
//! alerts, email agent questions, news on pipeline deals, meeting notes ready) and shows each new item once. Polling only
//! reads; it never starts anything that costs money. It runs only while the person has at least one
//! kind switched on and this computer is connected.

use crate::api::ApiError;
use crate::settings::{read_json, write_json};
use crate::state::{self, AppState};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// More than this many new items at once become one summary notification.
const MAX_SINGLE: usize = 3;

pub fn show(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        log::info!("notification not shown: {e}");
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Cursor {
    since: Option<String>,
    /// The last few hundred ids shown, so an item is never shown twice.
    seen: VecDeque<String>,
}

#[derive(Deserialize)]
struct Feed {
    now: String,
    items: Vec<Item>,
}

#[derive(Deserialize, Clone)]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub url: String,
}

/// Check once now; returns how many new items were shown.
pub async fn check(app: &AppHandle) -> Result<usize, ApiError> {
    let state = app.state::<AppState>();
    let s = state.settings().notifications;
    if !s.any() || !state.connected() {
        return Ok(0);
    }
    let path = state.data_dir.join("alerts.json");
    let mut cursor: Cursor = read_json(&path);
    let kinds: Vec<&str> = [("alerts", s.alerts), ("questions", s.questions), ("deals", s.deals), ("meetings", s.meetings)]
        .into_iter()
        .filter(|(_, on)| *on)
        .map(|(k, _)| k)
        .collect();
    let query = {
        let mut q = url::form_urlencoded::Serializer::new(String::new());
        q.append_pair("kinds", &kinds.join(","));
        if let Some(since) = &cursor.since {
            q.append_pair("since", since);
        }
        q.finish()
    };
    let feed: Feed = state.api().get(&format!("/api/desktop/notifications?{query}")).await.inspect_err(|e| state::on_error(app, e))?;
    let fresh: Vec<Item> = feed.items.into_iter().filter(|i| !cursor.seen.contains(&i.id)).collect();
    if let Some(latest) = fresh.first() {
        *state.last_alert.lock().unwrap() = Some(latest.url.clone());
    }
    if fresh.len() > MAX_SINGLE {
        show(app, &format!("{} new on YouBank", fresh.len()), &fresh.iter().take(4).map(|i| i.title.as_str()).collect::<Vec<_>>().join(" · "));
    } else {
        for i in fresh.iter().rev() {
            let title = match i.kind.as_str() {
                "question" => "Your email agent has a question".to_string(),
                _ => i.title.clone(),
            };
            let body = if i.kind == "question" {
                i.body.clone()
            } else if i.body.is_empty() {
                "Open YouBank to see it.".into()
            } else {
                i.body.clone()
            };
            show(app, &title, &body);
        }
    }
    for i in &fresh {
        cursor.seen.push_back(i.id.clone());
    }
    while cursor.seen.len() > 400 {
        cursor.seen.pop_front();
    }
    cursor.since = Some(feed.now);
    let _ = write_json(&path, &cursor);
    Ok(fresh.len())
}

/// Record an item as shown, so the poller does not show it again (the meeting copilot announces the
/// notes of a meeting this computer captured itself, with the feed's id for it).
pub fn mark_seen(app: &AppHandle, id: &str) {
    let path = app.state::<AppState>().data_dir.join("alerts.json");
    let mut cursor: Cursor = read_json(&path);
    if !cursor.seen.iter().any(|s| s == id) {
        cursor.seen.push_back(id.to_string());
        while cursor.seen.len() > 400 {
            cursor.seen.pop_front();
        }
        let _ = write_json(&path, &cursor);
    }
}

/// The poller: runs for the life of the app, sleeping between checks and backing off when asked to.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            let every = app.state::<AppState>().settings().notifications.every_minutes.max(2) as u64 * 60;
            let wait = match check(&app).await {
                Ok(_) | Err(ApiError::SignedOut) => every,
                Err(ApiError::Limited(after, _)) => after.max(every),
                Err(ApiError::Offline) => every.min(300),
                Err(e) => {
                    log::info!("alerts check: {e}");
                    every * 2
                }
            };
            tokio::time::sleep(Duration::from_secs(wait)).await;
        }
    });
}
