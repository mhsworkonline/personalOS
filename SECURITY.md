# PersonalOS — Security Design

This document explains, in plain language, how PersonalOS protects your data.
It is written for a future security review and for you, the user.

## What is encrypted

Everything. All application data — people and their photos, documents with
their scanned images and PDF attachments, bank account details and
credentials, vault secrets, finance records, notes, tasks, timeline events,
the full-text search index, settings — lives in a single SQLite database
encrypted with **SQLCipher**:

```
%APPDATA%\com.personalos.desktop\personalos.db
```

SQLCipher encrypts every database page with **AES-256 in CBC mode** and
authenticates each page with **HMAC-SHA512**. The WAL journal and any
temporary files SQLCipher creates are encrypted the same way. The file on
disk never contains plaintext (verified in the automated test suite by
scanning the raw file bytes for known plaintext).

One small file is *not* encrypted, and doesn't need to be:

```
%APPDATA%\com.personalos.desktop\personalos.meta.json
```

It stores the key-derivation **salt and parameters** (see below). These are
not secrets — the security of the system rests only on the master password.

## How the master password becomes a key

1. When you create the vault, a random **16-byte salt** is generated
   (`rand::thread_rng`, a CSPRNG).
2. Your master password + salt are fed through **Argon2id v1.3** with
   **64 MiB memory, 3 iterations, 1 lane** (exceeds the OWASP-recommended
   minimums), producing a **32-byte key**. This uses the audited
   [`argon2`](https://crates.io/crates/argon2) RustCrypto crate.
3. That key is handed to SQLCipher as a **raw key**
   (`PRAGMA key = "x'…'"`), which skips SQLCipher's own (PBKDF2) KDF —
   Argon2id already did the hard work.
4. Opening the database with a wrong key fails on the first page read
   (HMAC mismatch), which the app reports as "Invalid master password".

## Key handling rules

- The master password and derived key are **never written to disk**, never
  logged, and never leave the Rust process.
- The derived key lives in a `Zeroizing<[u8; 32]>` buffer (from the
  [`zeroize`](https://crates.io/crates/zeroize) crate) that is wiped from
  memory as soon as the database connection is keyed.
- `PRAGMA cipher_memory_security = ON` makes SQLCipher zero its own internal
  key material and page buffers when they are freed.
- **Locking** (manual, or auto-lock after configurable inactivity, default
  5 minutes) drops the database connection entirely; nothing decryptable
  stays in the process afterwards.
- There is **no recovery mechanism** by design. If the master password is
  lost, the data is unrecoverable. (Keep an encrypted backup with a password
  you won't lose.)

## Changing the master password

Re-keying uses SQLCipher's supported path for WAL-mode databases:
`sqlcipher_export()` copies the entire database into a fresh file keyed with
the new Argon2id-derived key (new random salt), then the files are swapped
atomically and the old file is deleted. A failure mid-way rolls back to the
old file, so the vault always opens with exactly one of the two passwords.

## Encrypted backups

Export produces a single `.posb` file:

```
"POSBK1" | version (1 byte) | salt (16) | nonce (24) | ciphertext
```

- The plaintext is a JSON dump of every table.
- The key is derived from a **backup password of your choice** (may differ
  from the master password) with the same Argon2id parameters and a **fresh
  random salt** stored in the header.
- Encryption is **XChaCha20-Poly1305** (RustCrypto `chacha20poly1305`
  crate) — an AEAD, so any tampering or a wrong password is detected
  cryptographically (decryption simply fails).
- Restore decrypts, replaces all data inside one SQL transaction, and
  rebuilds the search index.

## Documents and uploaded files

Document scans (front/back images) and attachments (PDFs etc.) are stored as
BLOBs **inside the encrypted database** — they get exactly the same at-rest
protection as every other record; nothing is written decrypted to disk.
Person photos work the same way. "Export" in the document editor writes a
decrypted copy only on explicit user action, to a location the user picks.
Document numbers (Aadhaar, PAN, passport, …) are masked in the UI by default
and are never added to the search index.

## Bank account credentials

Bank details (branch, IFSC, CIF, net-banking login/password, MPIN, app PIN,
UPI id, card metadata) are stored in the `accounts.details` JSON blob inside
the encrypted database — the same strategy as vault secrets. On top of that:

- Secret values (passwords, MPINs, account numbers, CIF) are **masked in the
  UI** and revealing them requires **re-entering the master password**
  (`verify_master_password` re-derives the Argon2id key and test-opens the
  database; a wrong password reveals nothing).
- **ATM PINs, CVVs, UPI PINs and OTPs are never stored.** The backend
  recursively rejects any detail key with those names, so no UI or future code
  path can slip them in. Only a UPI PIN *hint* field exists. Cards store type,
  nickname, last-4 and expiry — never full card numbers.
- None of the credential values are ever indexed for search (covered by the
  `search_index_rebuild_never_indexes_secrets` test).

## Full-text search index

The FTS5 search index lives inside the same encrypted database, so it is
encrypted at rest like everything else. It deliberately indexes only
non-secret material: item names, usernames, URLs, notes, tags, note content,
person names/nicknames/relationships, bank name/branch/IFSC — **never
passwords, API keys, private keys, license keys, recovery codes, net-banking
credentials, MPINs, account numbers or document numbers** (covered by tests).
Owner tokens (name, nickname, relationship) are added to each record's index
entry so person-based search works; these are identifiers, not secrets.

## Cryptography inventory

| Purpose            | Algorithm             | Implementation                       |
| ------------------ | --------------------- | ------------------------------------ |
| Password → key     | Argon2id (64 MiB/3/1) | `argon2` 0.5 (RustCrypto)            |
| Database at rest   | AES-256-CBC + HMAC-SHA512 per page | SQLCipher (bundled via `rusqlite`, OpenSSL crypto provider) |
| Backup files       | XChaCha20-Poly1305    | `chacha20poly1305` 0.10 (RustCrypto) |
| Randomness         | OS CSPRNG             | `rand` 0.8 (`thread_rng`)            |
| Key memory hygiene | Explicit zeroization  | `zeroize` 1.x                        |
| Password generator | Rejection sampling over `crypto.getRandomValues` | frontend, `src/lib/passwordGen.ts` |

## Known limitations (honest notes)

- The master password crosses the Tauri IPC boundary as a JavaScript string
  during unlock; JS strings cannot be zeroized. This is inherent to webview
  UIs; exposure is limited to process memory while the app runs.
- While the vault is **unlocked**, decrypted data is necessarily present in
  process memory (as with any password manager).
- Values copied with the copy buttons go to the OS clipboard; clear it
  yourself if you copy something sensitive on a shared machine.
- There is no protection against malware running as your user account —
  no desktop application can provide that.
