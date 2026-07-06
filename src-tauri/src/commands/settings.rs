use super::with_db;
use crate::AppState;
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}
