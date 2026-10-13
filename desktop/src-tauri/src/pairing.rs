//! Connecting this computer to a YouBank account, the way the Office add-in connects: the app asks for
//! a short code, the person approves it on YouBank (in the app's own window, where they are usually
//! signed in already, or in their browser), and the app collects a device token once and keeps it in
//! the keychain. The token only works on the desktop routes and can be revoked from Settings.

use crate::alerts;
use crate::api::ApiError;
use crate::state::{self, AppState};
use crate::{tasks, windows};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize)]
struct Started {
    code: String,
    poll: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    pub code: String,
    pub approve_url: String,
}

#[derive(Deserialize)]
struct Polled {
    status: String,
    token: Option<String>,
}

pub fn platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        _ => "linux",
    }
}

fn device_name() -> String {
    let host = gethostname::gethostname().to_string_lossy().trim().to_string();
    let host = host.trim_end_matches(".local").to_string();
    if host.is_empty() {
        "Desktop app".into()
    } else {
        host.chars().take(60).collect()
    }
}

/// Ask for a code, open the approval page, and wait for approval in the background.
pub async fn start(app: &AppHandle, in_browser: bool) -> Result<Pairing, String> {
    let state = app.state::<AppState>();
    let generation = state.pairing.fetch_add(1, Ordering::SeqCst) + 1;
    let s: Started = state.api().post_open("/api/desktop/pair/start", &serde_json::json!({ "platform": platform(), "name": device_name() })).await?;
    // The approval page is built here from the configured site, never taken from the answer.
    let approve = state.site.join(&format!("desktop/connect?code={}", s.code)).map_err(|e| e.to_string())?;
    if in_browser {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(approve.as_str(), None::<&str>);
    } else {
        windows::open_site(app, &format!("/desktop/connect?code={}", s.code));
    }
    let a = app.clone();
    let poll = s.poll.clone();
    tauri::async_runtime::spawn(async move { wait(a, poll, generation).await });
    Ok(Pairing { code: s.code, approve_url: approve.to_string() })
}

pub fn cancel(app: &AppHandle) {
    app.state::<AppState>().pairing.fetch_add(1, Ordering::SeqCst);
}

async fn wait(app: AppHandle, poll: String, generation: u64) {
    let state = app.state::<AppState>();
    // Codes last ten minutes; check every three seconds until then.
    for _ in 0..200 {
        tokio::time::sleep(Duration::from_secs(3)).await;
        if state.pairing.load(Ordering::SeqCst) != generation {
            return;
        }
        let r: Result<Polled, ApiError> = state.api().post_open("/api/desktop/pair/poll", &serde_json::json!({ "poll": poll })).await;
        match r {
            Ok(p) if p.status == "approved" => {
                let Some(token) = p.token else { break };
                if let Err(e) = state.set_token(Some(token)) {
                    let _ = app.emit("pair://failed", e.clone());
                    alerts::show(&app, "Could not stay connected", &e);
                    return;
                }
                let account = state::refresh_account(&app).await.ok().flatten();
                let _ = tasks::sync_switches(&app).await;
                crate::files::restart_watchers(&app);
                let who = account.map(|a| if a.name.is_empty() { a.email } else { a.name }).unwrap_or_default();
                alerts::show(&app, "This computer is connected", &format!("Signed in as {who}. Choose what the app may do in the desktop agent."));
                let _ = app.emit("pair://done", who);
                state::broadcast(&app);
                return;
            }
            Ok(p) if p.status == "expired" => break,
            _ => {}
        }
    }
    let _ = app.emit("pair://expired", ());
}

/// Disconnect: the server revokes the token, and the keychain forgets it.
pub async fn sign_out(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let r: Result<serde_json::Value, ApiError> = state.api().delete("/api/desktop/me").await;
    if let Err(e) = r {
        if !matches!(e, ApiError::SignedOut) {
            log::info!("revoke on sign-out: {e}");
        }
    }
    state.set_token(None)?;
    state::broadcast(app);
    Ok(())
}
