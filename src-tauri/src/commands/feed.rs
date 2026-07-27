//! AI Feed: news and YouTube updates from user-configured RSS/Atom sources.
//! Deliberately **not** person-scoped — this is public content, not personal
//! data, the one module in the app without a `person_id`.
//!
//! Network access is on-demand only: nothing is fetched until the user
//! presses Refresh. All egress lives in this one file, mirroring the
//! Portfolio live-price fetch — the app's other documented network
//! exception. See SECURITY.md.

use super::with_db;
use crate::db;
use crate::models::{CatalogEntry, FeedItem, FeedRefreshResult, FeedSource, FeedSourceInput};
use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::time::Duration;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

pub const FEED_KINDS: [&str; 2] = ["news", "youtube"];
const SOURCE_COLS: &str = "id, name, kind, topic, url, enabled, created_at";

fn source_from_row(r: &Row) -> rusqlite::Result<FeedSource> {
    Ok(FeedSource {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        topic: r.get(3)?,
        url: r.get(4)?,
        enabled: r.get(5)?,
        created_at: r.get(6)?,
    })
}

/// Verified, free, no-key-required sources offered per topic in the
/// "Discover" list. Each URL was fetched and confirmed to return real items
/// before shipping. "ai" is intentionally the richest topic — it's the
/// module's reason for existing; the others are a light starting set.
#[tauri::command]
pub fn feed_catalog() -> Vec<CatalogEntry> {
    fn e(name: &str, kind: &str, topic: &str, url: &str) -> CatalogEntry {
        CatalogEntry { name: name.into(), kind: kind.into(), topic: topic.into(), url: url.into() }
    }
    vec![
        e("OpenAI News", "news", "ai", "https://openai.com/news/rss.xml"),
        e("Google DeepMind Blog", "news", "ai", "https://deepmind.google/blog/rss.xml"),
        e("ArXiv — cs.AI (latest papers)", "news", "ai", "https://rss.arxiv.org/rss/cs.AI"),
        e("Hacker News — AI", "news", "ai", "https://hnrss.org/newest?q=AI"),
        e("Two Minute Papers", "youtube", "ai", "https://www.youtube.com/feeds/videos.xml?channel_id=UCbfYPyITQ-7l4upoX8nvctg"),
        e("AI Explained", "youtube", "ai", "https://www.youtube.com/feeds/videos.xml?channel_id=UCNJ1Ymd5yFuUPtn21xtRbbw"),
        e("Yannic Kilcher", "youtube", "ai", "https://www.youtube.com/feeds/videos.xml?channel_id=UCZHmQk67mSJgfCCTn7xBfew"),
        e("TechCrunch", "news", "technology", "https://techcrunch.com/feed/"),
        e("Hacker News — Front Page", "news", "technology", "https://hnrss.org/frontpage"),
        e("NASA News", "news", "science", "https://www.nasa.gov/news-release/feed/"),
        e("ScienceDaily — Top Science", "news", "science", "https://www.sciencedaily.com/rss/top/science.xml"),
        e("Hacker News — Startups & Business", "news", "business", "https://hnrss.org/newest?q=startup+OR+business"),
        e("BBC News — World", "news", "world", "https://feeds.bbci.co.uk/news/world/rss.xml"),
    ]
}

