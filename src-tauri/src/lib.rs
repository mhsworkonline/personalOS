mod commands;
mod crypto;
mod db;
mod models;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("personalos.db")
    }
    pub fn meta_path(&self) -> PathBuf {
        self.data_dir.join("personalos.meta.json")
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(AppState {
                db: Mutex::new(None),
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::vault_status,
            commands::auth::setup_vault,
            commands::auth::unlock_vault,
            commands::auth::lock_vault,
            commands::auth::verify_master_password,
            commands::auth::change_master_password,
            commands::tasks::get_dashboard,
            commands::tasks::task_save,
            commands::tasks::task_toggle,
            commands::tasks::task_delete,
            commands::tasks::quick_note_create,
            commands::tasks::quick_note_delete,
            commands::timeline::timeline_upcoming,
            commands::timeline::reminder_create,
            commands::timeline::timeline_delete,
            commands::people::person_list,
            commands::people::person_save,
            commands::people::person_photo,
            commands::people::person_set_photo,
            commands::people::person_related_counts,
            commands::people::person_delete,
            commands::people::person_overview,
            commands::documents::document_list,
            commands::documents::document_save,
            commands::documents::document_delete,
            commands::documents::document_file_add,
            commands::documents::document_file_data,
            commands::documents::document_file_export,
            commands::documents::document_file_delete,
            commands::doclib::document_scan,
            commands::doclib::document_import,
            commands::doclib::document_link_repair,
            commands::doclib::document_link_refresh,
            commands::doclib::document_link_delete,
            commands::doclib::document_link_path,
            commands::doclib::document_link_open,
            commands::doclib::document_folder_map_set,
            commands::doclib::document_folder_map_list,
            commands::vault::vault_list,
            commands::vault::vault_get,
            commands::vault::vault_save,
            commands::vault::vault_delete,
            commands::finance::finance_overview,
            commands::finance::finance_charts,
            commands::finance::category_list,
            commands::finance::category_create,
            commands::finance::category_rename,
            commands::finance::category_delete,
            commands::finance::account_list,
            commands::finance::account_save,
            commands::finance::account_related_counts,
            commands::finance::account_delete,
            commands::finance::transaction_list,
            commands::finance::transaction_save,
            commands::finance::transaction_delete,
            commands::finance::transaction_transfer,
            commands::finance::subscription_list,
            commands::finance::subscription_save,
            commands::finance::subscription_advance,
            commands::finance::subscription_delete,
            commands::finance::emi_list,
            commands::finance::emi_save,
            commands::finance::emi_mark_paid,
            commands::finance::emi_delete,
            commands::investments::investment_list,
            commands::investments::investment_detail,
            commands::investments::investment_save,
            commands::investments::investment_related_counts,
            commands::investments::investment_delete,
            commands::investments::investment_transaction_list,
            commands::investments::investment_transaction_save,
            commands::investments::investment_transaction_delete,
            commands::investments::rent_schedule_save,
            commands::investments::rent_schedule_mark_paid,
            commands::investments::rent_schedule_delete,
            commands::notes::folder_list,
            commands::notes::folder_create,
            commands::notes::folder_rename,
            commands::notes::folder_delete,
            commands::notes::note_list,
            commands::notes::note_get,
            commands::notes::note_save,
            commands::notes::note_delete,
            commands::notes::note_set_reminder,
            commands::notes::tag_list,
            commands::search::universal_search,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::backup::export_backup,
            commands::backup::import_backup,
            commands::backup::data_file_info,
            commands::backup::auto_backup_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PersonalOS");
}

// ---------------------------------------------------------------------------
// Integration tests for the encrypted data layer. These run headless
// (`cargo test`) and exercise: key derivation, encrypted open/lock/reopen,
// wrong-password rejection, schema + v1→v2 migration, FTS search (including
// person-based search), timeline sync, and document storage.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::params;

    fn open_fresh(dir: &std::path::Path, password: &str) -> (Connection, crypto::MetaFile) {
        let meta = crypto::new_meta();
        let key = crypto::derive_key(password, &meta.kdf).unwrap();
        let conn = db::open_encrypted(&dir.join("test.db"), &key).unwrap();
        db::ensure_schema(&conn).unwrap();
        (conn, meta)
    }

    #[test]
    fn encrypted_at_rest_and_wrong_password_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let (conn, meta) = open_fresh(dir.path(), "correct horse");
        let me: i64 = conn
            .query_row("SELECT id FROM persons WHERE is_default = 1", [], |r| r.get(0))
            .unwrap();
        conn.execute(
            "INSERT INTO notes (title, content, pinned, person_id, created_at, updated_at)
             VALUES ('secret plans', 'the treasure is buried here', 0, ?1, '2026-01-01', '2026-01-01')",
            params![me],
        )
        .unwrap();
        drop(conn);

        // File must not look like plain SQLite and must not leak plaintext.
        let raw = std::fs::read(dir.path().join("test.db")).unwrap();
        assert!(!raw.starts_with(b"SQLite format 3"));
        let hay = String::from_utf8_lossy(&raw);
        assert!(!hay.contains("treasure"));
        assert!(!hay.contains("secret plans"));

        // Wrong password must fail; right one must read the row back.
        let bad_key = crypto::derive_key("wrong password", &meta.kdf).unwrap();
        assert!(db::open_encrypted(&dir.path().join("test.db"), &bad_key).is_err());
        let key = crypto::derive_key("correct horse", &meta.kdf).unwrap();
        let conn = db::open_encrypted(&dir.path().join("test.db"), &key).unwrap();
        let title: String = conn
            .query_row("SELECT title FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "secret plans");
    }

    /// Build a database with the exact v1 (pre-person) schema, fill it with
    /// data, then run `ensure_schema` and prove the migration: "Me" exists,
    /// every record is backfilled to it, nothing is lost, and search finds
    /// old records via the new person tokens.
    #[test]
    fn v1_database_migrates_to_person_model_without_data_loss() {
        let dir = tempfile::tempdir().unwrap();
        let meta = crypto::new_meta();
        let key = crypto::derive_key("migrate-me", &meta.kdf).unwrap();
        let conn = db::open_encrypted(&dir.path().join("v1.db"), &key).unwrap();
        // v1 schema: no persons/documents tables, no person_id/details columns,
        // FTS without the person column.
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, due_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE quick_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, created_at TEXT NOT NULL);
             CREATE TABLE vault_items (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, name TEXT NOT NULL, fields TEXT NOT NULL DEFAULT '{}', url TEXT, notes TEXT, expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, kind TEXT NOT NULL, amount REAL NOT NULL, category TEXT, description TEXT, date TEXT NOT NULL, created_at TEXT NOT NULL);
             CREATE TABLE subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, cycle TEXT NOT NULL DEFAULT 'monthly', next_renewal TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE emis (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, lender TEXT, monthly_amount REAL NOT NULL DEFAULT 0, total_months INTEGER NOT NULL DEFAULT 0, months_paid INTEGER NOT NULL DEFAULT 0, next_due TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE folders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
             CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
             CREATE TABLE note_tags (note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (note_id, tag_id));
             CREATE TABLE timeline_events (id INTEGER PRIMARY KEY AUTOINCREMENT, source_module TEXT NOT NULL, source_id INTEGER, kind TEXT NOT NULL, title TEXT NOT NULL, event_date TEXT NOT NULL, amount REAL, notes TEXT, created_at TEXT NOT NULL);
             CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, action TEXT NOT NULL, title TEXT NOT NULL, record_id INTEGER, created_at TEXT NOT NULL);
             CREATE VIRTUAL TABLE search_index USING fts5(title, body, module UNINDEXED, record_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4');
             INSERT INTO tasks (title, done, due_date, created_at, updated_at) VALUES ('Buy milk', 0, '2026-08-01', 'x', 'x');
             INSERT INTO vault_items (category, name, fields, created_at, updated_at) VALUES ('login', 'GitHub', '{\"username\":\"mhs\",\"password\":\"S3CR3T\"}', 'x', 'x');
             INSERT INTO accounts (name, kind, balance, created_at, updated_at) VALUES ('HDFC Savings', 'bank', 48800.0, 'x', 'x');
             INSERT INTO transactions (account_id, kind, amount, category, date, created_at) VALUES (1, 'expense', 1200.0, 'groceries', '2026-07-06', 'x');
             INSERT INTO subscriptions (name, amount, cycle, next_renewal, created_at, updated_at) VALUES ('Netflix', 649.0, 'monthly', '2026-08-06', 'x', 'x');
             INSERT INTO notes (title, content, pinned, created_at, updated_at) VALUES ('Server setup', 'install nginx', 1, 'x', 'x');
             INSERT INTO timeline_events (source_module, source_id, kind, title, event_date, created_at) VALUES ('subscriptions', 1, 'renewal', 'Netflix renews', '2026-08-06', 'x');",
        )
        .unwrap();
        drop(conn);

        // Reopen exactly like unlock does: migrations run.
        let conn = db::open_encrypted(&dir.path().join("v1.db"), &key).unwrap();
        db::ensure_schema(&conn).unwrap();

        // "Me" exists and is the default.
        let (me, name): (i64, String) = conn
            .query_row(
                "SELECT id, full_name FROM persons WHERE is_default = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, "Me");

        // Every record survived and belongs to "Me".
        for (table, expected) in [
            ("tasks", 1i64),
            ("vault_items", 1),
            ("accounts", 1),
            ("subscriptions", 1),
            ("notes", 1),
            ("timeline_events", 1),
        ] {
            let (count, owned): (i64, i64) = conn
                .query_row(
                    &format!("SELECT COUNT(*), COUNT(CASE WHEN person_id = {me} THEN 1 END) FROM {table}"),
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!((count, owned), (expected, expected), "table {table}");
        }
        // Non-person tables intact too.
        let txs: i64 = conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(txs, 1);
        // Opening balance is backfilled from the v1 balance minus the net
        // effect of transactions already recorded, so the live balance the
        // user sees doesn't jump: 48800 balance - (-1200 expense) = 50000.
        let (balance, opening): (f64, f64) = conn
            .query_row("SELECT balance, opening_balance FROM accounts WHERE name = 'HDFC Savings'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(balance, 48800.0);
        assert_eq!(opening, 50000.0);
        // Secrets untouched by migration.
        let secret: String = conn
            .query_row("SELECT json_extract(fields, '$.password') FROM vault_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(secret, "S3CR3T");

        // The rebuilt index finds old records by person ("self" relationship).
        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM search_index WHERE search_index MATCH '\"self\"* \"netflix\"*'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
        // Migration is idempotent.
        db::ensure_schema(&conn).unwrap();
        let people: i64 = conn.query_row("SELECT COUNT(*) FROM persons", [], |r| r.get(0)).unwrap();
        assert_eq!(people, 1);
    }

    #[test]
    fn person_search_documents_and_timeline() {
        let dir = tempfile::tempdir().unwrap();
        let (conn, _) = open_fresh(dir.path(), "pw123456");
        conn.execute(
            "INSERT INTO persons (full_name, nickname, relationship, is_default, created_at, updated_at)
             VALUES ('Ramesh Kumar', 'Papa', 'father', 0, 'x', 'x')",
            [],
        )
        .unwrap();
        let father = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO documents (person_id, doc_type, doc_number, name_on_document, expiry_date, created_at, updated_at)
             VALUES (?1, 'passport', 'PP998877', 'Ramesh Kumar', '2027-01-15', 'x', 'x')",
            params![father],
        )
        .unwrap();
        let doc = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO subscriptions (name, amount, cycle, next_renewal, person_id, created_at, updated_at)
             VALUES ('Health insurance', 500, 'monthly', '2026-08-01', ?1, 'x', 'x')",
            params![father],
        )
        .unwrap();
        db::rebuild_search_index(&conn).unwrap();
        db::sync_timeline(&conn, "documents", doc, "document_expiration",
            "Ramesh Kumar: Passport expires", Some("2027-01-15"), None, Some(father)).unwrap();

        // Searching the relationship word surfaces all of Father's records.
        let hits: Vec<(String, i64)> = conn
            .prepare("SELECT module, record_id FROM search_index WHERE search_index MATCH '\"father\"*' ORDER BY module")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let modules: Vec<&str> = hits.iter().map(|(m, _)| m.as_str()).collect();
        assert!(modules.contains(&"documents"), "documents in {modules:?}");
        assert!(modules.contains(&"subscriptions"), "subscriptions in {modules:?}");
        assert!(modules.contains(&"person"), "person in {modules:?}");
        // The document number must never be searchable.
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM search_index WHERE search_index MATCH '\"PP998877\"*'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
        // Document expiry landed on the shared timeline, linked to Father.
        let (kind, pid): (String, i64) = conn
            .query_row(
                "SELECT kind, person_id FROM timeline_events WHERE source_module = 'documents'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((kind.as_str(), pid), ("document_expiration", father));
        // Syncing again does not duplicate.
        db::sync_timeline(&conn, "documents", doc, "document_expiration",
            "Ramesh Kumar: Passport expires", Some("2027-02-15"), None, Some(father)).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM timeline_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn search_index_rebuild_never_indexes_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let (conn, _) = open_fresh(dir.path(), "pw123456");
        let me: i64 = conn
            .query_row("SELECT id FROM persons WHERE is_default = 1", [], |r| r.get(0))
            .unwrap();
        conn.execute(
            "INSERT INTO vault_items (category, name, fields, url, person_id, created_at, updated_at)
             VALUES ('login', 'Proton', '{\"username\":\"mhs\",\"password\":\"SUPERSECRET\"}', 'https://proton.me', ?1, '2026-01-01', '2026-01-01')",
            params![me],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO accounts (name, kind, balance, person_id, details, created_at, updated_at)
             VALUES ('HDFC Salary', 'bank', 1000, ?1,
             '{\"ifsc\":\"HDFC0001\",\"netbanking\":{\"password\":\"NETSECRET\",\"login_id\":\"LOGIN77\"},\"mobile\":{\"mpin\":\"991122\"}}',
             '2026-01-01', '2026-01-01')",
            params![me],
        )
        .unwrap();
        db::rebuild_search_index(&conn).unwrap();
        // Username and IFSC are searchable…
        for term in ["\"mhs\"*", "\"HDFC0001\"*"] {
            let n: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM search_index WHERE search_index MATCH '{term}'"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "expected hit for {term}");
        }
        // …but secrets, credentials and MPINs are never indexed.
        for term in ["\"SUPERSECRET\"*", "\"NETSECRET\"*", "\"991122\"*", "\"LOGIN77\"*"] {
            let n: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM search_index WHERE search_index MATCH '{term}'"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 0, "expected no hit for {term}");
        }
    }

    #[test]
    fn fts_search_and_timeline_sync() {
        let dir = tempfile::tempdir().unwrap();
        let (conn, _) = open_fresh(dir.path(), "pw123456");

        db::index_record(&conn, "notes", 1, "Server setup checklist", "install nginx and postgres", None).unwrap();
        db::index_record(&conn, "vault", 2, "GitHub", "login user mhs", None).unwrap();

        let hits: Vec<(String, i64)> = conn
            .prepare("SELECT module, record_id FROM search_index WHERE search_index MATCH ?1 ORDER BY rank")
            .unwrap()
            .query_map(params![db::fts_query("postg").unwrap()], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(hits, vec![("notes".to_string(), 1)]);

        // Timeline upsert: one event per (module, id, kind); None deletes.
        db::sync_timeline(&conn, "subscriptions", 7, "renewal", "Netflix renews", Some("2026-08-01"), Some(9.99), None).unwrap();
        db::sync_timeline(&conn, "subscriptions", 7, "renewal", "Netflix renews", Some("2026-09-01"), Some(9.99), None).unwrap();
        let (count, date): (i64, String) = conn
            .query_row(
                "SELECT COUNT(*), MAX(event_date) FROM timeline_events WHERE source_module='subscriptions'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((count, date.as_str()), (1, "2026-09-01"));
        db::sync_timeline(&conn, "subscriptions", 7, "renewal", "", None, None, None).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM timeline_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
