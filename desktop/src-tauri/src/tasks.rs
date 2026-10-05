//! Scheduled work while the app sits in the tray. Each task is one call to the server, which does the
//! work as the connected person and returns what to show:
//!   morning brief (daily, free)    email agent status (every few hours, free)
//!   Edge brief (daily, AI)         watch checks (every N hours, AI)
//! Every task is off until the person switches it on. The AI ones also need a plan, and the server
//! keeps its own copy of the switches (PUT /api/desktop/me) and refuses a scheduled AI task that is off
//! there, so nothing that spends AI money runs unless the person turned that task on for this computer.

use crate::alerts;
use crate::api::ApiError;
use crate::settings::{parse_hhmm, read_json, write_json, Settings};
use crate::state::{self, AppState};
use chrono::{DateTime, Datelike, Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const IDS: [&str; 4] = ["morning-brief", "autopilot-status", "edge-brief", "watch-check"];

#[derive(Deserialize)]
struct Answer {
    result: TaskResult,
}

#[derive(Deserialize, Serialize)]
pub struct TaskResult {
    pub title: String,
    pub body: String,
    pub url: String,
    #[serde(default)]
    pub quiet: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct Runs {
    /// Task id to the last time it ran (or was tried), RFC 3339.
    last: BTreeMap<String, String>,
}

enum Schedule {
    Daily(u32, u32),
    Every(u32),
}

fn schedule(s: &Settings, id: &str) -> Option<Schedule> {
    let t = &s.tasks;
    let daily = |d: &crate::settings::Daily| d.on.then(|| parse_hhmm(&d.at).map(|(h, m)| Schedule::Daily(h, m))).flatten();
    match id {
        "morning-brief" => daily(&t.morning_brief),
        "edge-brief" => daily(&t.edge_brief),
        "autopilot-status" => t.autopilot_status.on.then_some(Schedule::Every(t.autopilot_status.hours)),
        "watch-check" => t.watch_check.on.then_some(Schedule::Every(t.watch_check.hours)),
        _ => None,
    }
}

/// Whether a task is due at `now`, given when it last ran. Pure.
fn due(sched: &Schedule, last: Option<DateTime<Local>>, now: DateTime<Local>) -> bool {
    match *sched {
        Schedule::Daily(h, m) => {
            let Some(today) = Local.with_ymd_and_hms(now.year(), now.month(), now.day(), h, m, 0).single() else { return false };
            // Only within a few hours of the time, so a laptop opened in the evening does not send the morning brief.
            now >= today && now - today < chrono::Duration::hours(4) && last.is_none_or(|l| l < today)
        }
        Schedule::Every(hours) => last.is_none_or(|l| now - l >= chrono::Duration::hours(hours as i64)),
    }
}

/// Run one task: `manual` when the person pressed "Run now" (the server then needs only the plan).
pub async fn run(app: &AppHandle, id: &str, manual: bool) -> Result<TaskResult, ApiError> {
    let state = app.state::<AppState>();
    let body = serde_json::json!({ "trigger": if manual { "manual" } else { "schedule" } });
    let r: Answer = state.api().post(&format!("/api/desktop/tasks/{id}"), &body).await.inspect_err(|e| state::on_error(app, e))?;
    if !r.result.quiet || manual {
        alerts::show(app, &r.result.title, &r.result.body);
        *state.last_alert.lock().unwrap() = Some(r.result.url.clone());
    }
    Ok(r.result)
}

/// Tell the server which tasks are on for this computer (it checks before any scheduled AI task).
pub async fn sync_switches(app: &AppHandle) -> Result<(), ApiError> {
    let state = app.state::<AppState>();
    if !state.connected() {
        return Ok(());
    }
    let tasks = state.settings().tasks.server_map();
    let _: serde_json::Value = state.api().put("/api/desktop/me", &serde_json::json!({ "tasks": tasks })).await?;
    Ok(())
}

/// Switch a task off locally (and on the server) after the server refused it for good (no plan).
fn switch_off(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    let _ = state.update_settings(|s| match id {
        "edge-brief" => s.tasks.edge_brief.on = false,
        "watch-check" => s.tasks.watch_check.on = false,
        "morning-brief" => s.tasks.morning_brief.on = false,
        "autopilot-status" => s.tasks.autopilot_status.on = false,
        _ => {}
    });
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = sync_switches(&a).await;
    });
    state::broadcast(app);
}

/// The scheduler: once a minute, run whatever is due. A failed run still counts as a run, so a broken
/// task waits for its next slot instead of retrying every minute.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(45)).await;
        let _ = sync_switches(&app).await;
        loop {
            tick(&app).await;
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

async fn tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.connected() || !state.is_online() {
        return;
    }
    let settings = state.settings();
    let path = state.data_dir.join("tasks.json");
    let mut runs: Runs = read_json(&path);
    let now = Local::now();
    for id in IDS {
        let Some(sched) = schedule(&settings, id) else { continue };
        let last = runs.last.get(id).and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Local));
        if !due(&sched, last, now) {
            continue;
        }
        runs.last.insert(id.to_string(), now.to_rfc3339());
        let _ = write_json(&path, &runs);
        match run(app, id, false).await {
            Ok(_) => {}
            Err(ApiError::Plan(m)) => {
                alerts::show(app, "A scheduled task was switched off", &m);
                switch_off(app, id);
            }
            Err(ApiError::Server(403, m)) => {
                // Off on the server (another copy of the app changed it, or Edge is not on): say so once and stop.
                alerts::show(app, "A scheduled task could not run", &m);
                switch_off(app, id);
            }
            Err(e) => log::info!("task {id}: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(h: u32, m: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 10, 5, h, m, 0).single().unwrap()
    }

    #[test]
    fn daily() {
        let s = Schedule::Daily(8, 0);
        assert!(!due(&s, None, at(7, 59)));
        assert!(due(&s, None, at(8, 1)));
        assert!(!due(&s, Some(at(8, 1)), at(9, 0)));
        assert!(due(&s, Some(at(8, 1) - chrono::Duration::days(1)), at(8, 30)));
        // Opened in the evening: the morning's brief is skipped, not sent late.
        assert!(!due(&s, None, at(19, 0)));
    }

    #[test]
    fn every() {
        let s = Schedule::Every(4);
        assert!(due(&s, None, at(10, 0)));
        assert!(!due(&s, Some(at(7, 0)), at(10, 0)));
        assert!(due(&s, Some(at(6, 0)), at(10, 0)));
    }
}
