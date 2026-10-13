//! Updates from GitHub Releases (the endpoint in tauri.conf.json, a `latest.json` the release workflow
//! publishes with each signed build). The app checks a minute after start and every six hours, tells
//! the person when a new version is ready, and installs only when they choose "Restart to update".
//! A build without an update signing key (a local build, say) does not update itself.

use crate::alerts;
use crate::state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

fn configured(app: &AppHandle) -> bool {
    app.config().plugins.0.get("updater").and_then(|u| u.get("pubkey")).and_then(|k| k.as_str()).is_some_and(|k| !k.trim().is_empty())
}

const NOT_SET_UP: &str = "This copy of YouBank does not update itself. Get new versions from the download page.";

/// Look for a newer version; Some(version) when one is ready to install.
pub async fn check(app: &AppHandle, tell: bool) -> Result<Option<String>, String> {
    if !configured(app) {
        return Err(NOT_SET_UP.into());
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| {
        log::info!("update check: {e}");
        "Could not check for updates right now.".to_string()
    })?;
    let version = found.map(|u| u.version);
    let state = app.state::<AppState>();
    let was = state.update_ready.lock().unwrap().clone();
    *state.update_ready.lock().unwrap() = version.clone();
    if let Some(v) = &version {
        if tell || was.as_deref() != Some(v) {
            alerts::show(
                app,
                &format!("YouBank {v} is ready"),
                "When it suits you, choose Check for updates in the YouBank menu, or Restart to update in the desktop agent.",
            );
        }
    }
    Ok(version)
}

/// Download, install and restart.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    if !configured(app) {
        return Err(NOT_SET_UP.into());
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("You already have the latest version.".into());
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| {
        log::warn!("update install: {e}");
        "The update could not be installed. Try again later, or download it from the download page.".to_string()
    })?;
    app.restart();
}

pub fn start(app: AppHandle) {
    if !configured(&app) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            let _ = check(&app, false).await;
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}
