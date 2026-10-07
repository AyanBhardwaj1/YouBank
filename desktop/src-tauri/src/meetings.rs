//! The meeting copilot on this computer: noticing a call, the consent step, recording, sending the
//! audio to YouBank chunk by chunk, the recording indicator, and telling the person when the notes
//! are ready.
//!
//! The rules it keeps:
//! - Nothing records until the person starts it, after a prompt that reminds them some places require
//!   everyone's consent (with a notice they can paste in the chat). The only exception is an app they
//!   set to start on its own, on the site; the indicator shows all the same.
//! - While recording, the tray icon carries a red dot and the small pill window (always on top) shows
//!   a timer and a Stop button.
//! - Apps and words the person chose never to record are never offered or recorded (the server
//!   checks too).
//! - Audio is kept on disk only until YouBank has transcribed it, unless the person chose to keep a
//!   copy on this computer. YouBank never keeps it.
//! - Chunks wait on disk while offline and are sent in order when the site is back; a meeting is ended
//!   on the server only once all its audio has arrived, even across a restart.

use crate::api::ApiError;
use crate::capture::{self, ChunkMeta};
use crate::settings::{read_json, write_json};
use crate::state::{self, AppState};
use crate::{alerts, detect, tray, windows};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// The server's view for this person: copilot settings (consent notice, never-record rules,
/// auto-start), what they may use, and recent meetings. Kept as JSON and passed to the pages.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ServerView(pub serde_json::Value);

impl ServerView {
    fn list(&self, key: &str) -> Vec<String> {
        self.0
            .pointer(&format!("/settings/{key}"))
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_lowercase)).collect())
            .unwrap_or_default()
    }
    pub fn never_apps(&self) -> Vec<String> {
        self.list("neverApps")
    }
    pub fn never_keywords(&self) -> Vec<String> {
        self.list("neverKeywords")
    }
    pub fn auto_start_apps(&self) -> Vec<String> {
        self.list("autoStartApps")
    }
}

/// Why a meeting must not be offered or recorded under the person's rules, or None. Pure.
pub fn refused(never_apps: &[String], never_keywords: &[String], app: &str, title: &str) -> Option<String> {
    if never_apps.iter().any(|a| a == app) {
        return Some(format!("You chose never to record {} meetings.", app_label(app)));
    }
    let t = title.to_lowercase();
    never_keywords.iter().find(|k| !k.is_empty() && t.contains(k.as_str())).map(|k| format!("You chose never to record meetings that mention “{k}”."))
}

pub fn app_label(app: &str) -> &'static str {
    match app {
        "zoom" => "Zoom",
        "teams" => "Microsoft Teams",
        "meet" => "Google Meet",
        "webex" => "Webex",
        "slack" => "Slack huddle",
        _ => "meeting",
    }
}

/// A recording in progress, as the pages see it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: i64,
    pub title: String,
    pub platform: String,
    pub started_at: String,
    pub system_note: Option<String>,
    pub mic: String,
    pub sent: u32,
    pub waiting: u32,
    pub problem: Option<String>,
    pub auto: bool,
}

/// What the pill asks: "offer" (a call was noticed) or "consent" (the person chose to start).
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub kind: String,
    pub app: String,
    pub title: String,
}

#[derive(Default)]
pub struct Meetings {
    pub session: Mutex<Option<Session>>,
    pub capture: Mutex<Option<capture::Capture>>,
    pub prompt: Mutex<Option<Prompt>>,
    pub server: Mutex<ServerView>,
    /// Apps whose offer was declined, until their call ends.
    dismissed: Mutex<HashMap<String, Instant>>,
    /// When each app was last seen in a call.
    in_call: Mutex<HashMap<String, Instant>>,
    pub kick: tokio::sync::Notify,
}

#[derive(Default, Serialize, Deserialize)]
struct Watching {
    ids: Vec<i64>,
}

/// Written beside a meeting's chunks when it ends; the sender calls `end` once every chunk is through.
#[derive(Default, Serialize, Deserialize)]
struct EndMarker {
    discard: bool,
}

