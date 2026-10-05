//! The three windows: `main` (the YouBank site, or the app's own start-up, sign-in and offline
//! screens), `quickask` (the small floating ask window) and `agent` (the desktop agent's settings).
//!
//! The main window only ever shows the configured site, the sign-in pages it hands off to, or the
//! app's own pages. Every other link opens in the person's browser. The site gets exactly the three
//! commands in capabilities/remote.json; nothing on the computer is reachable from it.

use crate::state::AppState;
use crate::{alerts, settings};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::ipc::CapabilityBuilder;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use url::Url;

pub const MAIN: &str = "main";
pub const QUICK: &str = "quickask";
pub const AGENT: &str = "agent";

/// The commands the website may call: keep in step with capabilities/remote.json.
const REMOTE_COMMANDS: [&str; 3] = ["allow-desktop-info", "allow-open-quick-ask", "allow-open-agent"];

/// Sign-in pages the site hands off to (Google, via Neon Auth). They load in the window so the session
/// cookie lands in it; they get no app commands.
const AUTH_HOSTS: [&str; 4] = ["accounts.google.com", "accounts.youtube.com", "neon.tech", "neonauth.com"];

#[derive(Debug, PartialEq, Eq)]
pub enum Nav {
    /// Load it in the main window.
    Allow,
    /// Open it in the person's browser instead.
    External,
    /// Neither (a script or file link, say).
    Block,
}

/// Where a navigation in the main window may go. Pure.
pub fn classify(url: &Url, site: &Url) -> Nav {
    match url.scheme() {
        "tauri" | "about" => return Nav::Allow,
        // The site's own downloads (CSV exports built in the page). Such pages have no origin the
        // capabilities match, so they get no app commands.
        "blob" | "data" => return Nav::Allow,
        "http" | "https" => {}
        "mailto" | "tel" => return Nav::External,
        _ => return Nav::Block,
    }
    if url.host_str() == Some("tauri.localhost") || url.origin() == site.origin() {
        return Nav::Allow;
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if url.scheme() == "https" && AUTH_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}"))) {
        return Nav::Allow;
    }
    Nav::External
}

/// A page bundled with the app, as the main window addresses it.
pub fn local_url(page: &str) -> Url {
    #[cfg(windows)]
    let base = "http://tauri.localhost/";
    #[cfg(not(windows))]
    let base = "tauri://localhost/";
    Url::parse(base).and_then(|b| b.join(page)).expect("local url")
}

/// A custom site address (staging, local development) gets the same three commands as production.
pub fn allow_custom_site(app: &AppHandle) {
    let site = app.state::<AppState>().site.clone();
    if site.as_str() == Url::parse(settings::DEFAULT_SITE).expect("site").as_str() {
        return;
    }
    let mut cap = CapabilityBuilder::new("remote-site-custom").remote(format!("{}*", site.as_str())).window(MAIN).local(false);
    for p in REMOTE_COMMANDS {
        cap = cap.permission(p);
    }
    if let Err(e) = app.add_capability(cap) {
        log::warn!("could not allow the custom site: {e}");
    }
}

pub fn create_main(app: &AppHandle, visible: bool) -> tauri::Result<WebviewWindow> {
    let nav_app = app.clone();
    let win_app = app.clone();
    let dl_app = app.clone();
    let w = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("YouBank")
        .inner_size(1360.0, 860.0)
        .min_inner_size(900.0, 600.0)
        .visible(visible)
        .on_navigation(move |url| {
            let site = nav_app.state::<AppState>().site.clone();
            match classify(url, &site) {
                Nav::Allow => true,
                Nav::External => {
                    let _ = nav_app.opener().open_url(url.as_str(), None::<&str>);
                    false
                }
                Nav::Block => false,
            }
        })
        .on_new_window(move |url, _features| {
            // Links that open a new tab: our own pages stay in the window, everything else goes to the browser.
            let site = win_app.state::<AppState>().site.clone();
            if url.origin() == site.origin() {
                if let Some(w) = win_app.get_webview_window(MAIN) {
                    let _ = w.navigate(url);
                }
            } else if classify(&url, &site) != Nav::Block {
                let _ = win_app.opener().open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| match event {
            DownloadEvent::Requested { url, destination } => {
                if let Some(path) = download_path(&dl_app, &url, destination) {
                    *destination = path;
                }
                true
            }
            DownloadEvent::Finished { path, success, .. } => {
                let name = path.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "The file".into());
                if success {
                    alerts::show(&dl_app, "Downloaded", &format!("{name} is in your Downloads folder."));
                } else {
                    alerts::show(&dl_app, "Download failed", &format!("{name} could not be saved. Try again."));
                }
                true
            }
            _ => true,
        })
        .on_page_load(|w, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let app = w.app_handle();
                let state = app.state::<AppState>();
                if payload.url().origin() == state.site.origin() {
                    *state.resume.lock().unwrap() = Some(payload.url().to_string());
                }
            }
        })
        .build()?;
    let close_app = app.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            if close_app.state::<AppState>().settings().close_to_tray {
                api.prevent_close();
                if let Some(w) = close_app.get_webview_window(MAIN) {
                    let _ = w.hide();
                }
            }
        }
    });
    Ok(w)
}

