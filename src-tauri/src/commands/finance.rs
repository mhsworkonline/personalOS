//! Finance: accounts, manual transactions, subscriptions, EMIs, net worth.
//! Accounts and subscriptions belong to a person (default "Me"). Bank
//! accounts carry a structured `details` JSON blob (branch, IFSC, net-banking
//! credentials, cards, …) stored inside the SQLCipher-encrypted database —
//! the same strategy as vault `fields`. ATM PINs, CVVs, UPI PINs and OTPs are
//! rejected outright and can never be stored.

use super::with_db;
use crate::db::{self, advance_date, index_record, log_activity, sync_timeline, unindex_record};
use crate::models::{
    Account, AccountInput, Emi, EmiInput, FinanceOverview, KindTotal, Subscription,
    SubscriptionInput, Transaction, TransactionInput,
};
use crate::AppState;
use rusqlite::{params, Connection, Row};
use tauri::State;

pub const ACCOUNT_KINDS: [&str; 4] = ["bank", "cash", "credit_card", "investment"];

/// Keys that must never be stored anywhere, per the security policy.
const FORBIDDEN_DETAIL_KEYS: [&str; 6] = ["cvv", "atm_pin", "upi_pin", "otp", "pin_atm", "card_pin"];

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

fn account_from_row(r: &Row) -> rusqlite::Result<Account> {
    let details_raw: String = r.get(6)?;
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        balance: r.get(3)?,
        notes: r.get(4)?,
        person_id: r.get(5)?,
        details: serde_json::from_str(&details_raw).unwrap_or(serde_json::json!({})),
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

const ACCOUNT_COLS: &str = "id, name, kind, balance, notes, person_id, details, created_at, updated_at";

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
                conn.execute(
                    "UPDATE accounts SET name = ?1, kind = ?2, balance = ?3, notes = ?4,
                     person_id = ?5, details = ?6, updated_at = ?7 WHERE id = ?8",
                    params![name, input.kind, input.balance, input.notes, person_id, details_raw, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO accounts (name, kind, balance, notes, person_id, details, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                    params![name, input.kind, input.balance, input.notes, person_id, details_raw, now],
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

#[tauri::command]
pub fn account_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let name: Option<String> = conn
            .query_row("SELECT name FROM accounts WHERE id = ?1", params![id], |r| r.get(0))
            .ok();
        conn.execute(
            "DELETE FROM search_index WHERE module = 'transactions'
             AND record_id IN (SELECT id FROM transactions WHERE account_id = ?1)",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        unindex_record(conn, "accounts", id)?;
        if let Some(n) = name {
            log_activity(conn, "finance", "deleted account", &n, None)?;
        }
        Ok(())
    })
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
        created_at: r.get(8)?,
    })
}

const TX_SELECT: &str = "SELECT t.id, t.account_id, a.name, t.kind, t.amount, t.category,
    t.description, t.date, t.created_at
    FROM transactions t JOIN accounts a ON a.id = t.account_id";

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

#[tauri::command]
pub fn transaction_create(
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
        let now = db::now();
        conn.execute(
            "INSERT INTO transactions (account_id, kind, amount, category, description, date, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![input.account_id, input.kind, input.amount, input.category, input.description, input.date, now],
        )
        .map_err(|e| format!("Cannot add transaction: {e}"))?;
        let id = conn.last_insert_rowid();
        let delta = if input.kind == "expense" { -input.amount } else { input.amount };
        conn.execute(
            "UPDATE accounts SET balance = balance + ?1, updated_at = ?2 WHERE id = ?3",
            params![delta, now, input.account_id],
        )
        .map_err(|e| e.to_string())?;
        let tx = conn
            .query_row(&format!("{TX_SELECT} WHERE t.id = ?1"), params![id], tx_from_row)
            .map_err(|e| e.to_string())?;
        let person: Option<i64> = conn
            .query_row(
                "SELECT person_id FROM accounts WHERE id = ?1",
                params![input.account_id],
                |r| r.get(0),
            )
            .unwrap_or(None);
        let title = tx.description.clone().unwrap_or_else(|| {
            format!("{} {}", tx.kind, tx.category.as_deref().unwrap_or("transaction"))
        });
        index_record(
            conn,
            "transactions",
            id,
            &title,
            &format!("{} {}", tx.category.as_deref().unwrap_or(""), tx.account_name),
            person,
        )?;
        log_activity(conn, "finance", "transaction", &title, Some(id))?;
        Ok(tx)
    })
}

#[tauri::command]
pub fn transaction_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let row: Option<(i64, String, f64)> = conn
            .query_row(
                "SELECT account_id, kind, amount FROM transactions WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        if let Some((account_id, kind, amount)) = row {
            let delta = if kind == "expense" { amount } else { -amount };
            conn.execute(
                "UPDATE accounts SET balance = balance + ?1, updated_at = ?2 WHERE id = ?3",
                params![delta, db::now(), account_id],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute("DELETE FROM transactions WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        unindex_record(conn, "transactions", id)
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
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

const EMI_COLS: &str =
    "id, name, lender, monthly_amount, total_months, months_paid, next_due, active, notes, created_at, updated_at";

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
                     months_paid = ?5, next_due = ?6, active = ?7, notes = ?8, updated_at = ?9 WHERE id = ?10",
                    params![name, input.lender, input.monthly_amount, input.total_months,
                            input.months_paid, input.next_due, input.active, input.notes, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO emis (name, lender, monthly_amount, total_months, months_paid, next_due, active, notes, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                    params![name, input.lender, input.monthly_amount, input.total_months,
                            input.months_paid, input.next_due, input.active, input.notes, now],
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
