//! Excel and PowerPoint files on this computer, linked to Studio documents.
//!
//! - Pull: Studio's own export (formulas and values, native slides) is saved into the YouBank folder
//!   (Documents/YouBank unless the person picked another) and opened in Excel or PowerPoint.
//! - Push: a linked workbook the person saved is sent back; the server reads it with Studio's importer
//!   and stores the difference as one undoable change, exactly like the Excel add-in's sync. If Studio
//!   moved on since the pull, the push stops and asks (pull a fresh copy, or overwrite).
//! - AI edit (premium): push, let the Studio agent work, pull the result back over the file.
//! - Link: a workbook that is not in Studio yet becomes a new Studio document.
//!
//! Every write over a local file keeps a backup in the folder's ".backups" first, so nothing the person
//! typed is ever lost. Decks only pull: a deck edited in PowerPoint cannot be read back into Studio yet.

use crate::alerts;
use crate::api::{send, ApiError};
use crate::files::sha256_hex;
use crate::settings::{read_json, write_json};
use crate::state::{self, AppState};
use reqwest::{header, Method};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Link {
    pub doc_id: i64,
    pub title: String,
    pub path: String,
    /// "xlsx" or "pptx".
    pub format: String,
    /// The Studio change the local file reflects; a push from an older one would undo newer changes.
    pub cursor: i64,
    /// The file's fingerprint when it last matched Studio (pulled or pushed): different means local edits.
    pub synced_sha: String,
    pub synced_at: String,
}

#[derive(Default, Serialize, Deserialize)]
pub struct OfficeLinks {
    #[serde(skip)]
    file: PathBuf,
    pub links: Vec<Link>,
}

impl OfficeLinks {
    pub fn load(data_dir: &Path) -> Self {
        let file = data_dir.join("office.json");
        let mut l: OfficeLinks = read_json(&file);
        l.file = file;
        l
    }

    fn save(&self) {
        if let Err(e) = write_json(&self.file, self) {
            log::warn!("could not save Office links: {e}");
        }
    }

    fn by_path(&self, path: &str) -> Option<Link> {
        self.links.iter().find(|l| l.path == path).cloned()
    }

    fn upsert(&mut self, link: Link) {
        self.links.retain(|l| l.path != link.path && !(l.doc_id == link.doc_id && l.format == link.format));
        self.links.push(link);
        self.save();
    }
}

/// Where pulled files go.
pub fn folder(app: &AppHandle) -> PathBuf {
    let s = app.state::<AppState>().settings().office.folder;
    if !s.trim().is_empty() {
        return PathBuf::from(s);
    }
    app.path().document_dir().unwrap_or_else(|_| std::env::temp_dir()).join("YouBank")
}

/// Whether a changed path is in the Office folder (so the Office sync handles it, not file indexing).
pub fn is_linked_dir(app: &AppHandle, p: &Path) -> bool {
    app.state::<AppState>().settings().office.enabled && p.parent() == Some(folder(app).as_path())
}

/// A file name for a header, percent-encoded as the server's decodeURIComponent expects (spaces as %20). Pure.
pub fn header_name(name: &str) -> String {
    url::form_urlencoded::byte_serialize(name.as_bytes()).collect::<String>().replace('+', "%20")
}

/// A file name without anything a file system would refuse. Pure.
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c }).collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        "YouBank".into()
    } else {
        cleaned.chars().take(150).collect()
    }
}

/// `dir/name`, or `dir/name (2).ext` and so on when that is taken.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.to_string(), String::new()),
    };
    (2..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

fn now() -> String {
    chrono::Local::now().to_rfc3339()
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{} could not be read: {e}", path.display()))
}

/// Keep a copy of the file in `.backups` before anything overwrites it.
fn backup(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let dir = path.parent().unwrap_or(Path::new(".")).join(".backups");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make a backup folder: {e}"))?;
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    let to = unique_path(&dir, &format!("{stem} {}{ext}", chrono::Local::now().format("%Y-%m-%d %H%M")));
    std::fs::copy(path, &to).map_err(|e| format!("Could not back up {}: {e}", path.display()))?;
    Ok(Some(to))
}

/// Write through a temporary file, so Excel never sees half a workbook.
fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("youbank-tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Could not save {}: {e}", path.display()))?;
    std::fs::rename(&tmp, path).map_err(|_| {
        let _ = std::fs::remove_file(&tmp);
        format!("{} is open in another program. Close it there, then try again.", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
    })
}

