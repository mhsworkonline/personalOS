pub mod auth;
pub mod backup;
pub mod doclib;
pub mod documents;
pub mod finance;
pub mod investments;
pub mod notes;
pub mod people;
pub mod portfolio;
pub mod search;
pub mod settings;
pub mod tasks;
pub mod timeline;
pub mod vault;

use crate::AppState;
use rusqlite::Connection;

/// Run `f` against the open database, or fail with "locked".
pub fn with_db<T>(
    state: &tauri::State<'_, AppState>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.db.lock().map_err(|_| "Internal state error".to_string())?;
    match guard.as_ref() {
        Some(conn) => f(conn),
        None => Err("locked".into()),
    }
}
