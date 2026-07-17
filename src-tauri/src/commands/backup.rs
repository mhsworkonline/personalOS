//! Encrypted backups: a JSON dump of every table, encrypted with
//! XChaCha20-Poly1305 under a key derived from a backup password (see
//! crypto.rs and SECURITY.md). Import wipes current data, restores the dump,
//! re-runs migrations (so v1 backups gain "Me" and person links) and rebuilds
//! the FTS index. BLOBs (photos, document files) are encoded as
//! `{"__blob__": "<base64>"}` markers so they survive the JSON roundtrip.

use super::with_db;
use crate::{crypto, AppState};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use tauri::State;

/// Insert order respects foreign keys; deletes run in reverse.
/// `persons` first — nearly everything references it; `investments` before
/// `documents` since a document may reference its property.
const TABLES: [&str; 21] = [
    "settings",
    "persons",
    "investments",
    "investment_transactions",
    "investment_rent_schedules",
    "tasks",
    "quick_notes",
    "vault_items",
    "accounts",
    "transaction_categories",
    "transactions",
    "subscriptions",
    "emis",
    "folders",
    "notes",
    "tags",
    "note_tags",
    "documents",
    "document_files",
    "timeline_events",
    "activity_log",
];

fn dump_table(conn: &Connection, table: &str) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {table}"))
        .map_err(|e| e.to_string())?;
    let cols: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let mut rows_out = Vec::new();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut obj = Map::new();
        for (i, col) in cols.iter().enumerate() {
            let v = match row.get_ref(i).map_err(|e| e.to_string())? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                ValueRef::Blob(b) => json!({ "__blob__": B64.encode(b) }),
            };
            obj.insert(col.clone(), v);
        }
        rows_out.push(Value::Object(obj));
    }
    Ok(Value::Array(rows_out))
}

fn json_to_sql(v: &Value) -> Result<rusqlite::types::Value, String> {
    use rusqlite::types::Value as Sv;
    Ok(match v {
        Value::Null => Sv::Null,
        Value::Bool(b) => Sv::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Sv::Integer(i)
            } else {
                Sv::Real(n.as_f64().ok_or("Bad number in backup")?)
            }
        }
        Value::String(s) => Sv::Text(s.clone()),
        Value::Object(o) => {
            let Some(Value::String(b64)) = o.get("__blob__") else {
                return Err("Unsupported value type in backup".into());
            };
            Sv::Blob(B64.decode(b64).map_err(|_| "Corrupt blob in backup")?)
        }
        _ => return Err("Unsupported value type in backup".into()),
    })
}