fn require_enabled(app: &AppHandle) -> Result<(), String> {
    if app.state::<AppState>().settings().office.enabled {
        Ok(())
    } else {
        Err("Excel and PowerPoint sync is switched off. Turn it on in the desktop agent first.".into())
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudioDoc {
    pub id: i64,
    pub title: String,
    pub kind: String,
    #[serde(default)]
    pub sheets: Option<i64>,
    #[serde(default)]
    pub slides: Option<i64>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Deserialize)]
struct Docs {
    docs: Vec<StudioDoc>,
}

pub async fn docs(app: &AppHandle) -> Result<Vec<StudioDoc>, String> {
    let state = app.state::<AppState>();
    let d: Docs = state.api().get("/api/desktop/studio").await.inspect_err(|e| state::on_error(app, e))?;
    Ok(d.docs)
}

/// Pull a Studio document into a local file and return its path. `open` opens it in Excel or PowerPoint.
pub async fn pull(app: &AppHandle, doc_id: i64, format: &str, open: bool) -> Result<String, String> {
    require_enabled(app)?;
    let format = if format == "pptx" { "pptx" } else { "xlsx" };
    let state = app.state::<AppState>();
    let api = state.api();
    let res = send(api.authed(Method::GET, &format!("/api/desktop/studio/{doc_id}?format={format}"))?.timeout(Duration::from_secs(120)))
        .await
        .inspect_err(|e| state::on_error(app, e))?;
    let cursor = res.headers().get("x-youbank-cursor").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
    let name = res
        .headers()
        .get("x-youbank-filename")
        .and_then(|v| v.to_str().ok())
        .map(|v| url::form_urlencoded::parse(format!("n={v}").as_bytes()).next().map(|(_, n)| n.into_owned()).unwrap_or_default())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| format!("YouBank {doc_id}.{format}"));
    let bytes = res.bytes().await.map_err(|_| ApiError::Offline)?;
    let dir = folder(app);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    let existing = state.office.lock().await.links.iter().find(|l| l.doc_id == doc_id && l.format == format).cloned();
    let path = match &existing {
        Some(l) if Path::new(&l.path).parent() == Some(dir.as_path()) || Path::new(&l.path).exists() => PathBuf::from(&l.path),
        _ => unique_path(&dir, &safe_file_name(&name)),
    };
    // Local edits that never reached Studio are kept: the file is backed up before it is replaced.
    if path.exists() {
        let local = sha256_hex(&read(&path)?);
        if existing.as_ref().is_none_or(|l| l.synced_sha != local) {
            backup(&path)?;
        }
    }
    write_file(&path, &bytes)?;
    let title = name.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or(name.clone());
    state.office.lock().await.upsert(Link {
        doc_id,
        title,
        path: path.to_string_lossy().to_string(),
        format: format.into(),
        cursor,
        synced_sha: sha256_hex(&bytes),
        synced_at: now(),
    });
    let _ = app.emit("office://changed", ());
    if open {
        let _ = app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>);
    }
    Ok(path.to_string_lossy().to_string())
}

#[derive(Deserialize)]
struct Pushed {
    changed: bool,
    label: String,
    cursor: i64,
}

/// Push a linked workbook's saved state to Studio. `force` overwrites newer Studio changes.
pub async fn push(app: &AppHandle, path: &str, force: bool) -> Result<String, ApiError> {
    require_enabled(app).map_err(|m| ApiError::Server(400, m))?;
    let state = app.state::<AppState>();
    let link = state.office.lock().await.by_path(path).ok_or_else(|| ApiError::Server(404, "That file is not linked to Studio. Link it first.".into()))?;
    if link.format != "xlsx" {
        return Err(ApiError::Server(400, "Decks go one way for now: pull the deck again after changing it in Studio.".into()));
    }
    let bytes = read(Path::new(path)).map_err(|m| ApiError::Server(400, m))?;
    let sha = sha256_hex(&bytes);
    if sha == link.synced_sha && !force {
        return Ok("Already up to date.".into());
    }
    let name = Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let enc = header_name(&name);
    let req = state
        .api()
        .authed(Method::POST, &format!("/api/desktop/studio/{}{}", link.doc_id, if force { "?force=1" } else { "" }))?
        .header("x-youbank-base", link.cursor.to_string())
        .header("x-youbank-filename", enc)
        .header(header::CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .timeout(Duration::from_secs(120))
        .body(bytes);
    let p: Pushed =
        send(req).await.inspect_err(|e| state::on_error(app, e))?.json().await.map_err(|_| ApiError::Server(502, "Unexpected answer from YouBank.".into()))?;
    state.office.lock().await.upsert(Link { cursor: p.cursor, synced_sha: sha, synced_at: now(), ..link });
    let _ = app.emit("office://changed", ());
    Ok(if p.changed { p.label } else { "Studio already had these numbers.".into() })
}

#[derive(Deserialize)]
struct Created {
    id: i64,
    title: String,
    cursor: i64,
}

/// A local workbook not yet in Studio becomes a new Studio document, linked to this file.
pub async fn link(app: &AppHandle, path: &str) -> Result<i64, String> {
    require_enabled(app)?;
    let p = Path::new(path);
    if !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("xlsx") || e.eq_ignore_ascii_case("xlsm")) {
        return Err("Only Excel workbooks (.xlsx) can be linked to Studio.".into());
    }
    let bytes = read(p)?;
    let sha = sha256_hex(&bytes);
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let enc = header_name(&name);
    let state = app.state::<AppState>();
    let req = state.api().authed(Method::POST, "/api/desktop/studio")?.header("x-youbank-filename", enc).timeout(Duration::from_secs(120)).body(bytes);
    let c: Created = send(req).await.inspect_err(|e| state::on_error(app, e))?.json().await.map_err(|_| "Unexpected answer from YouBank.".to_string())?;
    state.office.lock().await.upsert(Link {
        doc_id: c.id,
        title: c.title,
        path: path.into(),
        format: "xlsx".into(),
        cursor: c.cursor,
        synced_sha: sha,
        synced_at: now(),
    });
    let _ = app.emit("office://changed", ());
    Ok(c.id)
}

