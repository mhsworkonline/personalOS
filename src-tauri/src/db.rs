//! Encrypted SQLite (SQLCipher) database: open/verify, schema, migrations,
//! and the shared helpers used by every module (search index, timeline sync,
//! activity log).
//!
//! ## Person-centric model
//! `persons` is the primary domain table. Personal records (vault items,
//! bank accounts, notes, tasks, subscriptions, documents, timeline events)
//! carry a `person_id`. The first person, "Me", is created automatically and
//! marked `is_default`; migrations backfill every pre-existing record to it.

use chrono::{Days, Local, Months, NaiveDate};
use rusqlite::{params, Connection};
use std::path::Path;

pub fn now() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

pub fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

/// Advance a YYYY-MM-DD date by one billing cycle.
pub fn advance_date(date: &str, cycle: &str) -> Result<String, String> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|e| format!("Bad date: {e}"))?;
    let next = match cycle {
        "weekly" => d.checked_add_days(Days::new(7)),
        "monthly" => d.checked_add_months(Months::new(1)),
        "quarterly" => d.checked_add_months(Months::new(3)),
        "yearly" => d.checked_add_months(Months::new(12)),
        other => return Err(format!("Unknown cycle: {other}")),
    }
    .ok_or("Date overflow")?;
    Ok(next.format("%Y-%m-%d").to_string())
}

/// Open the encrypted database. Fails with a clean message on a wrong key.
pub fn open_encrypted(path: &Path, key: &[u8; 32]) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("Cannot open database: {e}"))?;
    let hexkey = hex::encode(key);
    // Raw 32-byte key: SQLCipher skips its own KDF and uses the key directly.
    // cipher_memory_security makes SQLCipher zero its internal buffers.
    conn.execute_batch(&format!(
        "PRAGMA key = \"x'{hexkey}'\";\nPRAGMA cipher_memory_security = ON;"
    ))
    .map_err(|e| format!("Cannot key database: {e}"))?;
    // First real read fails if the key is wrong.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| "Invalid master password".to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;\nPRAGMA foreign_keys = ON;\nPRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| format!("Cannot configure database: {e}"))?;
    Ok(conn)
}

