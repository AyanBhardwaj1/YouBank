//! The tray (menu bar on a Mac): the app keeps running there with the window closed, so alerts and
//! scheduled tasks carry on. Quick actions sit in its menu.

use crate::state::AppState;
use crate::{alerts, files, tasks, updater, windows};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let hotkey = app.state::<AppState>().settings().hotkey;
    let item = |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);
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
