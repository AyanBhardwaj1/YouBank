//! The commands pages may call. Which page may call which is set by the capability files: the website
//! gets only `desktop_info`, `open_quick_ask` and `open_agent`; the app's own pages get the rest. Every
//! command answers errors as a sentence for the person.

use crate::api::ApiError;
use crate::settings::{Folder, Settings};
use crate::state::{self, AppState};
use crate::{alerts, ask, deeplink, files, meetings, office, pairing, tasks, updater, windows};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

type Res<T> = Result<T, String>;

/* ---------------- What the website may call ---------------- */

#[derive(Serialize)]
pub struct DesktopInfo {
    version: &'static str,
    platform: &'static str,
    connected: bool,
}

/// The app's version and whether this computer is connected (the download page and Settings show it).
#[tauri::command]
pub fn desktop_info(state: State<'_, AppState>) -> DesktopInfo {
    DesktopInfo { version: crate::api::VERSION, platform: pairing::platform(), connected: state.connected() }
}

#[tauri::command]
pub fn open_quick_ask(app: AppHandle) {
    windows::toggle_quick_ask(&app, None);
}

#[tauri::command]
pub fn open_agent(app: AppHandle, section: Option<String>) {
    let section = section.filter(|s| ["account", "files", "office", "alerts", "tasks", "meetings", "app"].contains(&s.as_str()));
    windows::open_agent(&app, section);
}