fn restore_table(conn: &Connection, table: &str, rows: &Value) -> Result<usize, String> {
    let Some(rows) = rows.as_array() else {
        return Ok(0);
    };
    let mut count = 0;
    for row in rows {
        let Some(obj) = row.as_object() else { continue };
        let cols: Vec<&String> = obj.keys().collect();
        for c in &cols {
            if !c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
                return Err(format!("Invalid column name in backup: {c}"));
            }
        }
        let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "INSERT INTO {table} ({}) VALUES ({})",
            cols.iter()
                .map(|c| format!("\"{c}\""))
                .collect::<Vec<_>>()
                .join(", "),
            placeholders.join(", ")
        );
        let values: Vec<rusqlite::types::Value> = obj
            .values()
            .map(json_to_sql)
            .collect::<Result<Vec<_>, _>>()?;
        let refs: Vec<&dyn rusqlite::ToSql> =
            values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        conn.execute(&sql, refs.as_slice())
            .map_err(|e| format!("Restore failed on {table}: {e}"))?;
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
pub fn export_backup(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> Result<String, String> {
    if password.chars().count() < 8 {
        return Err("Backup password must be at least 8 characters".into());
    }
    with_db(&state, |conn| {
        let mut tables = Map::new();
        for t in TABLES {
            tables.insert(t.to_string(), dump_table(conn, t)?);
        }
        let payload = json!({
            "format": "personalos-backup",
            "version": 2,
            "exported_at": crate::db::now(),
            "tables": Value::Object(tables),
        });
        let plaintext = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
        let encrypted = crypto::encrypt_backup(&password, &plaintext)?;
        std::fs::write(&path, encrypted).map_err(|e| format!("Cannot write backup: {e}"))?;
        Ok(format!("Backup written to {path}"))
    })
}

#[tauri::command]
pub fn import_backup(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> Result<HashMap<String, usize>, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Cannot read backup: {e}"))?;
    let plaintext = crypto::decrypt_backup(&password, &data)?;
    let payload: Value =
        serde_json::from_slice(&plaintext).map_err(|_| "Corrupt backup contents".to_string())?;
    if payload.get("format").and_then(|v| v.as_str()) != Some("personalos-backup") {
        return Err("Not a PersonalOS backup".into());
    }
    let tables = payload
        .get("tables")
        .and_then(|v| v.as_object())
        .ok_or("Corrupt backup contents")?;

    with_db(&state, |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for t in TABLES.iter().rev() {
            tx.execute(&format!("DELETE FROM {t}"), [])
                .map_err(|e| e.to_string())?;
        }
        let mut counts = HashMap::new();
        for t in TABLES {
            if let Some(rows) = tables.get(t) {
                counts.insert(t.to_string(), restore_table(&tx, t, rows)?);
            }
        }
        // Re-run migrations inside the transaction: a v1 backup (no persons)
        // gains "Me", person_id backfill and a rebuilt search index.
        crate::db::ensure_schema(&tx)?;
        crate::db::rebuild_search_index(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(counts)
    })
}

const AUTO_BACKUP_KEEP: usize = 7;

/// Local daily backup, no password prompt: checkpoints the WAL into the main
/// db file, then copies that file (still SQLCipher-encrypted under the same
/// master password — never plaintext) into `<data_dir>/backups/`. Runs at
/// most once per calendar day; keeps the last `AUTO_BACKUP_KEEP` copies.
/// Controlled by the `auto_backup_enabled` setting (default on).
#[tauri::command]
pub fn auto_backup_run(state: State<'_, AppState>) -> Result<Option<String>, String> {
    with_db(&state, |conn| {
        let enabled: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'auto_backup_enabled'",
                [],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "1".into());
        if enabled == "0" {
            return Ok(None);
        }
        let today = crate::db::today();
        let last: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'last_auto_backup'",
                [],
                |r| r.get(0),
            )
            .ok();
        if last.as_deref() == Some(today.as_str()) {
            return Ok(None);
        }

        let dir = state.data_dir.join("backups");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(format!("auto-{today}.db"));
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("Checkpoint failed: {e}"))?;
        std::fs::copy(state.db_path(), &dest).map_err(|e| format!("Auto backup failed: {e}"))?;

        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('last_auto_backup', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![today],
        )
        .map_err(|e| e.to_string())?;

        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("auto-"))
            .collect();
        files.sort_by_key(|e| e.file_name());
        while files.len() > AUTO_BACKUP_KEEP {
            let f = files.remove(0);
            let _ = std::fs::remove_file(f.path());
        }
        Ok(Some(dest.to_string_lossy().to_string()))
    })
}