/// Downloads land in the Downloads folder under the name the site gave, never overwriting a file.
fn download_path(app: &AppHandle, url: &Url, suggested: &std::path::Path) -> Option<PathBuf> {
    let dir = app.path().download_dir().ok()?;
    let name = suggested
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .or_else(|| url.path_segments().and_then(|mut s| s.next_back()).map(str::to_string))
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "YouBank download".into());
    Some(crate::office::unique_path(&dir, &crate::office::safe_file_name(&name)))
}

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN).or_else(|| create_main(app, true).ok())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Open a page of the site in the main window (a path such as "/app/edge"). While the site is not
/// answering, the offline screen shows instead and opens the page once it is back.
pub fn open_site(app: &AppHandle, path: &str) {
    let state = app.state::<AppState>();
    let url = state.site.join(path.trim_start_matches('/')).unwrap_or_else(|_| state.site.clone());
    show_main(app);
    if !state.is_online() {
        *state.resume.lock().unwrap() = Some(url.to_string());
        return show_offline(app);
    }
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.navigate(url);
    }
}

/// The site stopped answering: keep the page to come back to and show the offline screen, which retries.
pub fn show_offline(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.online.store(false, Ordering::Relaxed);
    if let Some(w) = app.get_webview_window(MAIN) {
        let on_site = w.url().map(|u| u.origin() == state.site.origin()).unwrap_or(false);
        if on_site {
            *state.resume.lock().unwrap() = w.url().ok().map(|u| u.to_string());
        }
        let _ = w.navigate(local_url("index.html#offline"));
    }
}

/// The site answers again: go back to where the person was.
pub fn back_online(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.online.store(true, Ordering::Relaxed);
    let target = state.resume.lock().unwrap().clone().unwrap_or_else(|| state.site.join("app").map(|u| u.to_string()).unwrap_or_default());
    if let (Some(w), Ok(url)) = (app.get_webview_window(MAIN), Url::parse(&target)) {
        let showing_offline = w.url().map(|u| u.fragment() == Some("offline")).unwrap_or(false);
        if showing_offline {
            let _ = w.navigate(url);
        }
    }
}

/// Show or hide quick ask; `question` fills the box (from a youbank://ask link).
pub fn toggle_quick_ask(app: &AppHandle, question: Option<String>) {
    let w = match app.get_webview_window(QUICK) {
        Some(w) => w,
        None => match WebviewWindowBuilder::new(app, QUICK, WebviewUrl::App("quickask.html".into()))
            .title("Ask YouBank")
            .inner_size(680.0, 460.0)
            .min_inner_size(480.0, 300.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .visible(false)
            .build()
        {
            Ok(w) => w,
            Err(e) => return log::warn!("quick ask window: {e}"),
        },
    };
    let visible = w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false);
    if visible && question.is_none() {
        let _ = w.hide();
        return;
    }
    // Kept for a window still loading (it reads it on start), and sent to one already open.
    *app.state::<AppState>().ask_draft.lock().unwrap() = question.clone();
    let _ = w.center();
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit("quickask://open", question.unwrap_or_default());
}

/// The desktop agent's settings, on a section ("account", "files", "office", "alerts", "tasks", "app").
pub fn open_agent(app: &AppHandle, section: Option<String>) {
    let w = match app.get_webview_window(AGENT) {
        Some(w) => w,
        None => match WebviewWindowBuilder::new(app, AGENT, WebviewUrl::App("agent.html".into()))
            .title("YouBank desktop agent")
            .inner_size(920.0, 720.0)
            .min_inner_size(700.0, 520.0)
            .center()
            .build()
        {
            Ok(w) => w,
            Err(e) => return log::warn!("agent window: {e}"),
        },
    };
    *app.state::<AppState>().agent_section.lock().unwrap() = section.clone();
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
    if let Some(s) = section {
        let _ = w.emit("agent://section", s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation() {
        let site = Url::parse("https://youbank-nu.vercel.app/").unwrap();
        let u = |s: &str| Url::parse(s).unwrap();
        assert_eq!(classify(&u("https://youbank-nu.vercel.app/app/edge"), &site), Nav::Allow);
        assert_eq!(classify(&u("tauri://localhost/index.html"), &site), Nav::Allow);
        assert_eq!(classify(&u("http://tauri.localhost/index.html"), &site), Nav::Allow);
        assert_eq!(classify(&u("https://accounts.google.com/o/oauth2/auth"), &site), Nav::Allow);
        assert_eq!(classify(&u("https://ep-1.neonauth.us-east-2.aws.neon.tech/auth"), &site), Nav::Allow);
        assert_eq!(classify(&u("https://www.sec.gov/filing"), &site), Nav::External);
        assert_eq!(classify(&u("http://accounts.google.com/"), &site), Nav::External);
        assert_eq!(classify(&u("https://youbank-nu.vercel.app.evil.example/"), &site), Nav::External);
        assert_eq!(classify(&u("https://evilneon.tech/"), &site), Nav::External);
        assert_eq!(classify(&u("file:///etc/passwd"), &site), Nav::Block);
        assert_eq!(classify(&u("javascript:alert(1)"), &site), Nav::Block);
        assert_eq!(classify(&u("data:text/csv,a,b"), &site), Nav::Allow);
        assert_eq!(classify(&u("mailto:a@b.co"), &site), Nav::External);
    }
}
