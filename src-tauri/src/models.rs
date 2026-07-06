use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// People (the primary domain object — every personal record belongs to one)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct Person {
    pub id: i64,
    pub full_name: String,
    pub nickname: Option<String>,
    pub relationship: String,
    pub dob: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub is_default: bool,
    pub has_photo: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PersonInput {
    pub id: Option<i64>,
    pub full_name: String,
    pub nickname: Option<String>,
    pub relationship: String,
    pub dob: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Document {
    pub id: i64,
    pub person_id: i64,
    pub doc_type: String,
    pub doc_number: Option<String>,
    pub name_on_document: Option<String>,
    pub issue_date: Option<String>,
    pub expiry_date: Option<String>,
    pub issuing_authority: Option<String>,
    pub notes: Option<String>,
    pub files: Vec<DocumentFileMeta>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DocumentInput {
    pub id: Option<i64>,
    pub person_id: i64,
    pub doc_type: String,
    pub doc_number: Option<String>,
    pub name_on_document: Option<String>,
    pub issue_date: Option<String>,
    pub expiry_date: Option<String>,
    pub issuing_authority: Option<String>,
    pub notes: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DocumentFileMeta {
    pub id: i64,
    pub document_id: i64,
    pub kind: String, // "front" | "back" | "attachment"
    pub filename: String,
    pub mime: String,
    pub size: i64,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PersonOverview {
    pub person: Person,
    pub photo: Option<String>, // data URL
    pub documents: Vec<Document>,
    pub accounts: Vec<Account>,
    pub vault: Vec<VaultItemMeta>,
    pub notes: Vec<NoteMeta>,
    pub subscriptions: Vec<Subscription>,
    pub tasks: Vec<Task>,
    pub timeline: Vec<TimelineEvent>,
}

// ---------------------------------------------------------------------------
// Tasks / quick notes
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub done: bool,
    pub due_date: Option<String>,
    pub person_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct QuickNote {
    pub id: i64,
    pub content: String,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct VaultItemMeta {
    pub id: i64,
    pub category: String,
    pub name: String,
    pub username: Option<String>,
    pub url: Option<String>,
    pub expires_at: Option<String>,
    pub person_id: Option<i64>,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VaultItem {
    pub id: i64,
    pub category: String,
    pub name: String,
    pub fields: serde_json::Value,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub expires_at: Option<String>,
    pub person_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VaultItemInput {
    pub id: Option<i64>,
    pub category: String,
    pub name: String,
    pub fields: serde_json::Value,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub expires_at: Option<String>,
    pub person_id: Option<i64>,
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub balance: f64,
    pub notes: Option<String>,
    pub person_id: Option<i64>,
    /// Bank-specific structured data (branch, IFSC, net-banking credentials,
    /// cards, …). Lives inside the SQLCipher-encrypted database like vault
    /// `fields`; secret values are additionally masked in the UI.
    pub details: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AccountInput {
    pub id: Option<i64>,
    pub name: String,
    pub kind: String,
    pub balance: f64,
    pub notes: Option<String>,
    pub person_id: Option<i64>,
    pub details: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Transaction {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub kind: String,
    pub amount: f64,
    pub category: Option<String>,
    pub description: Option<String>,
    pub date: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TransactionInput {
    pub account_id: i64,
    pub kind: String, // "expense" | "income"
    pub amount: f64,
    pub category: Option<String>,
    pub description: Option<String>,
    pub date: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Subscription {
    pub id: i64,
    pub name: String,
    pub amount: f64,
    pub cycle: String,
    pub next_renewal: String,
    pub active: bool,
    pub notes: Option<String>,
    pub person_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SubscriptionInput {
    pub id: Option<i64>,
    pub name: String,
    pub amount: f64,
    pub cycle: String,
    pub next_renewal: String,
    pub active: bool,
    pub notes: Option<String>,
    pub person_id: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Emi {
    pub id: i64,
    pub name: String,
    pub lender: Option<String>,
    pub monthly_amount: f64,
    pub total_months: i64,
    pub months_paid: i64,
    pub next_due: String,
    pub active: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EmiInput {
    pub id: Option<i64>,
    pub name: String,
    pub lender: Option<String>,
    pub monthly_amount: f64,
    pub total_months: i64,
    pub months_paid: i64,
    pub next_due: String,
    pub active: bool,
    pub notes: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct KindTotal {
    pub kind: String,
    pub total: f64,
    pub count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FinanceOverview {
    pub assets: f64,
    pub liabilities: f64,
    pub net_worth: f64,
    pub by_kind: Vec<KindTotal>,
    pub monthly_subscriptions: f64,
    pub monthly_emi: f64,
    pub active_subscriptions: i64,
    pub active_emis: i64,
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct NoteMeta {
    pub id: i64,
    pub title: String,
    pub folder_id: Option<i64>,
    pub pinned: bool,
    pub preview: String,
    pub tags: Vec<String>,
    pub person_id: Option<i64>,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub folder_id: Option<i64>,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub person_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct NoteInput {
    pub id: Option<i64>,
    pub title: String,
    pub content: String,
    pub folder_id: Option<i64>,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub person_id: Option<i64>,
}

// ---------------------------------------------------------------------------
// Timeline / activity / search / dashboard
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct TimelineEvent {
    pub id: i64,
    pub source_module: String,
    pub source_id: Option<i64>,
    pub kind: String,
    pub title: String,
    pub event_date: String,
    pub amount: Option<f64>,
    pub notes: Option<String>,
    pub person_id: Option<i64>,
    pub person_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Activity {
    pub id: i64,
    pub module: String,
    pub action: String,
    pub title: String,
    pub record_id: Option<i64>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub module: String,
    pub record_id: i64,
    pub title: String,
    pub snippet: String,
    pub person: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DashboardData {
    pub today: String,
    pub tasks: Vec<Task>,
    pub quick_notes: Vec<QuickNote>,
    pub timeline: Vec<TimelineEvent>,
    pub activity: Vec<Activity>,
}
