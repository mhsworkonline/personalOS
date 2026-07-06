//! Vault: encrypted credential storage. Secret values live in the `fields`
//! JSON blob and are only returned by `vault_get` (never by the list query).
//! The search index stores name/username/url/notes — never secrets.
//! Every item belongs to a person (default "Me").

use super::with_db;
use crate::db::{self, index_record, log_activity, sync_timeline, unindex_record};
use crate::models::{VaultItem, VaultItemInput, VaultItemMeta};
use crate::AppState;
use rusqlite::{params, Connection, Row};
use tauri::State;

pub const CATEGORIES: [&str; 7] = [
    "login",
    "api_key",
    "ssh_key",
    "license",
    "recovery_codes",
    "wifi",
    "secure_note",
];

fn item_from_row(r: &Row) -> rusqlite::Result<VaultItem> {
    let fields_raw: String = r.get(3)?;
    Ok(VaultItem {
        id: r.get(0)?,
        category: r.get(1)?,
        name: r.get(2)?,
        fields: serde_json::from_str(&fields_raw).unwrap_or(serde_json::json!({})),
        url: r.get(4)?,
        notes: r.get(5)?,
        expires_at: r.get(6)?,
        person_id: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

const ITEM_COLS: &str =
    "id, category, name, fields, url, notes, expires_at, person_id, created_at, updated_at";

fn field_str(fields: &serde_json::Value, key: &str) -> Option<String> {
    fields
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn to_meta(it: VaultItem) -> VaultItemMeta {
    VaultItemMeta {
        id: it.id,
        category: it.category,
        name: it.name,
        username: field_str(&it.fields, "username"),
        url: it.url,
        expires_at: it.expires_at,
        person_id: it.person_id,
        updated_at: it.updated_at,
    }
}

/// Metas for one person (person dashboard) — secrets never included.
pub fn vault_metas_for(conn: &Connection, person: Option<i64>) -> Result<Vec<VaultItemMeta>, String> {
    let sql = match person {
        Some(_) => format!("SELECT {ITEM_COLS} FROM vault_items WHERE person_id = ?1 ORDER BY name COLLATE NOCASE"),
        None => format!("SELECT {ITEM_COLS} FROM vault_items ORDER BY name COLLATE NOCASE"),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = match person {
        Some(pid) => stmt.query_map(params![pid], item_from_row),
        None => stmt.query_map([], item_from_row),
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items.into_iter().map(to_meta).collect())
}

#[tauri::command]
pub fn vault_list(
    state: State<'_, AppState>,
    category: Option<String>,
    query: Option<String>,
) -> Result<Vec<VaultItemMeta>, String> {
    with_db(&state, |conn| {
        let mut sql = format!("SELECT {ITEM_COLS} FROM vault_items");
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(cat) = &category {
            sql.push_str(" WHERE category = ?1");
            params_vec.push(Box::new(cat.clone()));
        }
        sql.push_str(" ORDER BY name COLLATE NOCASE ASC");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        let items = stmt
            .query_map(refs.as_slice(), item_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let q = query.unwrap_or_default().to_lowercase();
        let metas = items
            .into_iter()
            .filter(|it| {
                if q.is_empty() {
                    return true;
                }
                let username = field_str(&it.fields, "username").unwrap_or_default();
                it.name.to_lowercase().contains(&q)
                    || username.to_lowercase().contains(&q)
                    || it.url.as_deref().unwrap_or("").to_lowercase().contains(&q)
                    || it.notes.as_deref().unwrap_or("").to_lowercase().contains(&q)
            })
            .map(to_meta)
            .collect();
        Ok(metas)
    })
}

#[tauri::command]
pub fn vault_get(state: State<'_, AppState>, id: i64) -> Result<VaultItem, String> {
    with_db(&state, |conn| {
        conn.query_row(
            &format!("SELECT {ITEM_COLS} FROM vault_items WHERE id = ?1"),
            params![id],
            item_from_row,
        )
        .map_err(|_| "Vault item not found".to_string())
    })
}

fn index_vault_item(conn: &Connection, item: &VaultItem) -> Result<(), String> {
    // Deliberately excludes secret values (passwords, keys, codes).
    let body = format!(
        "{} {} {} {}",
        item.category,
        field_str(&item.fields, "username").unwrap_or_default(),
        item.url.as_deref().unwrap_or(""),
        item.notes.as_deref().unwrap_or("")
    );
    index_record(conn, "vault", item.id, &item.name, body.trim(), item.person_id)
}

#[tauri::command]
pub fn vault_save(state: State<'_, AppState>, input: VaultItemInput) -> Result<VaultItem, String> {
    if input.name.trim().is_empty() {
        return Err("Name must not be empty".into());
    }
    if !CATEGORIES.contains(&input.category.as_str()) {
        return Err(format!("Unknown category: {}", input.category));
    }
    if !input.fields.is_object() {
        return Err("Fields must be an object".into());
    }
    with_db(&state, |conn| {
        let now = db::now();
        let name = input.name.trim().to_string();
        let fields_raw = serde_json::to_string(&input.fields).map_err(|e| e.to_string())?;
        let person_id = match input.person_id {
            Some(p) => p,
            None => db::default_person_id(conn)?,
        };
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE vault_items SET category = ?1, name = ?2, fields = ?3, url = ?4,
                     notes = ?5, expires_at = ?6, person_id = ?7, updated_at = ?8 WHERE id = ?9",
                    params![
                        input.category, name, fields_raw, input.url, input.notes,
                        input.expires_at, person_id, now, id
                    ],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO vault_items (category, name, fields, url, notes, expires_at, person_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                    params![input.category, name, fields_raw, input.url, input.notes, input.expires_at, person_id, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        let item = conn
            .query_row(
                &format!("SELECT {ITEM_COLS} FROM vault_items WHERE id = ?1"),
                params![id],
                item_from_row,
            )
            .map_err(|e| e.to_string())?;
        index_vault_item(conn, &item)?;
        sync_timeline(
            conn,
            "vault",
            id,
            "expiration",
            &format!("{} expires", item.name),
            item.expires_at.as_deref(),
            None,
            item.person_id,
        )?;
        log_activity(
            conn,
            "vault",
            if input.id.is_some() { "updated" } else { "added" },
            &item.name,
            Some(id),
        )?;
        Ok(item)
    })
}

#[tauri::command]
pub fn vault_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let name: Option<String> = conn
            .query_row(
                "SELECT name FROM vault_items WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        conn.execute("DELETE FROM vault_items WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        unindex_record(conn, "vault", id)?;
        sync_timeline(conn, "vault", id, "expiration", "", None, None, None)?;
        if let Some(n) = name {
            log_activity(conn, "vault", "deleted", &n, None)?;
        }
        Ok(())
    })
}
