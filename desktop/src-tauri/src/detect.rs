//! Noticing a meeting: which meeting apps are running and whether one is in a call, so the app can
//! offer to start the copilot. It only looks; it never starts recording by itself unless the person
//! set that app to start on its own.
//!
//! What it looks at, every 15 seconds while the copilot is on and listening is switched on:
//! - running processes (all systems): Zoom, Microsoft Teams, Webex, Slack and browsers;
//! - which apps are using the microphone, the clearest sign of a call: on Linux PulseAudio's or
//!   PipeWire's recording streams (`pactl`), on Windows the microphone privacy store in the registry
//!   (an app using it now has a stop time of zero); macOS offers no such list without extra permission;
//! - window titles, for Google Meet in a browser tab and for call windows: `wmctrl -l` on Linux (X11),
//!   `tasklist /v` on Windows. macOS would need the Accessibility permission, which the app does not ask
//!   for, so there Meet in a browser is not noticed and a call is noticed from the app's own processes.
//!
//! The decision is a pure function of that snapshot (`classify`), tested below.

use std::collections::BTreeSet;
use std::process::Command;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

#[derive(Debug, Default, Clone)]
pub struct Snapshot {
    /// Process names, lowercased, without ".exe".
    pub processes: BTreeSet<String>,
    pub titles: Vec<String>,
    /// Apps using the microphone now, lowercased (a process or app name, or a path).
    pub mic_users: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Detected {
    /// The platform id the server uses: zoom, teams, meet, webex, slack.
    pub app: &'static str,
    /// The window or tab title that showed it, if any.
    pub title: String,
    /// In a call (the microphone is in use, or a call window is open), not just running.
    pub in_call: bool,
}

const BROWSERS: [&str; 9] = ["chrome", "google chrome", "chromium", "firefox", "msedge", "microsoft edge", "brave", "arc", "opera"];

fn any_proc(s: &Snapshot, names: &[&str]) -> bool {
    names.iter().any(|n| s.processes.contains(*n))
}

fn mic_by(s: &Snapshot, needles: &[&str]) -> bool {
    s.mic_users.iter().any(|u| needles.iter().any(|n| u.contains(n)))
}

fn title_where(s: &Snapshot, f: impl Fn(&str) -> bool) -> Option<String> {
    s.titles.iter().find(|t| f(&t.to_lowercase())).cloned()
}

/// The meeting the snapshot shows, preferring one in a call over one merely open. Pure.
pub fn classify(s: &Snapshot) -> Option<Detected> {
    let mut found: Vec<Detected> = Vec::new();

    // Zoom: its meeting helper (CptHost) runs only during a meeting; its window says "Zoom Meeting".
    let zoom_title = title_where(s, |t| t == "zoom meeting" || t == "zoom webinar" || t.starts_with("zoom meeting"));
    if any_proc(s, &["zoom", "zoom.us", "zoomus", "cpthost", "caphost"]) || zoom_title.is_some() {
        let in_call = any_proc(s, &["cpthost", "caphost"]) || mic_by(s, &["zoom"]) || zoom_title.is_some();
        found.push(Detected { app: "zoom", title: zoom_title.unwrap_or_default(), in_call });
    }
    // Teams: "Meeting with … | Microsoft Teams", or the microphone in use by Teams.
    if any_proc(s, &["ms-teams", "teams", "msteams"]) {
        let title = title_where(s, |t| t.contains("microsoft teams") && (t.contains("meeting") || t.contains("call") || t.contains("|"))).unwrap_or_default();
        let in_call = mic_by(s, &["teams"]) || title.to_lowercase().contains("meeting") || title.to_lowercase().starts_with("call");
        found.push(Detected { app: "teams", title, in_call });
    }
    // Google Meet in a browser tab: "Meet - abc-defg-hij" or "Meet – Weekly sync".
    if let Some(title) = title_where(s, |t| t.starts_with("meet - ") || t.starts_with("meet – ") || t.contains("google meet")) {
        // A Meet tab can sit open between calls; a browser using the microphone means it is in one.
        found.push(Detected { app: "meet", title, in_call: mic_by(s, &BROWSERS) });
    }
    // Webex: its meeting manager runs during a meeting.
    if any_proc(s, &["webex", "ciscowebex", "ciscowebexstart", "webexmta", "atmgr", "webexhost"]) {
        let in_call = any_proc(s, &["atmgr", "webexmta", "webexhost"]) || mic_by(s, &["webex", "atmgr"]);
        found.push(Detected { app: "webex", title: title_where(s, |t| t.contains("webex")).unwrap_or_default(), in_call });
    }
    // Slack huddles: Slack using the microphone, or a huddle window.
    if any_proc(s, &["slack"]) {
        let title = title_where(s, |t| t.contains("huddle")).unwrap_or_default();
        let in_call = mic_by(s, &["slack"]) || !title.is_empty();
        if in_call {
            found.push(Detected { app: "slack", title, in_call });
        }
    }
    found.sort_by_key(|d| !d.in_call);
    found.into_iter().next()
}

/// `pactl list source-outputs`: the apps recording now (application.name and process.binary). Pure.
pub fn parse_pactl(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| {
            let l = l.trim();
            ["application.name = ", "application.process.binary = "].iter().find_map(|k| l.strip_prefix(k)).map(|v| v.trim_matches('"').to_lowercase())
        })
        .collect()
}

