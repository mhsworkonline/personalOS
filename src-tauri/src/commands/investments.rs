//! Investments: land, plots, flats, houses — physical property tracked as one
//! entity for its whole life. Buying and selling are never separate records;
//! they're `investment_transactions` rows (`purchase`, `expense`,
//! `rent_income`, `sale`) against the same `investments` row. Status
//! (owned/rented/sold) is always derived from that history, never stored.
//! A `investment_rent_schedules` row represents a current tenancy: its mere
//! existence means "rented"; ending a tenancy deletes the row (past
//! `rent_income` transactions already recorded the actual payments, so
//! nothing is lost).

use super::finance::{delete_transaction_row, emis_for_investment, record_transaction};
use super::with_db;
use crate::db::{self, advance_date, index_record, log_activity, sync_timeline, unindex_record};
use crate::models::{
    InvestmentDetail, InvestmentInput, InvestmentSummary, InvestmentTransaction,
    InvestmentTransactionInput, RentSchedule, RentScheduleInput,
};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;
use tauri::State;

pub const INVESTMENT_KINDS: [&str; 6] = ["land", "plot", "flat", "house", "shop", "other"];
pub const TX_KINDS: [&str; 4] = ["purchase", "expense", "rent_income", "sale"];

const INV_COLS: &str = "id, name, kind, address, notes, person_id, created_at, updated_at";
const TX_COLS: &str =
    "id, investment_id, kind, amount, date, counterparty, notes, settle_account_id, linked_transaction_id, created_at";
const RENT_COLS: &str =
    "id, investment_id, monthly_amount, next_due, tenant_name, notes, settle_account_id, created_at, updated_at";

/// A property transaction settles money into/out of a Finance account: purchase/
/// expense pay money out (like an expense), rent_income/sale bring money in
/// (like income). Keeps "cash on hand" correct wherever the money actually went.
fn finance_kind_for(tx_kind: &str) -> &'static str {
    match tx_kind {
        "purchase" | "expense" => "expense",
        _ => "income",
    }
}

#[allow(clippy::type_complexity)]
fn inv_base_from_row(
    r: &Row,
) -> rusqlite::Result<(i64, String, String, Option<String>, Option<String>, Option<i64>, String, String)>
{
    Ok((
        r.get(0)?,
        r.get(1)?,
        r.get(2)?,
        r.get(3)?,
        r.get(4)?,
        r.get(5)?,
        r.get(6)?,
        r.get(7)?,
    ))
}

fn tx_from_row(r: &Row) -> rusqlite::Result<InvestmentTransaction> {
    Ok(InvestmentTransaction {
        id: r.get(0)?,
        investment_id: r.get(1)?,
        kind: r.get(2)?,
        amount: r.get(3)?,
        date: r.get(4)?,
        counterparty: r.get(5)?,
        notes: r.get(6)?,
        settle_account_id: r.get(7)?,
        linked_transaction_id: r.get(8)?,
        created_at: r.get(9)?,
    })
}