/// Create base schema (fresh installs) and bring older databases up to date.
/// Idempotent; called on every setup/unlock/import.
pub fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA).map_err(|e| format!("Schema error: {e}"))?;
    run_migrations(conn)
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  nickname TEXT,
  relationship TEXT NOT NULL DEFAULT 'other',
  dob TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  photo BLOB,
  photo_mime TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  person_id INTEGER REFERENCES persons(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quick_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  url TEXT,
  notes TEXT,
  expires_at TEXT,
  person_id INTEGER REFERENCES persons(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  opening_balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  person_id INTEGER REFERENCES persons(id),
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT,
  description TEXT,
  date TEXT NOT NULL,
  transfer_peer_id INTEGER REFERENCES transactions(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transaction_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  cycle TEXT NOT NULL DEFAULT 'monthly',
  next_renewal TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  person_id INTEGER REFERENCES persons(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lender TEXT,
  monthly_amount REAL NOT NULL DEFAULT 0,
  total_months INTEGER NOT NULL DEFAULT 0,
  months_paid INTEGER NOT NULL DEFAULT 0,
  next_due TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  investment_id INTEGER REFERENCES investments(id),
  settle_account_id INTEGER REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  person_id INTEGER REFERENCES persons(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES persons(id),
  doc_type TEXT NOT NULL,
  doc_number TEXT,
  name_on_document TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  issuing_authority TEXT,
  notes TEXT,
  investment_id INTEGER REFERENCES investments(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  address TEXT,
  notes TEXT,
  person_id INTEGER REFERENCES persons(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investment_id INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  counterparty TEXT,
  notes TEXT,
  settle_account_id INTEGER REFERENCES accounts(id),
  linked_transaction_id INTEGER REFERENCES transactions(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investment_rent_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investment_id INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  monthly_amount REAL NOT NULL DEFAULT 0,
  next_due TEXT NOT NULL,
  tenant_name TEXT,
  notes TEXT,
  settle_account_id INTEGER REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- Documents that stay as real files on disk. The app stores only a pointer
-- (path relative to the `documents_root` setting) plus a content hash, and
-- never writes into that folder — delete the app and the files are untouched.
-- Separate from document_files (whose BLOBs are embedded and encrypted) so
-- existing embedded attachments keep working unchanged.
CREATE TABLE IF NOT EXISTS document_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Remembers that the folder "moksh" means person #3, so every later scan
-- assigns new files in it automatically instead of asking again.
CREATE TABLE IF NOT EXISTS document_folder_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder TEXT NOT NULL UNIQUE COLLATE NOCASE,
  person_id INTEGER NOT NULL REFERENCES persons(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_module TEXT NOT NULL,
  source_id INTEGER,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  amount REAL,
  notes TEXT,
  person_id INTEGER REFERENCES persons(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_source
  ON timeline_events(source_module, source_id, kind);
CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline_events(event_date);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  record_id INTEGER,
  created_at TEXT NOT NULL
);
"#;

// ---------------------------------------------------------------------------
// Migrations (bring a pre-person database up to date without data loss)
// ---------------------------------------------------------------------------

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let cols = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(cols.iter().any(|c| c == column))
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','virtual table') AND name = ?1",
            params![table],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// Tables that carry a person_id and are backfilled to the default person.
const PERSON_OWNED: [&str; 6] = [
    "tasks",
    "vault_items",
    "accounts",
    "notes",
    "subscriptions",
    "timeline_events",
];

fn run_migrations(conn: &Connection) -> Result<(), String> {
    let mut changed = false;

    // v1 → v2: add person_id to existing tables.
    for table in PERSON_OWNED {
        if !has_column(conn, table, "person_id")? {
            conn.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN person_id INTEGER REFERENCES persons(id);"
            ))
            .map_err(|e| format!("Migration failed on {table}: {e}"))?;
            changed = true;
        }
    }
    // v1 → v2: structured bank details on accounts.
    if !has_column(conn, "accounts", "details")? {
        conn.execute_batch("ALTER TABLE accounts ADD COLUMN details TEXT NOT NULL DEFAULT '{}';")
            .map_err(|e| format!("Migration failed on accounts.details: {e}"))?;
        changed = true;
    }

    // Opening balance: a fixed reference point separate from the live
    // balance, so it can be edited any time (e.g. it was entered wrong)
    // without needing fake historical transactions. Backfill recovers the
    // implied opening balance from today's balance minus the net effect of
    // every transaction already recorded, so existing balances don't jump.
    if !has_column(conn, "accounts", "opening_balance")? {
        conn.execute_batch("ALTER TABLE accounts ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0;")
            .map_err(|e| format!("Migration failed on accounts.opening_balance: {e}"))?;
        conn.execute_batch(
            "UPDATE accounts SET opening_balance = balance - COALESCE((
                SELECT SUM(CASE WHEN t.kind IN ('expense','transfer_out') THEN -t.amount ELSE t.amount END)
                FROM transactions t WHERE t.account_id = accounts.id
             ), 0);",
        )
        .map_err(|e| format!("Migration failed backfilling accounts.opening_balance: {e}"))?;
        changed = true;
    }

    // Investments module: optional link from a document to the property it belongs to.
    if table_exists(conn, "documents")? && !has_column(conn, "documents", "investment_id")? {
        conn.execute_batch(
            "ALTER TABLE documents ADD COLUMN investment_id INTEGER REFERENCES investments(id);",
        )
        .map_err(|e| format!("Migration failed on documents.investment_id: {e}"))?;
        changed = true;
    }

    // Cash-on-hand tracking: investment transactions/tenancies can optionally
    // settle to a Finance account, and transfers between accounts link their
    // two legs together.
    if table_exists(conn, "investment_transactions")? {
        if !has_column(conn, "investment_transactions", "settle_account_id")? {
            conn.execute_batch(
                "ALTER TABLE investment_transactions ADD COLUMN settle_account_id INTEGER REFERENCES accounts(id);",
            )
            .map_err(|e| format!("Migration failed on investment_transactions.settle_account_id: {e}"))?;
            changed = true;
        }
        if !has_column(conn, "investment_transactions", "linked_transaction_id")? {
            conn.execute_batch(
                "ALTER TABLE investment_transactions ADD COLUMN linked_transaction_id INTEGER REFERENCES transactions(id);",
            )
            .map_err(|e| format!("Migration failed on investment_transactions.linked_transaction_id: {e}"))?;
            changed = true;
        }
    }
    if table_exists(conn, "investment_rent_schedules")?
        && !has_column(conn, "investment_rent_schedules", "settle_account_id")?
    {
        conn.execute_batch(
            "ALTER TABLE investment_rent_schedules ADD COLUMN settle_account_id INTEGER REFERENCES accounts(id);",
        )
        .map_err(|e| format!("Migration failed on investment_rent_schedules.settle_account_id: {e}"))?;
        changed = true;
    }
    if table_exists(conn, "transactions")? && !has_column(conn, "transactions", "transfer_peer_id")? {
        conn.execute_batch(
            "ALTER TABLE transactions ADD COLUMN transfer_peer_id INTEGER REFERENCES transactions(id);",
        )
        .map_err(|e| format!("Migration failed on transactions.transfer_peer_id: {e}"))?;
        changed = true;
    }

    // EMIs can optionally finance a property and settle payments to an account.
    if table_exists(conn, "emis")? {
        if !has_column(conn, "emis", "investment_id")? {
            conn.execute_batch("ALTER TABLE emis ADD COLUMN investment_id INTEGER REFERENCES investments(id);")
                .map_err(|e| format!("Migration failed on emis.investment_id: {e}"))?;
            changed = true;
        }
        if !has_column(conn, "emis", "settle_account_id")? {
            conn.execute_batch("ALTER TABLE emis ADD COLUMN settle_account_id INTEGER REFERENCES accounts(id);")
                .map_err(|e| format!("Migration failed on emis.settle_account_id: {e}"))?;
            changed = true;
        }
    }

    // Finance categories: a managed pick-list instead of free text. First run
    // seeds it from whatever category strings already appear in transactions,
    // plus a handful of sensible defaults, so the dropdown isn't empty and no
    // existing data is orphaned. `transactions.category` itself stays a plain
    // TEXT column (no FK) so deleting a category never touches past entries.
    if table_exists(conn, "transaction_categories")? {
        let existing: i64 = conn
            .query_row("SELECT COUNT(*) FROM transaction_categories", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if existing == 0 {
            let now = now();
            let mut seen = std::collections::HashSet::new();
            let used: Vec<String> = {
                let mut stmt = conn
                    .prepare(
                        "SELECT DISTINCT TRIM(category) FROM transactions
                         WHERE category IS NOT NULL AND TRIM(category) != ''",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([], |r| r.get::<_, String>(0))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                rows
            };
            const DEFAULTS: [&str; 10] = [
                "Food", "Household", "Travel", "Bills", "Salary", "Shopping", "Healthcare", "Rent",
                "Entertainment", "Misc",
            ];
            for name in used.into_iter().chain(DEFAULTS.iter().map(|s| s.to_string())) {
                let key = name.to_lowercase();
                if seen.insert(key) {
                    conn.execute(
                        "INSERT OR IGNORE INTO transaction_categories (name, created_at) VALUES (?1, ?2)",
                        params![name, now],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            changed = true;
        }
    }

    // v1 → v2: search index gains a person display column (FTS5 tables cannot
    // be ALTERed — drop and rebuild below).
    if table_exists(conn, "search_index")? && !has_column(conn, "search_index", "person")? {
        conn.execute_batch("DROP TABLE search_index;")
            .map_err(|e| format!("Migration failed on search_index: {e}"))?;
        changed = true;
    }
    if !table_exists(conn, "search_index")? {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE search_index USING fts5(
               title, body, module UNINDEXED, record_id UNINDEXED, person UNINDEXED,
               tokenize = 'unicode61 remove_diacritics 2',
               prefix = '2 3 4'
             );",
        )
        .map_err(|e| format!("Migration failed creating search_index: {e}"))?;
        changed = true;
    }

    // Documents now index their linked filenames and title themselves by
    // filename rather than by type label. Anything indexed under the old shape
    // is stale, so force exactly one rebuild.
    const INDEX_VERSION: &str = "3";
    let index_version: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'index_version'", [], |r| r.get(0))
        .ok();
    if index_version.as_deref() != Some(INDEX_VERSION) {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('index_version', ?1)",
            params![INDEX_VERSION],
        )
        .map_err(|e| format!("Migration failed setting index_version: {e}"))?;
        changed = true;
    }

    // The default person "Me" always exists.
    let me = ensure_default_person(conn)?;

    // Every pre-existing (or imported v1) record belongs to "Me".
    for table in PERSON_OWNED {
        let n = conn
            .execute(
                &format!("UPDATE {table} SET person_id = ?1 WHERE person_id IS NULL"),
                params![me],
            )
            .map_err(|e| format!("Backfill failed on {table}: {e}"))?;
        if n > 0 {
            changed = true;
        }
    }

    if changed {
        rebuild_search_index(conn)?;
    }
    Ok(())
}

pub fn ensure_default_person(conn: &Connection) -> Result<i64, String> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM persons WHERE is_default = 1 ORDER BY id LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    if let Some(id) = existing {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO persons (full_name, relationship, is_default, created_at, updated_at)
         VALUES ('Me', 'self', 1, ?1, ?1)",
        params![now()],
    )
    .map_err(|e| format!("Cannot create default person: {e}"))?;
    Ok(conn.last_insert_rowid())
}

pub fn default_person_id(conn: &Connection) -> Result<i64, String> {
    ensure_default_person(conn)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// Display name + extra searchable tokens (nickname, relationship) for a
/// person, so "Father" or a nickname instantly matches every owned record.
pub fn person_search_info(
    conn: &Connection,
    person_id: Option<i64>,
) -> Result<(Option<String>, String), String> {
    let Some(pid) = person_id else {
        return Ok((None, String::new()));
    };
    let row: Option<(String, Option<String>, String)> = conn
        .query_row(
            "SELECT full_name, nickname, relationship FROM persons WHERE id = ?1",
            params![pid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    match row {
        Some((name, nickname, relationship)) => {
            let tokens = format!("{} {} {}", name, nickname.as_deref().unwrap_or(""), relationship);
            Ok((Some(name), tokens))
        }
        None => Ok((None, String::new())),
    }
}

pub fn index_record(
    conn: &Connection,
    module: &str,
    record_id: i64,
    title: &str,
    body: &str,
    person_id: Option<i64>,
) -> Result<(), String> {
    unindex_record(conn, module, record_id)?;
    let (person_name, tokens) = person_search_info(conn, person_id)?;
    let body = format!("{body} {tokens}");
    conn.execute(
        "INSERT INTO search_index (title, body, module, record_id, person) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![title, body.trim(), module, record_id, person_name],
    )
    .map_err(|e| format!("Search index error: {e}"))?;
    Ok(())
}

pub fn unindex_record(conn: &Connection, module: &str, record_id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM search_index WHERE module = ?1 AND record_id = ?2",
        params![module, record_id],
    )
    .map_err(|e| format!("Search index error: {e}"))?;
    Ok(())
}

/// Keep exactly one timeline event per (module, source_id, kind).
/// Passing `date = None` removes the event.
pub fn sync_timeline(
    conn: &Connection,
    module: &str,
    source_id: i64,
    kind: &str,
    title: &str,
    date: Option<&str>,
    amount: Option<f64>,
    person_id: Option<i64>,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM timeline_events WHERE source_module = ?1 AND source_id = ?2 AND kind = ?3",
        params![module, source_id, kind],
    )
    .map_err(|e| format!("Timeline error: {e}"))?;
    if let Some(d) = date {
        conn.execute(
            "INSERT INTO timeline_events (source_module, source_id, kind, title, event_date, amount, person_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![module, source_id, kind, title, d, amount, person_id, now()],
        )
        .map_err(|e| format!("Timeline error: {e}"))?;
    }
    Ok(())
}

pub fn log_activity(
    conn: &Connection,
    module: &str,
    action: &str,
    title: &str,
    record_id: Option<i64>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO activity_log (module, action, title, record_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![module, action, title, record_id, now()],
    )
    .map_err(|e| format!("Activity log error: {e}"))?;
    // Cap the log so it never grows unbounded.
    conn.execute(
        "DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 300)",
        [],
    )
    .map_err(|e| format!("Activity log error: {e}"))?;
    Ok(())
}

/// Build an FTS5 MATCH expression: every whitespace-separated token becomes a
/// quoted prefix query ("tok"*), AND-combined. Returns None for empty input.
pub fn fts_query(input: &str) -> Option<String> {
    let tokens: Vec<String> = input
        .split_whitespace()
        .map(|t| t.replace('"', ""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

/// Human label for a document type (used in titles and the search index).
pub fn doc_type_label(t: &str) -> &'static str {
    match t {
        "aadhaar" => "Aadhaar",
        "pan" => "PAN",
        "passport" => "Passport",
        "driving_licence" => "Driving Licence",
        "voter_id" => "Voter ID",
        "birth_certificate" => "Birth Certificate",
        "insurance" => "Insurance",
        "health_card" => "Health Card",
        "pension_card" => "Pension Card",
        "tax" => "Tax Document",
        "education" => "Education",
        "bank" => "Bank Document",
        "legal" => "Legal Document",
        _ => "Document",
    }
}

/// Rebuild the FTS index from scratch, mirroring what each module indexes.
/// Secret values (passwords, keys, PINs, document numbers) are never indexed.
pub fn rebuild_search_index(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM search_index", [])
        .map_err(|e| e.to_string())?;

    type Row = (i64, String, String, Option<i64>);
    let collect = |sql: &str| -> Result<Vec<Row>, String> {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    };

    let sets: Vec<(&str, Vec<Row>)> = vec![
        (
            "person",
            collect(
                "SELECT id, full_name,
                 COALESCE(nickname,'') || ' ' || relationship || ' ' || COALESCE(phone,'') || ' ' ||
                 COALESCE(email,'') || ' ' || COALESCE(notes,''), id FROM persons",
            )?,
        ),
        ("tasks", collect("SELECT id, title, '', person_id FROM tasks")?),
        ("quick", collect("SELECT id, content, '', NULL FROM quick_notes")?),
        (
            "vault",
            collect(
                "SELECT id, name, category || ' ' ||
                 COALESCE(json_extract(fields, '$.username'), '') || ' ' ||
                 COALESCE(url, '') || ' ' || COALESCE(notes, ''), person_id FROM vault_items",
            )?,
        ),
        (
            "accounts",
            collect(
                "SELECT id, name, kind || ' ' || COALESCE(notes, '') || ' ' ||
                 COALESCE(json_extract(details, '$.bank_name'), '') || ' ' ||
                 COALESCE(json_extract(details, '$.branch'), '') || ' ' ||
                 COALESCE(json_extract(details, '$.ifsc'), ''), person_id FROM accounts",
            )?,
        ),
        (
            "transactions",
            collect(
                "SELECT t.id, COALESCE(NULLIF(t.description, ''), t.kind || ' ' || COALESCE(t.category, 'transaction')),
                 COALESCE(t.category, '') || ' ' || a.name, a.person_id
                 FROM transactions t JOIN accounts a ON a.id = t.account_id",
            )?,
        ),
        (
            "subscriptions",
            collect("SELECT id, name, 'subscription ' || COALESCE(notes, ''), person_id FROM subscriptions")?,
        ),
        (
            "emis",
            collect(
                "SELECT id, name, 'emi loan ' || COALESCE(lender, '') || ' ' || COALESCE(notes, ''), NULL FROM emis",
            )?,
        ),
        (
            "notes",
            collect(
                "SELECT n.id, n.title, n.content || ' ' ||
                 COALESCE((SELECT group_concat(t.name, ' ') FROM tags t
                           JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = n.id), ''), n.person_id
                 FROM notes n",
            )?,
        ),
        (
            "documents",
            collect(
                "SELECT d.id,
                 COALESCE(NULLIF(TRIM(d.notes),''), NULLIF(TRIM(d.name_on_document),''), d.doc_type),
                 'document ' || d.doc_type || ' ' || COALESCE(d.issuing_authority,'') || ' '
                   || COALESCE(d.notes,'') || ' '
                   || COALESCE((SELECT group_concat(l.filename, ' ') FROM document_links l
                                WHERE l.document_id = d.id), ''),
                 d.person_id
                 FROM documents d",
            )?,
        ),
        (
            "investments",
            collect(
                "SELECT id, name, kind || ' ' || COALESCE(address,'') || ' ' || COALESCE(notes,''), person_id
                 FROM investments",
            )?,
        ),
        (
            "investment_transactions",
            collect(
                "SELECT it.id, COALESCE(NULLIF(it.counterparty,''), it.kind || ' ' || i.name),
                 it.kind || ' ' || COALESCE(it.notes,'') || ' ' || i.name, i.person_id
                 FROM investment_transactions it JOIN investments i ON i.id = it.investment_id",
            )?,
        ),
        (
            "reminder",
            collect(
                "SELECT id, title, COALESCE(notes, ''), person_id FROM timeline_events WHERE source_module = 'reminder'",
            )?,
        ),
    ];
    for (module, rows) in sets {
        for (id, title, body, person_id) in rows {
            if module == "documents" {
                // Title uses the human label, e.g. "Aadhaar — Ramesh".
                let (doc_type, rest) = title.split_once(' ').unwrap_or((title.as_str(), ""));
                let label = doc_type_label(doc_type);
                let display = if rest.trim().is_empty() {
                    label.to_string()
                } else {
                    format!("{label} — {}", rest.trim())
                };
                index_record(conn, module, id, &display, &format!("{doc_type} {body}"), person_id)?;
            } else if module == "person" {
                // A person's own index row must not link to another person.
                index_record(conn, module, id, &title, &body, person_id)?;
            } else {
                index_record(conn, module, id, &title, body.trim(), person_id)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advance_date_cycles() {
        assert_eq!(advance_date("2026-01-31", "monthly").unwrap(), "2026-02-28");
        assert_eq!(advance_date("2026-07-01", "weekly").unwrap(), "2026-07-08");
        assert_eq!(advance_date("2026-07-06", "quarterly").unwrap(), "2026-10-06");
        assert_eq!(advance_date("2026-07-06", "yearly").unwrap(), "2027-07-06");
        assert!(advance_date("garbage", "monthly").is_err());
    }

    #[test]
    fn fts_query_building() {
        assert_eq!(fts_query("hello wor"), Some("\"hello\"* \"wor\"*".into()));
        assert_eq!(fts_query("  "), None);
        assert_eq!(fts_query("a\"b"), Some("\"ab\"*".into()));
    }
}