fn root(app: &AppHandle) -> PathBuf {
    app.state::<AppState>().data_dir.join("meetings")
}

fn kept_dir(app: &AppHandle, id: i64) -> PathBuf {
    app.path().document_dir().unwrap_or_else(|_| std::env::temp_dir()).join("YouBank").join("Meetings").join(format!("meeting-{id}"))
}

pub fn changed(app: &AppHandle) {
    let _ = app.emit("meeting://changed", ());
}

/* ---------------- The server ---------------- */

/// Fetch the copilot settings, plan and recent meetings, and keep them for the rules and the pages.
pub async fn refresh(app: &AppHandle) -> Result<ServerView, ApiError> {
    let state = app.state::<AppState>();
    let v: serde_json::Value = state.api().get("/api/desktop/meetings").await.inspect_err(|e| state::on_error(app, e))?;
    let view = ServerView(v);
    *state.meetings.server.lock().unwrap() = view.clone();
    Ok(view)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StartArgs {
    pub platform: String,
    pub app_title: String,
    pub title: String,
    pub notice_copied: bool,
    pub auto: bool,
    pub contact_ids: Vec<i64>,
    pub deal_ids: Vec<i64>,
}

#[derive(Deserialize)]
struct Started {
    meeting: StartedMeeting,
}
#[derive(Deserialize)]
struct StartedMeeting {
    id: i64,
    title: String,
}

/// Start recording a meeting: the person agreed to the prompt (or set this app to start on its own).
pub async fn start(app: &AppHandle, args: StartArgs) -> Result<Session, String> {
    let state = app.state::<AppState>();
    let settings = state.settings();
    if !settings.meetings.enabled {
        return Err("Turn on the meeting copilot first (desktop agent → Meetings).".into());
    }
    if !state.connected() {
        return Err(ApiError::SignedOut.into());
    }
    if state.meetings.session.lock().unwrap().is_some() {
        return Err("A meeting is already being recorded.".into());
    }
    let server = state.meetings.server.lock().unwrap().clone();
    if let Some(r) = refused(&server.never_apps(), &server.never_keywords(), &args.platform, &args.app_title) {
        return Err(r);
    }
    let body = serde_json::json!({
        "platform": args.platform, "appTitle": args.app_title, "title": args.title,
        "consent": { "noticeCopied": args.notice_copied, "auto": args.auto },
        "contactIds": args.contact_ids, "dealIds": args.deal_ids,
    });
    let r: Started = state.api().post("/api/desktop/meetings", &body).await.inspect_err(|e| state::on_error(app, e))?;
    let id = r.meeting.id;
    let (tx, rx) = mpsc::channel();
    let cap = match capture::start(root(app).join(id.to_string()), settings.meetings.system_audio, tx) {
        Ok(c) => c,
        Err(e) => {
            // Nothing was recorded: take the meeting back off YouBank.
            let _: Result<serde_json::Value, _> = state.api().post(&format!("/api/desktop/meetings/{id}/end"), &serde_json::json!({ "discard": true })).await;
            return Err(e);
        }
    };
    let session = Session {
        id,
        title: r.meeting.title,
        platform: args.platform.clone(),
        started_at: chrono::Local::now().to_rfc3339(),
        system_note: cap.system_note.clone(),
        mic: cap.mic_name.clone(),
        sent: 0,
        waiting: 0,
        problem: None,
        auto: args.auto,
    };
    *state.meetings.capture.lock().unwrap() = Some(cap);
    *state.meetings.session.lock().unwrap() = Some(session.clone());
    *state.meetings.prompt.lock().unwrap() = None;
    pump(app.clone(), rx);
    tray::set_recording(app, true);
    windows::show_pill(app);
    if settings.meetings.open_copilot {
        windows::open_copilot(app);
    }
    changed(app);
    Ok(session)
}

/// Carry the capture thread's news to the sender and the pages.
fn pump(app: AppHandle, rx: mpsc::Receiver<capture::Event>) {
    std::thread::spawn(move || {
        for ev in rx {
            let state = app.state::<AppState>();
            match ev {
                capture::Event::Chunk(meta) => {
                    log::debug!("meeting chunk {} written ({:.1} s)", meta.seq, meta.duration);
                    if let Some(s) = state.meetings.session.lock().unwrap().as_mut() {
                        s.waiting += 1;
                    }
                    state.meetings.kick.notify_one();
                }
                capture::Event::Problem(m) => {
                    if let Some(s) = state.meetings.session.lock().unwrap().as_mut() {
                        s.problem = Some(m.clone());
                    }
                    alerts::show(&app, "Meeting copilot", &m);
                }
            }
            changed(&app);
        }
    });
}

/// Stop recording. The rest of the audio is sent, then the meeting ends on YouBank and its notes are
/// written; `discard` deletes it instead (nothing more is sent, and YouBank deletes what it has).
pub async fn stop(app: &AppHandle, discard: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let Some(session) = state.meetings.session.lock().unwrap().take() else { return Ok(()) };
    let cap = state.meetings.capture.lock().unwrap().take();
    if let Some(c) = cap {
        // Joining waits for the last partial chunk to be written.
        let _ = tauri::async_runtime::spawn_blocking(move || c.stop()).await;
    }
    let dir = root(app).join(session.id.to_string());
    if discard {
        let _ = std::fs::remove_dir_all(&dir);
    }
    let _ = write_json(&dir.join("end.json"), &EndMarker { discard });
    tray::set_recording(app, false);
    windows::hide_pill(app);
    state.meetings.kick.notify_one();
    changed(app);
    Ok(())
}

/* ---------------- Sending the audio ---------------- */

#[derive(Deserialize)]
struct ChunkAnswer {
    segments: Vec<serde_json::Value>,
}

fn chunk_files(dir: &Path) -> Vec<(PathBuf, ChunkMeta)> {
    let mut out: Vec<(PathBuf, ChunkMeta)> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json") && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("chunk-")))
        .filter_map(|p| std::fs::read(&p).ok().and_then(|b| serde_json::from_slice::<ChunkMeta>(&b).ok()).map(|m| (p.with_extension("wav"), m)))
        .collect();
    out.sort_by_key(|(_, m)| m.seq);
    out
}

/// What to do with a chunk the server refused. Pure.
pub fn on_refusal(e: &ApiError) -> Refusal {
    match e {
        ApiError::Offline | ApiError::Limited(..) => Refusal::Later,
        ApiError::Server(s, _) if *s >= 500 || *s == 408 => Refusal::Later,
        ApiError::SignedOut => Refusal::Later,
        // The meeting was stopped or deleted, the chunk is bad, or the plan or settings refuse it.
        _ => Refusal::Drop,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    Later,
    Drop,
}

/// Send what is waiting, oldest meeting and chunk first. Returns false when it stopped on trouble.
async fn send_waiting(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    if !state.connected() {
        return false;
    }
    let mut dirs: Vec<(i64, PathBuf)> = std::fs::read_dir(root(app))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_string_lossy().parse::<i64>().ok().map(|id| (id, e.path())))
        .collect();
    dirs.sort();
    for (id, dir) in dirs {
        for (wav, meta) in chunk_files(&dir) {
            let Ok(bytes) = std::fs::read(&wav) else {
                let _ = std::fs::remove_file(wav.with_extension("json"));
                continue;
            };
            let path = format!(
                "/api/desktop/meetings/{id}/chunks/{}?start={:.3}&duration={:.3}&frame={}&mic={}&sys={}",
                meta.seq,
                meta.start,
                meta.duration,
                capture::FRAME_SECS,
                meta.mic,
                meta.sys
            );
            match state.api().put_bytes::<ChunkAnswer>(&path, "audio/wav", bytes, Duration::from_secs(170)).await {
                Ok(r) => {
                    let _ = app.emit("meeting://segments", serde_json::json!({ "meetingId": id, "segments": r.segments }));
                    if state.settings().meetings.keep_audio {
                        let keep = kept_dir(app, id);
                        let _ = std::fs::create_dir_all(&keep);
                        if std::fs::rename(&wav, keep.join(wav.file_name().unwrap_or_default())).is_err() {
                            let _ = std::fs::copy(&wav, keep.join(wav.file_name().unwrap_or_default()));
                        }
                    }
                    let _ = std::fs::remove_file(&wav);
                    let _ = std::fs::remove_file(wav.with_extension("json"));
                    if let Some(s) = state.meetings.session.lock().unwrap().as_mut().filter(|s| s.id == id) {
                        s.sent += 1;
                        s.waiting = s.waiting.saturating_sub(1);
                        s.problem = None;
                    }
                    changed(app);
                }
                Err(e) => {
                    state::on_error(app, &e);
                    if on_refusal(&e) == Refusal::Later {
                        if let Some(s) = state.meetings.session.lock().unwrap().as_mut().filter(|s| s.id == id) {
                            s.problem = Some(format!("Audio is waiting to be sent: {e}"));
                        }
                        changed(app);
                        return false;
                    }
                    log::info!("meeting {id} chunk {} dropped: {e}", meta.seq);
                    let _ = std::fs::remove_file(&wav);
                    let _ = std::fs::remove_file(wav.with_extension("json"));
                    if matches!(e, ApiError::Plan(_)) || matches!(e, ApiError::Server(409, _) | ApiError::Server(404, _) | ApiError::Server(403, _)) {
                        // The meeting is over on YouBank (stopped elsewhere, deleted, or refused): stop here too.
                        if state.meetings.session.lock().unwrap().as_ref().is_some_and(|s| s.id == id) {
                            alerts::show(app, "Meeting copilot stopped", &e.to_string());
                            let _ = stop(app, false).await;
                        }
                        let _ = std::fs::remove_dir_all(&dir);
                        break;
                    }
                }
            }
        }
        // Every chunk is through and the meeting was stopped: end it on YouBank.
        let marker = dir.join("end.json");
        if marker.exists() && chunk_files(&dir).is_empty() {
            let end: EndMarker = read_json(&marker);
            let body = serde_json::json!({ "discard": end.discard });
            match state.api().post::<_, serde_json::Value>(&format!("/api/desktop/meetings/{id}/end"), &body).await {
                Ok(_) | Err(ApiError::Server(404, _)) => {
                    let _ = std::fs::remove_dir_all(&dir);
                    if !end.discard {
                        watch(app, id);
                    }
                }
                Err(e) if on_refusal(&e) == Refusal::Later => return false,
                Err(_) => {
                    let _ = std::fs::remove_dir_all(&dir);
                }
            }
        }
    }
    true
}

/* ---------------- Notes ready ---------------- */

fn watching_path(app: &AppHandle) -> PathBuf {
    root(app).join("watching.json")
}

fn watch(app: &AppHandle, id: i64) {
    let path = watching_path(app);
    let mut w: Watching = read_json(&path);
    if !w.ids.contains(&id) {
        w.ids.push(id);
        let _ = write_json(&path, &w);
    }
}

#[derive(Deserialize)]
struct MeetingAnswer {
    meeting: MeetingInfo,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeetingInfo {
    id: i64,
    title: String,
    status: String,
    error: String,
    notes_at: Option<String>,
    notes: Option<serde_json::Value>,
}

/// Check on meetings this computer ended until their notes are written, and say so once.
async fn check_notes(app: &AppHandle) {
    let state = app.state::<AppState>();
    let path = watching_path(app);
    let mut w: Watching = read_json(&path);
    if w.ids.is_empty() || !state.connected() {
        return;
    }
    let mut keep = Vec::new();
    for id in w.ids.drain(..) {
        match state.api().get::<MeetingAnswer>(&format!("/api/desktop/meetings/{id}")).await {
            Ok(r) if r.meeting.status == "ready" || r.meeting.status == "failed" => {
                let m = r.meeting;
                let url = format!("/app/crm?tab=meetings&meeting={}", m.id);
                let title = if m.title.is_empty() { "Your meeting".to_string() } else { m.title.clone() };
                if m.notes.as_ref().is_some_and(|n| !n.is_null()) {
                    let summary = m.notes.as_ref().and_then(|n| n.get("summary")).and_then(|s| s.as_str()).unwrap_or("");
                    alerts::show(
                        app,
                        "Meeting notes ready",
                        &format!("{title}{}", if summary.is_empty() { String::new() } else { format!(": {}", summary.chars().take(160).collect::<String>()) }),
                    );
                    if let Some(at) = m.notes_at.as_deref().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()) {
                        alerts::mark_seen(app, &format!("m:{}:{}", m.id, at.timestamp_millis()));
                    }
                } else {
                    alerts::show(
                        app,
                        "Meeting saved",
                        &format!("{title}: {}", if m.error.is_empty() { "the transcript is on YouBank." } else { m.error.as_str() }),
                    );
                }
                *state.last_alert.lock().unwrap() = Some(url);
                let _ = app.emit("meeting://notes", m.id);
            }
            Ok(_) => keep.push(id),
            Err(ApiError::Server(404, _)) => {}
            Err(_) => keep.push(id),
        }
    }
    w.ids = keep;
    let _ = write_json(&path, &w);
}

/* ---------------- Noticing calls ---------------- */

/// One look: offer the copilot for a call that started, or start it for an app set to start on its own.
async fn look(app: &AppHandle, sys: &mut sysinfo::System) {
    let state = app.state::<AppState>();
    let s = state.settings();
    if !s.meetings.enabled || !s.meetings.detect || !state.connected() || state.meetings.session.lock().unwrap().is_some() {
        return;
    }
    let snap = detect::snapshot(sys);
    let found = detect::classify(&snap).filter(|d| d.in_call);
    let now = Instant::now();
    {
        let mut in_call = state.meetings.in_call.lock().unwrap();
        if let Some(d) = &found {
            in_call.insert(d.app.to_string(), now);
        }
        // A call that ended a minute ago: its "not now" is forgotten, and a stale offer goes.
        let ended: Vec<String> = in_call.iter().filter(|(_, t)| now.duration_since(**t) > Duration::from_secs(60)).map(|(k, _)| k.clone()).collect();
        for app_id in ended {
            in_call.remove(&app_id);
            state.meetings.dismissed.lock().unwrap().remove(&app_id);
            let mut prompt = state.meetings.prompt.lock().unwrap();
            if prompt.as_ref().is_some_and(|p| p.kind == "offer" && p.app == app_id) {
                *prompt = None;
                drop(prompt);
                windows::hide_pill(app);
            }
        }
    }
    let Some(d) = found else { return };
    if state.meetings.dismissed.lock().unwrap().contains_key(d.app) || state.meetings.prompt.lock().unwrap().is_some() {
        return;
    }
    let server = state.meetings.server.lock().unwrap().clone();
    if refused(&server.never_apps(), &server.never_keywords(), d.app, &d.title).is_some() {
        return;
    }
    if server.auto_start_apps().iter().any(|a| a == d.app) {
        let args = StartArgs { platform: d.app.into(), app_title: d.title.clone(), auto: true, ..Default::default() };
        match start(app, args).await {
            Ok(_) => alerts::show(
                app,
                "Meeting copilot started",
                &format!("Recording this {} call, as you set. Stop it from the pill or the tray.", app_label(d.app)),
            ),
            Err(e) => alerts::show(app, "Meeting copilot", &e),
        }
        return;
    }
    *state.meetings.prompt.lock().unwrap() = Some(Prompt { kind: "offer".into(), app: d.app.into(), title: d.title.clone() });
    alerts::show(app, &format!("{} call detected", app_label(d.app)), "Start the meeting copilot? Choose Start in the small YouBank window, or from the tray.");
    windows::show_pill(app);
    changed(app);
}

/// Show the consent step in the pill: from the tray, the agent window or the copilot window, or after
/// the person chose Start on an offer. `detected` keeps the app and title an offer had.
pub fn ask_consent(app: &AppHandle, detected: Option<(String, String)>) {
    let state = app.state::<AppState>();
    let (app_id, title) = detected
        .or_else(|| state.meetings.prompt.lock().unwrap().as_ref().map(|p| (p.app.clone(), p.title.clone())))
        .unwrap_or_else(|| ("other".into(), String::new()));
    *state.meetings.prompt.lock().unwrap() = Some(Prompt { kind: "consent".into(), app: app_id, title });
    windows::show_pill(app);
    changed(app);
}

/// The person declined an offer: for this call, or (never) for this app from now on.
pub async fn dismiss(app: &AppHandle, never: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let prompt = state.meetings.prompt.lock().unwrap().take();
    windows::hide_pill(app);
    changed(app);
    let Some(p) = prompt else { return Ok(()) };
    state.meetings.dismissed.lock().unwrap().insert(p.app.clone(), Instant::now());
    if never && p.app != "other" {
        let mut settings = state.meetings.server.lock().unwrap().0.get("settings").cloned().unwrap_or_else(|| serde_json::json!({}));
        let mut apps = settings.get("neverApps").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if !apps.iter().any(|a| a.as_str() == Some(p.app.as_str())) {
            apps.push(serde_json::Value::String(p.app.clone()));
        }
        settings["neverApps"] = serde_json::Value::Array(apps);
        save_server_settings(app, settings).await?;
    }
    Ok(())
}

/// Save the copilot settings on YouBank (they apply to every computer).
pub async fn save_server_settings(app: &AppHandle, settings: serde_json::Value) -> Result<serde_json::Value, String> {
    let state = app.state::<AppState>();
    let saved: serde_json::Value =
        state.api().put("/api/desktop/meetings", &serde_json::json!({ "settings": settings })).await.inspect_err(|e| state::on_error(app, e))?;
    let _ = refresh(app).await;
    changed(app);
    Ok(saved)
}

/// The background work: the sender, the notes check, noticing calls, and the settings refresh.
pub fn start_background(app: AppHandle) {
    // Sending: whenever a chunk is written, and every 20 seconds for anything left from before.
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut backoff = 20u64;
        loop {
            let ok = send_waiting(&a).await;
            backoff = if ok { 20 } else { (backoff * 2).min(300) };
            let state = a.state::<AppState>();
            let _ = tokio::time::timeout(Duration::from_secs(backoff), state.meetings.kick.notified()).await;
        }
    });
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            check_notes(&a).await;
            tokio::time::sleep(Duration::from_secs(20)).await;
        }
    });
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(25)).await;
        let mut sys = detect::system();
        let mut last_refresh: Option<Instant> = None;
        loop {
            let enabled = a.state::<AppState>().settings().meetings.enabled;
            if enabled && a.state::<AppState>().connected() && last_refresh.is_none_or(|t| t.elapsed() > Duration::from_secs(600)) {
                last_refresh = Some(Instant::now());
                let _ = refresh(&a).await;
            }
            if enabled {
                look(&a, &mut sys).await;
            }
            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_rules() {
        let apps = vec!["zoom".to_string()];
        let words = vec!["board".to_string(), String::new()];
        assert!(refused(&apps, &words, "zoom", "anything").is_some());
        assert!(refused(&apps, &words, "teams", "Board prep | Microsoft Teams").is_some());
        assert!(refused(&apps, &words, "teams", "Pipeline review").is_none());
    }

    #[test]
    fn refusals() {
        assert_eq!(on_refusal(&ApiError::Offline), Refusal::Later);
        assert_eq!(on_refusal(&ApiError::Server(503, String::new())), Refusal::Later);
        assert_eq!(on_refusal(&ApiError::Limited(60, String::new())), Refusal::Later);
        assert_eq!(on_refusal(&ApiError::Server(409, String::new())), Refusal::Drop);
        assert_eq!(on_refusal(&ApiError::Server(400, String::new())), Refusal::Drop);
    }

    #[test]
    fn server_view() {
        let v = ServerView(serde_json::json!({ "settings": { "neverApps": ["Zoom"], "neverKeywords": ["HR"], "autoStartApps": [] } }));
        assert_eq!(v.never_apps(), vec!["zoom"]);
        assert_eq!(v.never_keywords(), vec!["hr"]);
        assert!(v.auto_start_apps().is_empty());
        assert!(ServerView::default().never_apps().is_empty());
    }
}
