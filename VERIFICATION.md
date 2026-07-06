# Verification Report

What was actually tested before delivery, and how.
v1 report: 2026-07-06 (original build). This report covers the **v2
person-centric enhancement**, verified 2026-07-06 on Windows 11 Pro,
WebView2 149.0.4022.98.

## 1. Automated Rust tests (`cargo test` — 10/10 passed)

Data-layer and crypto tests against real SQLCipher databases in temp dirs:

| Test | Proves |
| ---- | ------ |
| `kdf_is_deterministic_and_salt_sensitive` | Argon2id key derivation properties |
| `backup_roundtrip_and_wrong_password` | Backup container crypto; wrong password/corrupt file rejected |
| `encrypted_at_rest_and_wrong_password_rejected` | DB file has no SQLite header, no plaintext; wrong key fails to open |
| **`v1_database_migrates_to_person_model_without_data_loss`** | Builds the exact v1 schema, fills every table, runs `ensure_schema`: "Me" created as default, every record backfilled to it, counts identical, secrets untouched, search rebuilt with person tokens, migration idempotent |
| **`person_search_documents_and_timeline`** | Searching "father" surfaces the person, their document and subscription; document numbers never searchable; document expiry creates exactly one `document_expiration` timeline event linked to the person; re-sync doesn't duplicate |
| **`search_index_rebuild_never_indexes_secrets`** | Usernames/IFSC searchable; vault passwords, net-banking credentials, login IDs and MPINs never indexed |
| `backup_roundtrip_between_encrypted_databases` | v2 dump (persons, documents, **BLOB document files**) encrypts → restores into a differently-keyed DB byte-for-byte; backup file leaks no plaintext |
| `fts_search_and_timeline_sync` | FTS prefix search; timeline upsert/delete semantics |
| `advance_date_cycles`, `fts_query_building` | Date math, FTS query sanitization |

## 2. Migration E2E with real binaries (7/7 passed)

The **original v1 release binary** (preserved before the upgrade) and the new
v2 binary were driven via WebDriver against the same data directory
(`migration-e2e.mjs`, session scratchpad):

1. v1 binary: create vault, seed a task, vault login (with password), bank
   account (₹75,000), subscription, markdown note. Close.
2. v2 binary: unlock the same encrypted database with the same master
   password — **migration runs on unlock**.
3. Verified: dashboard shows all migrated data; the People module shows
   **"Me"** owning 1 bank account, 1 vault entry, 1 subscription, 1 note and
   the task; the vault password decrypts to the identical value; the account
   balance is intact. No data loss, no errors.

## 3. Full v2 UI E2E suite (`tests/e2e.mjs` — 29/29 passed)

Against the standalone v2 release binary (tauri-driver + msedgedriver
149.0.4022.98), fresh vault. Regression coverage from v1 (dashboard, vault,
finance flows, notes, quick capture, lock/unlock) **plus**:

- Default person "Me" auto-created on first run
- Add person (full name, nickname, relationship Father, phone)
- Add a Passport document with expiry date; document number **masked**
  (`•••• 8990`) by default
- Document expiry automatically appears on the shared dashboard timeline as
  "Ramesh Kumar: Passport expires" (no duplicate entry)
- Bank account owned by Father with bank name, IFSC, net-banking login +
  password, MPIN and a card (type/nickname/last-4)
- Credentials **masked by default** (verified `input type=password` via DOM)
- Reveal gate: wrong master password **rejected**; correct master password
  reveals the exact stored value (verified via DOM property)
- Subscription and vault item assigned to Father
- Universal search "Father" returns his **document, bank account,
  subscription and vault item** in one query; opening the person result lands
  on his dashboard
- Person dashboard aggregates documents, accounts, vault entries,
  subscriptions, tasks, notes and upcoming events
- **Person deletion is guarded**: the delete dialog lists owned records and
  forces reassignment; after "Move records & delete person" every record is
  intact under "Me"
- Lock / wrong-password / unlock still works with all data intact

Screenshots of each stage were captured and visually reviewed.

Two frontend bugs were found *by this suite* and fixed before delivery: a
React input-remount bug that dropped keystrokes in bank credential fields,
and a race that reset the selected person when navigating from search.

## 4. Encryption-at-rest spot check (v2 data)

After the E2E run, the raw `personalos.db` bytes were scanned:

- Header is random (not `SQLite format 3`) ✓
- No plaintext of: document number `P7788990`, net-banking password
  `NetSecret…`, MPIN `445566`, person name `Ramesh`, vault password
  `SecretHub…`, IFSC `HDFC0001234` ✓

## 5. Builds

- `npm run build` — strict TypeScript + Vite: clean ✓
- `cargo test` — zero warnings, 10/10 ✓
- `npm run tauri build` — release exe + NSIS installer produced ✓

## Not covered by automation (honest gaps)

- **Document file upload/preview/export through the UI** — native file
  dialogs cannot be driven by WebDriver. The encrypted BLOB storage and
  roundtrip are covered at the code level
  (`backup_roundtrip_between_encrypted_databases` stores and restores a
  binary PDF byte-for-byte), and the UI path is a thin wrapper
  (dialog → path → `document_file_add`). Worth one manual pass.
- **Person photo upload** — same dialog limitation; same storage mechanism
  as document files.
- **Backup export/import and change-master-password UI paths** — unchanged
  from v1 (still dialog-gated); underlying logic covered by Rust tests.
- **Auto-lock timer** — unchanged from v1; manual lock (same code path) is
  E2E-tested.
- The backend's rejection of forbidden keys (CVV/ATM PIN/UPI PIN/OTP) is
  enforced in `account_save` (`check_forbidden`) and reviewed, but not
  exercised end-to-end since the UI deliberately has no such fields.

## Re-running the suites

```
# terminal 1
tauri-driver --native-driver <msedgedriver.exe matching your WebView2 version>
# terminal 2 (fresh vault: delete %APPDATA%\com.personalos.desktop first)
node tests/e2e.mjs <screenshot-dir>
```
