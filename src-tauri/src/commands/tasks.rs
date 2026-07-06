//! Dashboard, tasks and quick notes.

use super::with_db;
use crate::db::{self, index_record, log_activity, sync_timeline, unindex_record};
use crate::models::{Activity, DashboardData, QuickNote, Task, TimelineEvent};
use crate::AppState;
use chrono::{Days, Local};
use rusqlite::{params, Connection, Row};
use serde::Deserialize;
use tauri::State;

fn task_from_row(r: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        done: r.get(2)?,
        due_date: r.get(3)?,
        person_id: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

const TASK_COLS: &str = "id, title, done, due_date, person_id, created_at, updated_at";

pub fn tasks_for(conn: &Connection, person: Option<i64>) -> Result<Vec<Task>, String> {
    let sql = match person {
        Some(_) => format!(
            "SELECT {TASK_COLS} FROM tasks WHERE person_id = ?1
             ORDER BY done ASC, due_date IS NULL, due_date ASC, updated_at DESC LIMIT 100"
        ),
        None => format!(
            "SELECT {TASK_COLS} FROM tasks
             ORDER BY done ASC, due_date IS NULL, due_date ASC, updated_at DESC LIMIT 100"
        ),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = match person {
        Some(pid) => stmt.query_map(params![pid], task_from_row),
        None => stmt.query_map([], task_from_row),
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Unified timeline, optionally filtered to one person. Includes overdue.
pub fn query_timeline_for(
    conn: &Connection,
    days: i64,
    person: Option<i64>,
) -> Result<Vec<TimelineEvent>, String> {
    let horizon = Local::now()
        .date_naive()
        .checked_add_days(Days::new(days.max(0) as u64))
        .ok_or("Date overflow")?
        .format("%Y-%m-%d")
        .to_string();
    let base = "SELECT te.id, te.source_module, te.source_id, te.kind, te.title, te.event_date,
                te.amount, te.notes, te.person_id, p.full_name
                FROM timeline_events te LEFT JOIN persons p ON p.id = te.person_id";
    let sql = match person {
        Some(_) => format!(
            "{base} WHERE te.event_date <= ?1 AND te.person_id = ?2 ORDER BY te.event_date ASC, te.id ASC LIMIT 200"
        ),
        None => format!("{base} WHERE te.event_date <= ?1 ORDER BY te.event_date ASC, te.id ASC LIMIT 200"),
    };
    let map = |r: &Row| -> rusqlite::Result<TimelineEvent> {
        Ok(TimelineEvent {
            id: r.get(0)?,
            source_module: r.get(1)?,
            source_id: r.get(2)?,
            kind: r.get(3)?,
            title: r.get(4)?,
            event_date: r.get(5)?,
            amount: r.get(6)?,
            notes: r.get(7)?,
            person_id: r.get(8)?,
            person_name: r.get(9)?,
        })
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = match person {
        Some(pid) => stmt.query_map(params![horizon, pid], map),
        None => stmt.query_map(params![horizon], map),
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn query_quick_notes(conn: &Connection) -> Result<Vec<QuickNote>, String> {
    let mut stmt = conn
        .prepare("SELECT id, content, created_at FROM quick_notes ORDER BY id DESC LIMIT 30")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(QuickNote {
                id: r.get(0)?,
                content: r.get(1)?,
                created_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn query_activity(conn: &Connection, limit: i64) -> Result<Vec<Activity>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, module, action, title, record_id, created_at
             FROM activity_log ORDER BY id DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(Activity {
                id: r.get(0)?,
                module: r.get(1)?,
                action: r.get(2)?,
                title: r.get(3)?,
                record_id: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn get_dashboard(state: State<'_, AppState>, days: i64) -> Result<DashboardData, String> {
    with_db(&state, |conn| {
        Ok(DashboardData {
            today: db::today(),
            tasks: tasks_for(conn, None)?,
            quick_notes: query_quick_notes(conn)?,
            timeline: query_timeline_for(conn, days, None)?,
            activity: query_activity(conn, 15)?,
        })
    })
}

#[derive(Deserialize)]
pub struct TaskInput {
    pub id: Option<i64>,
    pub title: String,
    pub due_date: Option<String>,
    pub person_id: Option<i64>,
}

fn sync_task_timeline(conn: &Connection, task: &Task) -> Result<(), String> {
    let date = if task.done { None } else { task.due_date.as_deref() };
    sync_timeline(conn, "tasks", task.id, "task", &task.title, date, None, task.person_id)
}

#[tauri::command]
pub fn task_save(state: State<'_, AppState>, input: TaskInput) -> Result<Task, String> {
    if input.title.trim().is_empty() {
        return Err("Task title must not be empty".into());
    }
    with_db(&state, |conn| {
        let now = db::now();
        let title = input.title.trim().to_string();
        let person_id = match input.person_id {
            Some(p) => p,
            None => db::default_person_id(conn)?,
        };
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE tasks SET title = ?1, due_date = ?2, person_id = ?3, updated_at = ?4 WHERE id = ?5",
                    params![title, input.due_date, person_id, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO tasks (title, done, due_date, person_id, created_at, updated_at)
                     VALUES (?1, 0, ?2, ?3, ?4, ?4)",
                    params![title, input.due_date, person_id, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        let task = conn
            .query_row(
                &format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"),
                params![id],
                task_from_row,
            )
            .map_err(|e| e.to_string())?;
        index_record(conn, "tasks", id, &task.title, "", task.person_id)?;
        sync_task_timeline(conn, &task)?;
        log_activity(
            conn,
            "tasks",
            if input.id.is_some() { "updated" } else { "added" },
            &task.title,
            Some(id),
        )?;
        Ok(task)
    })
}

#[tauri::command]
pub fn task_toggle(state: State<'_, AppState>, id: i64) -> Result<Task, String> {
    with_db(&state, |conn| {
        conn.execute(
            "UPDATE tasks SET done = 1 - done, updated_at = ?1 WHERE id = ?2",
            params![db::now(), id],
        )
        .map_err(|e| e.to_string())?;
        let task = conn
            .query_row(
                &format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"),
                params![id],
                task_from_row,
            )
            .map_err(|e| e.to_string())?;
        sync_task_timeline(conn, &task)?;
        if task.done {
            log_activity(conn, "tasks", "completed", &task.title, Some(id))?;
        }
        Ok(task)
    })
}

#[tauri::command]
pub fn task_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let title: Option<String> = conn
            .query_row("SELECT title FROM tasks WHERE id = ?1", params![id], |r| {
                r.get(0)
            })
            .ok();
        conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        unindex_record(conn, "tasks", id)?;
        sync_timeline(conn, "tasks", id, "task", "", None, None, None)?;
        if let Some(t) = title {
            log_activity(conn, "tasks", "deleted", &t, None)?;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn quick_note_create(state: State<'_, AppState>, content: String) -> Result<QuickNote, String> {
    if content.trim().is_empty() {
        return Err("Note must not be empty".into());
    }
    with_db(&state, |conn| {
        let now = db::now();
        conn.execute(
            "INSERT INTO quick_notes (content, created_at) VALUES (?1, ?2)",
            params![content.trim(), now],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        index_record(conn, "quick", id, content.trim(), "", None)?;
        Ok(QuickNote {
            id,
            content: content.trim().into(),
            created_at: now,
        })
    })
}

#[tauri::command]
pub fn quick_note_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute("DELETE FROM quick_notes WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        unindex_record(conn, "quick", id)
    })
}