#[tauri::command]
pub fn data_file_info(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    out.insert(
        "db_path".into(),
        state.db_path().to_string_lossy().to_string(),
    );
    out.insert(
        "meta_path".into(),
        state.meta_path().to_string_lossy().to_string(),
    );
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{crypto, db};

    /// Full export→encrypt→decrypt→restore roundtrip between two separately
    /// encrypted databases, exactly as the export/import commands do it —
    /// including BLOB survival (document files) and person links.
    #[test]
    fn backup_roundtrip_between_encrypted_databases() {
        let dir = tempfile::tempdir().unwrap();
        let open = |name: &str, pw: &str| {
            let meta = crypto::new_meta();
            let key = crypto::derive_key(pw, &meta.kdf).unwrap();
            let conn = db::open_encrypted(&dir.path().join(name), &key).unwrap();
            db::ensure_schema(&conn).unwrap();
            conn
        };
        let src = open("a.db", "password-one");
        let me: i64 = src
            .query_row("SELECT id FROM persons WHERE is_default = 1", [], |r| r.get(0))
            .unwrap();
        src.execute_batch(&format!(
            "INSERT INTO notes (title, content, pinned, person_id, created_at, updated_at)
               VALUES ('Roadmap', 'ship the backup feature', 1, {me}, '2026-01-01', '2026-01-01');
             INSERT INTO vault_items (category, name, fields, person_id, created_at, updated_at)
               VALUES ('login', 'GitHub', '{{\"username\":\"mhs\",\"password\":\"TOPSECRET\"}}', {me}, '2026-01-01', '2026-01-01');
             INSERT INTO documents (person_id, doc_type, doc_number, expiry_date, created_at, updated_at)
               VALUES ({me}, 'passport', 'P1234567', '2030-01-01', '2026-01-01', '2026-01-01');"
        ))
        .unwrap();
        let blob: Vec<u8> = vec![0x25, 0x50, 0x44, 0x46, 0x00, 0xFF, 0x01]; // "%PDF" + binary
        src.execute(
            "INSERT INTO document_files (document_id, kind, filename, mime, data, created_at)
             VALUES (1, 'attachment', 'scan.pdf', 'application/pdf', ?1, '2026-01-01')",
            rusqlite::params![blob],
        )
        .unwrap();

        // Export (same code path as the export_backup command)
        let mut tables = Map::new();
        for t in TABLES {
            tables.insert(t.to_string(), dump_table(&src, t).unwrap());
        }
        let payload = json!({ "format": "personalos-backup", "version": 2, "tables": Value::Object(tables) });
        let encrypted =
            crypto::encrypt_backup("backup-pass", &serde_json::to_vec(&payload).unwrap()).unwrap();
        let file = dir.path().join("backup.posb");
        std::fs::write(&file, &encrypted).unwrap();

        // The backup file itself must not leak plaintext.
        let raw = std::fs::read(&file).unwrap();
        let hay = String::from_utf8_lossy(&raw);
        assert!(!hay.contains("TOPSECRET") && !hay.contains("Roadmap") && !hay.contains("P1234567"));

        // Import into a fresh database with a different master password.
        let dst = open("b.db", "password-two");
        let decrypted = crypto::decrypt_backup("backup-pass", &std::fs::read(&file).unwrap()).unwrap();
        let payload: Value = serde_json::from_slice(&decrypted).unwrap();
        let tables = payload["tables"].as_object().unwrap();
        let tx = dst.unchecked_transaction().unwrap();
        for t in TABLES.iter().rev() {
            tx.execute(&format!("DELETE FROM {t}"), []).unwrap();
        }
        for t in TABLES {
            if let Some(rows) = tables.get(t) {
                restore_table(&tx, t, rows).unwrap();
            }
        }
        db::ensure_schema(&tx).unwrap();
        db::rebuild_search_index(&tx).unwrap();
        tx.commit().unwrap();

        // Person-linked data intact.
        let (title, person_id): (String, i64) = dst
            .query_row("SELECT title, person_id FROM notes", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(title, "Roadmap");
        let is_default: bool = dst
            .query_row("SELECT is_default FROM persons WHERE id = ?1", [person_id], |r| r.get(0))
            .unwrap();
        assert!(is_default);
        // Secret intact.
        let secret: String = dst
            .query_row(
                "SELECT json_extract(fields, '$.password') FROM vault_items",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(secret, "TOPSECRET");
        // BLOB intact byte-for-byte.
        let restored: Vec<u8> = dst
            .query_row("SELECT data FROM document_files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(restored, blob);
        // Search index rebuilt.
        let hits: i64 = dst
            .query_row(
                "SELECT COUNT(*) FROM search_index WHERE search_index MATCH '\"roadm\"*'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
        assert!(crypto::decrypt_backup("wrong-pass", &raw).is_err());
    }
}