/// `reg query …\ConsentStore\microphone /s`: apps whose LastUsedTimeStop is 0 are using the microphone now. Pure.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse_reg_microphone(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut key = String::new();
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("HKEY_") {
            key = t.rsplit('\\').next().unwrap_or("").replace('#', "\\").to_lowercase();
        } else if let Some(rest) = t.strip_prefix("LastUsedTimeStop") {
            let value = rest.split_whitespace().last().unwrap_or("");
            if (value == "0x0" || value == "0") && !key.is_empty() {
                out.push(key.clone());
            }
        }
    }
    out
}

/// `tasklist /v /fo csv /nh`: the window title is the last field. Pure.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse_tasklist_titles(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| {
            let fields: Vec<&str> = l.split("\",\"").collect();
            let title = fields.last()?.trim().trim_matches('"').trim();
            (!title.is_empty() && title != "N/A").then(|| title.to_string())
        })
        .collect()
}

/// `wmctrl -l`: "0x01e00003  0 host Title words". Pure.
pub fn parse_wmctrl(text: &str) -> Vec<String> {
    text.lines().map(|l| l.split_whitespace().skip(3).collect::<Vec<_>>().join(" ")).filter(|t| !t.is_empty()).collect()
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let mut c = Command::new(cmd);
    c.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashes every 15 seconds
    }
    let out = c.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

/// Look at the system now. Commands that are missing simply contribute nothing.
pub fn snapshot(sys: &mut System) -> Snapshot {
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let processes = sys.processes().values().map(|p| p.name().to_string_lossy().to_lowercase().trim_end_matches(".exe").to_string()).collect();
    // macOS adds nothing past the process list (see the module notes).
    #[cfg_attr(not(any(target_os = "linux", windows)), allow(unused_mut))]
    let mut s = Snapshot { processes, ..Default::default() };
    #[cfg(target_os = "linux")]
    {
        s.mic_users = run("pactl", &["list", "source-outputs"]).map(|t| parse_pactl(&t)).unwrap_or_default();
        s.titles = run("wmctrl", &["-l"]).map(|t| parse_wmctrl(&t)).unwrap_or_default();
    }
    #[cfg(windows)]
    {
        s.mic_users = run("reg", &["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone", "/s"])
            .map(|t| parse_reg_microphone(&t))
            .unwrap_or_default();
        s.titles = run("tasklist", &["/v", "/fo", "csv", "/nh"]).map(|t| parse_tasklist_titles(&t)).unwrap_or_default();
    }
    s
}

