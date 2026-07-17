//! People — the primary domain object. Every personal record (documents,
//! bank accounts, vault entries, notes, tasks, subscriptions, timeline
//! events) belongs to a person; "Me" is created automatically and cannot be
//! deleted.

use super::with_db;
use crate::db::{self, index_record, log_activity, unindex_record};
use crate::models::{Person, PersonInput, PersonOverview};
use crate::AppState;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rusqlite::{params, Connection, Row};
use std::collections::HashMap;
use tauri::State;

pub const RELATIONSHIPS: [&str; 14] = [
    "self", "wife", "husband", "father", "mother", "son", "daughter", "brother", "sister",
    "friend", "relative", "employee", "client", "other",
];

const PERSON_COLS: &str = "id, full_name, nickname, relationship, dob, phone, email, address, notes, is_default, photo IS NOT NULL, created_at, updated_at";

fn person_from_row(r: &Row) -> rusqlite::Result<Person> {
    Ok(Person {
        id: r.get(0)?,
        full_name: r.get(1)?,
        nickname: r.get(2)?,
        relationship: r.get(3)?,
        dob: r.get(4)?,
        phone: r.get(5)?,
        email: r.get(6)?,
        address: r.get(7)?,
        notes: r.get(8)?,
        is_default: r.get(9)?,
        has_photo: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

pub fn get_person(conn: &Connection, id: i64) -> Result<Person, String> {
    conn.query_row(
        &format!("SELECT {PERSON_COLS} FROM persons WHERE id = ?1"),
        params![id],
        person_from_row,
    )
    .map_err(|_| "Person not found".to_string())
}

fn index_person(conn: &Connection, p: &Person) -> Result<(), String> {
    let body = format!(
        "{} {} {} {} {}",
        p.nickname.as_deref().unwrap_or(""),
        p.relationship,
        p.phone.as_deref().unwrap_or(""),
        p.email.as_deref().unwrap_or(""),
        p.notes.as_deref().unwrap_or("")
    );
    index_record(conn, "person", p.id, &p.full_name, body.trim(), Some(p.id))
}

#[tauri::command]
pub fn person_list(state: State<'_, AppState>) -> Result<Vec<Person>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {PERSON_COLS} FROM persons ORDER BY is_default DESC, full_name COLLATE NOCASE"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], person_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn person_save(state: State<'_, AppState>, input: PersonInput) -> Result<Person, String> {
    let name = input.full_name.trim().to_string();
    if name.is_empty() {
        return Err("Name must not be empty".into());
    }
    if !RELATIONSHIPS.contains(&input.relationship.as_str()) {
        return Err(format!("Unknown relationship: {}", input.relationship));
    }
    with_db(&state, |conn| {
        let now = db::now();
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE persons SET full_name = ?1, nickname = ?2, relationship = ?3, dob = ?4,
                     phone = ?5, email = ?6, address = ?7, notes = ?8, updated_at = ?9 WHERE id = ?10",
                    params![name, input.nickname, input.relationship, input.dob, input.phone,
                            input.email, input.address, input.notes, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO persons (full_name, nickname, relationship, dob, phone, email, address, notes, is_default, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9)",
                    params![name, input.nickname, input.relationship, input.dob, input.phone,
                            input.email, input.address, input.notes, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        let person = get_person(conn, id)?;
        if input.id.is_some() {
            // Name/nickname/relationship appear in the index rows of every
            // owned record — rebuild so search stays consistent after edits.
            db::rebuild_search_index(conn)?;
        } else {
            index_person(conn, &person)?;
        }
        log_activity(
            conn,
            "people",
            if input.id.is_some() { "updated" } else { "added" },
            &person.full_name,
            Some(id),
        )?;
        Ok(person)
    })
}

#[tauri::command]
pub fn person_photo(state: State<'_, AppState>, id: i64) -> Result<Option<String>, String> {
    with_db(&state, |conn| {
        let row: Option<(Option<Vec<u8>>, Option<String>)> = conn
            .query_row(
                "SELECT photo, photo_mime FROM persons WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        Ok(match row {
            Some((Some(data), mime)) => Some(format!(
                "data:{};base64,{}",
                mime.unwrap_or_else(|| "image/jpeg".into()),
                B64.encode(data)
            )),
            _ => None,
        })
    })
}

pub fn mime_for(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".pdf") {
        "application/pdf"
    } else {
        "application/octet-stream"
    }
}

#[tauri::command]
pub fn person_set_photo(
    state: State<'_, AppState>,
    id: i64,
    path: Option<String>,
) -> Result<(), String> {
    with_db(&state, |conn| {
        match path {
            None => {
                conn.execute(
                    "UPDATE persons SET photo = NULL, photo_mime = NULL, updated_at = ?1 WHERE id = ?2",
                    params![db::now(), id],
                )
                .map_err(|e| e.to_string())?;
            }
            Some(p) => {
                let mime = mime_for(&p);
                if !mime.starts_with("image/") {
                    return Err("Photo must be a PNG, JPEG, WebP or GIF image".into());
                }
                let data = std::fs::read(&p).map_err(|e| format!("Cannot read photo: {e}"))?;
                if data.len() > 8 * 1024 * 1024 {
                    return Err("Photo is larger than 8 MB".into());
                }
                conn.execute(
                    "UPDATE persons SET photo = ?1, photo_mime = ?2, updated_at = ?3 WHERE id = ?4",
                    params![data, mime, db::now(), id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })
}

/// How many records belong to a person, keyed by module (for the delete flow).
pub fn related_counts(conn: &Connection, id: i64) -> Result<HashMap<String, i64>, String> {
    let mut out = HashMap::new();
    for (label, sql) in [
        ("documents", "SELECT COUNT(*) FROM documents WHERE person_id = ?1"),
        ("bank accounts", "SELECT COUNT(*) FROM accounts WHERE person_id = ?1"),
        ("vault entries", "SELECT COUNT(*) FROM vault_items WHERE person_id = ?1"),
        ("notes", "SELECT COUNT(*) FROM notes WHERE person_id = ?1"),
        ("tasks", "SELECT COUNT(*) FROM tasks WHERE person_id = ?1"),
        ("subscriptions", "SELECT COUNT(*) FROM subscriptions WHERE person_id = ?1"),
        ("investments", "SELECT COUNT(*) FROM investments WHERE person_id = ?1"),
        (
            "reminders",
            "SELECT COUNT(*) FROM timeline_events WHERE person_id = ?1 AND source_module = 'reminder'",
        ),
    ] {
        let n: i64 = conn
            .query_row(sql, params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if n > 0 {
            out.insert(label.to_string(), n);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn person_related_counts(
    state: State<'_, AppState>,
    id: i64,
) -> Result<HashMap<String, i64>, String> {
    with_db(&state, |conn| related_counts(conn, id))
}

/// Delete a person. If they still own records, the caller must pass
/// `reassign_to` — everything is moved to that person first (no data is ever
/// deleted implicitly). The default person "Me" cannot be deleted.
#[tauri::command]
pub fn person_delete(
    state: State<'_, AppState>,
    id: i64,
    reassign_to: Option<i64>,
) -> Result<(), String> {
    with_db(&state, |conn| {
        let person = get_person(conn, id)?;
        if person.is_default {
            return Err("The default person “Me” cannot be deleted".into());
        }
        let counts = related_counts(conn, id)?;
        let total: i64 = counts.values().sum();
        if total > 0 {
            let Some(target) = reassign_to else {
                let summary = counts
                    .iter()
                    .map(|(k, v)| format!("{v} {k}"))
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(format!(
                    "{} still owns records ({summary}). Choose another person to move them to first.",
                    person.full_name
                ));
            };
            if target == id {
                return Err("Cannot move records to the person being deleted".into());
            }
            get_person(conn, target)?; // must exist
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            for table in [
                "documents",
                "accounts",
                "vault_items",
                "notes",
                "tasks",
                "subscriptions",
                "investments",
                "timeline_events",
            ] {
                tx.execute(
                    &format!("UPDATE {table} SET person_id = ?1 WHERE person_id = ?2"),
                    params![target, id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM persons WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            db::rebuild_search_index(conn)?;
        } else {
            conn.execute("DELETE FROM persons WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
            unindex_record(conn, "person", id)?;
        }
        log_activity(conn, "people", "deleted", &person.full_name, None)?;
        Ok(())
    })
}

#[tauri::command]
pub fn person_overview(state: State<'_, AppState>, id: i64) -> Result<PersonOverview, String> {
    with_db(&state, |conn| {
        let person = get_person(conn, id)?;
        let photo: Option<(Option<Vec<u8>>, Option<String>)> = conn
            .query_row(
                "SELECT photo, photo_mime FROM persons WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        let photo = match photo {
            Some((Some(data), mime)) => Some(format!(
                "data:{};base64,{}",
                mime.unwrap_or_else(|| "image/jpeg".into()),
                B64.encode(data)
            )),
            _ => None,
        };
        Ok(PersonOverview {
            documents: super::documents::documents_for(conn, Some(id))?,
            accounts: super::finance::accounts_for(conn, Some(id))?,
            vault: super::vault::vault_metas_for(conn, Some(id))?,
            notes: super::notes::note_metas_for(conn, Some(id))?,
            subscriptions: super::finance::subscriptions_for(conn, Some(id))?,
            investments: super::investments::investments_for(conn, Some(id))?,
            tasks: super::tasks::tasks_for(conn, Some(id))?,
            timeline: super::tasks::query_timeline_for(conn, 365, Some(id))?,
            person,
            photo,
        })
    })
}
