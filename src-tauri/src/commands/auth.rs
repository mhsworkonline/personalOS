use crate::{crypto, db, AppState};
use tauri::State;

#[tauri::command]
pub fn vault_status(state: State<'_, AppState>) -> Result<String, String> {
    if state
        .db
        .lock()
        .map_err(|_| "Internal state error".to_string())?
        .is_some()
    {
        return Ok("unlocked".into());
    }
    if state.meta_path().exists() && state.db_path().exists() {
        Ok("locked".into())
    } else {
        Ok("setup_required".into())
    }
}

#[tauri::command]
pub fn setup_vault(state: State<'_, AppState>, password: String) -> Result<(), String> {
    if state.meta_path().exists() && state.db_path().exists() {
        return Err("A vault already exists".into());
    }
    if password.chars().count() < 8 {
        return Err("Master password must be at least 8 characters".into());
    }
    std::fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
    let meta = crypto::new_meta();
    let key = crypto::derive_key(&password, &meta.kdf)?;
    let conn = db::open_encrypted(&state.db_path(), &key)?;
    db::ensure_schema(&conn)?;
    crypto::save_meta(&state.meta_path(), &meta)?;
    *state
        .db
        .lock()
        .map_err(|_| "Internal state error".to_string())? = Some(conn);
    Ok(())
}

#[tauri::command]
pub fn unlock_vault(state: State<'_, AppState>, password: String) -> Result<(), String> {
    let meta = crypto::load_meta(&state.meta_path())?;
    let key = crypto::derive_key(&password, &meta.kdf)?;
    let conn = db::open_encrypted(&state.db_path(), &key)?;
    db::ensure_schema(&conn)?; // idempotent; also applies future additions
    *state
        .db
        .lock()
        .map_err(|_| "Internal state error".to_string())? = Some(conn);
    Ok(())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> Result<(), String> {
    // Dropping the connection closes the database; the derived key inside
    // SQLCipher is wiped (cipher_memory_security = ON).
    let mut guard = state
        .db
        .lock()
        .map_err(|_| "Internal state error".to_string())?;
    *guard = None;
    Ok(())
}

/// Confirm the master password without touching the open session. Used as a
/// re-authentication gate before revealing bank credentials in the UI.
/// Derives the key (Argon2id) and test-opens the database read-only.
#[tauri::command]
pub fn verify_master_password(
    state: State<'_, AppState>,
    password: String,
) -> Result<bool, String> {
    let meta = crypto::load_meta(&state.meta_path())?;
    let key = match crypto::derive_key(&password, &meta.kdf) {
        Ok(k) => k,
        Err(_) => return Ok(false),
    };
    Ok(db::open_encrypted(&state.db_path(), &key).is_ok())
}

/// Re-encrypt the database under a key derived from a new password, using
/// SQLCipher's `sqlcipher_export` (the supported way to rekey a WAL database):
/// export into a fresh file keyed with the new key, then atomically swap files.
#[tauri::command]
pub fn change_master_password(
    state: State<'_, AppState>,
    current: String,
    new: String,
) -> Result<(), String> {
    if new.chars().count() < 8 {
        return Err("New master password must be at least 8 characters".into());
    }
    let db_path = state.db_path();
    let meta_path = state.meta_path();

    // 1. Verify the current password with an independent connection.
    let meta = crypto::load_meta(&meta_path)?;
    let cur_key = crypto::derive_key(&current, &meta.kdf)?;
    let verify_conn = db::open_encrypted(&db_path, &cur_key)?;

    // 2. Export the whole database into a new file under the new key.
    let new_meta = crypto::new_meta();
    let new_key = crypto::derive_key(&new, &new_meta.kdf)?;
    let export_path = db_path.with_extension("db.rekey");
    let _ = std::fs::remove_file(&export_path);
    let export_str = export_path.to_string_lossy().replace('\'', "''");
    let new_hex = hex::encode(new_key.as_ref());
    verify_conn
        .execute_batch(&format!(
            "ATTACH DATABASE '{export_str}' AS rekeyed KEY \"x'{new_hex}'\";\n\
             SELECT sqlcipher_export('rekeyed');\n\
             DETACH DATABASE rekeyed;"
        ))
        .map_err(|e| format!("Re-encryption failed: {e}"))?;
    drop(verify_conn);

    // 3. Swap files while no connection is open.
    let mut guard = state
        .db
        .lock()
        .map_err(|_| "Internal state error".to_string())?;
    *guard = None; // close the live connection
    let backup_path = db_path.with_extension("db.old");
    let _ = std::fs::remove_file(&backup_path);
    std::fs::rename(&db_path, &backup_path).map_err(|e| format!("Swap failed: {e}"))?;
    if let Err(e) = std::fs::rename(&export_path, &db_path) {
        // Roll back so the vault still opens with the old password.
        let _ = std::fs::rename(&backup_path, &db_path);
        return Err(format!("Swap failed: {e}"));
    }
    // Remove stale WAL/SHM belonging to the old file.
    for suffix in ["-wal", "-shm"] {
        let mut p = db_path.as_os_str().to_owned();
        p.push(suffix);
        let _ = std::fs::remove_file(std::path::PathBuf::from(p));
    }
    crypto::save_meta(&meta_path, &new_meta)?;

    // 4. Reopen under the new key.
    let conn = db::open_encrypted(&db_path, &new_key)?;
    db::ensure_schema(&conn)?;
    *guard = Some(conn);
    let _ = std::fs::remove_file(&backup_path);
    Ok(())
}
