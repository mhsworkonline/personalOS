pub mod auth;
pub mod backup;
pub mod doclib;
pub mod documents;
pub mod feed;
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
use tauri::Manager;

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

/// Like `with_db`, but runs `f` on Tauri's blocking thread pool instead of
/// whatever thread delivered the IPC call. Plain (non-`async`) `#[tauri::command]`
/// functions execute inline on that thread, which on the desktop runtimes is the
/// same thread that pumps the WebView's UI — so a slow SQLCipher write or a
/// CPU-heavy Argon2id derivation inside a sync command freezes the whole window
/// until it returns. Use this for any command whose DB work can plausibly take
/// more than a few milliseconds (multi-statement saves, credential reveals).
pub async fn with_db_async<T, F>(app: tauri::AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_db(&state, f)
    })
    .await
    .map_err(|e| format!("Internal task error: {e}"))?
}