#[tauri::command]
pub fn feed_source_list(state: State<'_, AppState>) -> Result<Vec<FeedSource>, String> {
    with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(&format!("SELECT {SOURCE_COLS} FROM feed_sources ORDER BY topic, kind, name COLLATE NOCASE"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], source_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn feed_source_add(state: State<'_, AppState>, input: FeedSourceInput) -> Result<FeedSource, String> {
    let name = input.name.trim().to_string();
    let url = input.url.trim().to_string();
    let topic = input.topic.trim().to_lowercase();
    let topic = if topic.is_empty() { "ai".to_string() } else { topic };
    if name.is_empty() || url.is_empty() {
        return Err("Name and URL are required".into());
    }
    if !FEED_KINDS.contains(&input.kind.as_str()) {
        return Err(format!("Unknown feed type: {}", input.kind));
    }
    with_db(&state, |conn| {
        conn.execute(
            "INSERT INTO feed_sources (name, kind, topic, url, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![name, input.kind, topic, url, db::now()],
        )
        .map_err(|_| "A source with that URL already exists".to_string())?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            &format!("SELECT {SOURCE_COLS} FROM feed_sources WHERE id = ?1"),
            params![id],
            source_from_row,
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn feed_source_set_enabled(state: State<'_, AppState>, id: i64, enabled: bool) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute("UPDATE feed_sources SET enabled = ?1 WHERE id = ?2", params![enabled, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn feed_source_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute("DELETE FROM feed_sources WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn feed_item_list(
    state: State<'_, AppState>,
    source: Option<i64>,
    topic: Option<String>,
    unread_only: bool,
) -> Result<Vec<FeedItem>, String> {
    with_db(&state, |conn| {
        let mut sql = "SELECT i.id, i.source_id, s.name, s.kind, i.title, i.link, i.summary,
                        i.published_at, i.read, i.fetched_at
                        FROM feed_items i JOIN feed_sources s ON s.id = i.source_id"
            .to_string();
        let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let mut wheres = Vec::new();
        if let Some(sid) = source {
            binds.push(Box::new(sid));
            wheres.push(format!("i.source_id = ?{}", binds.len()));
        }
        if let Some(t) = topic.filter(|t| !t.is_empty()) {
            binds.push(Box::new(t));
            wheres.push(format!("s.topic = ?{}", binds.len()));
        }
        if unread_only {
            wheres.push("i.read = 0".to_string());
        }
        if !wheres.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&wheres.join(" AND "));
        }
        sql.push_str(" ORDER BY COALESCE(i.published_at, i.fetched_at) DESC LIMIT 400");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt
            .query_map(refs.as_slice(), |r| {
                Ok(FeedItem {
                    id: r.get(0)?,
                    source_id: r.get(1)?,
                    source_name: r.get(2)?,
                    source_kind: r.get(3)?,
                    title: r.get(4)?,
                    link: r.get(5)?,
                    summary: r.get(6)?,
                    published_at: r.get(7)?,
                    read: r.get(8)?,
                    fetched_at: r.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn feed_item_mark_read(state: State<'_, AppState>, id: i64, read: bool) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute("UPDATE feed_items SET read = ?1 WHERE id = ?2", params![read, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn feed_mark_all_read(state: State<'_, AppState>) -> Result<(), String> {
    with_db(&state, |conn| {
        conn.execute("UPDATE feed_items SET read = 1 WHERE read = 0", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Open a feed item's link in the system browser. Resolved and opened from
/// Rust (not the webview's IPC-scoped opener command) — same reasoning as
/// `doclib::document_link_open`: a fixed build-time URL scope can't cover
/// arbitrary feed links, and granting the webview "open any URL" is worse
/// than the app doing the open itself.
#[tauri::command]
pub fn feed_item_open(app: tauri::AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let link: String = with_db(&state, |conn| {
        conn.query_row("SELECT link FROM feed_items WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|_| "Item not found".to_string())
    })?;
    app.opener()
        .open_url(link, None::<&str>)
        .map_err(|e| format!("Could not open the link: {e}"))
}

fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(12))
        .user_agent("PersonalOS/1.0 (personal RSS reader)")
        .build()
}

fn item_guid(entry: &feed_rs::model::Entry) -> String {
    if !entry.id.is_empty() {
        entry.id.clone()
    } else if let Some(l) = entry.links.first() {
        l.href.clone()
    } else {
        entry.title.as_ref().map(|t| t.content.clone()).unwrap_or_default()
    }
}

fn strip_html(s: &str) -> String {
    // Feed summaries are often HTML; a light strip is enough for a one-line
    // preview (no need to render markup we'll never display as HTML here).
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn fetch_one(agent: &ureq::Agent, conn: &Connection, src: &FeedSource) -> Result<i64, String> {
    let bytes = agent
        .get(&src.url)
        .call()
        .map_err(|e| format!("Couldn't reach the feed ({e})"))?
        .into_reader();
    let parsed = feed_rs::parser::parse(bytes).map_err(|_| "Not a valid RSS/Atom feed".to_string())?;

    let now = db::now();
    let mut new_count = 0i64;
    for entry in parsed.entries {
        let guid = item_guid(&entry);
        if guid.is_empty() {
            continue;
        }
        let exists: Option<i64> = conn
            .query_row(
                "SELECT id FROM feed_items WHERE source_id = ?1 AND guid = ?2",
                params![src.id, guid],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_some() {
            continue;
        }
        let title = entry
            .title
            .map(|t| t.content)
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| "Untitled".to_string());
        let link = entry
            .links
            .first()
            .map(|l| l.href.clone())
            .unwrap_or_else(|| src.url.clone());
        let summary = entry
            .summary
            .map(|s| strip_html(&s.content))
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(400).collect::<String>());
        let published = entry
            .published
            .or(entry.updated)
            .map(|d| d.to_rfc3339());

        conn.execute(
            "INSERT INTO feed_items (source_id, title, link, summary, published_at, guid, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![src.id, title, link, summary, published, guid, now],
        )
        .map_err(|e| e.to_string())?;
        new_count += 1;
    }
    Ok(new_count)
}

/// Refresh every enabled source. User-initiated only — never called on a
/// timer or on app launch. Each source's failure is isolated so one broken
/// feed doesn't block the rest.
#[tauri::command]
pub fn feed_refresh(state: State<'_, AppState>) -> Result<Vec<FeedRefreshResult>, String> {
    let sources = with_db(&state, |conn| {
        let mut stmt = conn
            .prepare(&format!("SELECT {SOURCE_COLS} FROM feed_sources WHERE enabled = 1"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], source_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })?;

    let agent = http_agent();
    let mut results = Vec::with_capacity(sources.len());
    for src in sources {
        let outcome = with_db(&state, |conn| fetch_one(&agent, conn, &src));
        results.push(match outcome {
            Ok(n) => FeedRefreshResult { source_id: src.id, source_name: src.name, new_items: n, error: None },
            Err(e) => FeedRefreshResult { source_id: src.id, source_name: src.name, new_items: 0, error: Some(e) },
        });
    }

    // Keep the cache bounded — old read items beyond the newest 500 are
    // pruned so the table doesn't grow forever from a "refresh whenever" habit.
    with_db(&state, |conn| {
        conn.execute(
            "DELETE FROM feed_items WHERE read = 1 AND id NOT IN (
                SELECT id FROM feed_items ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT 500
             )",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    Ok(results)
}
