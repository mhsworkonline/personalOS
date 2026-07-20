//! Per-person documents (Aadhaar, PAN, passport, …) with encrypted file
//! attachments. Files are stored as BLOBs inside the SQLCipher database, so
//! they get exactly the same at-rest encryption as every other record.
//! Document numbers are shown masked in the UI and are never indexed for
//! search.

use super::people::mime_for;
use super::with_db;
use crate::db::{self, doc_type_label, index_record, log_activity, sync_timeline, unindex_record};
use crate::models::{Document, DocumentFileMeta, DocumentInput};
use crate::AppState;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rusqlite::{params, Connection, Row};
use tauri::State;

pub const DOC_TYPES: [&str; 14] = [
    "aadhaar",
    "pan",
    "passport",
    "driving_licence",
    "voter_id",
    "birth_certificate",
    "insurance",
    "health_card",
    "pension_card",
    "tax",
    // Broader categories that identity-only types can't hold: marksheets and
    // migration/leaving certificates, passbooks and cancelled cheques, bonds
    // and undertakings. Without these they'd all collapse into "other".
    "education",
    "bank",
    "legal",
    "other",
];

pub const FILE_KINDS: [&str; 3] = ["front", "back", "attachment"];
const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;

const DOC_COLS: &str = "id, person_id, doc_type, doc_number, name_on_document, issue_date, expiry_date, issuing_authority, notes, investment_id, created_at, updated_at";

