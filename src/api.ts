// Typed wrappers around every Tauri command. All property names are
// snake_case end-to-end (matching the Rust structs).
import { invoke } from "@tauri-apps/api/core";

export type VaultStatus = "setup_required" | "locked" | "unlocked";

// ---------------------------------------------------------------------------
// People — the primary domain object
// ---------------------------------------------------------------------------

export type Relationship =
  | "self"
  | "wife"
  | "husband"
  | "father"
  | "mother"
  | "son"
  | "daughter"
  | "brother"
  | "sister"
  | "friend"
  | "relative"
  | "employee"
  | "client"
  | "other";

export interface Person {
  id: number;
  full_name: string;
  nickname: string | null;
  relationship: Relationship;
  dob: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_default: boolean;
  has_photo: boolean;
  created_at: string;
  updated_at: string;
}

export interface PersonInput {
  id: number | null;
  full_name: string;
  nickname: string | null;
  relationship: Relationship;
  dob: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export type DocType =
  | "aadhaar"
  | "pan"
  | "passport"
  | "driving_licence"
  | "voter_id"
  | "birth_certificate"
  | "insurance"
  | "health_card"
  | "pension_card"
  | "tax"
  | "other";

export interface DocumentFileMeta {
  id: number;
  document_id: number;
  kind: "front" | "back" | "attachment";
  filename: string;
  mime: string;
  size: number;
  created_at: string;
}

export interface Doc {
  id: number;
  person_id: number;
  doc_type: DocType;
  doc_number: string | null;
  name_on_document: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  notes: string | null;
  investment_id: number | null;
  files: DocumentFileMeta[];
  created_at: string;
  updated_at: string;
}

export interface DocInput {
  id: number | null;
  person_id: number;
  doc_type: DocType;
  doc_number: string | null;
  name_on_document: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  notes: string | null;
  investment_id: number | null;
}

export interface PersonOverview {
  person: Person;
  photo: string | null;
  documents: Doc[];
  accounts: Account[];
  vault: VaultItemMeta[];
  notes: NoteMeta[];
  subscriptions: Subscription[];
  investments: InvestmentSummary[];
  tasks: Task[];
  timeline: TimelineEvent[];
}

// ---------------------------------------------------------------------------

export interface Task {
  id: number;
  title: string;
  done: boolean;
  due_date: string | null;
  person_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface QuickNote {
  id: number;
  content: string;
  created_at: string;
}

export interface TimelineEvent {
  id: number;
  source_module: string;
  source_id: number | null;
  kind: string;
  title: string;
  event_date: string;
  amount: number | null;
  notes: string | null;
  person_id: number | null;
  person_name: string | null;
}

export interface Activity {
  id: number;
  module: string;
  action: string;
  title: string;
  record_id: number | null;
  created_at: string;
}

export interface DashboardData {
  today: string;
  tasks: Task[];
  quick_notes: QuickNote[];
  timeline: TimelineEvent[];
  activity: Activity[];
}

export type VaultCategory =
  | "login"
  | "api_key"
  | "ssh_key"
  | "license"
  | "recovery_codes"
  | "wifi"
  | "secure_note";

export interface VaultItemMeta {
  id: number;
  category: VaultCategory;
  name: string;
  username: string | null;
  url: string | null;
  expires_at: string | null;
  person_id: number | null;
  updated_at: string;
}

export interface VaultItem {
  id: number;
  category: VaultCategory;
  name: string;
  fields: Record<string, string>;
  url: string | null;
  notes: string | null;
  expires_at: string | null;
  person_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface VaultItemInput {
  id: number | null;
  category: VaultCategory;
  name: string;
  fields: Record<string, string>;
  url: string | null;
  notes: string | null;
  expires_at: string | null;
  person_id: number | null;
}

export type AccountKind = "bank" | "cash" | "credit_card" | "investment";

/** Structured bank data stored (encrypted) in accounts.details. */
export interface BankCard {
  card_type: string;
  nickname: string;
  last4: string;
  expiry: string; // MM/YY
  notes: string;
}

export interface AccountDetails {
  bank_name?: string;
  branch?: string;
  account_number?: string;
  ifsc?: string;
  cif?: string;
  registered_mobile?: string;
  nominee?: string;
  netbanking?: {
    login_id?: string;
    username?: string;
    password?: string;
    alias?: string;
    security_notes?: string;
  };
  mobile?: {
    mpin?: string;
    app_pin?: string;
    upi_id?: string;
    upi_pin_hint?: string;
  };
  cards?: BankCard[];
}

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  balance: number;
  opening_balance: number;
  notes: string | null;
  person_id: number | null;
  details: AccountDetails;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: number;
  account_id: number;
  account_name: string;
  kind: "expense" | "income" | "transfer_out" | "transfer_in";
  amount: number;
  category: string | null;
  description: string | null;
  date: string;
  transfer_peer_id: number | null;
  created_at: string;
}

export interface TransferInput {
  from_account_id: number;
  to_account_id: number;
  amount: number;
  date: string;
  notes: string | null;
}

export interface TransferResult {
  debit: Transaction;
  credit: Transaction;
}

export type Cycle = "weekly" | "monthly" | "quarterly" | "yearly";

export interface Subscription {
  id: number;
  name: string;
  amount: number;
  cycle: Cycle;
  next_renewal: string;
  active: boolean;
  notes: string | null;
  person_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Emi {
  id: number;
  name: string;
  lender: string | null;
  monthly_amount: number;
  total_months: number;
  months_paid: number;
  next_due: string;
  active: boolean;
  notes: string | null;
  investment_id: number | null;
  settle_account_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceOverview {
  assets: number;
  liabilities: number;
  net_worth: number;
  by_kind: { kind: AccountKind; total: number; count: number }[];
  monthly_subscriptions: number;
  monthly_emi: number;
  active_subscriptions: number;
  active_emis: number;
}

export interface MonthlyFlow {
  month: string;
  income: number;
  expense: number;
}

export interface CategorySpend {
  category: string;
  total: number;
}

export interface FinanceCharts {
  monthly: MonthlyFlow[];
  categories: CategorySpend[];
}

export interface TransactionCategory {
  id: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Investments (land, plot, flat, house — purchase / rent / sale)
// ---------------------------------------------------------------------------

export type InvestmentKind = "land" | "plot" | "flat" | "house" | "shop" | "other";
export type InvestmentTxKind = "purchase" | "expense" | "rent_income" | "sale";
export type InvestmentStatus = "owned" | "rented" | "sold";

export interface RentSchedule {
  id: number;
  investment_id: number;
  monthly_amount: number;
  next_due: string;
  tenant_name: string | null;
  notes: string | null;
  settle_account_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface RentScheduleInput {
  id: number | null;
  investment_id: number;
  monthly_amount: number;
  next_due: string;
  tenant_name: string | null;
  notes: string | null;
  settle_account_id: number | null;
}

export interface InvestmentTransaction {
  id: number;
  investment_id: number;
  kind: InvestmentTxKind;
  amount: number;
  date: string;
  counterparty: string | null;
  notes: string | null;
  settle_account_id: number | null;
  linked_transaction_id: number | null;
  created_at: string;
}

export interface InvestmentTransactionInput {
  id: number | null;
  investment_id: number;
  kind: InvestmentTxKind;
  amount: number;
  date: string;
  counterparty: string | null;
  notes: string | null;
  settle_account_id: number | null;
}

export interface InvestmentSummary {
  id: number;
  name: string;
  kind: InvestmentKind;
  address: string | null;
  notes: string | null;
  person_id: number | null;
  status: InvestmentStatus;
  total_purchase: number;
  total_expense: number;
  total_rent_income: number;
  total_sale: number;
  gain: number;
  rent_schedule: RentSchedule | null;
  created_at: string;
  updated_at: string;
}

export interface InvestmentInput {
  id: number | null;
  person_id: number | null;
  name: string;
  kind: InvestmentKind;
  address: string | null;
  notes: string | null;
}

export interface InvestmentDetail {
  summary: InvestmentSummary;
  transactions: InvestmentTransaction[];
  emis: Emi[];
}

export interface Folder {
  id: number;
  name: string;
}

export interface NoteMeta {
  id: number;
  title: string;
  folder_id: number | null;
  pinned: boolean;
  preview: string;
  tags: string[];
  person_id: number | null;
  updated_at: string;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  folder_id: number | null;
  pinned: boolean;
  tags: string[];
  person_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  module: string;
  record_id: number;
  title: string;
  snippet: string;
  person: string | null;
}

export const api = {
  // auth
  vaultStatus: () => invoke<VaultStatus>("vault_status"),
  setupVault: (password: string) => invoke<void>("setup_vault", { password }),
  unlockVault: (password: string) => invoke<void>("unlock_vault", { password }),
  lockVault: () => invoke<void>("lock_vault"),
  verifyMasterPassword: (password: string) =>
    invoke<boolean>("verify_master_password", { password }),
  changeMasterPassword: (current: string, newPassword: string) =>
    invoke<void>("change_master_password", { current, new: newPassword }),

  // people
  personList: () => invoke<Person[]>("person_list"),
  personSave: (input: PersonInput) => invoke<Person>("person_save", { input }),
  personPhoto: (id: number) => invoke<string | null>("person_photo", { id }),
  personSetPhoto: (id: number, path: string | null) =>
    invoke<void>("person_set_photo", { id, path }),
  personRelatedCounts: (id: number) =>
    invoke<Record<string, number>>("person_related_counts", { id }),
  personDelete: (id: number, reassignTo: number | null) =>
    invoke<void>("person_delete", { id, reassignTo }),
  personOverview: (id: number) => invoke<PersonOverview>("person_overview", { id }),

  // documents
  documentList: (person: number | null) => invoke<Doc[]>("document_list", { person }),
  documentSave: (input: DocInput) => invoke<Doc>("document_save", { input }),
  documentDelete: (id: number) => invoke<void>("document_delete", { id }),
  documentFileAdd: (document: number, kind: string, path: string) =>
    invoke<DocumentFileMeta>("document_file_add", { document, kind, path }),
  documentFileData: (id: number) => invoke<string>("document_file_data", { id }),
  documentFileExport: (id: number, dest: string) =>
    invoke<void>("document_file_export", { id, dest }),
  documentFileDelete: (id: number) => invoke<void>("document_file_delete", { id }),

  // dashboard / tasks / quick notes
  getDashboard: (days: number) => invoke<DashboardData>("get_dashboard", { days }),
  taskSave: (input: {
    id: number | null;
    title: string;
    due_date: string | null;
    person_id: number | null;
  }) => invoke<Task>("task_save", { input }),
  taskToggle: (id: number) => invoke<Task>("task_toggle", { id }),
  taskDelete: (id: number) => invoke<void>("task_delete", { id }),
  quickNoteCreate: (content: string) => invoke<QuickNote>("quick_note_create", { content }),
  quickNoteDelete: (id: number) => invoke<void>("quick_note_delete", { id }),

  // timeline
  timelineUpcoming: (days: number, person: number | null = null) =>
    invoke<TimelineEvent[]>("timeline_upcoming", { days, person }),
  reminderCreate: (title: string, date: string, notes: string | null, person: number | null) =>
    invoke<TimelineEvent>("reminder_create", { title, date, notes, person }),
  timelineDelete: (id: number) => invoke<void>("timeline_delete", { id }),

  // vault
  vaultList: (category: VaultCategory | null, query: string | null) =>
    invoke<VaultItemMeta[]>("vault_list", { category, query }),
  vaultGet: (id: number) => invoke<VaultItem>("vault_get", { id }),
  vaultSave: (input: VaultItemInput) => invoke<VaultItem>("vault_save", { input }),
  vaultDelete: (id: number) => invoke<void>("vault_delete", { id }),

  // finance
  financeOverview: () => invoke<FinanceOverview>("finance_overview"),
  financeCharts: () => invoke<FinanceCharts>("finance_charts"),
  categoryList: () => invoke<TransactionCategory[]>("category_list"),
  categoryCreate: (name: string) => invoke<TransactionCategory>("category_create", { name }),
  categoryRename: (id: number, name: string) => invoke<void>("category_rename", { id, name }),
  categoryDelete: (id: number) => invoke<void>("category_delete", { id }),
  accountList: () => invoke<Account[]>("account_list"),
  accountSave: (input: {
    id: number | null;
    name: string;
    kind: AccountKind;
    opening_balance: number;
    notes: string | null;
    person_id: number | null;
    details: AccountDetails;
  }) => invoke<Account>("account_save", { input }),
  accountRelatedCounts: (id: number) => invoke<Record<string, number>>("account_related_counts", { id }),
  accountDelete: (id: number) => invoke<void>("account_delete", { id }),
  transactionList: (account: number | null, limit: number | null) =>
    invoke<Transaction[]>("transaction_list", { account, limit }),
  transactionSave: (input: {
    id: number | null;
    account_id: number;
    kind: "expense" | "income";
    amount: number;
    category: string | null;
    description: string | null;
    date: string;
  }) => invoke<Transaction>("transaction_save", { input }),
  transactionDelete: (id: number) => invoke<void>("transaction_delete", { id }),
  transactionTransfer: (input: TransferInput) => invoke<TransferResult>("transaction_transfer", { input }),
  subscriptionList: () => invoke<Subscription[]>("subscription_list"),
  subscriptionSave: (input: {
    id: number | null;
    name: string;
    amount: number;
    cycle: Cycle;
    next_renewal: string;
    active: boolean;
    notes: string | null;
    person_id: number | null;
  }) => invoke<Subscription>("subscription_save", { input }),
  subscriptionAdvance: (id: number) => invoke<Subscription>("subscription_advance", { id }),
  subscriptionDelete: (id: number) => invoke<void>("subscription_delete", { id }),
  emiList: () => invoke<Emi[]>("emi_list"),
  emiSave: (input: {
    id: number | null;
    name: string;
    lender: string | null;
    monthly_amount: number;
    total_months: number;
    months_paid: number;
    next_due: string;
    active: boolean;
    notes: string | null;
    investment_id: number | null;
    settle_account_id: number | null;
  }) => invoke<Emi>("emi_save", { input }),
  emiMarkPaid: (id: number) => invoke<Emi>("emi_mark_paid", { id }),
  emiDelete: (id: number) => invoke<void>("emi_delete", { id }),

  // investments
  investmentList: () => invoke<InvestmentSummary[]>("investment_list"),
  investmentDetail: (id: number) => invoke<InvestmentDetail>("investment_detail", { id }),
  investmentSave: (input: InvestmentInput) => invoke<InvestmentSummary>("investment_save", { input }),
  investmentRelatedCounts: (id: number) => invoke<Record<string, number>>("investment_related_counts", { id }),
  investmentDelete: (id: number) => invoke<void>("investment_delete", { id }),
  investmentTransactionList: (investment: number) =>
    invoke<InvestmentTransaction[]>("investment_transaction_list", { investment }),
  investmentTransactionSave: (input: InvestmentTransactionInput) =>
    invoke<InvestmentTransaction>("investment_transaction_save", { input }),
  investmentTransactionDelete: (id: number) => invoke<void>("investment_transaction_delete", { id }),
  rentScheduleSave: (input: RentScheduleInput) => invoke<RentSchedule>("rent_schedule_save", { input }),
  rentScheduleMarkPaid: (id: number) => invoke<RentSchedule>("rent_schedule_mark_paid", { id }),
  rentScheduleDelete: (id: number) => invoke<void>("rent_schedule_delete", { id }),

  // notes
  folderList: () => invoke<Folder[]>("folder_list"),
  folderCreate: (name: string) => invoke<Folder>("folder_create", { name }),
  folderRename: (id: number, name: string) => invoke<void>("folder_rename", { id, name }),
  folderDelete: (id: number) => invoke<void>("folder_delete", { id }),
  noteList: (folder: number | null, tag: string | null, query: string | null) =>
    invoke<NoteMeta[]>("note_list", { folder, tag, query }),
  noteGet: (id: number) => invoke<Note>("note_get", { id }),
  noteSave: (input: {
    id: number | null;
    title: string;
    content: string;
    folder_id: number | null;
    pinned: boolean;
    tags: string[];
    person_id: number | null;
  }) => invoke<Note>("note_save", { input }),
  noteDelete: (id: number) => invoke<void>("note_delete", { id }),
  noteSetReminder: (id: number, date: string | null) =>
    invoke<void>("note_set_reminder", { id, date }),
  tagList: () => invoke<string[]>("tag_list"),

  // search / settings / backup
  universalSearch: (query: string) => invoke<SearchResult[]>("universal_search", { query }),
  settingsGet: () => invoke<Record<string, string>>("settings_get"),
  settingsSet: (key: string, value: string) => invoke<void>("settings_set", { key, value }),
  exportBackup: (path: string, password: string) =>
    invoke<string>("export_backup", { path, password }),
  importBackup: (path: string, password: string) =>
    invoke<Record<string, number>>("import_backup", { path, password }),
  dataFileInfo: () => invoke<Record<string, string>>("data_file_info"),
  autoBackupRun: () => invoke<string | null>("auto_backup_run"),
};
