//! The app's own settings, kept as JSON in the app's config folder. Everything that reaches beyond the
//! window (folders, Office files, alerts, scheduled tasks) starts off and is switched on by the person,
//! with a consent screen recorded in `consents`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use url::Url;

/// Production. Overridden by `YOUBANK_URL` (staging, local development) or the setting.
pub const DEFAULT_SITE: &str = "https://youbank-nu.vercel.app";
/// Quick ask, from anywhere. Empty turns it off.
pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+Space";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Empty means production. Changing it takes effect on the next start.
    pub site_url: String,
    pub onboarded: bool,
    pub hotkey: String,
    pub launch_at_login: bool,
    /// Closing the window keeps the app in the tray, so alerts and scheduled tasks keep running.
    pub close_to_tray: bool,
    pub notifications: Notifications,
    pub files: FilesSettings,
    pub office: OfficeSettings,
    pub tasks: Tasks,
    /// What the person agreed to, and when (ISO time): "files", "office", "alerts", "tasks".
    pub consents: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            site_url: String::new(),
            onboarded: false,
            hotkey: DEFAULT_HOTKEY.into(),
            launch_at_login: false,
            close_to_tray: true,
            notifications: Notifications::default(),
            files: FilesSettings::default(),
            office: OfficeSettings::default(),
            tasks: Tasks::default(),
            consents: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Notifications {
    pub alerts: bool,
    pub questions: bool,
    pub deals: bool,
    /// How often to check, in minutes (at least 2; the server limits it too).
    pub every_minutes: u32,
}

impl Default for Notifications {
    fn default() -> Self {
        Self { alerts: false, questions: false, deals: false, every_minutes: 5 }
    }
}

