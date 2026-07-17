//! Finance: accounts, manual transactions, subscriptions, EMIs, net worth.
//! Accounts and subscriptions belong to a person (default "Me"). Bank
//! accounts carry a structured `details` JSON blob (branch, IFSC, net-banking
//! credentials, cards, …) stored inside the SQLCipher-encrypted database —
//! the same strategy as vault `fields`. ATM PINs, CVVs, UPI PINs and OTPs are
//! rejected outright and can never be stored.

use super::with_db;
use crate::db::{self, advance_date, index_record, log_activity, sync_timeline, unindex_record};
use crate::models::{
    Account, AccountInput, CategorySpend, Emi, EmiInput, FinanceCharts, FinanceOverview, KindTotal,
    MonthlyFlow, Subscription, SubscriptionInput, Transaction, TransactionCategory, TransactionInput,
    TransferInput, TransferResult,
};
use crate::AppState;
use rusqlite::{params, Connection, Row};
use std::collections::HashMap;
use tauri::State;

pub const ACCOUNT_KINDS: [&str; 4] = ["bank", "cash", "credit_card", "investment"];

/// Keys that must never be stored anywhere, per the security policy.
const FORBIDDEN_DETAIL_KEYS: [&str; 6] = ["cvv", "atm_pin", "upi_pin", "otp", "pin_atm", "card_pin"];

// ---------------------------------------------------------------------------
// Transaction categories (managed pick-list; transactions.category stays a
// plain TEXT column, so deleting a category never touches past entries)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn category_list(state: State<'_, AppState>) -> Result<Vec<TransactionCategory>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, name FROM transaction_categories ORDER BY name COLLATE NOCASE")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok(TransactionCategory { id: r.get(0)?, name: r.get(1)? }))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn category_create(state: State<'_, AppState>, name: String) -> Result<TransactionCategory, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Category name must not be empty".into());
    }
    with_db(&state, |conn| {
        conn.execute(
            "INSERT INTO transaction_categories (name, created_at) VALUES (?1, ?2)",
            params![name, db::now()],
        )
        .map_err(|_| "A category with that name already exists".to_string())?;
        Ok(TransactionCategory { id: conn.last_insert_rowid(), name })
    })
}

