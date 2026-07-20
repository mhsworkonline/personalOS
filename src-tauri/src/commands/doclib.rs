//! Document library: links documents that stay as real files on disk.
//!
//! The app stores a pointer (path relative to the `documents_root` setting)
//! plus a SHA-256, and **never writes into that folder** — uninstall the app
//! and every file is exactly where it was. Scanning is read-only: it returns
//! proposals and changes nothing until the user imports a reviewed selection.
//!
//! Files whose names look like PIN/CVV/OTP material are refused outright, the
//! same policy `finance.rs` applies to account details.

use super::with_db;
use crate::db::{self, index_record, log_activity, unindex_record};
use crate::models::{ImportEntry, ScanEntry, ScanResult};
use crate::AppState;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::State;
use tauri_plugin_opener::OpenerExt;
use walkdir::WalkDir;

pub const ROOT_SETTING: &str = "documents_root";

/// Only real document formats. Keeps videos, fonts and archives out of the
/// library even when they sit in the same folder.
const ALLOWED_EXT: [&str; 15] = [
    "pdf", "jpg", "jpeg", "png", "webp", "jfif", "gif", "tif", "tiff", "bmp", "doc", "docx", "xls",
    "xlsx", "rtf",
];

/// Never index these — same forbidden material as `finance::FORBIDDEN_DETAIL_KEYS`.
const BLOCKED_TOKENS: [&str; 6] = ["pin", "mpin", "cvv", "cvc", "otp", "atmpin"];

/// Types where one person genuinely holds one document, so repeat scans of
/// front/back/old/new attach to the same record instead of making duplicates.
const GROUPED_TYPES: [&str; 8] = [
    "aadhaar",
    "pan",
    "passport",
    "voter_id",
    "driving_licence",
    "birth_certificate",
    "health_card",
    "pension_card",
];

fn tokens(name: &str) -> Vec<String> {
    name.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// A filename that looks like PIN/CVV/OTP material. Matched on whole tokens so
/// "Painting.pdf" or "Spinner.jpg" don't trip it.
pub fn blocked_reason(filename: &str) -> Option<String> {
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let t = tokens(stem);
    for tok in &t {
        if BLOCKED_TOKENS.contains(&tok.as_str()) {
            return Some(format!(
                "Looks like PIN/OTP material (\"{tok}\") — never stored, by policy"
            ));
        }
    }
    None
}

/// Guess a document type from the filename. Returns the type and whether the
/// name gave real signal, so the UI can highlight rows worth reviewing.
/// Order matters: the most specific rules run first.
pub fn guess_doc_type(filename: &str) -> (&'static str, bool) {
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let t = tokens(stem);
    let hay = t.join(" ");
    let has = |needle: &str| hay.contains(needle);
    let tok = |needle: &str| t.iter().any(|x| x == needle);

    // Insurer brand names carry no "insurance" keyword of their own.
    if has("insurance") || has("ergo") || has("mediclaim") || has("policy") {
        return ("insurance", true);
    }
    // A police verification report is not a passport, though it names one.
    if has("police") {
        return ("legal", true);
    }
    // Covers the "aadhaar" / "aadhar" / "aaadhaar" spellings all present here.
    if t.iter().any(|x| x.starts_with("aadh")) {
        return ("aadhaar", true);
    }
    if tok("pan") || t.iter().any(|x| x.starts_with("pancard")) {
        return ("pan", true);
    }
    if has("passport") {
        return ("passport", true);
    }
    if has("licen") || has("driving") || has("learner") || tok("llr") || tok("dl") {
        return ("driving_licence", true);
    }
    if has("election") || has("voter") || tok("epic") {
        return ("voter_id", true);
    }
    if has("birth") {
        return ("birth_certificate", true);
    }
    if has("death") {
        return ("legal", true);
    }
    if has("medical") || has("fitness") || has("health") {
        return ("health_card", true);
    }
    for k in [
        "marksheet", "migration", "leaving", "school", "cbse", "gujcet", "neet", "admit",
        "scholarship", "admission", "fees", "reportcard", "hostel", "mbbs", "board", "exam",
        "domicile", "skill", "character", "result", "syllabus", "10th", "11th", "12th", "college",
    ] {
        if has(k) {
            return ("education", true);
        }
    }
    if tok("tc") || tok("lc") {
        return ("education", true);
    }
    for k in [
        "bond", "undertaking", "guarantee", "garanty", "affidavit", "solvency", "agreement",
        "notary", "stamp", "court", "deed",
    ] {
        if has(k) {
            return ("legal", true);
        }
    }
    for k in [
        "passbook", "cheque", "bank", "hdfc", "bandhan", "ifsc", "statement", "sbi", "icici",
        "axis", "kotak", "cancelled",
    ] {
        if has(k) {
            return ("bank", true);
        }
    }
    for k in ["itr", "form16", "gst", "tds", "taxreturn"] {
        if has(k) {
            return ("tax", true);
        }
    }
    if tok("tax") {
        return ("tax", true);
    }
    ("other", false)
}

fn sha256_file(path: &Path) -> Result<(String, i64), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Ok((hex::encode(h.finalize()), bytes.len() as i64))
}

