# PersonalOS — Architecture

Tauri 2 desktop app: React 18 + TypeScript (strict) + Tailwind 4 frontend,
Rust backend, one SQLCipher-encrypted SQLite database. Offline-first,
single-user, no network access.

```
src/                    React frontend
  api.ts                typed wrappers for every Tauri command (snake_case end-to-end)
  App.tsx               view switching, keyboard shortcuts, auto-lock timer
  components/ui.tsx     Modal, Confirm, toasts, PersonSelect/Badge, MasterGate
  modules/              Dashboard, People, Vault, Finance, Notes, Settings,
                        UniversalSearch (Ctrl+Space), QuickCapture (Ctrl+Shift+Space)
src-tauri/src/
  lib.rs                AppState { Mutex<Option<Connection>> }, command registry, tests
  crypto.rs             Argon2id KDF, meta file, backup encryption (XChaCha20-Poly1305)
  db.rs                 schema, migrations, search index, timeline sync, activity log
  commands/             one file per module (auth, people, documents, vault,
                        finance, notes, tasks, timeline, search, settings, backup)
tests/e2e.mjs           WebDriver suite (tauri-driver + msedgedriver)
```

## Person-centric data model (v2)

**`persons` is the primary domain table.** Every personal record belongs to a
person via `person_id`:

```
persons ──┬── documents ── document_files (BLOBs: scans, PDFs)
          ├── accounts ── transactions (inherit person via account)
          ├── vault_items
          ├── notes ── note_tags ── tags
          ├── tasks
          ├── subscriptions
          └── timeline_events
```

- The first person, **"Me"** (`is_default = 1`, relationship `self`), is
  created automatically on first run and by migration; it cannot be deleted.
- New records default to "Me" when no person is chosen (`db::default_person_id`).
- `emis` and `quick_notes` are deliberately household-level (no person link);
  `folders`/`tags` are organisational, not personal.
- Deleting a person **never cascades**: if they own records, the backend
  refuses unless a `reassign_to` person is given, in which case everything is
  moved inside one transaction first. The UI forces this choice.

## Database migration (v1 → v2)

`db::ensure_schema` runs on every setup/unlock/import and is idempotent:

1. `CREATE TABLE IF NOT EXISTS` for all tables (fresh installs get the full
   v2 shape immediately).
2. Column-presence migrations via `PRAGMA table_info`:
   `person_id` added to tasks/vault_items/accounts/notes/subscriptions/
   timeline_events; `details` added to accounts.
3. FTS5 `search_index` gains a `person` column — FTS tables can't be ALTERed,
   so the old index is dropped and rebuilt from source tables.
4. "Me" is created if missing; every record with `person_id IS NULL` is
   backfilled to it.
5. If anything changed, the search index is rebuilt.

No destructive statement is ever executed against user data; the migration is
covered by `v1_database_migrates_to_person_model_without_data_loss` (builds a
byte-accurate v1 schema, fills it, migrates, asserts).

Encrypted backups (`.posb`) restore through the same path, so v1 backups
import cleanly into v2 (BLOB columns travel as `{"__blob__": base64}`).

## Shared timeline

One table, `timeline_events`, with exactly one row per
`(source_module, source_id, kind)` — enforced by `db::sync_timeline`
(delete + insert; `date = None` removes). Sources:

| Source | kind | maintained by |
| ------ | ---- | ------------- |
| subscriptions | `renewal` | subscription save/advance/delete |
| emis | `emi` | EMI save/mark-paid/delete |
| vault_items.expires_at | `expiration` | vault save/delete |
| documents.expiry_date | `document_expiration` | document save/delete |
| tasks.due_date | `task` | task save/toggle/delete |
| notes | `reminder` | note_set_reminder |
| manual | `reminder` | reminder_create (source_module `reminder`) |

Events carry the owner's `person_id`; the dashboard shows the unified feed,
each person dashboard shows their filtered slice. No duplicate entry anywhere.

## Universal search

One FTS5 table (`search_index`, unicode61 + prefix indexes) with columns
`title, body, module, record_id, person`. Every indexed record's body is
augmented with its owner's **full name, nickname and relationship** tokens, so
searching "Father"/"Papa"/"Ramesh" instantly surfaces all of that person's
documents, bank accounts, vault entries, notes, tasks and subscriptions.
Persons themselves are indexed as module `person` (opens their dashboard).

Never indexed: passwords, keys, recovery codes, net-banking credentials,
MPINs, account numbers, CIFs, document numbers. Renaming a person triggers a
full index rebuild to keep tokens consistent.

## Bank account details

`accounts.details` is a JSON blob (like vault `fields`) inside the encrypted
database: bank/branch/IFSC/CIF/nominee, net-banking credentials, mobile
banking (MPIN, app PIN, UPI id, UPI PIN *hint*), and an array of cards
(type/nickname/last-4/expiry — never full numbers). The backend rejects any
key named `cvv`, `atm_pin`, `upi_pin`, `otp` etc. recursively. The UI masks
secret values and requires master-password re-confirmation
(`verify_master_password`) before revealing them.

## Files (photos, document scans)

Stored as BLOBs in the encrypted database (`persons.photo`,
`document_files.data`, ≤ 8/25 MB), so they get the same at-rest encryption as
everything else. Upload passes a filesystem *path* to Rust (no big IPC
payloads); preview returns a data URL; "export" writes a decrypted copy only
on explicit user action via the save dialog.
