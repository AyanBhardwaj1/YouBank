//! The tray (menu bar on a Mac): the app keeps running there with the window closed, so alerts and
//! scheduled tasks carry on. Quick actions sit in its menu. While the meeting copilot records, the icon
//! carries a red dot and the menu offers Stop.

use crate::state::AppState;
use crate::{alerts, files, meetings, tasks, updater, windows};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

/// The menu item that starts or stops the meeting copilot; its text follows the recording.
static MEETING_ITEM: Mutex<Option<MenuItem<Wry>>> = Mutex::new(None);

const START_MEETING: &str = "Start meeting copilot…";
const STOP_MEETING: &str = "Stop meeting copilot";

/// Paint a red recording dot in the lower right of an RGBA icon. Pure.
pub fn with_dot(rgba: &mut [u8], w: u32, h: u32) {
    let r = (w.min(h) as f32) * 0.22;
    let (cx, cy) = (w as f32 - r - 1.0, h as f32 - r - 1.0);
    for y in 0..h {
        for x in 0..w {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let i = ((y * w + x) * 4) as usize;
            if i + 3 >= rgba.len() {
                continue;
            }
            if d <= r {
                rgba[i..i + 4].copy_from_slice(&[226, 52, 64, 255]);
            } else if d <= r + 1.2 {
                // A light ring, so the dot shows on dark and light menu bars alike.
                rgba[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
            }
        }
    }
}

/// Show (or clear) the recording state in the tray: the dot, the tooltip and the menu item.
pub fn set_recording(app: &AppHandle, on: bool) {
    if let Some(item) = MEETING_ITEM.lock().unwrap().as_ref() {
        let _ = item.set_text(if on { STOP_MEETING } else { START_MEETING });
    }
    let Some(tray) = app.tray_by_id("main") else { return };
    let _ = tray.set_tooltip(Some(if on { "YouBank · recording a meeting" } else { "YouBank" }));
    if let Some(icon) = app.default_window_icon() {
        let image = if on {
            let mut rgba = icon.rgba().to_vec();
            with_dot(&mut rgba, icon.width(), icon.height());
            Image::new_owned(rgba, icon.width(), icon.height())
        } else {
            icon.clone().to_owned()
        };
        let _ = tray.set_icon(Some(image));
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let hotkey = app.state::<AppState>().settings().hotkey;
    let item = |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);
    let meeting = item("meeting", START_MEETING, None)?;
    *MEETING_ITEM.lock().unwrap() = Some(meeting.clone());
    let menu = Menu::with_items(
        app,
        &[
            &item("open", "Open YouBank", None)?,
            &item("ask", "Quick ask…", (!hotkey.is_empty()).then_some(hotkey.as_str()))?,
            &item("latest", "Open latest alert", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("check-alerts", "Check for alerts now", None)?,
            &item("brief", "Morning brief now", None)?,
            &item("files", "Add new and changed files", None)?,
            &PredefinedMenuItem::separator(app)?,
            &meeting,
            &PredefinedMenuItem::separator(app)?,
            &item("agent", "Desktop agent settings…", None)?,
            &item("update", "Check for updates…", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", "Quit YouBank", None)?,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("YouBank")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| on_menu(app, e.id().as_ref()))
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                windows::show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    let a = app.clone();
    match id {
        "open" => windows::show_main(app),
        "ask" => windows::toggle_quick_ask(app, None),
        "latest" => {
            let url = app.state::<AppState>().last_alert.lock().unwrap().clone();
            windows::open_site(app, url.as_deref().unwrap_or("/app/news"));
        }
        "check-alerts" => {
            tauri::async_runtime::spawn(async move {
                match alerts::check(&a).await {
                    Ok(0) => alerts::show(&a, "Nothing new", "No new alerts since the last check."),
                    Ok(_) => {}
                    Err(e) => alerts::show(&a, "Could not check for alerts", &e.to_string()),
                }
            });
        }
        "brief" => {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = tasks::run(&a, "morning-brief", true).await {
                    alerts::show(&a, "Morning brief", &e.to_string());
                }
            });
        }
        "files" => {
            tauri::async_runtime::spawn(async move {
                let msg = match files::scan(&a, None).await {
                    Ok(r) if r.pending == 0 => "Every file in your folders is already in YouBank.".to_string(),
                    Ok(_) => match files::upload(&a, None).await {
                        Ok(rep) => rep.stopped.unwrap_or_else(|| format!("{} added.", files::plural(rep.uploaded, "file"))),
                        Err(e) => e,
                    },
                    Err(e) => e,
                };
                alerts::show(&a, "Local files", &msg);
            });
        }
        "meeting" => {
            let state = app.state::<AppState>();
            if state.meetings.session.lock().unwrap().is_some() {
                tauri::async_runtime::spawn(async move {
                    let _ = meetings::stop(&a, false).await;
                    alerts::show(&a, "Meeting copilot stopped", "The rest of the audio is being sent; you'll be told when the notes are ready.");
                });
            } else if !state.settings().meetings.enabled {
                windows::open_agent(app, Some("meetings".into()));
            } else {
                meetings::ask_consent(app, None);
            }
        }
        "agent" => windows::open_agent(app, None),
        "update" => {
            tauri::async_runtime::spawn(async move {
                let ready = a.state::<AppState>().update_ready.lock().unwrap().clone();
                if ready.is_some() {
                    if let Err(e) = updater::install(&a).await {
                        alerts::show(&a, "Update", &e);
                    }
                    return;
                }
                match updater::check(&a, true).await {
                    Ok(None) => alerts::show(&a, "You are up to date", &format!("YouBank {} is the latest version.", crate::api::VERSION)),
                    Ok(Some(_)) => {}
                    Err(e) => alerts::show(&a, "Update", &e),
                }
            });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dot_in_the_corner() {
        let (w, h) = (32u32, 32u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        with_dot(&mut rgba, w, h);
        let px = |x: u32, y: u32| &rgba[((y * w + x) * 4) as usize..((y * w + x) * 4 + 4) as usize];
        assert_eq!(px(25, 25), &[226, 52, 64, 255]);
        assert_eq!(px(2, 2), &[0, 0, 0, 0]);
    }
}