fn rent_from_row(r: &Row) -> rusqlite::Result<RentSchedule> {
    Ok(RentSchedule {
        id: r.get(0)?,
        investment_id: r.get(1)?,
        monthly_amount: r.get(2)?,
        next_due: r.get(3)?,
        tenant_name: r.get(4)?,
        notes: r.get(5)?,
        settle_account_id: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

/// Status is derived, never stored: sold if the most recent purchase/sale
/// event is a sale; otherwise rented if a tenancy row exists; otherwise owned.
fn compute_status(conn: &Connection, investment_id: i64) -> Result<String, String> {
    let latest_purchase: Option<String> = conn
        .query_row(
            "SELECT MAX(date) FROM investment_transactions WHERE investment_id = ?1 AND kind = 'purchase'",
            params![investment_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let latest_sale: Option<String> = conn
        .query_row(
            "SELECT MAX(date) FROM investment_transactions WHERE investment_id = ?1 AND kind = 'sale'",
            params![investment_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let sold = match (&latest_purchase, &latest_sale) {
        (_, None) => false,
        (None, Some(_)) => true,
        (Some(p), Some(s)) => s >= p,
    };
    if sold {
        return Ok("sold".into());
    }
    let rented: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM investment_rent_schedules WHERE investment_id = ?1",
            params![investment_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(if rented > 0 { "rented".into() } else { "owned".into() })
}

fn compute_totals(conn: &Connection, investment_id: i64) -> Result<(f64, f64, f64, f64), String> {
    conn.query_row(
        "SELECT
           COALESCE(SUM(CASE WHEN kind = 'purchase' THEN amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN kind = 'rent_income' THEN amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN kind = 'sale' THEN amount ELSE 0 END), 0)
         FROM investment_transactions WHERE investment_id = ?1",
        params![investment_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .map_err(|e| e.to_string())
}

fn active_rent_schedule(conn: &Connection, investment_id: i64) -> Result<Option<RentSchedule>, String> {
    conn.query_row(
        &format!(
            "SELECT {RENT_COLS} FROM investment_rent_schedules WHERE investment_id = ?1 ORDER BY id DESC LIMIT 1"
        ),
        params![investment_id],
        rent_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn investment_summary(conn: &Connection, id: i64) -> Result<InvestmentSummary, String> {
    let (id, name, kind, address, notes, person_id, created_at, updated_at) = conn
        .query_row(
            &format!("SELECT {INV_COLS} FROM investments WHERE id = ?1"),
            params![id],
            inv_base_from_row,
        )
        .map_err(|_| "Investment not found".to_string())?;
    let status = compute_status(conn, id)?;
    let (total_purchase, total_expense, total_rent_income, total_sale) = compute_totals(conn, id)?;
    let gain = total_sale + total_rent_income - total_purchase - total_expense;
    let rent_schedule = active_rent_schedule(conn, id)?;
    Ok(InvestmentSummary {
        id,
        name,
        kind,
        address,
        notes,
        person_id,
        status,
        total_purchase,
        total_expense,
        total_rent_income,
        total_sale,
        gain,
        rent_schedule,
        created_at,
        updated_at,
    })
}

pub fn investments_for(conn: &Connection, person: Option<i64>) -> Result<Vec<InvestmentSummary>, String> {
    let sql = match person {
        Some(_) => "SELECT id FROM investments WHERE person_id = ?1 ORDER BY kind, name COLLATE NOCASE",
        None => "SELECT id FROM investments ORDER BY kind, name COLLATE NOCASE",
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let ids: Vec<i64> = match person {
        Some(pid) => stmt
            .query_map(params![pid], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
        None => stmt
            .query_map([], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
    };
    ids.into_iter().map(|id| investment_summary(conn, id)).collect()
}

pub fn investment_transactions_for(
    conn: &Connection,
    investment_id: i64,
) -> Result<Vec<InvestmentTransaction>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {TX_COLS} FROM investment_transactions WHERE investment_id = ?1 ORDER BY date DESC, id DESC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![investment_id], tx_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn investment_list(state: State<'_, AppState>) -> Result<Vec<InvestmentSummary>, String> {
    with_db(&state, |conn| investments_for(conn, None))
}

#[tauri::command]
pub fn investment_detail(state: State<'_, AppState>, id: i64) -> Result<InvestmentDetail, String> {
    with_db(&state, |conn| {
        let summary = investment_summary(conn, id)?;
        let transactions = investment_transactions_for(conn, id)?;
        let emis = emis_for_investment(conn, id)?;
        Ok(InvestmentDetail { summary, transactions, emis })
    })
}

#[tauri::command]
pub fn investment_save(
    state: State<'_, AppState>,
    input: InvestmentInput,
) -> Result<InvestmentSummary, String> {
    if input.name.trim().is_empty() {
        return Err("Investment name must not be empty".into());
    }
    if !INVESTMENT_KINDS.contains(&input.kind.as_str()) {
        return Err(format!("Unknown investment type: {}", input.kind));
    }
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
                    "UPDATE investments SET name = ?1, kind = ?2, address = ?3, notes = ?4,
                     person_id = ?5, updated_at = ?6 WHERE id = ?7",
                    params![name, input.kind, input.address, input.notes, person_id, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO investments (name, kind, address, notes, person_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                    params![name, input.kind, input.address, input.notes, person_id, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        index_record(
            conn,
            "investments",
            id,
            &name,
            &format!(
                "{} {} {}",
                input.kind,
                input.address.as_deref().unwrap_or(""),
                input.notes.as_deref().unwrap_or("")
            ),
            Some(person_id),
        )?;
        log_activity(
            conn,
            "investments",
            if input.id.is_some() { "updated investment" } else { "added investment" },
            &name,
            Some(id),
        )?;
        investment_summary(conn, id)
    })
}

/// What deleting this property would affect, so the UI can show an impact
/// summary before the user confirms (mirrors `people::related_counts`).
#[tauri::command]
pub fn investment_related_counts(state: State<'_, AppState>, id: i64) -> Result<HashMap<String, i64>, String> {
    with_db(&state, |conn| {
        let mut out = HashMap::new();
        for (label, sql) in [
            ("transactions", "SELECT COUNT(*) FROM investment_transactions WHERE investment_id = ?1"),
            ("tenancy", "SELECT COUNT(*) FROM investment_rent_schedules WHERE investment_id = ?1"),
            ("emis", "SELECT COUNT(*) FROM emis WHERE investment_id = ?1"),
            ("documents", "SELECT COUNT(*) FROM documents WHERE investment_id = ?1"),
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
pub fn investment_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| delete_investment(conn, id))
}

fn delete_investment(conn: &Connection, id: i64) -> Result<(), String> {
    let name: Option<String> = conn
        .query_row("SELECT name FROM investments WHERE id = ?1", params![id], |r| r.get(0))
        .ok();
    // Detach documents and EMIs that reference this property (their own records stay).
    conn.execute(
        "UPDATE documents SET investment_id = NULL WHERE investment_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("UPDATE emis SET investment_id = NULL WHERE investment_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    // Reverse any Finance account balances this property's transactions settled into.
    let linked_ids: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT linked_transaction_id FROM investment_transactions
                 WHERE investment_id = ?1 AND linked_transaction_id IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    for tx_id in linked_ids {
        delete_transaction_row(conn, tx_id)?;
    }
    conn.execute(
        "DELETE FROM search_index WHERE module = 'investment_transactions'
         AND record_id IN (SELECT id FROM investment_transactions WHERE investment_id = ?1)",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM timeline_events WHERE source_module = 'investments'
         AND source_id IN (SELECT id FROM investment_rent_schedules WHERE investment_id = ?1)",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM investments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?; // transactions + rent schedules cascade
    unindex_record(conn, "investments", id)?;
    if let Some(n) = name {
        log_activity(conn, "investments", "deleted investment", &n, None)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Transactions (purchase / expense / rent_income / sale)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn investment_transaction_list(
    state: State<'_, AppState>,
    investment: i64,
) -> Result<Vec<InvestmentTransaction>, String> {
    with_db(&state, |conn| investment_transactions_for(conn, investment))
}

fn tx_label(kind: &str) -> &'static str {
    match kind {
        "purchase" => "Purchased",
        "expense" => "Expense",
        "rent_income" => "Rent received",
        "sale" => "Sold",
        _ => "Transaction",
    }
}

/// Create or edit a property transaction. Editing re-settles the linked
/// Finance transaction from scratch (old one reversed/removed, new one
/// created if an account is chosen) so balances never drift.
#[tauri::command]
pub fn investment_transaction_save(
    state: State<'_, AppState>,
    input: InvestmentTransactionInput,
) -> Result<InvestmentTransaction, String> {
    if input.amount <= 0.0 {
        return Err("Amount must be positive".into());
    }
    if !TX_KINDS.contains(&input.kind.as_str()) {
        return Err(format!("Unknown transaction type: {}", input.kind));
    }
    chrono::NaiveDate::parse_from_str(&input.date, "%Y-%m-%d")
        .map_err(|_| "Date must be YYYY-MM-DD".to_string())?;
    with_db(&state, |conn| {
        let (inv_name, person_id): (String, Option<i64>) = conn
            .query_row(
                "SELECT name, person_id FROM investments WHERE id = ?1",
                params![input.investment_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "Investment not found".to_string())?;

        // Editing: undo whatever the old row settled before re-settling.
        if let Some(id) = input.id {
            let old_linked: Option<i64> = conn
                .query_row(
                    "SELECT linked_transaction_id FROM investment_transactions WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .map_err(|_| "Transaction not found".to_string())?;
            if let Some(tx_id) = old_linked {
                delete_transaction_row(conn, tx_id)?;
            }
        }

        let linked_transaction_id = match input.settle_account_id {
            Some(account_id) => {
                let title = format!("{} — {}", tx_label(&input.kind), inv_name);
                let tx = record_transaction(
                    conn,
                    account_id,
                    finance_kind_for(&input.kind),
                    input.amount,
                    Some("Investment"),
                    Some(&title),
                    &input.date,
                    None,
                )?;
                Some(tx.id)
            }
            None => None,
        };

        let now = db::now();
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE investment_transactions SET kind = ?1, amount = ?2, date = ?3, counterparty = ?4,
                     notes = ?5, settle_account_id = ?6, linked_transaction_id = ?7 WHERE id = ?8",
                    params![
                        input.kind, input.amount, input.date, input.counterparty, input.notes,
                        input.settle_account_id, linked_transaction_id, id
                    ],
                )
                .map_err(|e| format!("Cannot update transaction: {e}"))?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO investment_transactions
                     (investment_id, kind, amount, date, counterparty, notes, settle_account_id, linked_transaction_id, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        input.investment_id, input.kind, input.amount, input.date, input.counterparty, input.notes,
                        input.settle_account_id, linked_transaction_id, now
                    ],
                )
                .map_err(|e| format!("Cannot add transaction: {e}"))?;
                conn.last_insert_rowid()
            }
        };
        let tx = conn
            .query_row(&format!("SELECT {TX_COLS} FROM investment_transactions WHERE id = ?1"), params![id], tx_from_row)
            .map_err(|e| e.to_string())?;
        let title = format!("{} — {}", tx_label(&tx.kind), inv_name);
        index_record(
            conn,
            "investment_transactions",
            id,
            &title,
            &format!("{} {}", tx.counterparty.as_deref().unwrap_or(""), tx.notes.as_deref().unwrap_or("")),
            person_id,
        )?;
        log_activity(
            conn,
            "investments",
            if input.id.is_some() { "updated transaction" } else { "transaction" },
            &title,
            Some(id),
        )?;
        Ok(tx)
    })
}

#[tauri::command]
pub fn investment_transaction_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let linked: Option<i64> = conn
            .query_row(
                "SELECT linked_transaction_id FROM investment_transactions WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(None);
        if let Some(tx_id) = linked {
            delete_transaction_row(conn, tx_id)?;
        }
        conn.execute("DELETE FROM investment_transactions WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        unindex_record(conn, "investment_transactions", id)
    })
}

// ---------------------------------------------------------------------------
// Rent schedules (current tenancy)
// ---------------------------------------------------------------------------

fn sync_rent(conn: &Connection, rs: &RentSchedule) -> Result<(), String> {
    let (inv_name, person_id): (String, Option<i64>) = conn
        .query_row(
            "SELECT name, person_id FROM investments WHERE id = ?1",
            params![rs.investment_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    sync_timeline(
        conn,
        "investments",
        rs.id,
        "rent_due",
        &format!("Rent due — {inv_name}"),
        Some(rs.next_due.as_str()),
        Some(rs.monthly_amount),
        person_id,
    )
}

#[tauri::command]
pub fn rent_schedule_save(
    state: State<'_, AppState>,
    input: RentScheduleInput,
) -> Result<RentSchedule, String> {
    if input.monthly_amount <= 0.0 {
        return Err("Monthly rent must be positive".into());
    }
    chrono::NaiveDate::parse_from_str(&input.next_due, "%Y-%m-%d")
        .map_err(|_| "Next due date must be YYYY-MM-DD".to_string())?;
    with_db(&state, |conn| {
        conn.query_row(
            "SELECT id FROM investments WHERE id = ?1",
            params![input.investment_id],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|_| "Investment not found".to_string())?;
        let now = db::now();
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE investment_rent_schedules SET monthly_amount = ?1, next_due = ?2,
                     tenant_name = ?3, notes = ?4, settle_account_id = ?5, updated_at = ?6 WHERE id = ?7",
                    params![input.monthly_amount, input.next_due, input.tenant_name, input.notes, input.settle_account_id, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO investment_rent_schedules
                     (investment_id, monthly_amount, next_due, tenant_name, notes, settle_account_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                    params![input.investment_id, input.monthly_amount, input.next_due, input.tenant_name, input.notes, input.settle_account_id, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        let rs = conn
            .query_row(&format!("SELECT {RENT_COLS} FROM investment_rent_schedules WHERE id = ?1"), params![id], rent_from_row)
            .map_err(|e| e.to_string())?;
        sync_rent(conn, &rs)?;

        // Backfill: rent already recorded for this property that wasn't
        // settled to an account yet now goes into the one just chosen, so
        // the bank balance reflects it immediately — not just future cycles.
        if let Some(account_id) = rs.settle_account_id {
            backfill_rent_settlements(conn, rs.investment_id, account_id)?;
        }

        log_activity(
            conn,
            "investments",
            if input.id.is_some() { "updated tenancy" } else { "tenant added" },
            rs.tenant_name.as_deref().unwrap_or("Rent schedule"),
            Some(id),
        )?;
        Ok(rs)
    })
}

fn backfill_rent_settlements(conn: &Connection, investment_id: i64, account_id: i64) -> Result<(), String> {
    let unsettled: Vec<(i64, f64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, amount, date FROM investment_transactions
                 WHERE investment_id = ?1 AND kind = 'rent_income' AND settle_account_id IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![investment_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    if unsettled.is_empty() {
        return Ok(());
    }
    let inv_name: String = conn
        .query_row("SELECT name FROM investments WHERE id = ?1", params![investment_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let title = format!("Rent received — {inv_name}");
    for (tx_id, amount, date) in &unsettled {
        let tx = record_transaction(conn, account_id, "income", *amount, Some("Investment"), Some(&title), date, None)?;
        conn.execute(
            "UPDATE investment_transactions SET settle_account_id = ?1, linked_transaction_id = ?2 WHERE id = ?3",
            params![account_id, tx.id, tx_id],
        )
        .map_err(|e| e.to_string())?;
    }
    log_activity(
        conn,
        "investments",
        "backfilled rent settlements",
        &format!("{} — {} past payment(s)", inv_name, unsettled.len()),
        None,
    )?;
    Ok(())
}

/// Record this cycle's rent as a transaction and roll the schedule forward a month.
#[tauri::command]
pub fn rent_schedule_mark_paid(state: State<'_, AppState>, id: i64) -> Result<RentSchedule, String> {
    with_db(&state, |conn| {
        let rs = conn
            .query_row(&format!("SELECT {RENT_COLS} FROM investment_rent_schedules WHERE id = ?1"), params![id], rent_from_row)
            .map_err(|_| "Rent schedule not found".to_string())?;
        let (inv_name, person_id): (String, Option<i64>) = conn
            .query_row(
                "SELECT name, person_id FROM investments WHERE id = ?1",
                params![rs.investment_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let title = format!("Rent received — {inv_name}");

        let linked_transaction_id = match rs.settle_account_id {
            Some(account_id) => Some(
                record_transaction(
                    conn,
                    account_id,
                    "income",
                    rs.monthly_amount,
                    Some("Investment"),
                    Some(&title),
                    &rs.next_due,
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
             VALUES (?1, 'rent_income', ?2, ?3, ?4, NULL, ?5, ?6, ?7)",
            params![rs.investment_id, rs.monthly_amount, rs.next_due, rs.tenant_name, rs.settle_account_id, linked_transaction_id, now],
        )
        .map_err(|e| e.to_string())?;
        let tx_id = conn.last_insert_rowid();
        index_record(conn, "investment_transactions", tx_id, &title, rs.tenant_name.as_deref().unwrap_or(""), person_id)?;

        let next = advance_date(&rs.next_due, "monthly")?;
        conn.execute(
            "UPDATE investment_rent_schedules SET next_due = ?1, updated_at = ?2 WHERE id = ?3",
            params![next, now, id],
        )
        .map_err(|e| e.to_string())?;
        let rs = conn
            .query_row(&format!("SELECT {RENT_COLS} FROM investment_rent_schedules WHERE id = ?1"), params![id], rent_from_row)
            .map_err(|e| e.to_string())?;
        sync_rent(conn, &rs)?;
        log_activity(conn, "investments", "rent received", &inv_name, Some(tx_id))?;
        Ok(rs)
    })
}

/// End the current tenancy. Past rent payments stay recorded as transactions.
#[tauri::command]
pub fn rent_schedule_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let investment_id: Option<i64> = conn
            .query_row(
                "SELECT investment_id FROM investment_rent_schedules WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        conn.execute("DELETE FROM investment_rent_schedules WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        sync_timeline(conn, "investments", id, "rent_due", "", None, None, None)?;
        if let Some(inv_id) = investment_id {
            let name: Option<String> = conn
                .query_row("SELECT name FROM investments WHERE id = ?1", params![inv_id], |r| r.get(0))
                .ok();
            log_activity(conn, "investments", "ended tenancy", name.as_deref().unwrap_or("Investment"), Some(inv_id))?;
        }
        Ok(())
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

    #[test]
    fn rent_backfill_settles_past_unsettled_income_and_updates_balance() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_fresh(dir.path());
        let me: i64 = conn
            .query_row("SELECT id FROM persons WHERE is_default = 1", [], |r| r.get(0))
            .unwrap();

        conn.execute(
            "INSERT INTO accounts (name, kind, balance, person_id, details, created_at, updated_at)
             VALUES ('HDFC', 'bank', 0, ?1, '{}', '2026-01-01', '2026-01-01')",
            params![me],
        )
        .unwrap();
        let account_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO investments (name, kind, person_id, created_at, updated_at)
             VALUES ('Plot 14', 'plot', ?1, '2026-01-01', '2026-01-01')",
            params![me],
        )
        .unwrap();
        let investment_id = conn.last_insert_rowid();

        // Two past rent payments recorded before any account was chosen.
        for (amount, date) in [(8000.0, "2026-01-05"), (8000.0, "2026-02-05")] {
            conn.execute(
                "INSERT INTO investment_transactions (investment_id, kind, amount, date, created_at)
                 VALUES (?1, 'rent_income', ?2, ?3, ?3)",
                params![investment_id, amount, date],
            )
            .unwrap();
        }

        backfill_rent_settlements(&conn, investment_id, account_id).unwrap();

        let balance: f64 = conn
            .query_row("SELECT balance FROM accounts WHERE id = ?1", params![account_id], |r| r.get(0))
            .unwrap();
        assert_eq!(balance, 16000.0);

        let settled: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM investment_transactions WHERE investment_id = ?1 AND settle_account_id = ?2",
                params![investment_id, account_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(settled, 2);

        let tx_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM transactions WHERE account_id = ?1", params![account_id], |r| r.get(0))
            .unwrap();
        assert_eq!(tx_count, 2);
    }
}
