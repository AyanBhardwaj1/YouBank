//! What the app holds while it runs: its settings, the device token (read from the keychain once),
//! the connected account, and the local file and Office indexes.

use crate::api::{self, Api, ApiError};
use crate::files::FileIndex;
use crate::office::OfficeLinks;
use crate::settings::{self, Settings};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

/// The keychain entry's service; the account is the site's host, so staging and production never share a token.
const KEYCHAIN_SERVICE: &str = "com.youbank.desktop";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub email: String,
    pub plan: String,
    pub admin: bool,
    /// Premium desktop features this person may use: "desktop.folders" and so on.
    pub unlocked: Vec<String>,
    pub files_used: u64,
    pub files_free: u64,
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub data_dir: PathBuf,
    /// The site address this run uses (settings or YOUBANK_URL at start-up).
    pub site: Url,
    pub http: reqwest::Client,
    pub token: Mutex<Option<String>>,
    pub account: Mutex<Option<Account>>,
    /// Bumped to cancel a pairing in progress.
    pub pairing: AtomicU64,
    pub ask: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub files: tokio::sync::Mutex<FileIndex>,
    pub office: tokio::sync::Mutex<OfficeLinks>,
    pub watchers: Mutex<Vec<notify::RecommendedWatcher>>,
    pub online: AtomicBool,
    /// Where the main window was when the site stopped answering, to return to.
    pub resume: Mutex<Option<String>>,
    /// The page of the last alert shown, for "Open latest alert" in the tray.
    pub last_alert: Mutex<Option<String>>,
    pub update_ready: Mutex<Option<String>>,
    /// The question a youbank://ask link brought, until quick ask shows it.
    pub ask_draft: Mutex<Option<String>>,
    /// The section the agent window was asked to open on, for a window still loading.
    pub agent_section: Mutex<Option<String>>,
    /// The meeting copilot: the recording in progress, the offer or consent prompt, the server's rules.
    pub meetings: crate::meetings::Meetings,
}

impl AppState {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        let settings_path = config_dir.join("settings.json");
        let settings = Settings::load(&settings_path);
        let site = settings::site_url(&settings.site_url);
        let token = keychain_get(&site);
        Self {
            files: tokio::sync::Mutex::new(FileIndex::load(&data_dir)),
            office: tokio::sync::Mutex::new(OfficeLinks::load(&data_dir)),
            settings: Mutex::new(settings),
            settings_path,
            data_dir,
            site,
            http: api::client(),
            token: Mutex::new(token),
            account: Mutex::new(None),
            pairing: AtomicU64::new(0),
            ask: Mutex::new(None),
            watchers: Mutex::new(Vec::new()),
            online: AtomicBool::new(true),
            resume: Mutex::new(None),
            last_alert: Mutex::new(None),
            update_ready: Mutex::new(None),
            ask_draft: Mutex::new(None),
            agent_section: Mutex::new(None),
            meetings: crate::meetings::Meetings::default(),
        }
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    /// Change the settings and save them; returns the new value.
    pub fn update_settings(&self, f: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
        let mut s = self.settings.lock().unwrap();
        let mut next = s.clone();
        f(&mut next);
        let next = next.clean();
        next.save(&self.settings_path).map_err(|e| format!("Could not save settings: {e}"))?;
        *s = next.clone();
        Ok(next)
    }

    pub fn api(&self) -> Api {
        Api { http: self.http.clone(), base: self.site.clone(), token: self.token.lock().unwrap().clone() }
    }

    pub fn connected(&self) -> bool {
        self.token.lock().unwrap().is_some()
    }

    pub fn set_token(&self, token: Option<String>) -> Result<(), String> {
        match &token {
            Some(t) => keychain_set(&self.site, t)?,
            None => keychain_delete(&self.site),
        }
        *self.token.lock().unwrap() = token;
        if !self.connected() {
            *self.account.lock().unwrap() = None;
        }
        Ok(())
    }

    pub fn is_online(&self) -> bool {
        self.online.load(Ordering::Relaxed)
    }
}

fn entry(site: &Url) -> Option<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, site.host_str().unwrap_or("youbank")).map_err(|e| log::warn!("keychain unavailable: {e}")).ok()
}

fn keychain_get(site: &Url) -> Option<String> {
    entry(site)?.get_password().ok().filter(|t| t.starts_with("ybd_"))
}

fn keychain_set(site: &Url, token: &str) -> Result<(), String> {
    entry(site)
        .ok_or_else(|| "This computer's keychain is not available, so the app cannot stay connected. On Linux, install and unlock a Secret Service keyring (GNOME Keyring or KWallet).".to_string())?
        .set_password(token)
        .map_err(|e| format!("Could not save the connection in your keychain: {e}"))
}

fn keychain_delete(site: &Url) {
    if let Some(e) = entry(site) {
        let _ = e.delete_credential();
    }
}

/// Tell every window that the account or connection changed, so open screens refresh.
pub fn broadcast(app: &AppHandle) {
    let _ = app.emit("state://changed", ());
}

#[derive(Deserialize)]
struct Me {
    user: MeUser,
    plan: MePlan,
    features: std::collections::BTreeMap<String, MeFeature>,
    files: MeFiles,
}
#[derive(Deserialize)]
struct MeUser {
    name: String,
    email: String,
}
#[derive(Deserialize)]
struct MePlan {
    name: String,
    admin: bool,
}
#[derive(Deserialize)]
struct MeFeature {
    unlocked: bool,
}
#[derive(Deserialize)]
struct MeFiles {
    used: u64,
    free: u64,
}

/// Ask the server who this computer is connected as. A 401 means it was disconnected: the token goes.
pub async fn refresh_account(app: &AppHandle) -> Result<Option<Account>, ApiError> {
    let state = app.state::<AppState>();
    if !state.connected() {
        return Ok(None);
    }
    match state.api().get::<Me>("/api/desktop/me").await {
        Ok(me) => {
            let a = Account {
                name: me.user.name,
                email: me.user.email,
                plan: me.plan.name,
                admin: me.plan.admin,
                unlocked: me.features.into_iter().filter(|(_, f)| f.unlocked).map(|(k, _)| k).collect(),
                files_used: me.files.used,
                files_free: me.files.free,
            };
            *state.account.lock().unwrap() = Some(a.clone());
            broadcast(app);
            Ok(Some(a))
        }
        Err(ApiError::SignedOut) => {
            let _ = state.set_token(None);
            broadcast(app);
            Err(ApiError::SignedOut)
        }
        Err(e) => Err(e),
    }
}

/// Handle a signed-out answer from any call: forget the token so the app asks to connect again.
pub fn on_error(app: &AppHandle, e: &ApiError) {
    if matches!(e, ApiError::SignedOut) {
        let state = app.state::<AppState>();
        if state.connected() {
            let _ = state.set_token(None);
            broadcast(app);
        }
    }
}