/// A process list reader that refreshes only what detection needs.
pub fn system() -> System {
    System::new_with_specifics(RefreshKind::nothing())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(procs: &[&str], titles: &[&str], mic: &[&str]) -> Snapshot {
        Snapshot {
            processes: procs.iter().map(|s| s.to_string()).collect(),
            titles: titles.iter().map(|s| s.to_string()).collect(),
            mic_users: mic.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn calls_and_open_apps() {
        assert_eq!(classify(&snap(&["zoom"], &[], &[])), Some(Detected { app: "zoom", title: String::new(), in_call: false }));
        assert!(classify(&snap(&["zoom", "cpthost"], &[], &[])).unwrap().in_call);
        assert!(classify(&snap(&["zoom"], &["Zoom Meeting"], &[])).unwrap().in_call);
        assert!(classify(&snap(&["zoom"], &[], &["zoom"])).unwrap().in_call);
        let teams = classify(&snap(&["ms-teams"], &["Q3 review with Ledgerline | Microsoft Teams"], &["ms-teams"])).unwrap();
        assert_eq!((teams.app, teams.in_call), ("teams", true));
        let meet = classify(&snap(&["chrome"], &["Meet - Weekly pipeline - Google Chrome"], &["google chrome"])).unwrap();
        assert_eq!((meet.app, meet.in_call), ("meet", true));
        assert!(!classify(&snap(&["chrome"], &["Meet - abc-defg-hij - Google Chrome"], &[])).unwrap().in_call);
        assert_eq!(classify(&snap(&["slack"], &[], &[])), None);
        assert_eq!(classify(&snap(&["slack"], &[], &["slack"])).unwrap().app, "slack");
        assert!(classify(&snap(&["webex", "atmgr"], &[], &[])).unwrap().in_call);
        assert_eq!(classify(&snap(&["firefox", "code"], &["Inbox"], &["firefox"])), None);
        // An app in a call wins over one merely open.
        assert_eq!(classify(&snap(&["zoom", "ms-teams"], &[], &["ms-teams"])).unwrap().app, "teams");
    }

    #[test]
    fn parsers() {
        let pactl = "Source Output #42\n\tDriver: protocol-native.c\n\tProperties:\n\t\tapplication.name = \"ZOOM VoiceEngine\"\n\t\tapplication.process.binary = \"zoom\"\n";
        assert_eq!(parse_pactl(pactl), vec!["zoom voiceengine", "zoom"]);
        let reg = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Users#a#AppData#Roaming#Zoom#bin#Zoom.exe\n    LastUsedTimeStart    REG_QWORD    0x1db0\n    LastUsedTimeStop    REG_QWORD    0x0\n\nHKEY_CURRENT_USER\\...\\NonPackaged\\C:#Program Files#Slack#slack.exe\n    LastUsedTimeStop    REG_QWORD    0x1db1\n";
        assert_eq!(parse_reg_microphone(reg), vec!["c:\\users\\a\\appdata\\roaming\\zoom\\bin\\zoom.exe"]);
        let tasklist = "\"Zoom.exe\",\"1234\",\"Console\",\"1\",\"120,000 K\",\"Running\",\"PC\\a\",\"0:00:10\",\"Zoom Meeting\"\n\"svchost.exe\",\"4\",\"Services\",\"0\",\"1,000 K\",\"Unknown\",\"N/A\",\"0:00:00\",\"N/A\"";
        assert_eq!(parse_tasklist_titles(tasklist), vec!["Zoom Meeting"]);
        assert_eq!(parse_wmctrl("0x01e00003  0 laptop Meet - Weekly sync - Google Chrome\n0x02 -1 laptop \n"), vec!["Meet - Weekly sync - Google Chrome"]);
    }
}
