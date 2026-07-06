//! Universal search across every module, backed by one FTS5 index.
//! Person names, nicknames and relationships are part of every owned
//! record's index entry, so searching "Father" surfaces all of Father's
//! documents, accounts, vault entries, notes, tasks and subscriptions.

use super::with_db;
use crate::db::fts_query;
use crate::models::SearchResult;
use crate::AppState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn universal_search(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    let Some(match_expr) = fts_query(&query) else {
        return Ok(Vec::new());
    };
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT module, record_id, title, snippet(search_index, 1, '[', ']', '…', 10), person
                 FROM search_index WHERE search_index MATCH ?1
                 ORDER BY rank LIMIT 50",
            )
            .map_err(|e| e.to_string())?;
        let results = stmt
            .query_map(params![match_expr], |r| {
                Ok(SearchResult {
                    module: r.get(0)?,
                    record_id: r.get(1)?,
                    title: r.get(2)?,
                    snippet: r.get(3)?,
                    person: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(results)
    })
}