#[tauri::command]
pub fn category_rename(state: State<'_, AppState>, id: i64, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Category name must not be empty".into());
    }
    with_db(&state, |conn| {
        conn.execute("UPDATE transaction_categories SET name = ?1 WHERE id = ?2", params![name, id])
            .map_err(|_| "A category with that name already exists".to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn category_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        // Past transactions keep their stored category text unchanged — it's
        // a plain column, not a foreign key.
        conn.execute("DELETE FROM transaction_categories WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

fn account_from_row(r: &Row) -> rusqlite::Result<Account> {
    let details_raw: String = r.get(7)?;
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        balance: r.get(3)?,
        opening_balance: r.get(4)?,
        notes: r.get(5)?,
        person_id: r.get(6)?,
        details: serde_json::from_str(&details_raw).unwrap_or(serde_json::json!({})),
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

const ACCOUNT_COLS: &str =
    "id, name, kind, balance, opening_balance, notes, person_id, details, created_at, updated_at";

pub fn accounts_for(conn: &Connection, person: Option<i64>) -> Result<Vec<Account>, String> {
    let sql = match person {
        Some(_) => format!("SELECT {ACCOUNT_COLS} FROM accounts WHERE person_id = ?1 ORDER BY kind, name COLLATE NOCASE"),
        None => format!("SELECT {ACCOUNT_COLS} FROM accounts ORDER BY kind, name COLLATE NOCASE"),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = match person {
        Some(pid) => stmt.query_map(params![pid], account_from_row),
        None => stmt.query_map([], account_from_row),
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn account_list(state: State<'_, AppState>) -> Result<Vec<Account>, String> {
    with_db(&state, |conn| accounts_for(conn, None))
}

/// Recursively reject any forbidden key (CVV, ATM PIN, UPI PIN, OTP).
fn check_forbidden(value: &serde_json::Value) -> Result<(), String> {
    match value {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                let key = k.to_lowercase().replace([' ', '-'], "_");
                if FORBIDDEN_DETAIL_KEYS.contains(&key.as_str()) {
                    return Err(format!(
                        "Refusing to store “{k}” — ATM PINs, CVVs, UPI PINs and OTPs must never be saved"
                    ));
                }
                check_forbidden(v)?;
            }
        }
        serde_json::Value::Array(items) => {
            for v in items {
                check_forbidden(v)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn account_save(state: State<'_, AppState>, input: AccountInput) -> Result<Account, String> {
    if input.name.trim().is_empty() {
        return Err("Account name must not be empty".into());
    }
    if !ACCOUNT_KINDS.contains(&input.kind.as_str()) {
        return Err(format!("Unknown account type: {}", input.kind));
    }
    if !input.details.is_object() {
        return Err("Details must be an object".into());
    }
    check_forbidden(&input.details)?;
    with_db(&state, |conn| {
        let now = db::now();
        let name = input.name.trim().to_string();
        let details_raw = serde_json::to_string(&input.details).map_err(|e| e.to_string())?;
        let person_id = match input.person_id {
            Some(p) => p,
            None => db::default_person_id(conn)?,
        };
        let id = match input.id {
            Some(id) => {
                // Editing the opening balance shifts the live balance by the
                // same delta rather than replacing it outright, so every
                // transaction recorded since account creation stays intact.
                let (old_balance, old_opening): (f64, f64) = conn
                    .query_row(
                        "SELECT balance, opening_balance FROM accounts WHERE id = ?1",
                        params![id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .map_err(|_| "Account not found".to_string())?;
                let new_balance = old_balance + (input.opening_balance - old_opening);
                conn.execute(
                    "UPDATE accounts SET name = ?1, kind = ?2, balance = ?3, opening_balance = ?4,
                     notes = ?5, person_id = ?6, details = ?7, updated_at = ?8 WHERE id = ?9",
                    params![name, input.kind, new_balance, input.opening_balance, input.notes, person_id, details_raw, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                // A brand-new account has no transactions yet, so its live
                // balance starts out equal to the opening balance.
                conn.execute(
                    "INSERT INTO accounts (name, kind, balance, opening_balance, notes, person_id, details, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?7)",
                    params![name, input.kind, input.opening_balance, input.notes, person_id, details_raw, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        let account = conn
            .query_row(
                &format!("SELECT {ACCOUNT_COLS} FROM accounts WHERE id = ?1"),
                params![id],
                account_from_row,
            )
            .map_err(|e| e.to_string())?;
        // Index only non-secret fields: never credentials, MPINs or numbers.
        let d = &account.details;
        let idx = |k: &str| d.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        index_record(
            conn,
            "accounts",
            id,
            &account.name,
            &format!(
                "{} {} {} {} {}",
                account.kind,
                account.notes.as_deref().unwrap_or(""),
                idx("bank_name"),
                idx("branch"),
                idx("ifsc")
            ),
            account.person_id,
        )?;
        log_activity(
            conn,
            "finance",
            if input.id.is_some() { "updated account" } else { "added account" },
            &account.name,
            Some(id),
        )?;
        Ok(account)
    })
}

/// What deleting this account would affect, so the UI can show an impact
/// summary before the user confirms (mirrors `investments::investment_related_counts`).
#[tauri::command]
pub fn account_related_counts(state: State<'_, AppState>, id: i64) -> Result<HashMap<String, i64>, String> {
    with_db(&state, |conn| {
        let mut out = HashMap::new();
        for (label, sql) in [
            ("transactions", "SELECT COUNT(*) FROM transactions WHERE account_id = ?1"),
            ("investment_transactions", "SELECT COUNT(*) FROM investment_transactions WHERE settle_account_id = ?1"),
            ("rent_schedules", "SELECT COUNT(*) FROM investment_rent_schedules WHERE settle_account_id = ?1"),
            ("emis", "SELECT COUNT(*) FROM emis WHERE settle_account_id = ?1"),
        ] {
            let n: i64 = conn.query_row(sql, params![id], |r| r.get(0)).map_err(|e| e.to_string())?;
            if n > 0 {
                out.insert(label.to_string(), n);
            }
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn account_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| delete_account(conn, id))
}

fn delete_account(conn: &Connection, id: i64) -> Result<(), String> {
    let name: Option<String> = conn
        .query_row("SELECT name FROM accounts WHERE id = ?1", params![id], |r| r.get(0))
        .ok();

    // Delete this account's own transactions through the shared helper
    // (not a bare cascade) so any investment_transactions.linked_transaction_id
    // references and transfer peers (which may belong to another account)
    // are cleared safely first.
    let tx_ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM transactions WHERE account_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    for tx_id in tx_ids {
        if let Some(peer_id) = delete_transaction_row(conn, tx_id)? {
            delete_transaction_row(conn, peer_id)?;
        }
    }

    // Detach investment/rent/EMI records that settled via this account —
    // their own history stays, they just lose the "via account" link.
    conn.execute(
        "UPDATE investment_transactions SET settle_account_id = NULL WHERE settle_account_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE investment_rent_schedules SET settle_account_id = NULL WHERE settle_account_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("UPDATE emis SET settle_account_id = NULL WHERE settle_account_id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    unindex_record(conn, "accounts", id)?;
    if let Some(n) = name {
        log_activity(conn, "finance", "deleted account", &n, None)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Transactions (manual entry; create/delete adjust the account balance)
// ---------------------------------------------------------------------------

fn tx_from_row(r: &Row) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: r.get(0)?,
        account_id: r.get(1)?,
        account_name: r.get(2)?,
        kind: r.get(3)?,
        amount: r.get(4)?,
        category: r.get(5)?,
        description: r.get(6)?,
        date: r.get(7)?,
        transfer_peer_id: r.get(8)?,
        created_at: r.get(9)?,
    })
}

const TX_SELECT: &str = "SELECT t.id, t.account_id, a.name, t.kind, t.amount, t.category,
    t.description, t.date, t.transfer_peer_id, t.created_at
    FROM transactions t JOIN accounts a ON a.id = t.account_id";

fn tx_title(tx: &Transaction) -> String {
    tx.description
        .clone()
        .unwrap_or_else(|| format!("{} {}", tx.kind, tx.category.as_deref().unwrap_or("transaction")))
}

/// Insert one transaction row, adjust its account's balance, and index it.
/// Shared by manual entry (`transaction_create`), transfers between accounts,
/// and investment settlements (rent received / sale proceeds / purchase paid
/// from an account) — every real money movement goes through here so account
/// balances (in particular "cash on hand") stay correct from one place.
pub fn record_transaction(
    conn: &Connection,
    account_id: i64,
    kind: &str,
    amount: f64,
    category: Option<&str>,
    description: Option<&str>,
    date: &str,
    transfer_peer_id: Option<i64>,
) -> Result<Transaction, String> {
    let now = db::now();
    conn.execute(
        "INSERT INTO transactions (account_id, kind, amount, category, description, date, transfer_peer_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![account_id, kind, amount, category, description, date, transfer_peer_id, now],
    )
    .map_err(|e| format!("Cannot add transaction: {e}"))?;
    let id = conn.last_insert_rowid();
    let delta = if kind == "expense" || kind == "transfer_out" { -amount } else { amount };
    conn.execute(
        "UPDATE accounts SET balance = balance + ?1, updated_at = ?2 WHERE id = ?3",
        params![delta, now, account_id],
    )
    .map_err(|e| e.to_string())?;
    let tx = conn
        .query_row(&format!("{TX_SELECT} WHERE t.id = ?1"), params![id], tx_from_row)
        .map_err(|e| e.to_string())?;
    let person: Option<i64> = conn
        .query_row("SELECT person_id FROM accounts WHERE id = ?1", params![account_id], |r| r.get(0))
        .unwrap_or(None);
    index_record(
        conn,
        "transactions",
        id,
        &tx_title(&tx),
        &format!("{} {}", tx.category.as_deref().unwrap_or(""), tx.account_name),
        person,
    )?;
    Ok(tx)
}

/// Reverse the balance effect of one transaction row, delete it, and drop it
/// from the search index. Returns its `transfer_peer_id`, if any, so the
/// caller can decide whether to remove the paired leg of a transfer too.
pub fn delete_transaction_row(conn: &Connection, id: i64) -> Result<Option<i64>, String> {
    let row: Option<(i64, String, f64, Option<i64>)> = conn
        .query_row(
            "SELECT account_id, kind, amount, transfer_peer_id FROM transactions WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();
    let Some((account_id, kind, amount, transfer_peer_id)) = row else {
        return Ok(None);
    };
    let delta = if kind == "expense" || kind == "transfer_out" { amount } else { -amount };
    conn.execute(
        "UPDATE accounts SET balance = balance + ?1, updated_at = ?2 WHERE id = ?3",
        params![delta, db::now(), account_id],
    )
    .map_err(|e| e.to_string())?;
    // investment_transactions.linked_transaction_id points at rows here with
    // no ON DELETE action — clear the reference first or this delete trips
    // the foreign key whenever a settled investment transaction is involved.
    conn.execute(
        "UPDATE investment_transactions SET linked_transaction_id = NULL WHERE linked_transaction_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    // The other leg of a transfer points its own transfer_peer_id back at
    // this row (same self-referential FK, no ON DELETE action) — clear that
    // too or deleting either leg of a transfer trips the foreign key.
    conn.execute(
        "UPDATE transactions SET transfer_peer_id = NULL WHERE transfer_peer_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM transactions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    unindex_record(conn, "transactions", id)?;
    Ok(transfer_peer_id)
}

#[tauri::command]
pub fn transaction_list(
    state: State<'_, AppState>,
    account: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<Transaction>, String> {
    with_db(&state, |conn| {
        let limit = limit.unwrap_or(200).clamp(1, 1000);
        let (sql, binds): (String, Vec<Box<dyn rusqlite::ToSql>>) = match account {
            Some(aid) => (
                format!("{TX_SELECT} WHERE t.account_id = ?1 ORDER BY t.date DESC, t.id DESC LIMIT ?2"),
                vec![Box::new(aid), Box::new(limit)],
            ),
            None => (
                format!("{TX_SELECT} ORDER BY t.date DESC, t.id DESC LIMIT ?1"),
                vec![Box::new(limit)],
            ),
        };
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt
            .query_map(refs.as_slice(), tx_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

/// Create or edit a manual transaction. Transfer legs (which carry a
/// `transfer_peer_id`) can't be edited here — delete and recreate them via
/// `transaction_transfer` instead, since editing one leg would desync the pair.
#[tauri::command]
pub fn transaction_save(
    state: State<'_, AppState>,
    input: TransactionInput,
) -> Result<Transaction, String> {
    if input.amount <= 0.0 {
        return Err("Amount must be positive".into());
    }
    if input.kind != "expense" && input.kind != "income" {
        return Err("Transaction type must be income or expense".into());
    }
    chrono::NaiveDate::parse_from_str(&input.date, "%Y-%m-%d")
        .map_err(|_| "Date must be YYYY-MM-DD".to_string())?;
    with_db(&state, |conn| {
        let tx = match input.id {
            Some(id) => {
                let (old_account, old_kind, old_amount, transfer_peer): (i64, String, f64, Option<i64>) = conn
                    .query_row(
                        "SELECT account_id, kind, amount, transfer_peer_id FROM transactions WHERE id = ?1",
                        params![id],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    )
                    .map_err(|_| "Transaction not found".to_string())?;
                if transfer_peer.is_some() {
                    return Err("Transfers can't be edited — delete and recreate them instead".into());
                }
                let now = db::now();
                let reverse_delta = if old_kind == "expense" { old_amount } else { -old_amount };
                conn.execute(
                    "UPDATE accounts SET balance = balance + ?1, updated_at = ?2 WHERE id = ?3",
                    params![reverse_delta, now, old_account],
                )
                .map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE transactions SET account_id = ?1, kind = ?2, amount = ?3, category = ?4,
                     description = ?5, date = ?6 WHERE id = ?7",
                    params![input.account_id, input.kind, input.amount, input.category, input.description, input.date, id],
                )
                .map_err(|e| e.to_string())?;
                let new_delta = if input.kind == "expense" { -input.amount } else { input.amount };
                conn.execute(
                    "UPDATE accounts SET balance = balance + ?1, updated_at = ?2 WHERE id = ?3",
                    params![new_delta, now, input.account_id],
                )
                .map_err(|e| e.to_string())?;
                let tx = conn
                    .query_row(&format!("{TX_SELECT} WHERE t.id = ?1"), params![id], tx_from_row)
                    .map_err(|e| e.to_string())?;
                let person: Option<i64> = conn
                    .query_row("SELECT person_id FROM accounts WHERE id = ?1", params![input.account_id], |r| r.get(0))
                    .unwrap_or(None);
                index_record(
                    conn,
                    "transactions",
                    id,
                    &tx_title(&tx),
                    &format!("{} {}", tx.category.as_deref().unwrap_or(""), tx.account_name),
                    person,
                )?;
                tx
            }
            None => record_transaction(
                conn,
                input.account_id,
                &input.kind,
                input.amount,
                input.category.as_deref(),
                input.description.as_deref(),
                &input.date,
                None,
            )?,
        };
        log_activity(
            conn,
            "finance",
            if input.id.is_some() { "updated transaction" } else { "transaction" },
            &tx_title(&tx),
            Some(tx.id),
        )?;
        Ok(tx)
    })
}

#[tauri::command]
pub fn transaction_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        if let Some(peer_id) = delete_transaction_row(conn, id)? {
            delete_transaction_row(conn, peer_id)?;
        }
        Ok(())
    })
}

/// Move money between two accounts (e.g. a cash withdrawal from a bank
/// account). Creates a linked pair of transactions so both balances move
/// atomically; excluded from income/expense totals since nothing was earned
/// or spent — it's the same money, just in a different place.
#[tauri::command]
pub fn transaction_transfer(
    state: State<'_, AppState>,
    input: TransferInput,
) -> Result<TransferResult, String> {
    if input.amount <= 0.0 {
        return Err("Amount must be positive".into());
    }
    if input.from_account_id == input.to_account_id {
        return Err("Choose two different accounts".into());
    }
    chrono::NaiveDate::parse_from_str(&input.date, "%Y-%m-%d")
        .map_err(|_| "Date must be YYYY-MM-DD".to_string())?;
    with_db(&state, |conn| {
        let from_name: String = conn
            .query_row("SELECT name FROM accounts WHERE id = ?1", params![input.from_account_id], |r| r.get(0))
            .map_err(|_| "Source account not found".to_string())?;
        let to_name: String = conn
            .query_row("SELECT name FROM accounts WHERE id = ?1", params![input.to_account_id], |r| r.get(0))
            .map_err(|_| "Destination account not found".to_string())?;
        let suffix = input.notes.as_deref().map(|n| format!(" — {n}")).unwrap_or_default();

        let debit = record_transaction(
            conn,
            input.from_account_id,
            "transfer_out",
            input.amount,
            Some("Transfer"),
            Some(&format!("Transfer to {to_name}{suffix}")),
            &input.date,
            None,
        )?;
        let credit = record_transaction(
            conn,
            input.to_account_id,
            "transfer_in",
            input.amount,
            Some("Transfer"),
            Some(&format!("Transfer from {from_name}{suffix}")),
            &input.date,
            Some(debit.id),
        )?;
        conn.execute(
            "UPDATE transactions SET transfer_peer_id = ?1 WHERE id = ?2",
            params![credit.id, debit.id],
        )
        .map_err(|e| e.to_string())?;
        let debit = conn
            .query_row(&format!("{TX_SELECT} WHERE t.id = ?1"), params![debit.id], tx_from_row)
            .map_err(|e| e.to_string())?;

        log_activity(conn, "finance", "transfer", &format!("{from_name} → {to_name}"), Some(debit.id))?;
        Ok(TransferResult { debit, credit })
    })
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

fn sub_from_row(r: &Row) -> rusqlite::Result<Subscription> {
    Ok(Subscription {
        id: r.get(0)?,
        name: r.get(1)?,
        amount: r.get(2)?,
        cycle: r.get(3)?,
        next_renewal: r.get(4)?,
        active: r.get(5)?,
        notes: r.get(6)?,
        person_id: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

const SUB_COLS: &str =
    "id, name, amount, cycle, next_renewal, active, notes, person_id, created_at, updated_at";

fn sync_sub(conn: &Connection, sub: &Subscription) -> Result<(), String> {
    let date = if sub.active { Some(sub.next_renewal.as_str()) } else { None };
    sync_timeline(
        conn,
        "subscriptions",
        sub.id,
        "renewal",
        &format!("{} renews", sub.name),
        date,
        Some(sub.amount),
        sub.person_id,
    )
}

pub fn subscriptions_for(conn: &Connection, person: Option<i64>) -> Result<Vec<Subscription>, String> {
    let sql = match person {
        Some(_) => format!("SELECT {SUB_COLS} FROM subscriptions WHERE person_id = ?1 ORDER BY active DESC, next_renewal ASC"),
        None => format!("SELECT {SUB_COLS} FROM subscriptions ORDER BY active DESC, next_renewal ASC"),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = match person {
        Some(pid) => stmt.query_map(params![pid], sub_from_row),
        None => stmt.query_map([], sub_from_row),
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn subscription_list(state: State<'_, AppState>) -> Result<Vec<Subscription>, String> {
    with_db(&state, |conn| subscriptions_for(conn, None))
}

#[tauri::command]
pub fn subscription_save(
    state: State<'_, AppState>,
    input: SubscriptionInput,
) -> Result<Subscription, String> {
    if input.name.trim().is_empty() {
        return Err("Subscription name must not be empty".into());
    }
    advance_date(&input.next_renewal, &input.cycle)?; // validates both date and cycle
    with_db(&state, |conn| {
        let now = db::now();
        let name = input.name.trim().to_string();
        let person_id = match input.person_id {
            Some(p) => p,
            None => db::default_person_id(conn)?,
        };
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE subscriptions SET name = ?1, amount = ?2, cycle = ?3, next_renewal = ?4,
                     active = ?5, notes = ?6, person_id = ?7, updated_at = ?8 WHERE id = ?9",
                    params![name, input.amount, input.cycle, input.next_renewal, input.active, input.notes, person_id, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO subscriptions (name, amount, cycle, next_renewal, active, notes, person_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                    params![name, input.amount, input.cycle, input.next_renewal, input.active, input.notes, person_id, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        let sub = conn
            .query_row(
                &format!("SELECT {SUB_COLS} FROM subscriptions WHERE id = ?1"),
                params![id],
                sub_from_row,
            )
            .map_err(|e| e.to_string())?;
        sync_sub(conn, &sub)?;
        index_record(
            conn,
            "subscriptions",
            id,
            &sub.name,
            &format!("subscription {}", sub.notes.as_deref().unwrap_or("")),
            sub.person_id,
        )?;
        log_activity(
            conn,
            "finance",
            if input.id.is_some() { "updated subscription" } else { "added subscription" },
            &sub.name,
            Some(id),
        )?;
        Ok(sub)
    })
}

/// "Mark renewed": move next_renewal forward one cycle.
#[tauri::command]
pub fn subscription_advance(state: State<'_, AppState>, id: i64) -> Result<Subscription, String> {
    with_db(&state, |conn| {
        let sub = conn
            .query_row(
                &format!("SELECT {SUB_COLS} FROM subscriptions WHERE id = ?1"),
                params![id],
                sub_from_row,
            )
            .map_err(|_| "Subscription not found".to_string())?;
        let next = advance_date(&sub.next_renewal, &sub.cycle)?;
        conn.execute(
            "UPDATE subscriptions SET next_renewal = ?1, updated_at = ?2 WHERE id = ?3",
            params![next, db::now(), id],
        )
        .map_err(|e| e.to_string())?;
        let sub = conn
            .query_row(
                &format!("SELECT {SUB_COLS} FROM subscriptions WHERE id = ?1"),
                params![id],
                sub_from_row,
            )
            .map_err(|e| e.to_string())?;
        sync_sub(conn, &sub)?;
        log_activity(conn, "finance", "renewed", &sub.name, Some(id))?;
        Ok(sub)
    })
}

#[tauri::command]
pub fn subscription_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let name: Option<String> = conn
            .query_row("SELECT name FROM subscriptions WHERE id = ?1", params![id], |r| r.get(0))
            .ok();
        conn.execute("DELETE FROM subscriptions WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        unindex_record(conn, "subscriptions", id)?;
        sync_timeline(conn, "subscriptions", id, "renewal", "", None, None, None)?;
        if let Some(n) = name {
            log_activity(conn, "finance", "deleted subscription", &n, None)?;
        }
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// EMIs (household-level; not person-scoped)
// ---------------------------------------------------------------------------

fn emi_from_row(r: &Row) -> rusqlite::Result<Emi> {
    Ok(Emi {
        id: r.get(0)?,
        name: r.get(1)?,
        lender: r.get(2)?,
        monthly_amount: r.get(3)?,
        total_months: r.get(4)?,
        months_paid: r.get(5)?,
        next_due: r.get(6)?,
        active: r.get(7)?,
        notes: r.get(8)?,
        investment_id: r.get(9)?,
        settle_account_id: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

const EMI_COLS: &str = "id, name, lender, monthly_amount, total_months, months_paid, next_due, active, notes,
    investment_id, settle_account_id, created_at, updated_at";

/// EMIs financing a given property (shown on its detail page).
pub fn emis_for_investment(conn: &Connection, investment_id: i64) -> Result<Vec<Emi>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {EMI_COLS} FROM emis WHERE investment_id = ?1 ORDER BY active DESC, next_due ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![investment_id], emi_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn sync_emi(conn: &Connection, emi: &Emi) -> Result<(), String> {
    let date = if emi.active && emi.months_paid < emi.total_months {
        Some(emi.next_due.as_str())
    } else {
        None
    };
    sync_timeline(
        conn,
        "emis",
        emi.id,
        "emi",
        &format!("{} EMI due", emi.name),
        date,
        Some(emi.monthly_amount),
        None,
    )
}

#[tauri::command]
pub fn emi_list(state: State<'_, AppState>) -> Result<Vec<Emi>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {EMI_COLS} FROM emis ORDER BY active DESC, next_due ASC"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], emi_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn emi_save(state: State<'_, AppState>, input: EmiInput) -> Result<Emi, String> {
    if input.name.trim().is_empty() {
        return Err("EMI name must not be empty".into());
    }
    if input.total_months < 1 {
        return Err("Total months must be at least 1".into());
    }
    if input.months_paid < 0 || input.months_paid > input.total_months {
        return Err("Months paid must be between 0 and total months".into());
    }
    chrono::NaiveDate::parse_from_str(&input.next_due, "%Y-%m-%d")
        .map_err(|_| "Next due date must be YYYY-MM-DD".to_string())?;
    with_db(&state, |conn| {
        let now = db::now();
        let name = input.name.trim().to_string();
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE emis SET name = ?1, lender = ?2, monthly_amount = ?3, total_months = ?4,
                     months_paid = ?5, next_due = ?6, active = ?7, notes = ?8, investment_id = ?9,
                     settle_account_id = ?10, updated_at = ?11 WHERE id = ?12",
                    params![name, input.lender, input.monthly_amount, input.total_months,
                            input.months_paid, input.next_due, input.active, input.notes,
                            input.investment_id, input.settle_account_id, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO emis (name, lender, monthly_amount, total_months, months_paid, next_due, active, notes, investment_id, settle_account_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                    params![name, input.lender, input.monthly_amount, input.total_months,
                            input.months_paid, input.next_due, input.active, input.notes,
                            input.investment_id, input.settle_account_id, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        let emi = conn
            .query_row(
                &format!("SELECT {EMI_COLS} FROM emis WHERE id = ?1"),
                params![id],
                emi_from_row,
            )
            .map_err(|e| e.to_string())?;
        sync_emi(conn, &emi)?;
        index_record(
            conn,
            "emis",
            id,
            &emi.name,
            &format!("emi loan {} {}", emi.lender.as_deref().unwrap_or(""), emi.notes.as_deref().unwrap_or("")),
            None,
        )?;
        log_activity(
            conn,
            "finance",
            if input.id.is_some() { "updated EMI" } else { "added EMI" },
            &emi.name,
            Some(id),
        )?;
        Ok(emi)
    })
}

#[tauri::command]
pub fn emi_mark_paid(state: State<'_, AppState>, id: i64) -> Result<Emi, String> {
    with_db(&state, |conn| {
        let emi = conn
            .query_row(
                &format!("SELECT {EMI_COLS} FROM emis WHERE id = ?1"),
                params![id],
                emi_from_row,
            )
            .map_err(|_| "EMI not found".to_string())?;
        let months_paid = (emi.months_paid + 1).min(emi.total_months);
        let finished = months_paid >= emi.total_months;
        let next_due = if finished {
            emi.next_due.clone()
        } else {
            advance_date(&emi.next_due, "monthly")?
        };
        conn.execute(
            "UPDATE emis SET months_paid = ?1, next_due = ?2, active = ?3, updated_at = ?4 WHERE id = ?5",
            params![months_paid, next_due, !finished, db::now(), id],
        )
        .map_err(|e| e.to_string())?;

        // A loan financing a property logs each payment against it, settling
        // to an account if one is set — same "keeps cash on hand correct"
        // treatment as everything else in Finance/Investments.
        if let Some(investment_id) = emi.investment_id {
            let (inv_name, person_id): (String, Option<i64>) = conn
                .query_row(
                    "SELECT name, person_id FROM investments WHERE id = ?1",
                    params![investment_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|e| e.to_string())?;
            let today = db::today();
            let title = format!("EMI payment — {inv_name}");
            let linked_transaction_id = match emi.settle_account_id {
                Some(account_id) => Some(
                    record_transaction(
                        conn,
                        account_id,
                        "expense",
                        emi.monthly_amount,
                        Some("EMI"),
                        Some(&title),
                        &today,
                        None,
                    )?
                    .id,
                ),
                None => None,
            };
            let now = db::now();
            conn.execute(
                "INSERT INTO investment_transactions
                 (investment_id, kind, amount, date, counterparty, notes, settle_account_id, linked_transaction_id, created_at)
                 VALUES (?1, 'expense', ?2, ?3, ?4, 'EMI payment', ?5, ?6, ?7)",
                params![investment_id, emi.monthly_amount, today, emi.lender, emi.settle_account_id, linked_transaction_id, now],
            )
            .map_err(|e| e.to_string())?;
            let tx_id = conn.last_insert_rowid();
            index_record(conn, "investment_transactions", tx_id, &title, emi.lender.as_deref().unwrap_or(""), person_id)?;
        }

        let emi = conn
            .query_row(
                &format!("SELECT {EMI_COLS} FROM emis WHERE id = ?1"),
                params![id],
                emi_from_row,
            )
            .map_err(|e| e.to_string())?;
        sync_emi(conn, &emi)?;
        log_activity(
            conn,
            "finance",
            if finished { "EMI completed" } else { "EMI paid" },
            &emi.name,
            Some(id),
        )?;
        Ok(emi)
    })
}

#[tauri::command]
pub fn emi_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let name: Option<String> = conn
            .query_row("SELECT name FROM emis WHERE id = ?1", params![id], |r| r.get(0))
            .ok();
        conn.execute("DELETE FROM emis WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        unindex_record(conn, "emis", id)?;
        sync_timeline(conn, "emis", id, "emi", "", None, None, None)?;
        if let Some(n) = name {
            log_activity(conn, "finance", "deleted EMI", &n, None)?;
        }
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Overview / net worth
// ---------------------------------------------------------------------------

fn monthly_equivalent(amount: f64, cycle: &str) -> f64 {
    match cycle {
        "weekly" => amount * 52.0 / 12.0,
        "monthly" => amount,
        "quarterly" => amount / 3.0,
        "yearly" => amount / 12.0,
        _ => amount,
    }
}

#[tauri::command]
pub fn finance_overview(state: State<'_, AppState>) -> Result<FinanceOverview, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT kind, SUM(balance), COUNT(*) FROM accounts GROUP BY kind")
            .map_err(|e| e.to_string())?;
        let by_kind: Vec<KindTotal> = stmt
            .query_map([], |r| {
                Ok(KindTotal {
                    kind: r.get(0)?,
                    total: r.get(1)?,
                    count: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut assets = 0.0;
        let mut liabilities = 0.0;
        for kt in &by_kind {
            if kt.kind == "credit_card" {
                liabilities += kt.total;
            } else {
                assets += kt.total;
            }
        }
        // Remaining EMI principal counts as a liability.
        let emi_remaining: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(monthly_amount * (total_months - months_paid)), 0)
                 FROM emis WHERE active = 1",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        liabilities += emi_remaining;

        let subs: Vec<(f64, String)> = conn
            .prepare("SELECT amount, cycle FROM subscriptions WHERE active = 1")
            .map_err(|e| e.to_string())?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let monthly_subscriptions = subs
            .iter()
            .map(|(a, c)| monthly_equivalent(*a, c))
            .sum::<f64>();
        let active_subscriptions = subs.len() as i64;

        let (monthly_emi, active_emis): (f64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(monthly_amount), 0), COUNT(*) FROM emis WHERE active = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        Ok(FinanceOverview {
            assets,
            liabilities,
            net_worth: assets - liabilities,
            by_kind,
            monthly_subscriptions,
            monthly_emi,
            active_subscriptions,
            active_emis,
        })
    })
}

/// Cash flow for the last 6 calendar months and expense-by-category for the
/// current month, both derived from `transactions` (no new tables needed).
#[tauri::command]
pub fn finance_charts(state: State<'_, AppState>) -> Result<FinanceCharts, String> {
    with_db(&state, |conn| {
        let today = db::today();
        let mut y: i32 = today[0..4].parse().map_err(|_| "bad date".to_string())?;
        let mut m: i32 = today[5..7].parse().map_err(|_| "bad date".to_string())?;
        let mut months = Vec::with_capacity(6);
        for _ in 0..6 {
            months.push(format!("{y:04}-{m:02}"));
            m -= 1;
            if m == 0 {
                m = 12;
                y -= 1;
            }
        }
        months.reverse();

        let mut monthly = Vec::with_capacity(months.len());
        for month in &months {
            let pattern = format!("{month}%");
            let (income, expense): (f64, f64) = conn
                .query_row(
                    "SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0),
                            COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END), 0)
                     FROM transactions WHERE date LIKE ?1",
                    params![pattern],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|e| e.to_string())?;
            monthly.push(MonthlyFlow { month: month.clone(), income, expense });
        }

        let current_month_pattern = format!("{}%", &today[0..7]);
        let mut stmt = conn
            .prepare(
                "SELECT COALESCE(NULLIF(TRIM(category), ''), 'Other') AS cat, SUM(amount) AS total
                 FROM transactions
                 WHERE kind = 'expense' AND date LIKE ?1
                 GROUP BY cat ORDER BY total DESC LIMIT 8",
            )
            .map_err(|e| e.to_string())?;
        let categories = stmt
            .query_map(params![current_month_pattern], |r| {
                Ok(CategorySpend {
                    category: r.get(0)?,
                    total: r.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(FinanceCharts { monthly, categories })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{crypto, db};

    fn open_fresh(dir: &std::path::Path) -> Connection {
        let meta = crypto::new_meta();
        let key = crypto::derive_key("password123", &meta.kdf).unwrap();
        let conn = db::open_encrypted(&dir.join("test.db"), &key).unwrap();
        db::ensure_schema(&conn).unwrap();
        conn
    }

    fn make_account(conn: &Connection, name: &str, kind: &str, balance: f64, person: i64) -> i64 {
        conn.execute(
            "INSERT INTO accounts (name, kind, balance, person_id, details, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, '{}', '2026-01-01', '2026-01-01')",
            params![name, kind, balance, person],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// Same operations `transaction_transfer` performs: a cash withdrawal
    /// from a bank account must decrease the bank and increase Cash on hand
    /// in the same step, and deleting either leg must reverse both.
    #[test]
    fn cash_withdrawal_transfer_updates_both_balances_and_reverses_on_delete() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_fresh(dir.path());
        let me: i64 = conn
            .query_row("SELECT id FROM persons WHERE is_default = 1", [], |r| r.get(0))
            .unwrap();

        let bank = make_account(&conn, "HDFC", "bank", 50000.0, me);
        let cash = make_account(&conn, "Cash", "cash", 0.0, me);

        let debit = record_transaction(
            &conn, bank, "transfer_out", 5000.0, Some("Transfer"), Some("Transfer to Cash"), "2026-02-01", None,
        )
        .unwrap();
        let credit = record_transaction(
            &conn, cash, "transfer_in", 5000.0, Some("Transfer"), Some("Transfer from HDFC"), "2026-02-01", Some(debit.id),
        )
        .unwrap();
        conn.execute(
            "UPDATE transactions SET transfer_peer_id = ?1 WHERE id = ?2",
            params![credit.id, debit.id],
        )
        .unwrap();

        let bank_balance: f64 = conn
            .query_row("SELECT balance FROM accounts WHERE id = ?1", params![bank], |r| r.get(0))
            .unwrap();
        let cash_balance: f64 = conn
            .query_row("SELECT balance FROM accounts WHERE id = ?1", params![cash], |r| r.get(0))
            .unwrap();
        assert_eq!(bank_balance, 45000.0);
        assert_eq!(cash_balance, 5000.0);

        let peer = delete_transaction_row(&conn, debit.id).unwrap();
        assert_eq!(peer, Some(credit.id));
        delete_transaction_row(&conn, peer.unwrap()).unwrap();

        let bank_balance: f64 = conn
            .query_row("SELECT balance FROM accounts WHERE id = ?1", params![bank], |r| r.get(0))
            .unwrap();
        let cash_balance: f64 = conn
            .query_row("SELECT balance FROM accounts WHERE id = ?1", params![cash], |r| r.get(0))
            .unwrap();
        assert_eq!(bank_balance, 50000.0);
        assert_eq!(cash_balance, 0.0);
    }
}