pub fn root_path(conn: &Connection) -> Result<Option<String>, String> {
    let v: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![ROOT_SETTING],
            |r| r.get(0),
        )
        .ok();
    Ok(v.filter(|s| !s.trim().is_empty()))
}

/// Folder name -> person, as learned on previous imports.
fn folder_map(conn: &Connection) -> Result<HashMap<String, i64>, String> {
    let mut stmt = conn
        .prepare("SELECT LOWER(folder), person_id FROM document_folder_map")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().collect())
}

#[tauri::command]
pub fn document_folder_map_set(
    state: State<'_, AppState>,
    folder: String,
    person: i64,
) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute(
            "INSERT INTO document_folder_map (folder, person_id, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(folder) DO UPDATE SET person_id = excluded.person_id",
            params![folder.trim(), person, db::now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn document_folder_map_list(state: State<'_, AppState>) -> Result<HashMap<String, i64>, String> {
    with_db(&state, folder_map)
}

/// Walk the documents folder and classify every file. Read-only: nothing is
/// written to the database or to disk.
#[tauri::command]
pub fn document_scan(state: State<'_, AppState>) -> Result<ScanResult, String> {
    with_db(&state, |conn| {
        let Some(root) = root_path(conn)? else {
            return Err("No documents folder set yet".to_string());
        };
        let root_buf = PathBuf::from(&root);
        if !root_buf.is_dir() {
            return Err(format!("Documents folder not found: {root}"));
        }
        let map = folder_map(conn)?;
        let names: HashMap<i64, String> = {
            let mut stmt = conn
                .prepare("SELECT id, full_name FROM persons")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows.into_iter().collect()
        };

        // Existing links, indexed both ways so a file can be recognised by
        // where it sits and by what it contains.
        struct Link {
            id: i64,
            document_id: i64,
            rel_path: String,
            sha256: String,
            person_id: Option<i64>,
            doc_type: String,
        }
        let links: Vec<Link> = {
            let mut stmt = conn
                .prepare(
                    "SELECT l.id, l.document_id, l.rel_path, l.sha256, d.person_id, d.doc_type
                     FROM document_links l JOIN documents d ON d.id = l.document_id",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(Link {
                        id: r.get(0)?,
                        document_id: r.get(1)?,
                        rel_path: r.get(2)?,
                        sha256: r.get(3)?,
                        person_id: r.get(4)?,
                        doc_type: r.get(5)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        let by_path: HashMap<String, &Link> = links
            .iter()
            .map(|l| (l.rel_path.to_lowercase(), l))
            .collect();
        let by_hash: HashMap<String, &Link> = links.iter().map(|l| (l.sha256.clone(), l)).collect();

        let mut entries: Vec<ScanEntry> = Vec::new();
        let mut seen_links: Vec<i64> = Vec::new();
        let mut folders_on_disk: Vec<String> = Vec::new();

        for item in WalkDir::new(&root_buf).into_iter().filter_map(|e| e.ok()) {
            if !item.file_type().is_file() {
                continue;
            }
            let path = item.path();
            let filename = match path.file_name().and_then(|s| s.to_str()) {
                Some(f) => f.to_string(),
                None => continue,
            };
            // Office lock files and dotfiles are never documents.
            if filename.starts_with('~') || filename.starts_with('.') {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !ALLOWED_EXT.contains(&ext.as_str()) {
                continue;
            }
            let rel = match path.strip_prefix(&root_buf) {
                Ok(r) => r.to_string_lossy().replace('/', "\\"),
                Err(_) => continue,
            };
            let folder = rel.split('\\').next().unwrap_or("").to_string();
            let folder = if folder == filename { String::new() } else { folder };
            if !folder.is_empty() && !folders_on_disk.iter().any(|f| f.eq_ignore_ascii_case(&folder)) {
                folders_on_disk.push(folder.clone());
            }

            if let Some(reason) = blocked_reason(&filename) {
                entries.push(ScanEntry {
                    rel_path: rel,
                    filename,
                    folder,
                    sha256: String::new(),
                    size: item.metadata().map(|m| m.len() as i64).unwrap_or(0),
                    status: "blocked".into(),
                    person_id: None,
                    person_name: None,
                    doc_type: "other".into(),
                    confident: false,
                    document_id: None,
                    link_id: None,
                    note: Some(reason),
                });
                continue;
            }

            let (sha, size) = sha256_file(path)?;
            let existing_path = by_path.get(&rel.to_lowercase());
            let existing_hash = by_hash.get(&sha);

            let (status, link, note) = match (existing_path, existing_hash) {
                (Some(l), _) if l.sha256 == sha => ("linked", Some(*l), None),
                (Some(l), _) => (
                    "modified",
                    Some(*l),
                    Some("File changed since it was linked".to_string()),
                ),
                (None, Some(l)) => (
                    "moved",
                    Some(*l),
                    Some(format!("Was at {}", l.rel_path)),
                ),
                (None, None) => ("new", None, None),
            };
            if let Some(l) = link {
                seen_links.push(l.id);
            }

            let (person_id, doc_type, confident) = match link {
                Some(l) => (l.person_id, l.doc_type.clone(), true),
                None => {
                    let (t, c) = guess_doc_type(&filename);
                    (
                        map.get(&folder.to_lowercase()).copied(),
                        t.to_string(),
                        c,
                    )
                }
            };

            entries.push(ScanEntry {
                rel_path: rel,
                filename,
                folder,
                sha256: sha,
                size,
                status: status.into(),
                person_id,
                person_name: person_id.and_then(|p| names.get(&p).cloned()),
                doc_type,
                confident,
                document_id: link.map(|l| l.document_id),
                link_id: link.map(|l| l.id),
                note,
            });
        }

        // Links whose file turned up nowhere in the tree.
        for l in &links {
            if seen_links.contains(&l.id) {
                continue;
            }
            entries.push(ScanEntry {
                rel_path: l.rel_path.clone(),
                filename: l
                    .rel_path
                    .rsplit('\\')
                    .next()
                    .unwrap_or(&l.rel_path)
                    .to_string(),
                folder: l.rel_path.split('\\').next().unwrap_or("").to_string(),
                sha256: l.sha256.clone(),
                size: 0,
                status: "missing".into(),
                person_id: l.person_id,
                person_name: l.person_id.and_then(|p| names.get(&p).cloned()),
                doc_type: l.doc_type.clone(),
                confident: true,
                document_id: Some(l.document_id),
                link_id: Some(l.id),
                note: Some("File no longer in the documents folder".into()),
            });
        }

        entries.sort_by(|a, b| a.rel_path.to_lowercase().cmp(&b.rel_path.to_lowercase()));
        let unmapped_folders = folders_on_disk
            .into_iter()
            .filter(|f| !map.contains_key(&f.to_lowercase()))
            .collect();

        Ok(ScanResult { root, entries, unmapped_folders })
    })
}

/// Commit reviewed rows: create (or reuse) a document per entry and link the
/// file to it. Never touches the file itself.
#[tauri::command]
pub fn document_import(
    state: State<'_, AppState>,
    entries: Vec<ImportEntry>,
) -> Result<usize, String> {
    with_db(&state, |conn| {
        let mut n = 0usize;
        for e in &entries {
            if blocked_reason(&e.filename).is_some() {
                continue;
            }
            let already: Option<i64> = conn
                .query_row(
                    "SELECT id FROM document_links WHERE sha256 = ?1",
                    params![e.sha256],
                    |r| r.get(0),
                )
                .ok();
            if already.is_some() {
                continue;
            }
            let now = db::now();
            let stem = Path::new(&e.filename)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&e.filename)
                .to_string();

            // Identity documents collapse into one record per person; broad
            // buckets (education, bank, …) stay one record per file, labelled
            // with the filename so the list reads sensibly.
            let document_id = if GROUPED_TYPES.contains(&e.doc_type.as_str()) {
                let found: Option<i64> = conn
                    .query_row(
                        "SELECT id FROM documents WHERE person_id = ?1 AND doc_type = ?2 LIMIT 1",
                        params![e.person_id, e.doc_type],
                        |r| r.get(0),
                    )
                    .ok();
                match found {
                    Some(id) => id,
                    None => {
                        conn.execute(
                            "INSERT INTO documents (person_id, doc_type, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?3)",
                            params![e.person_id, e.doc_type, now],
                        )
                        .map_err(|err| err.to_string())?;
                        conn.last_insert_rowid()
                    }
                }
            } else {
                conn.execute(
                    "INSERT INTO documents (person_id, doc_type, notes, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![e.person_id, e.doc_type, stem, now],
                )
                .map_err(|err| err.to_string())?;
                conn.last_insert_rowid()
            };

            conn.execute(
                "INSERT INTO document_links (document_id, rel_path, filename, sha256, size, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![document_id, e.rel_path, e.filename, e.sha256, e.size, now],
            )
            .map_err(|err| err.to_string())?;

            // Title by filename so search results say "Moksh-12th-Marksheet",
            // not "Education" 26 times. Document numbers are never indexed.
            // Mirrors the documents branch of `db::rebuild_search_index`.
            let label = db::doc_type_label(&e.doc_type);
            let title: String = conn
                .query_row(
                    "SELECT COALESCE(NULLIF(TRIM(notes),''), NULLIF(TRIM(name_on_document),''), doc_type)
                     FROM documents WHERE id = ?1",
                    params![document_id],
                    |r| r.get(0),
                )
                .unwrap_or_else(|_| label.to_string());
            let filenames: String = conn
                .query_row(
                    "SELECT COALESCE(group_concat(filename, ' '), '') FROM document_links
                     WHERE document_id = ?1",
                    params![document_id],
                    |r| r.get(0),
                )
                .unwrap_or_default();
            index_record(
                conn,
                "documents",
                document_id,
                &title,
                &format!("document {} {} {}", e.doc_type, stem, filenames),
                Some(e.person_id),
            )?;
            n += 1;
        }
        if n > 0 {
            log_activity(conn, "documents", "linked files", &format!("{n} file(s)"), None)?;
        }
        Ok(n)
    })
}

/// Point an existing link at a new relative path (used to repair a moved file).
#[tauri::command]
pub fn document_link_repair(
    state: State<'_, AppState>,
    link: i64,
    path: String,
) -> Result<(), String> {
    with_db(&state, |conn| {
        let filename = path.rsplit('\\').next().unwrap_or(&path).to_string();
        conn.execute(
            "UPDATE document_links SET rel_path = ?1, filename = ?2 WHERE id = ?3",
            params![path, filename, link],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Re-hash a link's file after the file legitimately changed.
#[tauri::command]
pub fn document_link_refresh(state: State<'_, AppState>, link: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let Some(root) = root_path(conn)? else {
            return Err("No documents folder set yet".to_string());
        };
        let rel: String = conn
            .query_row(
                "SELECT rel_path FROM document_links WHERE id = ?1",
                params![link],
                |r| r.get(0),
            )
            .map_err(|_| "Link not found".to_string())?;
        let (sha, size) = sha256_file(&PathBuf::from(&root).join(&rel))?;
        conn.execute(
            "UPDATE document_links SET sha256 = ?1, size = ?2 WHERE id = ?3",
            params![sha, size, link],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Remove a link. Deletes the parent document too when nothing is left on it,
/// so unlinking never leaves an empty shell behind. The file is untouched.
#[tauri::command]
pub fn document_link_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let document_id: Option<i64> = conn
            .query_row(
                "SELECT document_id FROM document_links WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        conn.execute("DELETE FROM document_links WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if let Some(doc) = document_id {
            let links: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM document_links WHERE document_id = ?1",
                    params![doc],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let files: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM document_files WHERE document_id = ?1",
                    params![doc],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if links == 0 && files == 0 {
                conn.execute("DELETE FROM documents WHERE id = ?1", params![doc])
                    .map_err(|e| e.to_string())?;
                unindex_record(conn, "documents", doc)?;
            }
        }
        Ok(())
    })
}

/// Absolute path of a linked file. Errors when the file is gone rather than
/// silently returning a path to nothing.
#[tauri::command]
pub fn document_link_path(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    with_db(&state, |conn| resolve_link(conn, id))
}

fn resolve_link(conn: &Connection, id: i64) -> Result<String, String> {
    let Some(root) = root_path(conn)? else {
        return Err("No documents folder set yet".to_string());
    };
    let rel: String = conn
        .query_row(
            "SELECT rel_path FROM document_links WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|_| "Link not found".to_string())?;
    let full = PathBuf::from(&root).join(&rel);
    if !full.exists() {
        return Err(format!("File is missing: {rel}"));
    }
    Ok(full.to_string_lossy().to_string())
}

/// Open a linked file in the system's default viewer.
///
/// Deliberately opened from Rust rather than via the webview's `openPath`:
/// the plugin's IPC command is gated by a **build-time** path scope, but the
/// documents root is chosen at runtime and can be changed at any time. Rather
/// than granting the webview `"path": "**"` (blanket permission to open any
/// file on the machine), the app resolves the path itself and only ever opens
/// something that is actually linked under the configured root.
#[tauri::command]
pub fn document_link_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let full = with_db(&state, |conn| resolve_link(conn, id))?;
    app.opener()
        .open_path(full, None::<&str>)
        .map_err(|e| format!("Could not open the file: {e}"))
}
