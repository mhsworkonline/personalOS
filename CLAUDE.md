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
- **Secondary backups**: both `export_backup` (manual) and `auto_backup_run`
  (daily) additionally mirror a timestamped copy to `D:\backups\PersonalOS`
  (`backup.rs::SECONDARY_BACKUP_DIR`/`mirror_to_secondary`), added 2026-08-06
  after [[incident-personalos-data-wipe]] destroyed the only backup location.
  Best-effort by design: a missing D: drive logs a `backup`/"secondary backup
  FAILED" activity entry but must never fail the primary backup. Never make
  this the *only* backup location, and never let a failure here block a
  primary export/auto-backup from completing.
- Keep the architecture boring: no plugin systems, no DI, no multi-user.
- **App data folder safety (read before ANY testing/debugging session):**
  the real vault lives at `%APPDATA%\com.personalos.desktop\personalos.db`
  (+ `.meta.json` + `backups\`). This is **not** exclusive to the release
  build — it's keyed by Tauri's `identifier`, and the debug binary used to
  share that exact identifier with the release build, meaning "wipe app data
  for a clean test vault" silently destroyed real production data. That
  happened once, for real, and cost the user a month of data. It is now
  structurally prevented two ways: (1) `build-app.js test` builds with
  `tauri.test.conf.json` layered on top, giving it the separate identifier
  `com.personalos.desktop.test`; (2) belt-and-suspenders in `lib.rs`'s
  `setup()`, **any** debug build (`cargo build`, `cargo test`, `tauri build
  --debug`, with or without the config override) writes into a nested
  `debug-test-data` subfolder no matter what identifier it resolves to.
  **Never remove or weaken either of these.** Consequences: you can safely
  `Remove-Item -Recurse` a debug build's data directory for a fresh vault —
  it is never the real one. You must **never** run destructive filesystem
  commands against `%APPDATA%\com.personalos.desktop\` itself (its root
  files, not the nested `debug-test-data\` subfolder) without first copying
  it elsewhere and getting explicit confirmation — that path is only ever
  touched by a genuine release build.

## Hidden modules

- **Workbench** (`src/modules/workbench/`) is a UI-only preview with **no
  backend** — every screen reads from `mockData.ts`, its types are not in
  `api.ts`, and it needs a network egress (`src-tauri/src/ai.rs`, unbuilt) to
  ever function. See `AI_WORKBENCH_DESIGN.md` for the full intended design.
  It is currently **hidden from the app** (2026-07): removed from the sidebar,
  routing and Ctrl+K in `App.tsx`, and gated behind `SHOW_WORKBENCH = false`
  in `Settings.tsx` (hides the AI-Providers preview and start-on-Workbench
  toggle). The module files are intentionally kept, not deleted. **To revive:**
  restore the import/nav item/route/Ctrl+K in `App.tsx`, flip `SHOW_WORKBENCH`
  to `true`, then build the real backend per the design doc. Revisit when
  there's appetite to build live AI chat.

## Build & test (Windows)

```
# PATH needs: %USERPROFILE%\.cargo\bin and C:\Strawberry\perl\bin (vendored OpenSSL build)
npm install
npm run build            # tsc --noEmit (strict, noUnusedLocals) + vite
cd src-tauri && cargo test   # data-layer + crypto + migration tests

npm start                # test build + launch it — the normal edit/test loop
npm run release          # gated, bundled, distributable
npm run release 1.1.0    # same, syncing the version across all three files
```

- **`npm start`** is the default after any change: debug profile, `--no-bundle`
  (no installer), output at `out/test/personalos.exe`, then launches it.
- **`npm run release`** is only for explicit releases. It gates on typecheck +
  `cargo test` first, then writes `out/release/` (exe + NSIS installer). Pass a
  version to sync `package.json`, `Cargo.toml` and `tauri.conf.json` — without
  it every installer keeps the same filename and Windows won't treat a newer
  build as an upgrade.
- `out/` is gitignored. Build artifacts must never be committed (they were,
  until they got untracked — don't reintroduce them).

- Debug binary needs `npm run dev` (Vite on :1420); the release binary is
  standalone.
- E2E setup (one-time): `cargo install tauri-driver --locked`; download
  msedgedriver matching the installed WebView2 version (check
  `HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`,
  then `https://msedgedriver.microsoft.com/<version>/edgedriver_win64.zip`).
- E2E run: `tauri-driver --native-driver <msedgedriver.exe>` then
  `node tests/e2e.mjs <shots-dir>` — this targets `target\debug\personalos.exe`
  (never the release binary; see "App data folder safety" above). For a fresh
  vault, wipe `%APPDATA%\com.personalos.desktop\debug-test-data` (the nested
  debug-only subfolder — not its parent). Kill leftover `personalos.exe`
  processes or the build fails with "Access is denied". WebDriver gotchas: `getText` returns
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