impl Notifications {
    pub fn any(&self) -> bool {
        self.alerts || self.questions || self.deals
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct FilesSettings {
    pub enabled: bool,
    pub folders: Vec<Folder>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Folder {
    pub path: String,
    /// Upload new and changed files as soon as they are seen, instead of asking first.
    pub auto_upload: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct OfficeSettings {
    pub enabled: bool,
    /// Where pulled Studio files go; empty means Documents/YouBank.
    pub folder: String,
    /// Push a linked workbook to Studio as soon as it is saved, instead of asking first.
    pub auto_push: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Tasks {
    pub morning_brief: Daily,
    pub autopilot_status: Every,
    pub edge_brief: Daily,
    pub watch_check: Every,
}

impl Default for Tasks {
    fn default() -> Self {
        Self {
            morning_brief: Daily { on: false, at: "08:00".into() },
            autopilot_status: Every { on: false, hours: 4 },
            edge_brief: Daily { on: false, at: "08:15".into() },
            watch_check: Every { on: false, hours: 12 },
        }
    }
}

impl Tasks {
    /// The switches the server keeps for this computer (it refuses scheduled AI tasks that are off there).
    pub fn server_map(&self) -> serde_json::Value {
        serde_json::json!({
            "morning-brief": self.morning_brief.on,
            "autopilot-status": self.autopilot_status.on,
            "edge-brief": self.edge_brief.on,
            "watch-check": self.watch_check.on,
        })
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Daily {
    pub on: bool,
    /// Local time, "HH:MM".
    pub at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Every {
    pub on: bool,
    pub hours: u32,
}

impl Settings {
    /// Read the settings; a missing or damaged file gives the defaults (a damaged one is kept aside).
    pub fn load(path: &Path) -> Self {
        let Ok(text) = fs::read_to_string(path) else { return Self::default() };
        match serde_json::from_str::<Settings>(&text) {
            Ok(s) => s.clean(),
            Err(e) => {
                log::warn!("settings unreadable, starting from defaults: {e}");
                let _ = fs::rename(path, path.with_extension("damaged.json"));
                Self::default()
            }
        }
    }

    /// Write atomically, so a crash mid-write never leaves half a file.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        write_json(path, self)
    }

    /// Bring values into range. Pure.
    pub fn clean(mut self) -> Self {
        self.notifications.every_minutes = self.notifications.every_minutes.clamp(2, 240);
        self.tasks.autopilot_status.hours = self.tasks.autopilot_status.hours.clamp(1, 24);
        self.tasks.watch_check.hours = self.tasks.watch_check.hours.clamp(6, 168);
        for d in [&mut self.tasks.morning_brief, &mut self.tasks.edge_brief] {
            if parse_hhmm(&d.at).is_none() {
                d.at = "08:00".into();
            }
        }
        self.files.folders.dedup_by(|a, b| a.path == b.path);
        self
    }
}

/// "08:30" as (8, 30). Pure.
pub fn parse_hhmm(s: &str) -> Option<(u32, u32)> {
    let (h, m) = s.trim().split_once(':')?;
    let (h, m) = (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?);
    (h < 24 && m < 60).then_some((h, m))
}

/// The site this app opens: `YOUBANK_URL`, else the setting, else production. Only https, or plain http
/// to this computer for local development, is accepted; anything else falls back to production.
pub fn site_url(setting: &str) -> Url {
    let env = std::env::var("YOUBANK_URL").unwrap_or_default();
    let found = [env.as_str(), setting].into_iter().find_map(valid_site);
    found.unwrap_or_else(|| Url::parse(DEFAULT_SITE).expect("default site"))
}

/// The origin of a site address, if it is one the app may load. Pure.
pub fn valid_site(raw: &str) -> Option<Url> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let u = Url::parse(raw).ok()?;
    let host = u.host_str()?.to_ascii_lowercase();
    let local = host == "localhost" || host == "127.0.0.1";
    if !(u.scheme() == "https" || (u.scheme() == "http" && local)) {
        return None;
    }
    if !u.username().is_empty() || u.password().is_some() {
        return None;
    }
    Url::parse(&u.origin().ascii_serialization()).ok()
}

/// Write JSON through a temporary file and a rename.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    fs::rename(tmp, path)
}

/// Read JSON, or the default when missing or unreadable.
pub fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sites() {
        assert_eq!(valid_site("https://staging.youbank.app/app?x=1").unwrap().as_str(), "https://staging.youbank.app/");
        assert_eq!(valid_site("http://localhost:3000").unwrap().as_str(), "http://localhost:3000/");
        assert!(valid_site("http://evil.example").is_none());
        assert!(valid_site("file:///etc/passwd").is_none());
        assert!(valid_site("https://user:pw@youbank.app").is_none());
        assert!(valid_site("").is_none());
    }

    #[test]
    fn defaults_are_off() {
        let s = Settings::default();
        assert!(!s.files.enabled && !s.office.enabled && !s.notifications.any());
        assert!(!s.tasks.edge_brief.on && !s.tasks.watch_check.on);
        assert!(s.close_to_tray);
    }

    #[test]
    fn cleaning() {
        let mut s = Settings::default();
        s.notifications.every_minutes = 0;
        s.tasks.morning_brief.at = "25:00".into();
        s.tasks.watch_check.hours = 1;
        let s = s.clean();
        assert_eq!(s.notifications.every_minutes, 2);
        assert_eq!(s.tasks.morning_brief.at, "08:00");
        assert_eq!(s.tasks.watch_check.hours, 6);
        assert_eq!(parse_hhmm("7:05"), Some((7, 5)));
        assert_eq!(parse_hhmm("7"), None);
    }

    #[test]
    fn partial_json_keeps_defaults() {
        let s: Settings = serde_json::from_str(r#"{"onboarded":true,"tasks":{"edgeBrief":{"on":true}}}"#).unwrap();
        assert!(s.onboarded && s.tasks.edge_brief.on);
        assert_eq!(s.hotkey, DEFAULT_HOTKEY);
        assert_eq!(s.notifications.every_minutes, 5);
    }
}
