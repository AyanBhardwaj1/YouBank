//! Generates the permission set for the app's own commands (`allow-<command>`), so each capability
//! file lists exactly which commands a window or origin may call. A command missing from this list
//! cannot be called from any page at all.

const COMMANDS: &[&str] = &[
    // The only three the website may call (capabilities/remote.json).
    "desktop_info",
    "open_quick_ask",
    "open_agent",
    // The app's own screens (capabilities/local.json).
    "get_state",
    "save_settings",
    "accept_consent",
    "site_status",
    "open_site",
    "open_external",
    "hide_quick_ask",
    "pair_start",
    "pair_cancel",
    "sign_out",
    "refresh_account",
    "ask",
    "ask_cancel",
    "pick_path",
    "add_folder",
    "remove_folder",
    "set_folder_auto",
    "scan_files",
    "upload_files",
    "remove_indexed_file",
    "files_status",
    "studio_docs",
    "studio_pull",
    "studio_push",
    "studio_link",
    "studio_unlink",
    "studio_agent",
    "office_status",
    "open_local",
    "run_task",
    "check_alerts",
    "check_update",
    "install_update",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS))).expect("failed to run tauri-build");
}
