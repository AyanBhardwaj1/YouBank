//! Folders the person picks, read into Edge documents so research, Edge and Studio can cite them.
//!
//! - Only folders the person added, and only PDF, Word, Excel and PowerPoint files in them.
//! - Each file is fingerprinted (SHA-256) here; the server is asked which fingerprints it lacks, and only
//!   new or changed files are uploaded, in Edge's own 4 MB parts.
//! - The server never learns where a file lives: it gets a hash of the path and the file's name.
//! - The folders are watched; a new or changed file is uploaded at once if the person chose that for
//!   the folder, and otherwise they are told and it waits for them.
//! - Past the free allowance (DESKTOP_FREE_FILES on the server), indexing more files needs a plan; the
//!   server checks before any upload starts.

use crate::alerts;
use crate::api::{send, ApiError};
use crate::settings::{read_json, write_json};
use crate::state::{self, AppState};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

pub const EXTENSIONS: [&str; 5] = ["pdf", "docx", "xlsx", "xlsm", "pptx"];
const MAX_BYTES: u64 = 200 * 1024 * 1024;
const MAX_FILES_PER_FOLDER: usize = 5_000;
const MAX_DEPTH: usize = 8;

static UPLOADING: AtomicBool = AtomicBool::new(false);
static EVENTS: OnceLock<tokio::sync::mpsc::UnboundedSender<PathBuf>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    #[default]
    Pending,
    Indexed,
    Failed,
    /// Past the free allowance on a plan without `desktop.folders`.
    NeedsPlan,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub folder: String,
    pub name: String,
    pub bytes: u64,
    pub modified: u64,
    pub sha256: String,
    pub path_key: String,
    pub status: Status,
    pub doc_id: Option<i64>,
    pub error: String,
    pub uploaded_at: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
pub struct FileIndex {
    #[serde(skip)]
    file: PathBuf,
    pub entries: BTreeMap<String, Entry>,
}

impl FileIndex {
    pub fn load(data_dir: &Path) -> Self {
        let file = data_dir.join("files.json");
        let mut ix: FileIndex = read_json(&file);
        ix.file = file;
        ix
    }

    pub fn save(&self) {
        if let Err(e) = write_json(&self.file, self) {
            log::warn!("could not save the file index: {e}");
        }
    }
}

/// Whether a file is one the app reads. Office's own lock files ("~$Model.xlsx") are skipped. Pure.
pub fn indexable(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if name.starts_with("~$") || name.starts_with("._") || name.starts_with('.') {
        return false;
    }
    path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).is_some_and(|e| EXTENSIONS.contains(&e.as_str()))
}

