//! YouBank for desktop: the YouBank site in its own window, with native extras (tray, notifications,
//! youbank:// links, quick ask on a global hotkey, updates) and a local agent that works with the
//! person's files, Excel and PowerPoint, and runs scheduled briefs and checks, each only once switched on.
//!
//! See ../README.md for the architecture and the permission model.

mod alerts;
mod api;
mod ask;
mod commands;
mod deeplink;
mod files;
mod office;
mod pairing;
mod settings;
mod state;
mod tasks;
mod tray;
mod updater;
mod windows;

use state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Register the quick ask hotkey (replacing the old one). Empty turns it off.
pub(crate) fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if hotkey.trim().is_empty() {
        return Ok(());
    }
    gs.register(hotkey.trim()).map_err(|e| format!("That shortcut could not be used ({e}). Another app may have it; try a different one."))
}

/// Watch whether the site answers, once a minute: when it stops, the main window shows the offline
/// screen (which keeps retrying); when it is back, the window returns to where the person was.
fn watch_connection(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut misses = 0;
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let state = app.state::<AppState>();
            let on_site = app.get_webview_window(windows::MAIN).and_then(|w| w.url().ok()).is_some_and(|u| u.origin() == state.site.origin());
            if state.api().reachable().await {
                misses = 0;
                if !state.is_online() {
                    windows::back_online(&app);
                }
            } else {
                misses += 1;
                // Two misses in a row, so one slow answer does not take the page away.
                if misses >= 2 && on_site {
                    windows::show_offline(&app);
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hidden = std::env::args().any(|a| a == "--hidden");
    tauri::Builder::default()
        // First, so a second launch (or a youbank:// link opening one) hands over to this instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A youbank:// link has already been handed to its handler, which picks the window.
            if !argv.iter().any(|a| a.starts_with("youbank://")) {
                windows::show_main(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&[windows::QUICK]).build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        windows::toggle_quick_ask(app, None);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let handle = app.handle().clone();
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            app.manage(AppState::new(config_dir, data_dir));
            windows::allow_custom_site(&handle);
            windows::create_main(&handle, !hidden)?;
            tray::create(&handle)?;

            let hotkey = handle.state::<AppState>().settings().hotkey;
            if let Err(e) = register_hotkey(&handle, &hotkey) {
                log::warn!("quick ask hotkey: {e}");
            }

            // youbank:// links: from the system while running, and the one that started the app.
            #[cfg(any(windows, target_os = "linux"))]
            if let Err(e) = app.deep_link().register_all() {
                log::warn!("could not register youbank:// links: {e}");
            }
            let links = handle.clone();
            app.deep_link().on_open_url(move |e| {
                for u in e.urls() {
                    commands::handle_link(&links, u.as_str());
                }
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for u in urls {
                    commands::handle_link(&handle, u.as_str());
                }
            }

            watch_connection(handle.clone());
            alerts::start(handle.clone());
            tasks::start(handle.clone());
            files::start(handle.clone());
            updater::start(handle.clone());
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                let _ = state::refresh_account(&h).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::desktop_info,
            commands::open_quick_ask,
            commands::open_agent,
            commands::get_state,
            commands::save_settings,
            commands::accept_consent,
            commands::site_status,
            commands::open_site,
            commands::open_external,
            commands::hide_quick_ask,
            commands::pair_start,
            commands::pair_cancel,
            commands::sign_out,
            commands::refresh_account,
            commands::ask,
            commands::ask_cancel,
            commands::pick_path,
            commands::add_folder,
            commands::remove_folder,
            commands::set_folder_auto,
            commands::scan_files,
            commands::upload_files,
            commands::remove_indexed_file,
            commands::files_status,
            commands::studio_docs,
            commands::studio_pull,
            commands::studio_push,
            commands::studio_link,
            commands::studio_unlink,
            commands::studio_agent,
            commands::office_status,
            commands::open_local,
            commands::run_task,
            commands::check_alerts,
            commands::check_update,
            commands::install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building YouBank")
        .run(|app, event| {
            // Closing every window keeps the app in the tray; only Quit ends it.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() && app.state::<AppState>().settings().close_to_tray {
                    api.prevent_exit();
                }
            }
        });
}
