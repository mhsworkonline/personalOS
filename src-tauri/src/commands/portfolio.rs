//! Portfolio: stocks and mutual funds the user holds. Prices are entered
//! manually (the app is offline by design), and unrealized P&L is computed
//! from quantity, average cost and the last known price — nothing is stored
//! that can be derived. Every holding belongs to a person (default "Me").

use super::with_db;
use crate::db::{self, index_record, log_activity, unindex_record};
use crate::models::{Holding, HoldingInput, PortfolioSummary, QuoteRequest, QuoteResult};
use crate::AppState;
use rusqlite::{params, Connection, Row};
use std::time::Duration;
use tauri::State;

pub const HOLDING_KINDS: [&str; 2] = ["stock", "fund"];

const HOLDING_COLS: &str = "id, symbol, name, kind, quantity, avg_cost, last_price, price_date,
    notes, quote_key, person_id, created_at, updated_at";

fn holding_from_row(r: &Row) -> rusqlite::Result<Holding> {
    let quantity: f64 = r.get(4)?;
    let avg_cost: f64 = r.get(5)?;
    let last_price: f64 = r.get(6)?;
    let invested = quantity * avg_cost;
    let current = quantity * last_price;
    let pnl = current - invested;
    let pnl_pct = if invested > 0.0 { pnl / invested * 100.0 } else { 0.0 };
    Ok(Holding {
        id: r.get(0)?,
        symbol: r.get(1)?,
        name: r.get(2)?,
        kind: r.get(3)?,
        quantity,
        avg_cost,
        last_price,
        price_date: r.get(7)?,
        notes: r.get(8)?,
        quote_key: r.get(9)?,
        person_id: r.get(10)?,
        invested,
        current,
        pnl,
        pnl_pct,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

pub fn holdings_for(conn: &Connection, person: Option<i64>) -> Result<Vec<Holding>, String> {
    let sql = match person {
        Some(_) => format!(
            "SELECT {HOLDING_COLS} FROM holdings WHERE person_id = ?1 ORDER BY symbol COLLATE NOCASE"
        ),
        None => format!("SELECT {HOLDING_COLS} FROM holdings ORDER BY symbol COLLATE NOCASE"),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = match person {
        Some(pid) => stmt.query_map(params![pid], holding_from_row),
        None => stmt.query_map([], holding_from_row),
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn holding_list(state: State<'_, AppState>) -> Result<Vec<Holding>, String> {
    with_db(&state, |conn| holdings_for(conn, None))
}

#[tauri::command]
pub fn portfolio_summary(state: State<'_, AppState>) -> Result<PortfolioSummary, String> {
    with_db(&state, |conn| {
        let (invested, current, count): (f64, f64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(quantity * avg_cost), 0),
                        COALESCE(SUM(quantity * last_price), 0), COUNT(*)
                 FROM holdings",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        let pnl = current - invested;
        let pnl_pct = if invested > 0.0 { pnl / invested * 100.0 } else { 0.0 };
        Ok(PortfolioSummary { invested, current, pnl, pnl_pct, count })
    })
}

#[tauri::command]
pub fn holding_save(state: State<'_, AppState>, input: HoldingInput) -> Result<Holding, String> {
    let symbol = input.symbol.trim().to_uppercase();
    if symbol.is_empty() {
        return Err("Symbol must not be empty".into());
    }
    if !HOLDING_KINDS.contains(&input.kind.as_str()) {
        return Err(format!("Unknown holding type: {}", input.kind));
    }
    if input.quantity < 0.0 || input.avg_cost < 0.0 || input.last_price < 0.0 {
        return Err("Quantity and prices must not be negative".into());
    }
    with_db(&state, |conn| {
        let now = db::now();
        let name = input.name.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let notes = input.notes.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let quote_key = input.quote_key.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let person_id = match input.person_id {
            Some(p) => p,
            None => db::default_person_id(conn)?,
        };
        let id = match input.id {
            Some(id) => {
                conn.execute(
                    "UPDATE holdings SET symbol = ?1, name = ?2, kind = ?3, quantity = ?4,
                     avg_cost = ?5, last_price = ?6, price_date = ?7, notes = ?8, quote_key = ?9,
                     person_id = ?10, updated_at = ?11 WHERE id = ?12",
                    params![symbol, name, input.kind, input.quantity, input.avg_cost,
                            input.last_price, input.price_date, notes, quote_key, person_id, now, id],
                )
                .map_err(|e| e.to_string())?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO holdings (symbol, name, kind, quantity, avg_cost, last_price,
                     price_date, notes, quote_key, person_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                    params![symbol, name, input.kind, input.quantity, input.avg_cost,
                            input.last_price, input.price_date, notes, quote_key, person_id, now],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        let holding = conn
            .query_row(
                &format!("SELECT {HOLDING_COLS} FROM holdings WHERE id = ?1"),
                params![id],
                holding_from_row,
            )
            .map_err(|e| e.to_string())?;
        index_record(
            conn,
            "holdings",
            id,
            &holding.symbol,
            &format!(
                "{} {} {}",
                holding.kind,
                holding.name.as_deref().unwrap_or(""),
                holding.notes.as_deref().unwrap_or("")
            ),
            holding.person_id,
        )?;
        log_activity(
            conn,
            "portfolio",
            if input.id.is_some() { "updated holding" } else { "added holding" },
            &holding.symbol,
            Some(id),
        )?;
        Ok(holding)
    })
}

/// Update just the price (and its date) of one holding — the fast path behind
/// the "Update prices" screen, so a whole portfolio can be refreshed quickly.
#[tauri::command]
pub fn holding_set_price(
    state: State<'_, AppState>,
    id: i64,
    price: f64,
    date: Option<String>,
) -> Result<Holding, String> {
    if price < 0.0 {
        return Err("Price must not be negative".into());
    }
    with_db(&state, |conn| {
        let now = db::now();
        let date = date.unwrap_or_else(db::today);
        conn.execute(
            "UPDATE holdings SET last_price = ?1, price_date = ?2, updated_at = ?3 WHERE id = ?4",
            params![price, date, now, id],
        )
        .map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("SELECT {HOLDING_COLS} FROM holdings WHERE id = ?1"),
            params![id],
            holding_from_row,
        )
        .map_err(|e| e.to_string())
    })
}

// ---------------------------------------------------------------------------
// Live price fetch — user-initiated only. The only network calls the app ever
// makes. Nothing but the quote key (symbol / scheme code) leaves the machine;
// no personal data, no auth. Runs off the DB lock (no `with_db`).
// ---------------------------------------------------------------------------

fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(12))
        .build()
}

/// Yahoo Finance quote (NSE symbols end in `.NS`, BSE in `.BO`).
fn fetch_stock(agent: &ureq::Agent, symbol: &str) -> Result<f64, String> {
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d"
    );
    let json: serde_json::Value = agent
        .get(&url)
        .set("User-Agent", "Mozilla/5.0")
        .call()
        .map_err(|_| "Couldn't reach the price service".to_string())?
        .into_json()
        .map_err(|_| "Unexpected response".to_string())?;
    json["chart"]["result"][0]["meta"]["regularMarketPrice"]
        .as_f64()
        .ok_or_else(|| format!("No price found for {symbol}"))
}

/// AMFI daily NAV via the free mfapi.in JSON, keyed by scheme code.
fn fetch_fund(agent: &ureq::Agent, scheme: &str) -> Result<f64, String> {
    let url = format!("https://api.mfapi.in/mf/{scheme}/latest");
    let json: serde_json::Value = agent
        .get(&url)
        .call()
        .map_err(|_| "Couldn't reach the NAV service".to_string())?
        .into_json()
        .map_err(|_| "Unexpected response".to_string())?;
    json["data"][0]["nav"]
        .as_str()
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|n| *n > 0.0)
        .ok_or_else(|| format!("No NAV found for scheme {scheme}"))
}

#[tauri::command]
pub fn quote_fetch(items: Vec<QuoteRequest>) -> Result<Vec<QuoteResult>, String> {
    let agent = http_agent();
    let mut out = Vec::with_capacity(items.len());
    for it in items {
        let key = it.quote_key.trim();
        let result = if key.is_empty() {
            Err("No quote symbol set".to_string())
        } else if it.kind == "fund" {
            fetch_fund(&agent, key)
        } else {
            fetch_stock(&agent, key)
        };
        out.push(match result {
            Ok(price) => QuoteResult { id: it.id, price: Some(price), error: None },
            Err(e) => QuoteResult { id: it.id, price: None, error: Some(e) },
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn holding_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        let symbol: Option<String> = conn
            .query_row("SELECT symbol FROM holdings WHERE id = ?1", params![id], |r| r.get(0))
            .ok();
        conn.execute("DELETE FROM holdings WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        unindex_record(conn, "holdings", id)?;
        if let Some(s) = symbol {
            log_activity(conn, "portfolio", "deleted holding", &s, None)?;
        }
        Ok(())
    })
}