fn mime(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).as_deref() {
        Some("pdf") => "application/pdf",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("xlsm") => "application/vnd.ms-excel.sheet.macroEnabled.12",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The server's handle on a local file: a hash of where it lives, never the path itself. Pure.
pub fn path_key(path: &Path) -> String {
    sha256_hex(path.to_string_lossy().as_bytes())
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Folders too broad to index whole (a drive, the home folder, a system folder). Pure.
pub fn too_broad(path: &Path, home: Option<&Path>) -> bool {
    let depth = path.components().count();
    if depth <= 1 || path.parent().is_none() {
        return true;
    }
    if home.is_some_and(|h| h == path) {
        return true;
    }
    let s = path.to_string_lossy().to_ascii_lowercase().replace('\\', "/");
    ["/system", "/library", "/usr", "/etc", "/var", "/bin", "/proc", "/applications", "c:/windows", "c:/program files"]
        .iter()
        .any(|p| s == *p || s.starts_with(&format!("{p}/")))
}

fn status_changed(app: &AppHandle) {
    let _ = app.emit("files://changed", ());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub found: usize,
    pub pending: usize,
}

#[derive(Deserialize)]
struct CheckAnswer {
    states: BTreeMap<String, String>,
}

/// Walk the folders (all, or one), fingerprint what changed, and ask the server which files it lacks.
pub async fn scan(app: &AppHandle, only: Option<String>) -> Result<ScanReport, String> {
    let state = app.state::<AppState>();
    let settings = state.settings();
    if !settings.files.enabled {
        return Err("Local files are switched off. Turn them on in the desktop agent first.".into());
    }
    if !state.connected() {
        return Err(ApiError::SignedOut.into());
    }
    let folders: Vec<String> = settings.files.folders.iter().map(|f| f.path.clone()).filter(|p| only.as_ref().is_none_or(|o| o == p)).collect();
    let known: BTreeMap<String, Entry> = state.files.lock().await.entries.clone();
    let found = tauri::async_runtime::spawn_blocking(move || walk(&folders, &known)).await.map_err(|e| e.to_string())?;

    let mut checks = Vec::new();
    {
        let mut ix = state.files.lock().await;
        let scanned: BTreeSet<String> = found.iter().map(|e| e.path.clone()).collect();
        // Files that are gone locally leave the list (their documents stay; remove them on purpose to delete).
        let folders_scanned: BTreeSet<String> = found.iter().map(|e| e.folder.clone()).chain(only.clone()).collect();
        ix.entries.retain(|p, e| scanned.contains(p) || !(only.is_none() || folders_scanned.contains(&e.folder)));
        for e in found {
            let keep = ix.entries.get(&e.path).filter(|old| old.sha256 == e.sha256).cloned();
            let next = keep.unwrap_or(e);
            checks.push(serde_json::json!({ "pathKey": next.path_key, "sha256": next.sha256 }));
            ix.entries.insert(next.path.clone(), next);
        }
        ix.save();
    }

    let api = state.api();
    let mut states = BTreeMap::new();
    for chunk in checks.chunks(500) {
        let a: CheckAnswer = api.post("/api/desktop/files", &serde_json::json!({ "check": chunk })).await.inspect_err(|e| state::on_error(app, e))?;
        states.extend(a.states);
    }
    let mut ix = state.files.lock().await;
    let mut pending = 0;
    let total = ix.entries.len();
    for e in ix.entries.values_mut() {
        match states.get(&e.path_key).map(String::as_str) {
            Some("unchanged") => {
                if e.status != Status::Indexed {
                    e.status = Status::Indexed;
                    e.error.clear();
                }
            }
            Some(_) => {
                if e.status == Status::Indexed {
                    e.status = Status::Pending;
                }
                if e.status != Status::NeedsPlan {
                    pending += 1;
                }
            }
            None => {}
        }
    }
    ix.save();
    drop(ix);
    status_changed(app);
    Ok(ScanReport { found: total, pending })
}

fn walk(folders: &[String], known: &BTreeMap<String, Entry>) -> Vec<Entry> {
    let mut out = Vec::new();
    for folder in folders {
        let mut n = 0;
        for item in walkdir::WalkDir::new(folder)
            .max_depth(MAX_DEPTH)
            .follow_links(false)
            .into_iter()
            .filter_entry(|d| d.depth() == 0 || !d.file_name().to_string_lossy().starts_with('.'))
            .flatten()
        {
            if !item.file_type().is_file() || !indexable(item.path()) {
                continue;
            }
            let Ok(meta) = item.metadata() else { continue };
            if meta.len() == 0 || meta.len() > MAX_BYTES {
                continue;
            }
            n += 1;
            if n > MAX_FILES_PER_FOLDER {
                log::warn!("{folder}: more than {MAX_FILES_PER_FOLDER} files; the rest are skipped");
                break;
            }
            let path = item.path().to_string_lossy().to_string();
            let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            // Unchanged size and time: the fingerprint is still good, no need to read the file again.
            let sha = match known.get(&path) {
                Some(k) if k.bytes == meta.len() && k.modified == modified && !k.sha256.is_empty() => k.sha256.clone(),
                _ => match hash_file(item.path()) {
                    Ok(h) => h,
                    Err(e) => {
                        log::info!("could not read {path}: {e}");
                        continue;
                    }
                },
            };
            let prev = known.get(&path);
            out.push(Entry {
                path_key: path_key(item.path()),
                name: item.file_name().to_string_lossy().to_string(),
                folder: folder.clone(),
                bytes: meta.len(),
                modified,
                status: prev.filter(|p| p.sha256 == sha).map(|p| p.status).unwrap_or(Status::Pending),
                doc_id: prev.and_then(|p| p.doc_id),
                uploaded_at: prev.and_then(|p| p.uploaded_at.clone()),
                error: String::new(),
                sha256: sha,
                path,
            });
        }
    }
    out
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Start {
    Skip {
        skip: bool,
        #[serde(rename = "docId")]
        doc_id: i64,
    },
    Upload {
        #[serde(rename = "fileId")]
        file_id: i64,
        parts: u64,
        #[serde(rename = "partBytes")]
        part_bytes: u64,
    },
}

#[derive(Deserialize)]
struct Done {
    #[serde(rename = "docId")]
    doc_id: i64,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UploadReport {
    pub uploaded: usize,
    pub skipped: usize,
    pub failed: usize,
    /// Why the run stopped early, if it did (a plan, Edge switched off, limits, the connection).
    pub stopped: Option<String>,
}

/// Send what is pending (all, or the given paths). One run at a time.
pub async fn upload(app: &AppHandle, only: Option<Vec<String>>) -> Result<UploadReport, String> {
    if UPLOADING.swap(true, Ordering::SeqCst) {
        return Err("Files are already being sent. They will be done shortly.".into());
    }
    let r = upload_inner(app, only).await;
    UPLOADING.store(false, Ordering::SeqCst);
    status_changed(app);
    r
}

async fn upload_inner(app: &AppHandle, only: Option<Vec<String>>) -> Result<UploadReport, String> {
    let state = app.state::<AppState>();
    if !state.settings().files.enabled {
        return Err("Local files are switched off.".into());
    }
    let todo: Vec<Entry> = {
        let ix = state.files.lock().await;
        ix.entries
            .values()
            .filter(|e| matches!(e.status, Status::Pending | Status::Failed | Status::NeedsPlan))
            .filter(|e| only.as_ref().is_none_or(|o| o.contains(&e.path)))
            .cloned()
            .collect()
    };
    let mut report = UploadReport::default();
    let total = todo.len();
    for (i, e) in todo.into_iter().enumerate() {
        let _ = app.emit("files://progress", serde_json::json!({ "done": i, "total": total, "name": e.name }));
        match upload_one(app, &e).await {
            Ok(Some(doc)) => {
                report.uploaded += 1;
                set(app, &e.path, |x| {
                    x.status = Status::Indexed;
                    x.doc_id = Some(doc);
                    x.error.clear();
                    x.uploaded_at = Some(chrono::Local::now().to_rfc3339());
                })
                .await;
            }
            Ok(None) => report.skipped += 1,
            Err(ApiError::Plan(m)) => {
                set(app, &e.path, |x| x.status = Status::NeedsPlan).await;
                report.stopped = Some(m);
                break;
            }
            Err(err @ (ApiError::SignedOut | ApiError::Offline | ApiError::Limited(..) | ApiError::Server(403 | 503 | 507, _))) => {
                state::on_error(app, &err);
                report.stopped = Some(err.to_string());
                break;
            }
            Err(err) => {
                report.failed += 1;
                let msg = err.to_string();
                set(app, &e.path, |x| {
                    x.status = Status::Failed;
                    x.error = msg;
                })
                .await;
            }
        }
    }
    let _ = app.emit("files://progress", serde_json::json!({ "done": total, "total": total, "name": "" }));
    if report.uploaded > 0 {
        let _ = state::refresh_account(app).await;
    }
    Ok(report)
}

async fn set(app: &AppHandle, path: &str, f: impl FnOnce(&mut Entry)) {
    let state = app.state::<AppState>();
    let mut ix = state.files.lock().await;
    if let Some(e) = ix.entries.get_mut(path) {
        f(e);
    }
    ix.save();
}

/// One file: start (the server may already have it), send the parts, finish. Some(doc id) when sent.
async fn upload_one(app: &AppHandle, e: &Entry) -> Result<Option<i64>, ApiError> {
    let state = app.state::<AppState>();
    let api = state.api();
    let path = PathBuf::from(&e.path);
    // The file may have changed since it was scanned: fingerprint it again if so.
    let meta = std::fs::metadata(&path).map_err(|_| ApiError::Server(404, format!("{} is no longer there.", e.name)))?;
    let sha = if meta.len() == e.bytes {
        e.sha256.clone()
    } else {
        hash_file(&path).map_err(|err| ApiError::Server(400, format!("{} could not be read: {err}", e.name)))?
    };
    let start: Start = api
        .post("/api/desktop/files", &serde_json::json!({ "pathKey": e.path_key, "sha256": sha, "name": e.name, "mime": mime(&path), "bytes": meta.len() }))
        .await?;
    let (file_id, parts, part_bytes) = match start {
        Start::Skip { skip: true, doc_id } => {
            set(app, &e.path, |x| {
                x.status = Status::Indexed;
                x.doc_id = Some(doc_id);
                x.sha256 = sha.clone();
            })
            .await;
            return Ok(None);
        }
        Start::Skip { .. } => return Err(ApiError::Server(502, "Unexpected answer from YouBank.".into())),
        Start::Upload { file_id, parts, part_bytes } => (file_id, parts, part_bytes),
    };
    for n in 0..parts {
        let p = path.clone();
        let chunk = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<Vec<u8>> {
            let mut f = std::fs::File::open(p)?;
            f.seek(SeekFrom::Start(n * part_bytes))?;
            let mut buf = Vec::with_capacity(part_bytes as usize);
            f.take(part_bytes).read_to_end(&mut buf)?;
            Ok(buf)
        })
        .await
        .map_err(|err| ApiError::Server(500, err.to_string()))?
        .map_err(|err| ApiError::Server(400, format!("{} could not be read: {err}", e.name)))?;
        send(api.authed(Method::PUT, &format!("/api/desktop/files/{file_id}/part?n={n}"))?.timeout(Duration::from_secs(180)).body(chunk)).await?;
    }
    let done: Done = api
        .post(
            &format!("/api/desktop/files/{file_id}/complete"),
            &serde_json::json!({ "pathKey": e.path_key, "sha256": sha, "name": e.name, "bytes": meta.len() }),
        )
        .await?;
    set(app, &e.path, |x| x.sha256 = sha.clone()).await;
    Ok(Some(done.doc_id))
}

/// Remove one file from YouBank: its document is deleted (unless a copy elsewhere uses it), and it leaves the list.
pub async fn remove(app: &AppHandle, path: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let key = state.files.lock().await.entries.get(path).map(|e| e.path_key.clone());
    if let Some(key) = key {
        let _: serde_json::Value = state.api().delete(&format!("/api/desktop/files?pathKey={key}")).await?;
        let mut ix = state.files.lock().await;
        ix.entries.remove(path);
        ix.save();
    }
    status_changed(app);
    Ok(())
}

/// Stop indexing a folder; with `remove_docs`, delete what it uploaded too.
pub async fn remove_folder(app: &AppHandle, folder: &str, remove_docs: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    if remove_docs {
        let paths: Vec<String> =
            state.files.lock().await.entries.values().filter(|e| e.folder == folder && e.doc_id.is_some()).map(|e| e.path.clone()).collect();
        for p in paths {
            remove(app, &p).await?;
        }
    }
    {
        let mut ix = state.files.lock().await;
        ix.entries.retain(|_, e| e.folder != folder);
        ix.save();
    }
    state.update_settings(|s| s.files.folders.retain(|f| f.path != folder))?;
    restart_watchers(app);
    status_changed(app);
    Ok(())
}

/* ---------------- Watching ---------------- */

/// Watch every indexed folder and the Office folder. Called at start and whenever they change.
pub fn restart_watchers(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut watchers = state.watchers.lock().unwrap();
    watchers.clear();
    let Some(tx) = EVENTS.get().cloned() else { return };
    let s = state.settings();
    let mut dirs: Vec<(PathBuf, bool)> = Vec::new();
    if s.files.enabled {
        dirs.extend(s.files.folders.iter().map(|f| (PathBuf::from(&f.path), true)));
    }
    if s.office.enabled {
        // Made now if missing, so the first pulled file is watched too.
        let office = crate::office::folder(app);
        let _ = std::fs::create_dir_all(&office);
        dirs.push((office, false));
    }
    for (dir, recursive) in dirs {
        if !dir.is_dir() {
            continue;
        }
        let tx = tx.clone();
        let w = ::notify::recommended_watcher(move |res: ::notify::Result<::notify::Event>| {
            if let Ok(ev) = res {
                if matches!(ev.kind, ::notify::EventKind::Create(_) | ::notify::EventKind::Modify(_) | ::notify::EventKind::Remove(_)) {
                    for p in ev.paths {
                        let _ = tx.send(p);
                    }
                }
            }
        });
        match w {
            Ok(mut w) => {
                use ::notify::Watcher;
                let mode = if recursive { ::notify::RecursiveMode::Recursive } else { ::notify::RecursiveMode::NonRecursive };
                if let Err(e) = w.watch(&dir, mode) {
                    log::warn!("cannot watch {}: {e}", dir.display());
                    continue;
                }
                watchers.push(w);
            }
            Err(e) => log::warn!("watcher: {e}"),
        }
    }
}

/// The watcher's events, gathered for a few quiet seconds (saving a file fires several), then acted on.
pub fn start(app: AppHandle) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<PathBuf>();
    let _ = EVENTS.set(tx);
    restart_watchers(&app);
    tauri::async_runtime::spawn(async move {
        loop {
            let Some(first) = rx.recv().await else { break };
            let mut batch = BTreeSet::from([first]);
            while let Ok(Some(p)) = tokio::time::timeout(Duration::from_secs(4), rx.recv()).await {
                batch.insert(p);
            }
            let (office, local): (Vec<PathBuf>, Vec<PathBuf>) = batch.into_iter().filter(|p| indexable(p)).partition(|p| crate::office::is_linked_dir(&app, p));
            if !office.is_empty() {
                crate::office::on_saved(&app, office).await;
            }
            if !local.is_empty() {
                on_changed(&app, local).await;
            }
        }
    });
}

async fn on_changed(app: &AppHandle, paths: Vec<PathBuf>) {
    let state = app.state::<AppState>();
    let settings = state.settings();
    for folder in settings.files.folders.iter().filter(|f| paths.iter().any(|p| p.starts_with(&f.path))) {
        let Ok(r) = scan(app, Some(folder.path.clone())).await else { continue };
        if r.pending == 0 {
            continue;
        }
        if folder.auto_upload {
            let only: Vec<String> =
                state.files.lock().await.entries.values().filter(|e| e.folder == folder.path && e.status == Status::Pending).map(|e| e.path.clone()).collect();
            if let Ok(rep) = upload(app, Some(only)).await {
                if let Some(why) = rep.stopped {
                    alerts::show(app, "Some files were not added", &why);
                }
            }
        } else {
            let name = Path::new(&folder.path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| folder.path.clone());
            alerts::show(app, &format!("{} new or changed in {name}", plural(r.pending, "file")), "Open the desktop agent to add them to YouBank.");
        }
    }
}

pub fn plural(n: usize, word: &str) -> String {
    format!("{n} {word}{}", if n == 1 { "" } else { "s" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_files() {
        assert!(indexable(Path::new("/x/CIM Project Atlas.pdf")));
        assert!(indexable(Path::new("/x/Model.XLSX")));
        assert!(!indexable(Path::new("/x/~$Model.xlsx")));
        assert!(!indexable(Path::new("/x/notes.txt")));
        assert!(!indexable(Path::new("/x/.hidden.pdf")));
    }

    #[test]
    fn broad_folders() {
        let home = Path::new("/home/ayan");
        assert!(too_broad(Path::new("/"), Some(home)));
        assert!(too_broad(home, Some(home)));
        assert!(too_broad(Path::new("/usr/share"), Some(home)));
        assert!(!too_broad(Path::new("/home/ayan/Deals"), Some(home)));
    }

    #[test]
    fn keys_hide_paths() {
        let k = path_key(Path::new("/home/ayan/Deals/CIM.pdf"));
        assert_eq!(k.len(), 64);
        assert!(!k.contains("Deals"));
    }
}
