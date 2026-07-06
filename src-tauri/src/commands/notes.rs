//! Notes: markdown notes with folders, tags, pinning and reminders.
//! Every note belongs to a person (default "Me").

use super::with_db;
use crate::db::{self, index_record, log_activity, sync_timeline, unindex_record};
use crate::models::{Folder, Note, NoteInput, NoteMeta};
use crate::AppState;
use rusqlite::{params, Connection};
use tauri::State;

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn folder_list(state: State<'_, AppState>) -> Result<Vec<Folder>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, name FROM folders ORDER BY name COLLATE NOCASE")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok(Folder { id: r.get(0)?, name: r.get(1)? }))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn folder_create(state: State<'_, AppState>, name: String) -> Result<Folder, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Folder name must not be empty".into());
    }
    with_db(&state, |conn| {
        conn.execute(
            "INSERT INTO folders (name, created_at) VALUES (?1, ?2)",
            params![name, db::now()],
        )
        .map_err(|_| "A folder with that name already exists".to_string())?;
        Ok(Folder { id: conn.last_insert_rowid(), name })
    })
}

#[tauri::command]
pub fn folder_rename(state: State<'_, AppState>, id: i64, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Folder name must not be empty".into());
    }
    with_db(&state, |conn| {
        conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", params![name, id])
            .map_err(|_| "A folder with that name already exists".to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn folder_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        // Notes in the folder survive with folder_id = NULL (ON DELETE SET NULL).
        conn.execute("DELETE FROM folders WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

fn note_tags(conn: &Connection, note_id: i64) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
             WHERE nt.note_id = ?1 ORDER BY t.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![note_id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn preview_of(content: &str) -> String {
    let stripped: String = content
        .lines()
        .map(|l| l.trim_start_matches(['#', '>', '-', '*', ' ']))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    stripped.chars().take(140).collect()
}

type NoteRow = (i64, String, String, Option<i64>, bool, Option<i64>, String);

fn rows_to_metas(conn: &Connection, rows: Vec<NoteRow>) -> Result<Vec<NoteMeta>, String> {
    let mut metas = Vec::with_capacity(rows.len());
    for (id, title, content, folder_id, pinned, person_id, updated_at) in rows {
        metas.push(NoteMeta {
            id,
            title,
            folder_id,
            pinned,
            preview: preview_of(&content),
            tags: note_tags(conn, id)?,
            person_id,
            updated_at,
        });
    }
    Ok(metas)
}

const NOTE_META_COLS: &str = "n.id, n.title, n.content, n.folder_id, n.pinned, n.person_id, n.updated_at";

pub fn note_metas_for(conn: &Connection, person: Option<i64>) -> Result<Vec<NoteMeta>, String> {
    let sql = match person {
        Some(_) => format!(
            "SELECT {NOTE_META_COLS} FROM notes n WHERE n.person_id = ?1 ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 500"
        ),
        None => format!(
            "SELECT {NOTE_META_COLS} FROM notes n ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 500"
        ),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let map = |r: &rusqlite::Row| -> rusqlite::Result<NoteRow> {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
    };
    let rows = match person {
        Some(pid) => stmt.query_map(params![pid], map),
        None => stmt.query_map([], map),
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    rows_to_metas(conn, rows)
}

#[tauri::command]
pub fn note_list(
    state: State<'_, AppState>,
    folder: Option<i64>,
    tag: Option<String>,
    query: Option<String>,
) -> Result<Vec<NoteMeta>, String> {
    with_db(&state, |conn| {
        let mut sql = format!("SELECT DISTINCT {NOTE_META_COLS} FROM notes n");
        let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let mut wheres: Vec<String> = Vec::new();
        if let Some(t) = &tag {
            sql.push_str(
                " JOIN note_tags nt ON nt.note_id = n.id JOIN tags tg ON tg.id = nt.tag_id",
            );
            binds.push(Box::new(t.clone()));
            wheres.push(format!("tg.name = ?{}", binds.len()));
        }
        if let Some(f) = folder {
            binds.push(Box::new(f));
            wheres.push(format!("n.folder_id = ?{}", binds.len()));
        }
        if let Some(q) = &query {
            if !q.trim().is_empty() {
                binds.push(Box::new(format!("%{}%", q.trim())));
                let n = binds.len();
                wheres.push(format!("(n.title LIKE ?{n} OR n.content LIKE ?{n})"));
            }
        }
        if !wheres.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&wheres.join(" AND "));
        }
        sql.push_str(" ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 500");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let rows: Vec<NoteRow> = stmt
            .query_map(refs.as_slice(), |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows_to_metas(conn, rows)
    })
}

fn note_get_inner(conn: &Connection, id: i64) -> Result<Note, String> {
    let mut note = conn
        .query_row(
            "SELECT id, title, content, folder_id, pinned, person_id, created_at, updated_at FROM notes WHERE id = ?1",
            params![id],
            |r| {
                Ok(Note {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    content: r.get(2)?,
                    folder_id: r.get(3)?,
                    pinned: r.get(4)?,
                    person_id: r.get(5)?,
                    tags: Vec::new(),
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            },
        )
        .map_err(|_| "Note not found".to_string())?;
    note.tags = note_tags(conn, id)?;
    Ok(note)
}

#[tauri::command]
pub fn note_get(state: State<'_, AppState>, id: i64) -> Result<Note, String> {
    with_db(&state, |conn| note_get_inner(conn, id))
}

fn set_tags(conn: &Connection, note_id: i64, tags: &[String]) -> Result<(), String> {
    conn.execute("DELETE FROM note_tags WHERE note_id = ?1", params![note_id])
        .map_err(|e| e.to_string())?;
    for tag in tags {
        let tag = tag.trim().trim_start_matches('#').to_string();
        if tag.is_empty() {
            continue;
        }
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", params![tag])
            .map_err(|e| e.to_string())?;
        let tag_id: i64 = conn
            .query_row("SELECT id FROM tags WHERE name = ?1", params![tag], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
            params![note_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    // Drop orphaned tags so the tag list stays clean.
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn note_save(state: State<'_, AppState>, input: NoteInput) -> Result<Note, String> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err("Note title must not be empty".into());
    }
    with_db(&state, |conn| {
        let now = db::now();
        let person_id = match input.person_id {
            Some(p) => p,
            None => db::default_person_id(conn)?,
        };
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE notes SET title = ?1, content = ?2, folder_id = ?3, pinned = ?4, person_id = ?5, updated_at = ?6 WHERE id = ?7",
                    params![title, input.content, input.folder_id, input.pinned, person_id, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO notes (title, content, folder_id, pinned, person_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                    params![title, input.content, input.folder_id, input.pinned, person_id, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        set_tags(conn, id, &input.tags)?;
        let tags = note_tags(conn, id)?;
        let body = format!("{} {}", input.content, tags.join(" "));
        index_record(conn, "notes", id, &title, &body, Some(person_id))?;
        // Keep any reminder event's title and person in sync with the note.
        conn.execute(
            "UPDATE timeline_events SET title = ?1, person_id = ?2 WHERE source_module = 'notes' AND source_id = ?3",
            params![format!("Note: {title}"), person_id, id],
        )
        .map_err(|e| e.to_string())?;
        log_activity(
            conn,
            "notes",
            if input.id.is_some() { "updated" } else { "added" },
            &title,
            Some(id),
        )?;
        note_get_inner(conn, id)
    })
}

#[tauri::command]
pub fn note_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let title: Option<String> = conn
            .query_row("SELECT title FROM notes WHERE id = ?1", params![id], |r| r.get(0))
            .ok();
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)",
            [],
        )
        .map_err(|e| e.to_string())?;
        unindex_record(conn, "notes", id)?;
        sync_timeline(conn, "notes", id, "reminder", "", None, None, None)?;
        if let Some(t) = title {
            log_activity(conn, "notes", "deleted", &t, None)?;
        }
        Ok(())
    })
}

/// Attach (or clear, with date = None) a follow-up reminder to a note.
#[tauri::command]
pub fn note_set_reminder(
    state: State<'_, AppState>,
    id: i64,
    date: Option<String>,
) -> Result<(), String> {
    if let Some(d) = &date {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .map_err(|_| "Reminder date must be YYYY-MM-DD".to_string())?;
    }
    with_db(&state, |conn| {
        let (title, person_id): (String, Option<i64>) = conn
            .query_row(
                "SELECT title, person_id FROM notes WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "Note not found".to_string())?;
        sync_timeline(
            conn,
            "notes",
            id,
            "reminder",
            &format!("Note: {title}"),
            date.as_deref(),
            None,
            person_id,
        )
    })
}

#[tauri::command]
pub fn tag_list(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT name FROM tags ORDER BY name COLLATE NOCASE")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}