/* ---------------- The app's own pages ---------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateView {
    version: &'static str,
    platform: &'static str,
    site: String,
    custom_site: bool,
    online: bool,
    connected: bool,
    account: Option<state::Account>,
    settings: Settings,
    update_ready: Option<String>,
    autostart: bool,
    /// A question from a youbank://ask link, for quick ask to fill in when it opens.
    ask_draft: Option<String>,
    agent_section: Option<String>,
}

#[tauri::command]
pub fn get_state(app: AppHandle, state: State<'_, AppState>) -> AppStateView {
    use tauri_plugin_autostart::ManagerExt;
    AppStateView {
        version: crate::api::VERSION,
        platform: pairing::platform(),
        site: state.site.to_string(),
        custom_site: state.site.as_str() != format!("{}/", crate::settings::DEFAULT_SITE),
        online: state.is_online(),
        connected: state.connected(),
        account: state.account.lock().unwrap().clone(),
        settings: state.settings(),
        update_ready: state.update_ready.lock().unwrap().clone(),
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        ask_draft: state.ask_draft.lock().unwrap().clone(),
        agent_section: state.agent_section.lock().unwrap().clone(),
    }
}

/// Save settings from the agent window. Anything that needs consent stays off until it was given
/// (accept_consent), whatever the page sends; side effects (hotkey, start at login, watchers, the
/// server's task switches) follow.
#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> Res<Settings> {
    let state = app.state::<AppState>();
    let before = state.settings();
    let next = state.update_settings(|s| {
        let consents = s.consents.clone();
        *s = settings;
        s.consents = consents;
        let agreed = |k: &str| s.consents.contains_key(k);
        if !agreed("files") {
            s.files.enabled = false;
        }
        if !agreed("office") {
            s.office.enabled = false;
        }
        if !agreed("alerts") {
            s.notifications.alerts = false;
            s.notifications.questions = false;
            s.notifications.deals = false;
        }
        if !agreed("meetings") {
            s.meetings.enabled = false;
        }
        if !agreed("tasks") {
            s.tasks.morning_brief.on = false;
            s.tasks.autopilot_status.on = false;
            s.tasks.edge_brief.on = false;
            s.tasks.watch_check.on = false;
        }
    })?;
    if next.hotkey != before.hotkey {
        crate::register_hotkey(&app, &next.hotkey)?;
    }
    if next.launch_at_login != before.launch_at_login {
        use tauri_plugin_autostart::ManagerExt;
        let r = if next.launch_at_login { app.autolaunch().enable() } else { app.autolaunch().disable() };
        r.map_err(|e| format!("Could not change starting with your computer: {e}"))?;
    }
    if next.files != before.files || next.office.enabled != before.office.enabled || next.office.folder != before.office.folder {
        files::restart_watchers(&app);
    }
    if next.tasks != before.tasks {
        tasks::sync_switches(&app).await.map_err(|e| format!("Saved here, but YouBank did not get the change yet: {e}"))?;
    }
    state::broadcast(&app);
    Ok(next)
}

/// The person agreed to a consent screen ("files", "office", "alerts", "tasks", "meetings"): record when, and switch it on.
#[tauri::command]
pub fn accept_consent(app: AppHandle, what: String) -> Res<Settings> {
    if !["files", "office", "alerts", "tasks", "meetings"].contains(&what.as_str()) {
        return Err("Unknown setting".into());
    }
    let state = app.state::<AppState>();
    let s = state.update_settings(|s| {
        s.consents.insert(what.clone(), chrono::Local::now().to_rfc3339());
        match what.as_str() {
            "files" => s.files.enabled = true,
            "office" => s.office.enabled = true,
            "meetings" => s.meetings.enabled = true,
            _ => {}
        }
    })?;
    files::restart_watchers(&app);
    state::broadcast(&app);
    Ok(s)
}

#[derive(Serialize)]
pub struct SiteStatus {
    online: bool,
    site: String,
}

/// Whether the site answers; the start-up and offline screens use it.
#[tauri::command]
pub async fn site_status(app: AppHandle) -> SiteStatus {
    let state = app.state::<AppState>();
    let online = state.api().reachable().await;
    state.online.store(online, std::sync::atomic::Ordering::Relaxed);
    SiteStatus { online, site: state.site.to_string() }
}

/// Open a page of the site in the main window; without a path, where the person left off (or Home).
#[tauri::command]
pub fn open_site(app: AppHandle, path: Option<String>) -> Res<()> {
    let state = app.state::<AppState>();
    let target = match path {
        Some(p) => {
            if !p.starts_with('/') || p.starts_with("//") || p.contains('\\') || p.chars().any(char::is_control) {
                return Err("bad path".into());
            }
            p
        }
        None => state
            .resume
            .lock()
            .unwrap()
            .clone()
            .and_then(|u| url::Url::parse(&u).ok())
            .filter(|u| u.origin() == state.site.origin())
            .map(|u| u[url::Position::BeforePath..].to_string())
            .unwrap_or_else(|| "/app".into()),
    };
    if !state.settings().onboarded {
        let _ = state.update_settings(|s| s.onboarded = true);
    }
    windows::open_site(&app, &target);
    Ok(())
}

/// Open a link in the person's browser (help pages, the approval page when signing in there).
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Res<()> {
    let u = url::Url::parse(&url).map_err(|_| "bad link")?;
    if u.scheme() != "https" && u.origin() != app.state::<AppState>().site.origin() {
        return Err("Only web links can be opened.".into());
    }
    app.opener().open_url(u.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_quick_ask(app: AppHandle) {
    ask::cancel(&app);
    if let Some(w) = app.get_webview_window(windows::QUICK) {
        let _ = w.hide();
    }
}

#[tauri::command]
pub async fn pair_start(app: AppHandle, in_browser: Option<bool>) -> Res<pairing::Pairing> {
    pairing::start(&app, in_browser.unwrap_or(false)).await
}

#[tauri::command]
pub fn pair_cancel(app: AppHandle) {
    pairing::cancel(&app);
}

#[tauri::command]
pub async fn sign_out(app: AppHandle) -> Res<()> {
    pairing::sign_out(&app).await
}

#[tauri::command]
pub async fn refresh_account(app: AppHandle) -> Res<Option<state::Account>> {
    state::refresh_account(&app).await.or_else(|e| if matches!(e, ApiError::SignedOut) { Ok(None) } else { Err(e.to_string()) })
}

#[tauri::command]
pub fn ask(app: AppHandle, messages: Vec<ask::Message>) -> Res<()> {
    if !app.state::<AppState>().connected() {
        return Err(ApiError::SignedOut.into());
    }
    ask::start(&app, messages);
    Ok(())
}

#[tauri::command]
pub fn ask_cancel(app: AppHandle) {
    ask::cancel(&app);
}

/// A folder (to index) or a workbook (to link to Studio), from the system's own picker.
#[tauri::command]
pub async fn pick_path(app: AppHandle, kind: String) -> Res<Option<String>> {
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let d = a.dialog().file();
        if kind == "workbook" {
            d.set_title("Choose an Excel workbook to link to Studio").add_filter("Excel workbook", &["xlsx", "xlsm"]).blocking_pick_file()
        } else {
            d.set_title("Choose a folder for YouBank to read").blocking_pick_folder()
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn add_folder(app: AppHandle, path: String, auto_upload: Option<bool>) -> Res<files::ScanReport> {
    let state = app.state::<AppState>();
    if !state.settings().files.enabled {
        return Err("Turn on local files first.".into());
    }
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err("That folder does not exist.".into());
    }
    if files::too_broad(&p, app.path().home_dir().ok().as_deref()) {
        return Err("That folder is too broad to read whole. Pick the folder that holds your deal files.".into());
    }
    state.update_settings(|s| {
        if !s.files.folders.iter().any(|f| f.path == path) {
            s.files.folders.push(Folder { path: path.clone(), auto_upload: auto_upload.unwrap_or(false) });
        }
    })?;
    files::restart_watchers(&app);
    files::scan(&app, Some(path)).await
}

#[tauri::command]
pub async fn remove_folder(app: AppHandle, path: String, remove_docs: bool) -> Res<()> {
    files::remove_folder(&app, &path, remove_docs).await
}

#[tauri::command]
pub fn set_folder_auto(app: AppHandle, path: String, auto_upload: bool) -> Res<()> {
    app.state::<AppState>().update_settings(|s| {
        if let Some(f) = s.files.folders.iter_mut().find(|f| f.path == path) {
            f.auto_upload = auto_upload;
        }
    })?;
    Ok(())
}

#[tauri::command]
pub async fn scan_files(app: AppHandle) -> Res<files::ScanReport> {
    files::scan(&app, None).await
}

#[tauri::command]
pub async fn upload_files(app: AppHandle, paths: Option<Vec<String>>) -> Res<files::UploadReport> {
    files::upload(&app, paths).await
}

#[tauri::command]
pub async fn remove_indexed_file(app: AppHandle, path: String) -> Res<()> {
    files::remove(&app, &path).await
}

#[derive(Serialize)]
pub struct FilesView {
    entries: Vec<files::Entry>,
}

#[tauri::command]
pub async fn files_status(app: AppHandle) -> FilesView {
    let state = app.state::<AppState>();
    let ix = state.files.lock().await;
    FilesView { entries: ix.entries.values().take(3000).cloned().collect() }
}

#[tauri::command]
pub async fn studio_docs(app: AppHandle) -> Res<Vec<office::StudioDoc>> {
    office::docs(&app).await
}

#[tauri::command]
pub async fn studio_pull(app: AppHandle, doc_id: i64, format: String, open: Option<bool>) -> Res<String> {
    office::pull(&app, doc_id, &format, open.unwrap_or(true)).await
}

#[derive(Serialize)]
pub struct PushResult {
    ok: bool,
    message: String,
    /// Studio changed since the pull: the page offers "pull a fresh copy" or "push anyway".
    conflict: bool,
}

#[tauri::command]
pub async fn studio_push(app: AppHandle, path: String, force: Option<bool>) -> PushResult {
    match office::push(&app, &path, force.unwrap_or(false)).await {
        Ok(m) => PushResult { ok: true, message: m, conflict: false },
        Err(ApiError::Conflict(m, _)) => PushResult { ok: false, message: m, conflict: true },
        Err(e) => PushResult { ok: false, message: e.to_string(), conflict: false },
    }
}

#[tauri::command]
pub async fn studio_link(app: AppHandle, path: String) -> Res<i64> {
    office::link(&app, &path).await
}

#[tauri::command]
pub async fn studio_unlink(app: AppHandle, path: String) {
    office::unlink(&app, &path).await
}

#[tauri::command]
pub async fn studio_agent(app: AppHandle, path: String, instruction: String) -> Res<String> {
    let instruction = instruction.trim().to_string();
    if instruction.is_empty() {
        return Err("Say what to change.".into());
    }
    office::agent_edit(&app, &path, &instruction).await
}

#[derive(Serialize)]
pub struct OfficeView {
    folder: String,
    links: Vec<office::LinkStatus>,
}

#[tauri::command]
pub async fn office_status(app: AppHandle) -> OfficeView {
    let (folder, links) = office::status(&app).await;
    OfficeView { folder, links }
}

/// Open a linked Office file, an indexed file or the YouBank folder in its own program. Nothing else.
#[tauri::command]
pub async fn open_local(app: AppHandle, path: String, reveal: Option<bool>) -> Res<()> {
    let state = app.state::<AppState>();
    let known = state.office.lock().await.links.iter().any(|l| l.path == path)
        || state.files.lock().await.entries.contains_key(&path)
        || Path::new(&path) == office::folder(&app)
        || state.settings().files.folders.iter().any(|f| f.path == path);
    if !known {
        return Err("That file is not one YouBank manages.".into());
    }
    if Path::new(&path) == office::folder(&app) {
        let _ = std::fs::create_dir_all(&path);
    }
    let r = if reveal.unwrap_or(false) { app.opener().reveal_item_in_dir(&path) } else { app.opener().open_path(path.clone(), None::<&str>) };
    r.map_err(|e| format!("Could not open it: {e}"))
}

#[tauri::command]
pub async fn run_task(app: AppHandle, id: String) -> Res<tasks::TaskResult> {
    if !tasks::IDS.contains(&id.as_str()) {
        return Err("Unknown task".into());
    }
    tasks::run(&app, &id, true).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_alerts(app: AppHandle) -> Res<usize> {
    alerts::check(&app).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Res<Option<String>> {
    updater::check(&app, true).await
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Res<()> {
    updater::install(&app).await
}

/* ---------------- The meeting copilot ---------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingView {
    enabled: bool,
    connected: bool,
    session: Option<meetings::Session>,
    prompt: Option<meetings::Prompt>,
    /// The site's copilot settings, plan and recent meetings, as last fetched.
    server: serde_json::Value,
}

#[tauri::command]
pub fn meeting_state(app: AppHandle) -> MeetingView {
    let state = app.state::<AppState>();
    let session = state.meetings.session.lock().unwrap().clone();
    let prompt = state.meetings.prompt.lock().unwrap().clone();
    let server = state.meetings.server.lock().unwrap().0.clone();
    MeetingView { enabled: state.settings().meetings.enabled, connected: state.connected(), session, prompt, server }
}

/// Show the consent step in the pill ("Start the copilot" from a page, or Start on an offer).
#[tauri::command]
pub fn meeting_prompt(app: AppHandle, platform: Option<String>, title: Option<String>) -> Res<()> {
    let state = app.state::<AppState>();
    if !state.settings().meetings.enabled {
        windows::open_agent(&app, Some("meetings".into()));
        return Err("Turn on the meeting copilot first.".into());
    }
    if state.meetings.session.lock().unwrap().is_some() {
        windows::show_pill(&app);
        return Ok(());
    }
    meetings::ask_consent(&app, platform.map(|p| (p, title.unwrap_or_default())));
    Ok(())
}

/// Start recording, after the consent step.
#[tauri::command]
pub async fn meeting_start(app: AppHandle, args: meetings::StartArgs) -> Res<meetings::Session> {
    meetings::start(&app, args).await
}

#[tauri::command]
pub async fn meeting_stop(app: AppHandle, discard: bool) -> Res<()> {
    meetings::stop(&app, discard).await
}

/// Not now (for this call), or never for this app.
#[tauri::command]
pub async fn meeting_dismiss(app: AppHandle, never: bool) -> Res<()> {
    meetings::dismiss(&app, never).await
}

#[tauri::command]
pub async fn meeting_refresh(app: AppHandle) -> Res<serde_json::Value> {
    meetings::refresh(&app).await.map(|v| v.0).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn meeting_server_settings(app: AppHandle, settings: serde_json::Value) -> Res<serde_json::Value> {
    meetings::save_server_settings(&app, settings).await
}

fn current_meeting(app: &AppHandle, id: Option<i64>) -> Res<i64> {
    id.filter(|n| *n > 0)
        .or_else(|| app.state::<AppState>().meetings.session.lock().unwrap().as_ref().map(|s| s.id))
        .ok_or_else(|| "No meeting is being recorded.".to_string())
}

async fn call(app: &AppHandle, f: impl std::future::Future<Output = Result<serde_json::Value, ApiError>>) -> Res<serde_json::Value> {
    f.await.inspect_err(|e| state::on_error(app, e)).map_err(|e| e.to_string())
}

/// Live suggestions on or off for the meeting being recorded (the server checks the plan).
#[tauri::command]
pub async fn meeting_live(app: AppHandle, on: bool) -> Res<serde_json::Value> {
    let id = current_meeting(&app, None)?;
    let api = app.state::<AppState>().api();
    call(&app, api.put(&format!("/api/desktop/meetings/{id}/live"), &serde_json::json!({ "on": on }))).await
}

#[tauri::command]
pub async fn meeting_suggest(app: AppHandle) -> Res<serde_json::Value> {
    let id = current_meeting(&app, None)?;
    let api = app.state::<AppState>().api();
    call(&app, api.post(&format!("/api/desktop/meetings/{id}/live"), &serde_json::json!({}))).await
}

#[tauri::command]
pub async fn meeting_brief(app: AppHandle, id: Option<i64>, fresh: Option<bool>) -> Res<serde_json::Value> {
    let id = current_meeting(&app, id)?;
    let api = app.state::<AppState>().api();
    call(&app, api.get(&format!("/api/desktop/meetings/{id}/brief{}", if fresh.unwrap_or(false) { "?fresh=1" } else { "" }))).await
}

#[tauri::command]
pub async fn meeting_tail(app: AppHandle, id: Option<i64>) -> Res<serde_json::Value> {
    let id = current_meeting(&app, id)?;
    let api = app.state::<AppState>().api();
    call(&app, api.get(&format!("/api/desktop/meetings/{id}?tail=1"))).await
}

#[tauri::command]
pub async fn meeting_ask(app: AppHandle, question: String, id: Option<i64>) -> Res<serde_json::Value> {
    let id = current_meeting(&app, id)?;
    let api = app.state::<AppState>().api();
    call(&app, api.post(&format!("/api/desktop/meetings/{id}/ask"), &serde_json::json!({ "question": question }))).await
}

#[tauri::command]
pub async fn meeting_search(app: AppHandle, q: String) -> Res<serde_json::Value> {
    let api = app.state::<AppState>().api();
    let query = url::form_urlencoded::Serializer::new(String::new()).append_pair("q", q.trim()).finish();
    call(&app, api.get(&format!("/api/desktop/meetings/search?{query}"))).await
}

/// Say who and what the meeting is about (picked contacts and deals), or rename it.
#[tauri::command]
pub async fn meeting_link(app: AppHandle, contact_ids: Vec<i64>, deal_ids: Vec<i64>, title: Option<String>) -> Res<serde_json::Value> {
    let id = current_meeting(&app, None)?;
    let api = app.state::<AppState>().api();
    let mut body = serde_json::json!({ "contactIds": contact_ids, "dealIds": deal_ids });
    if let Some(t) = title {
        body["title"] = serde_json::Value::String(t);
    }
    call(&app, api.patch(&format!("/api/desktop/meetings/{id}"), &body)).await
}

#[tauri::command]
pub fn open_copilot(app: AppHandle) {
    windows::open_copilot(&app);
}

#[tauri::command]
pub fn hide_pill(app: AppHandle) {
    windows::hide_pill(&app);
}

/// Act on a youbank:// link (from the system, a second launch or the tray).
pub fn handle_link(app: &AppHandle, raw: &str) {
    match deeplink::parse(raw) {
        Some(deeplink::Link::Open(path)) => windows::open_site(app, &path),
        Some(deeplink::Link::Ask(q)) => windows::toggle_quick_ask(app, Some(q)),
        Some(deeplink::Link::Agent(section)) => windows::open_agent(app, section),
        None => {}
    }
}
