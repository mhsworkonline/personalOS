//! Shared timeline: unified view + manual reminders. Auto events come from
//! their source modules (subscriptions, EMIs, vault/document expiry, task due
//! dates, note reminders) via `db::sync_timeline` — never duplicated here.

use super::with_db;
use crate::db::{self, index_record, log_activity, unindex_record};
use crate::models::TimelineEvent;
use crate::AppState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn timeline_upcoming(
    state: State<'_, AppState>,
    days: i64,
    person: Option<i64>,
) -> Result<Vec<TimelineEvent>, String> {
    with_db(&state, |conn| {
        super::tasks::query_timeline_for(conn, days, person)
    })
}

#[tauri::command]
pub fn reminder_create(
    state: State<'_, AppState>,
    title: String,
    date: String,
    notes: Option<String>,
    person: Option<i64>,
) -> Result<TimelineEvent, String> {
    if title.trim().is_empty() {
        return Err("Reminder title must not be empty".into());
    }
    chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| "Reminder date must be YYYY-MM-DD".to_string())?;
    with_db(&state, |conn| {
        let now = db::now();
        let title = title.trim().to_string();
        let person_id = match person {
            Some(p) => p,
            None => db::default_person_id(conn)?,
        };
        conn.execute(
            "INSERT INTO timeline_events (source_module, source_id, kind, title, event_date, amount, notes, person_id, created_at)
             VALUES ('reminder', NULL, 'reminder', ?1, ?2, NULL, ?3, ?4, ?5)",
            params![title, date, notes, person_id, now],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        index_record(
            conn,
            "reminder",
            id,
            &title,
            notes.as_deref().unwrap_or(""),
            Some(person_id),
        )?;
        log_activity(conn, "timeline", "reminder set", &title, Some(id))?;
        let person_name: Option<String> = conn
            .query_row(
                "SELECT full_name FROM persons WHERE id = ?1",
                params![person_id],
                |r| r.get(0),
            )
            .ok();
        Ok(TimelineEvent {
            id,
            source_module: "reminder".into(),
            source_id: None,
            kind: "reminder".into(),
            title,
            event_date: date,
            amount: None,
            notes,
            person_id: Some(person_id),
            person_name,
        })
    })
}

/// Delete a timeline event by id. Auto-generated events (subscriptions, EMIs,
/// expirations, task due dates) reappear when their source record is saved
/// again; the UI only offers deletion for manual reminders.
#[tauri::command]
pub fn timeline_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let source: Option<String> = conn
            .query_row(
                "SELECT source_module FROM timeline_events WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        conn.execute("DELETE FROM timeline_events WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if source.as_deref() == Some("reminder") {
            unindex_record(conn, "reminder", id)?;
        }
        Ok(())
    })
}
