# PersonalOS — notes for AI assistants

Offline-first, single-user Tauri 2 desktop app. **Read ARCHITECTURE.md first**
(person-centric model, migrations, timeline, search) and SECURITY.md before
touching crypto or storage.

## Ground rules

- **Person-centric**: `persons` is the primary domain object. Any new module
  that stores personal data must carry `person_id REFERENCES persons(id)`,
  default to `db::default_person_id(conn)`, include the owner in its search
  index entry (pass `person_id` to `db::index_record`), and appear in
  `person_overview` + `people::related_counts` + `person_delete` reassignment.
- **No plaintext secrets, ever.** All data lives in the SQLCipher database;
  secret values additionally must never reach the FTS index (`search_index`)
  or the activity log. Forbidden outright: CVV, ATM PIN, UPI PIN, OTP.
- **Timeline**: dated events go through `db::sync_timeline` (one event per
  source+kind, delete+insert). Never insert timeline rows directly except
  manual reminders.
- **Migrations**: extend `db::run_migrations` with idempotent,
  column-presence-checked steps. Never drop or rewrite user tables (FTS index
  is the only rebuildable exception). Add new tables to `backup.rs::TABLES`
  (FK-safe order) or backups will silently miss them.
- Keep the architecture boring: no plugin systems, no DI, no multi-user.

## Build & test (Windows)

```
# PATH needs: %USERPROFILE%\.cargo\bin and C:\Strawberry\perl\bin (vendored OpenSSL build)
npm install
npm run build            # tsc --noEmit (strict, noUnusedLocals) + vite
cd src-tauri && cargo test   # data-layer + crypto + migration tests
npm run tauri build      # release exe + NSIS installer
```

- Debug binary needs `npm run dev` (Vite on :1420); the release binary is
  standalone.
- E2E setup (one-time): `cargo install tauri-driver --locked`; download
  msedgedriver matching the installed WebView2 version (check
  `HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`,
  then `https://msedgedriver.microsoft.com/<version>/edgedriver_win64.zip`).
- E2E run: `tauri-driver --native-driver <msedgedriver.exe>` then
  `node tests/e2e.mjs <shots-dir>` (wipe `%APPDATA%\com.personalos.desktop`
  first; kill leftover `personalos.exe` processes or the release build fails
  with "Access is denied"). WebDriver gotchas: `getText` returns
  CSS-uppercased text (compare case-insensitively); `clear()` doesn't reset
  React controlled inputs — use click + Ctrl+A + overtype; set date inputs
  via `execute/sync` with the native value setter + `input` event; the
  dashboard timeline only shows 30 days, so test dates must fall inside it.
- React footguns already hit once: never define input components inside
  another component (remount per keystroke loses focus/characters); use
  functional `setState` when an async fetch could race a user selection.

## Command conventions

- Commands live in `src-tauri/src/commands/<module>.rs`, take
  `State<AppState>`, return `Result<T, String>`, and go through
  `with_db(&state, |conn| …)` (errors with "locked" when the vault is locked).
  Register new commands in `lib.rs` AND add typed wrappers in `src/api.ts`
  (snake_case field names everywhere; single-word command arg names avoid
  Tauri's camelCase mapping).
- Every mutation: `index_record`/`unindex_record`, `sync_timeline` if dated,
  `log_activity`.
- Frontend refresh model: modules refetch on `refreshKey` bump
  (`onChanged()`); cross-module navigation via `navigate({view, recordModule,
  recordId})` and each module's `focus` prop.