fn doc_from_row(r: &Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: r.get(0)?,
        person_id: r.get(1)?,
        doc_type: r.get(2)?,
        doc_number: r.get(3)?,
        name_on_document: r.get(4)?,
        issue_date: r.get(5)?,
        expiry_date: r.get(6)?,
        issuing_authority: r.get(7)?,
        notes: r.get(8)?,
        investment_id: r.get(9)?,
        files: Vec::new(),
        links: Vec::new(),
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

/// On-disk files attached to a document, each flagged with whether it is still
/// where the link points, so the UI can show a "missing" badge.
fn links_for(conn: &Connection, document_id: i64) -> Result<Vec<crate::models::DocumentLinkMeta>, String> {
    let root = super::doclib::root_path(conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, rel_path, filename, size, created_at
             FROM document_links WHERE document_id = ?1 ORDER BY filename",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![document_id], |r| {
            Ok(crate::models::DocumentLinkMeta {
                id: r.get(0)?,
                document_id: r.get(1)?,
                rel_path: r.get(2)?,
                filename: r.get(3)?,
                size: r.get(4)?,
                present: false,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|mut l| {
            l.present = root
                .as_ref()
                .map(|r| std::path::PathBuf::from(r).join(&l.rel_path).exists())
                .unwrap_or(false);
            l
        })
        .collect())
}

fn files_for(conn: &Connection, document_id: i64) -> Result<Vec<DocumentFileMeta>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, kind, filename, mime, LENGTH(data), created_at
             FROM document_files WHERE document_id = ?1 ORDER BY kind, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![document_id], |r| {
            Ok(DocumentFileMeta {
                id: r.get(0)?,
                document_id: r.get(1)?,
                kind: r.get(2)?,
                filename: r.get(3)?,
                mime: r.get(4)?,
                size: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn documents_for(conn: &Connection, person: Option<i64>) -> Result<Vec<Document>, String> {
    let sql = match person {
        Some(_) => format!("SELECT {DOC_COLS} FROM documents WHERE person_id = ?1 ORDER BY doc_type, id"),
        None => format!("SELECT {DOC_COLS} FROM documents ORDER BY doc_type, id"),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut docs = match person {
        Some(pid) => stmt.query_map(params![pid], doc_from_row),
        None => stmt.query_map([], doc_from_row),
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    for d in &mut docs {
        d.files = files_for(conn, d.id)?;
        d.links = links_for(conn, d.id)?;
    }
    Ok(docs)
}

fn display_title(conn: &Connection, doc: &Document) -> String {
    let label = doc_type_label(&doc.doc_type);
    let owner: Option<String> = conn
        .query_row(
            "SELECT full_name FROM persons WHERE id = ?1",
            params![doc.person_id],
            |r| r.get(0),
        )
        .ok();
    match owner {
        Some(name) => format!("{name}: {label}"),
        None => label.to_string(),
    }
}

fn index_document(conn: &Connection, doc: &Document) -> Result<(), String> {
    // Deliberately excludes the document number (sensitive identifier).
    let label = doc_type_label(&doc.doc_type);
    let title = match &doc.name_on_document {
        Some(n) if !n.trim().is_empty() => format!("{label} — {}", n.trim()),
        _ => label.to_string(),
    };
    let body = format!(
        "{} document {} {}",
        doc.doc_type,
        doc.issuing_authority.as_deref().unwrap_or(""),
        doc.notes.as_deref().unwrap_or("")
    );
    index_record(conn, "documents", doc.id, &title, body.trim(), Some(doc.person_id))
}

fn sync_document_timeline(conn: &Connection, doc: &Document) -> Result<(), String> {
    sync_timeline(
        conn,
        "documents",
        doc.id,
        "document_expiration",
        &format!("{} expires", display_title(conn, doc)),
        doc.expiry_date.as_deref(),
        None,
        Some(doc.person_id),
    )
}

#[tauri::command]
pub fn document_list(
    state: State<'_, AppState>,
    person: Option<i64>,
) -> Result<Vec<Document>, String> {
    with_db(&state, |conn| documents_for(conn, person))
}

#[tauri::command]
pub fn document_save(state: State<'_, AppState>, input: DocumentInput) -> Result<Document, String> {
    if !DOC_TYPES.contains(&input.doc_type.as_str()) {
        return Err(format!("Unknown document type: {}", input.doc_type));
    }
    for d in [&input.issue_date, &input.expiry_date].into_iter().flatten() {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .map_err(|_| "Dates must be YYYY-MM-DD".to_string())?;
    }
    with_db(&state, |conn| {
        super::people::get_person(conn, input.person_id)?; // must exist
        let now = db::now();
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE documents SET person_id = ?1, doc_type = ?2, doc_number = ?3,
                     name_on_document = ?4, issue_date = ?5, expiry_date = ?6,
                     issuing_authority = ?7, notes = ?8, investment_id = ?9, updated_at = ?10 WHERE id = ?11",
                    params![input.person_id, input.doc_type, input.doc_number, input.name_on_document,
                            input.issue_date, input.expiry_date, input.issuing_authority, input.notes,
                            input.investment_id, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO documents (person_id, doc_type, doc_number, name_on_document, issue_date, expiry_date, issuing_authority, notes, investment_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                    params![input.person_id, input.doc_type, input.doc_number, input.name_on_document,
                            input.issue_date, input.expiry_date, input.issuing_authority, input.notes,
                            input.investment_id, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        let mut doc = conn
            .query_row(
                &format!("SELECT {DOC_COLS} FROM documents WHERE id = ?1"),
                params![id],
                doc_from_row,
            )
            .map_err(|e| e.to_string())?;
        doc.files = files_for(conn, id)?;
        index_document(conn, &doc)?;
        sync_document_timeline(conn, &doc)?;
        log_activity(
            conn,
            "documents",
            if input.id.is_some() { "updated" } else { "added" },
            &display_title(conn, &doc),
            Some(id),
        )?;
        Ok(doc)
    })
}

#[tauri::command]
pub fn document_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let doc = conn
            .query_row(
                &format!("SELECT {DOC_COLS} FROM documents WHERE id = ?1"),
                params![id],
                doc_from_row,
            )
            .map_err(|_| "Document not found".to_string())?;
        let title = display_title(conn, &doc);
        conn.execute("DELETE FROM documents WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?; // files cascade
        unindex_record(conn, "documents", id)?;
        sync_timeline(conn, "documents", id, "document_expiration", "", None, None, None)?;
        log_activity(conn, "documents", "deleted", &title, None)?;
        Ok(())
    })
}

#[tauri::command]
pub fn document_file_add(
    state: State<'_, AppState>,
    document: i64,
    kind: String,
    path: String,
) -> Result<DocumentFileMeta, String> {
    if !FILE_KINDS.contains(&kind.as_str()) {
        return Err(format!("Unknown file kind: {kind}"));
    }
    let data = std::fs::read(&path).map_err(|e| format!("Cannot read file: {e}"))?;
    if data.is_empty() {
        return Err("File is empty".into());
    }
    if data.len() > MAX_FILE_BYTES {
        return Err("File is larger than 25 MB".into());
    }
    let filename = std::path::Path::new(&path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let mime = mime_for(&path);
    if (kind == "front" || kind == "back") && !mime.starts_with("image/") {
        return Err("Front/back must be an image (PNG, JPEG, WebP, GIF)".into());
    }
    with_db(&state, |conn| {
        conn.query_row("SELECT id FROM documents WHERE id = ?1", params![document], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|_| "Document not found".to_string())?;
        // A document has exactly one front and one back image.
        if kind == "front" || kind == "back" {
            conn.execute(
                "DELETE FROM document_files WHERE document_id = ?1 AND kind = ?2",
                params![document, kind],
            )
            .map_err(|e| e.to_string())?;
        }
        let now = db::now();
        conn.execute(
            "INSERT INTO document_files (document_id, kind, filename, mime, data, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![document, kind, filename, mime, data, now],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        Ok(DocumentFileMeta {
            id,
            document_id: document,
            kind,
            filename,
            mime: mime.to_string(),
            size: data.len() as i64,
            created_at: now,
        })
    })
}

/// Returns the decrypted file as a data URL for in-app preview.
#[tauri::command]
pub fn document_file_data(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    with_db(&state, |conn| {
        let (mime, data): (String, Vec<u8>) = conn
            .query_row(
                "SELECT mime, data FROM document_files WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "File not found".to_string())?;
        Ok(format!("data:{mime};base64,{}", B64.encode(data)))
    })
}

/// Writes the decrypted file to a user-chosen destination (explicit export).
#[tauri::command]
pub fn document_file_export(
    state: State<'_, AppState>,
    id: i64,
    dest: String,
) -> Result<(), String> {
    with_db(&state, |conn| {
        let data: Vec<u8> = conn
            .query_row(
                "SELECT data FROM document_files WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .map_err(|_| "File not found".to_string())?;
        std::fs::write(&dest, data).map_err(|e| format!("Cannot write file: {e}"))?;
        Ok(())
    })
}

#[tauri::command]
pub fn document_file_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute("DELETE FROM document_files WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}