pub async fn unlink(app: &AppHandle, path: &str) {
    let state = app.state::<AppState>();
    let mut l = state.office.lock().await;
    l.links.retain(|x| x.path != path);
    l.save();
    drop(l);
    let _ = app.emit("office://changed", ());
}

#[derive(Deserialize)]
struct AgentAnswer {
    summary: String,
    #[serde(default)]
    error: String,
}

/// An AI edit to a local file (premium): bring Studio up to date with the file, let the agent work on
/// it, then write the result back over the file (backed up first). Returns the agent's summary.
pub async fn agent_edit(app: &AppHandle, path: &str, instruction: &str) -> Result<String, String> {
    require_enabled(app)?;
    let state = app.state::<AppState>();
    let link = state.office.lock().await.by_path(path).ok_or("That file is not linked to Studio. Link it first.")?;
    if link.format == "xlsx" {
        push(app, path, false).await.map_err(|e| match e {
            ApiError::Conflict(..) => {
                "This model changed in Studio after you pulled it. Pull a fresh copy or push your file first, then ask again.".to_string()
            }
            e => e.to_string(),
        })?;
    }
    let _ = app.emit("office://agent", serde_json::json!({ "path": path, "status": "working" }));
    let req = state
        .api()
        .authed(Method::POST, &format!("/api/desktop/studio/{}/agent", link.doc_id))?
        .timeout(Duration::from_secs(330))
        .json(&serde_json::json!({ "instruction": instruction }));
    let r = send(req).await.inspect_err(|e| state::on_error(app, e));
    let _ = app.emit("office://agent", serde_json::json!({ "path": path, "status": "done" }));
    let a: AgentAnswer = r?.json().await.map_err(|_| "Unexpected answer from YouBank.".to_string())?;
    if a.summary.is_empty() {
        return Err(if a.error.is_empty() { "The agent made no changes.".into() } else { a.error });
    }
    // The agent's work replaces the file; the version before it is kept in .backups.
    backup(Path::new(path))?;
    pull(app, link.doc_id, &link.format, false).await?;
    Ok(a.summary)
}

/// Linked workbooks the person just saved: push them (if they chose that) or tell them.
pub async fn on_saved(app: &AppHandle, paths: Vec<PathBuf>) {
    let state = app.state::<AppState>();
    let auto = state.settings().office.auto_push;
    for p in paths {
        let path = p.to_string_lossy().to_string();
        let Some(link) = state.office.lock().await.by_path(&path) else { continue };
        if link.format != "xlsx" {
            continue;
        }
        let Ok(bytes) = std::fs::read(&p) else { continue };
        if sha256_hex(&bytes) == link.synced_sha {
            continue;
        }
        if auto {
            match push(app, &path, false).await {
                Ok(label) => alerts::show(app, &format!("{} synced to Studio", link.title), &label),
                Err(e) => alerts::show(app, &format!("{} was not synced", link.title), &e.to_string()),
            }
        } else {
            alerts::show(app, &format!("{} changed", link.title), "Push it to Studio from the desktop agent when you are ready.");
            let _ = app.emit("office://changed", ());
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    #[serde(flatten)]
    pub link: Link,
    /// Saved locally since the last pull or push.
    pub changed: bool,
    pub missing: bool,
}

pub async fn status(app: &AppHandle) -> (String, Vec<LinkStatus>) {
    let state = app.state::<AppState>();
    let links = state.office.lock().await.links.clone();
    let out = links
        .into_iter()
        .map(|l| {
            let bytes = std::fs::read(&l.path).ok();
            LinkStatus { changed: bytes.as_ref().is_some_and(|b| sha256_hex(b) != l.synced_sha), missing: bytes.is_none(), link: l }
        })
        .collect();
    (folder(app).to_string_lossy().to_string(), out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(header_name("Acme DCF+v2.xlsx"), "Acme%20DCF%2Bv2.xlsx");
        assert_eq!(safe_file_name("Q3: DCF / LBO?.xlsx"), "Q3_ DCF _ LBO_.xlsx");
        assert_eq!(safe_file_name("  ..  "), "YouBank");
    }

    #[test]
    fn unique() {
        let dir = std::env::temp_dir().join(format!("yb-office-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Model.xlsx"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "Model.xlsx"), dir.join("Model (2).xlsx"));
        assert_eq!(unique_path(&dir, "Deck.pptx"), dir.join("Deck.pptx"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
