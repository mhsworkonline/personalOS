# PersonalOS

A fast, offline-first, single-user desktop app for daily personal use:
dashboard, people, encrypted vault, finance tracking, markdown notes and
universal search — all stored in one SQLCipher-encrypted SQLite database and
organised around the people in your life.

Built with **Tauri 2 + React + TypeScript + Tailwind CSS** (frontend) and
**Rust** (backend). No network access, no telemetry, no accounts.

## Modules

| Module | What it does |
| ------ | ------------ |
| **Dashboard** | Today's date, quick notes, tasks, unified timeline (renewals, EMI due dates, expirations, reminders, task due dates), recent activity |
| **People** | The primary domain object. Each person (Self, Wife, Father, …) has a dedicated dashboard: profile + photo, government documents (Aadhaar, PAN, passport, …) with encrypted scans/PDFs and expiry tracking, their bank accounts, vault entries, notes, subscriptions, tasks and upcoming events. The default person "Me" is created automatically |
| **Vault** | Logins, API keys, SSH keys, software licenses, recovery codes, Wi-Fi passwords, secure notes — each owned by a person. Master-password protected, password generator, auto-lock, fast search |
| **Finance** | Per-person bank/cash/credit-card/investment accounts with full banking details (branch, IFSC, CIF, net-banking credentials, MPIN, UPI id, cards) — secrets masked until master-password re-confirmation. Manual transactions, subscription tracking, EMI tracking, net-worth overview |
| **Notes** | Markdown editor with preview, folders, tags, pinning, person association, full-text search, follow-up reminders |
| **Universal Search** | `Ctrl+Space` — instant FTS5 search across every module. Searching a name, nickname or relationship ("Father") lists everything that person owns; Enter opens the record |

**Shared timeline:** subscriptions, EMIs, vault expiry dates, document expiry
dates, task due dates and note reminders each maintain their own dated event;
the dashboard aggregates them automatically — no duplicate data entry.

**Person-centric model:** every record belongs to a person (default "Me");
deleting a person never deletes their records — they must be moved to another
person first. Existing v1 databases migrate automatically and losslessly on
first unlock. See [ARCHITECTURE.md](ARCHITECTURE.md).

**Quick Capture:** `Ctrl+Shift+Space` anywhere in the app pops a lightweight
entry box for notes, tasks, reminders, subscriptions or vault logins.

## Keyboard shortcuts

| Keys | Action |
| ---- | ------ |
| `Ctrl+Space` | Universal Search |
| `Ctrl+Shift+Space` | Quick Capture |
| `Ctrl+N` | New note |
| `Ctrl+Shift+V` | Open Vault |
| `Ctrl+F` | Search within current module |
| `Ctrl+,` | Settings |
| `Ctrl+S` | Save note |
| `Ctrl+Shift+L` | Lock now |

## Security

All data is encrypted at rest (SQLCipher / AES-256; key derived from your
master password with Argon2id). Encrypted export/import backups included.
**Read [SECURITY.md](SECURITY.md)** for the full design and its limitations.
There is no password recovery — keep a backup.

## Development

Prerequisites (Windows): Rust (MSVC toolchain), Node 18+, VS Build Tools
C++ workload, Strawberry Perl (for the vendored OpenSSL build), WebView2.

```sh
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce the installer (src-tauri/target/release/bundle)
cargo test             # in src-tauri/: data-layer + crypto tests
```

Data lives in `%APPDATA%\com.personalos.desktop\`. Deleting
`personalos.db` + `personalos.meta.json` resets the app (e.g. if the master
password is lost and you want to restore from a backup: reset, create a new
master password, then Settings → Restore backup).
