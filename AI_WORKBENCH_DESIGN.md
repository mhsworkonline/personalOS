# AI Workbench — Design Document

Product + UX design for a new built-in PersonalOS module. **This document is the
complete design phase**: an implementer (Claude Sonnet) should be able to build
the module from this file plus ARCHITECTURE.md / CLAUDE.md / SECURITY.md without
another design round. No production code appears here by design.

---

## 1. Positioning — where AI Workbench fits

```
PersonalOS   → manages the person        (documents, money, vault, people, notes)
AI Workbench → manages everyday AI work  (chats, research, decisions, prompts, ideas)
AIOS         → manages software projects (PMOS → SAOS → PDOS, file-based frameworks)
```

AI Workbench is a **module inside PersonalOS**, peer to People/Vault/Finance/Notes,
and is intended to become the **default daily landing view** for the user. It is
where AI-assisted thinking, writing, research and analysis happen day to day.
It does **not** run software projects — the moment work becomes "build software",
it is handed off to AIOS as files (§8) and the Workbench goes back to being the
thinking space around it.

What it deliberately is NOT:

- Not a project manager, task tracker, or delivery tool (AIOS/PDOS owns that).
- Not a replacement for PersonalOS Notes (personal/life notes stay there) or
  QuickCapture (household scratch notes stay there). Workbench knowledge is
  *work-and-thinking* knowledge; the two never share tables.
- Not multi-user, not a plugin host, not an agent framework.

### The one architectural exception: network

PersonalOS is offline-first with no network access. Live AI chat is the first
feature that requires egress. This is handled as a **single, explicit, documented
exception**, not an erosion of the rule:

- All network I/O lives in one backend file (`src-tauri/src/ai.rs`), which talks
  **only** to the LLM provider endpoints the user has configured. Nothing else in
  the app gains network access.
- No key configured → no socket is ever opened. The module is fully usable
  offline for everything except "send message" (library, cards, drafting,
  reading old chats all work offline).
- A local provider (Ollama / any OpenAI-compatible localhost URL) keeps even
  chat fully offline for users who want that.
- API keys are stored in the SQLCipher database like account credentials:
  masked in the UI, reveal requires `verify_master_password`, never indexed,
  never logged. SECURITY.md must gain a short section describing this exception.

---

## 2. Design decisions (the big calls, up front)

| Decision | Choice | Why |
|---|---|---|
| Knowledge model | **One table, `cards`, with a `kind` discriminator** (`idea`, `insight`, `decision`, `prompt`, `snippet`) | Collapses notes/research/decisions/prompts/snippets/ideas into one entity → one editor, one list, one search path, one command set. The kinds differ by template and accent color, not by architecture. |
| Grouping | **A single optional free-text `topic`** on chats and cards. No folders, no spaces, no hierarchies. | FTS + kind filter + topic filter covers a solo user for years. Folders are where knowledge goes to die. |
| Multi-model comparison | A **mode of a chat**, not a separate feature. Each user turn fans out to the selected models; each model keeps its own parallel response thread. | Comparison is something you do *while chatting*, not a different place you go. |
| Conversations → knowledge | Explicit **Distill** action (chat/selection → card with provenance link). Never automatic. | Auto-summarizing every chat creates noise. Deliberate capture keeps the library 100% signal. |
| AIOS integration | **One-way markdown export** ("Send to project" writes a file into a project folder) + a `project` filter field. No API, no shared DB, no sync. | AIOS is file-based (FRAMEWORK.md + artifacts). Files are its native interface; anything richer is coupling for no benefit. |
| Person-centricity | `person_id` on `chats` and `cards`, defaulting to "Me", plumbed through search index / person_overview / related_counts / person_delete per the ground rules. **No person picker in the UI** — v1 assumes all AI work is Me's. | Complies with the architecture invariant at zero UI cost. |
| Timeline | Only **decision review dates** sync to the timeline (kind `decision_review`). Chats/cards otherwise stay off the timeline. | The timeline is for dated upcoming events. "Revisit this decision in 3 months" is exactly that; everything else would be noise. |
| Search index | Cards indexed fully (except `prompt`/`snippet` bodies are indexed — they contain no secrets by rule). Chats indexed as **title + user messages only** (assistant output excluded). | Keeps FTS lean and keeps searching aligned with *your* intent ("what did I ask about X"), not model verbosity. |
| Recent activity | **Derived** from `updated_at` on chats + cards. No activity table of its own. | The data already exists; a feed table would be pure duplication. |

---

## 3. Navigation

### App-level

`View` union gains `"workbench"`. Sidebar order (Workbench is the daily
workspace, so it sits directly under Dashboard):

```
┌──────────────┐
│ PersonalOS   │
│──────────────│
│ ◇ Dashboard  │
│ ✦ Workbench  │   ← new, kbd Ctrl+K
│ ◇ People     │
│ ◇ Vault      │
│ ◇ Finance    │
│ ◇ Notes      │
│──────────────│
│ ⚙ Settings   │
└──────────────┘
```

- **Ctrl+K** from anywhere: open Workbench on Home with the launcher input
  focused (one keystroke from "thought" to "typing at a model").
- A Settings toggle **"Start on Workbench"** makes it the post-unlock landing
  view (default off; flipping it is how it "becomes the primary workspace"
  without forcing it on day one).
- UniversalSearch (Ctrl+Space) results gain modules `chat` and `card`; opening
  one navigates via the existing `navigate({view:"workbench", recordModule,
  recordId})` + `focus` prop pattern.

### Inside the module

Three sub-views, switched by a slim tab row (state local to the module, plus
`focus` prop handling for cross-module navigation):

```
Home   |   Chats   |   Library
```

- **Home** — launcher, idea inbox, pinned prompts, recent activity.
- **Chats** — conversation list + active chat (or compare) pane.
- **Library** — all cards, filterable by kind / topic / project.

No deeper navigation exists. Every screen is at most two clicks from any other.
Within the module: **N** = new chat, **I** = quick idea, **/** = filter the
current list. (Plain single-letter keys, active only when no input is focused —
same convention the rest of the app can adopt later.)

---

## 4. Information architecture

Two content entities, one config entity:

```
ai_providers (config)      chats ──── chat_messages
                             │ distill
                             ▼
                           cards  (kind: idea | insight | decision | prompt | snippet)
```

- **Chat** — a conversation. `mode` is `single` or `compare`. Ephemeral by
  temperament: chats are working material, expected to be distilled and
  eventually archived.
- **Card** — the durable unit of knowledge. Everything reusable is a card:
  - `idea` — quick capture, near-zero friction, an inbox to triage later.
  - `insight` — research findings, knowledge capture, work notes, analysis
    write-ups. The general-purpose kind.
  - `decision` — decision journal entry. Body follows a template (Context /
    Options / Decision / Why / Review on). Optional review date → timeline.
  - `prompt` — a prompt **pattern**: reusable body with `{{variable}}`
    placeholders, not a frozen string. Launchable from Home.
  - `snippet` — a code snippet with a `language` tag, rendered monospaced.
- **Provenance** — a card created by Distill stores `source_chat_id`; the card
  shows "from chat: …" and the chat shows "distilled into: …". This is the
  entire lineage system — one nullable column.
- **Lifecycle flags** — `pinned` (surfaces on Home) and `archived` (hidden from
  default lists, still searchable). No statuses, no workflow states.
- **Idea triage** — an idea either gets deleted, or "promoted": its kind is
  changed to `insight`/`decision`/`prompt`/`snippet` in place (same row, same
  id, history preserved). Promotion is a one-click kind change, not a copy.

---

## 5. Minimal data model

Follows every CLAUDE.md ground rule (person_id, idempotent column-checked
migrations, backup TABLES registration in FK-safe order: `ai_providers`,
`chats`, `chat_messages`, `cards`).

```sql
ai_providers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,              -- "Anthropic", "OpenAI", "Local (Ollama)"
  kind TEXT NOT NULL,              -- 'anthropic' | 'openai_compat'
  base_url TEXT NOT NULL,          -- editable; localhost URLs = offline chat
  api_key TEXT NOT NULL DEFAULT '',-- SECRET: masked in UI, reveal gated by
                                   -- verify_master_password; never indexed/logged
  models TEXT NOT NULL DEFAULT '[]', -- JSON array of model id strings (user-editable)
  enabled INTEGER NOT NULL DEFAULT 1
)

chats (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES persons(id),  -- default db::default_person_id
  title TEXT NOT NULL,             -- auto: first user message truncated; renamable
  mode TEXT NOT NULL DEFAULT 'single',   -- 'single' | 'compare'
  models TEXT NOT NULL DEFAULT '[]',     -- JSON ["provider_id:model_id", ...]; 1 in single mode
  topic TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

chat_messages (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id),
  role TEXT NOT NULL,              -- 'user' | 'assistant'
  model TEXT NOT NULL DEFAULT '',  -- '' for user msgs; "provider_id:model_id" for assistant
  content TEXT NOT NULL,           -- markdown
  error TEXT NOT NULL DEFAULT '',  -- non-empty = failed turn (kept for retry UI)
  created_at TEXT NOT NULL
)

cards (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES persons(id),
  kind TEXT NOT NULL,              -- 'idea'|'insight'|'decision'|'prompt'|'snippet'
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',   -- markdown; prompt kind may contain {{variables}}
  topic TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',        -- AIOS project slug, free text (§8)
  language TEXT NOT NULL DEFAULT '',       -- snippet kind only
  review_on TEXT NOT NULL DEFAULT '',      -- decision kind only, ISO date or ''
  source_chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)
```

**Deliberately absent** (each considered and cut): tags table (topic string +
FTS suffice), message token counts / cost tracking, chat branching, embeddings,
card↔card links, folders, attachments, per-message metadata JSON.

### Plumbing obligations (per ground rules)

- `db::index_record` on every card save (title + body + topic, owner person
  passed) and every chat save (title + concatenated **user** messages only).
  `unindex_record` on delete. **API keys never touch the index.**
- `db::sync_timeline(source_module='cards', kind='decision_review')` when a
  decision card's `review_on` is set/changed/cleared/deleted.
- `log_activity` on every mutation ("chat created", "provider updated" — never
  content, never keys).
- `person_overview`, `people::related_counts`, `person_delete` reassignment
  gain `chats` + `cards` counts/moves.
- New commands in `src-tauri/src/commands/workbench.rs`, registered in
  `lib.rs`, typed wrappers in `src/api.ts`, all through `with_db`.

### Backend command surface (names only — signatures follow module conventions)

```
providers:  provider_list / provider_save / provider_delete / provider_reveal_key
chats:      chat_list / chat_get / chat_save (title/topic/mode/models/archived)
            chat_delete / chat_send (persist user msg, fan out, stream via Tauri
            events `workbench://token` + `workbench://done`, persist responses)
            chat_retry (re-send a failed turn) / chat_adopt (compare → new
            single chat from one model's thread)
cards:      card_list (kind/topic/project/archived/pinned filters, FTS query)
            card_get / card_save / card_delete / card_distill (chat_id +
            optional message ids + kind → new card draft body)
            card_export (card ids + target dir → writes markdown file, §8)
```

`chat_send` is the only command that opens a network connection.

---

## 6. Primary workflows

1. **Ask** — Ctrl+K → Home launcher already focused → type → Enter. A chat is
   created with the default model and the reply streams in. *(≈2 seconds from
   thought to streaming.)*
2. **Compare** — in the launcher (or an existing chat header) toggle Compare
   and tick 2–4 models. Every user turn fans out; responses render side by
   side. "Adopt →" under any column creates a new single chat carrying the
   user messages + that model's responses.
3. **Capture an idea** — press **I** anywhere in the Workbench (or the Home
   idea box): one line, Enter, done. It lands in the Idea inbox on Home.
4. **Distill** — in any chat: `Distill` button (whole chat) or select messages
   → `Distill selection`. Pick a kind → card editor opens pre-filled (title
   suggested from chat title, body from selection, `source_chat_id` set).
   Optionally press "AI summarize" in the editor to have the current default
   model condense the draft before saving.
5. **Decide** — new card → kind `decision` → template body appears (Context /
   Options / Decision / Why / Review on). Setting *Review on* puts a
   `decision_review` event on the PersonalOS timeline, so the dashboard
   resurfaces it on the right day.
6. **Reuse a prompt** — Home shows pinned prompt cards. Click one → if it has
   `{{variables}}`, a small fill-in form appears → Launch starts a chat with
   the rendered prompt. (Prompt cards are patterns, so the same card serves
   "summarize {{text}} for {{audience}}" forever.)
7. **Research** — a chat (often compare mode) + distilled `insight` cards
   sharing a `topic`. Filtering Library by that topic later reads as a
   research dossier. No dedicated "research" feature exists — this composition
   *is* the feature.
8. **Write/analyze with AI** — a chat is the drafting surface (markdown
   renders); the finished artifact is distilled to an `insight` card or
   exported as a file. No separate editor-with-AI is built.

---

## 7. How conversations become reusable knowledge

The pipeline is deliberately a funnel, each step explicit and lossless:

```
chat (working material, cheap, plentiful)
  └─ Distill → card draft (user confirms kind, trims, optionally AI-summarizes)
       └─ card (durable, searchable, pinned/topic'd, provenance-linked)
            └─ Export → markdown file in an AIOS project (leaves the app)
```

Rules that make this work long-term:

- **Nothing is knowledge until a human says so.** No auto-capture.
- **Provenance is always one click away** (`source_chat_id` both directions).
- **Chats age out, cards don't.** Archiving old chats is guilt-free because
  anything valuable was distilled; the Library stays small and high-signal.
- **Cards are plain markdown.** They can be exported, pasted, or read in ten
  years with no lock-in.

---

## 8. Integration with AIOS

AIOS is a file-based system: PMOS/SAOS/PDOS frameworks consuming and producing
markdown artifacts in project folders. The Workbench therefore integrates at
the **file layer**, one-way, on explicit user action:

- **`project` field on cards** — free-text slug (e.g. `personalos`,
  `bug-tracker`). Library filters by it. This is bookkeeping, not coupling.
- **"Send to project"** (single card or current Library filter selection) —
  a save-dialog export that writes `workbench-<kind>-<slug>.md` (or one
  combined `workbench-export-<date>.md`) with title, kind, topic, dates and
  body. The user points it at the AIOS project folder; PMOS/SAOS sessions then
  read it like any other input document. Uses the existing "decrypted copy
  only on explicit user action via save dialog" file-export convention.
- **Typical flows**: pre-PMOS research (`insight` cards → export → PMOS input);
  decisions made mid-project in a Workbench chat → `decision` card → export
  into the project's decision log; prompt patterns used to run AIOS sessions
  live as `prompt` cards.
- **Nothing flows back automatically.** If AIOS artifacts contain reusable
  wisdom, the user pastes it into a card. Keeping the boundary manual keeps
  both systems independently simple, and matches AIOS's own principle that
  state is written down in files, not held in integrations.

---

## 9. UX principles

1. **One keystroke to a model.** Ctrl+K anywhere → cursor in the launcher.
   The module's core loop must be faster than opening a browser tab.
2. **Capture is cheaper than organizing.** Ideas are one line; filing (kind,
   topic, project) happens later or never. Filters and FTS do the organizing.
3. **Distill, don't hoard.** The UI nudges chat → card (Distill is the primary
   chat action) and makes archiving chats painless.
4. **Five kinds, one shape.** Every knowledge object looks and behaves the
   same; kind changes the template and accent, nothing else. New concepts are
   never introduced when a kind would do.
5. **Provenance visible, never demanded.** Links are created as a side effect
   of Distill; the user never manually "relates" things.
6. **Offline is a mode, not an error.** With no key or no network, everything
   except sending works, and the UI says exactly that once, quietly.
7. **Calm density.** Text-first lists, no cards-with-thumbnails, no badges
   competing for attention. Color is used only for kind accents and errors.
8. **Boring architecture.** Same module patterns as the rest of PersonalOS:
   `refreshKey` refetch, `focus` prop, `Result<T,String>` commands, snake_case.

---

## 10. Daily usage flow

```
unlock → Workbench Home (if "start on Workbench" is on)
  ├─ glance: idea inbox (triage 0–3 ideas: promote or delete)
  ├─ glance: recent activity (resume yesterday's chat in one click)
  ├─ any decision_review due today already appeared on the PersonalOS
  │  dashboard timeline → opens the decision card directly
  └─ work loop, repeated all day:
       Ctrl+K → ask → (maybe compare) → distill what mattered → archive chat
       stray thought at any moment → I → one line → back to work
end of week (optional, 5 min): Library → filter kind=idea → triage;
  filter topic=<current work> → export to AIOS project if useful
```

The design target: **zero maintenance required**. Triage and weekly review are
optional hygiene, not obligations the UI punishes you for skipping.

---

## 11. Screens

Layout constants: the module renders inside the existing content area (sidebar
stays). Desktop-first; at widths under ~1100px, two-pane screens collapse to a
single pane with back navigation (list → detail). Under ~900px, compare mode
stacks model columns vertically. All lists virtualize past ~200 rows.

Legend for wireframes: `▣` pinned, `◷` timestamp, `⋯` overflow menu,
`[ ]` button, `(...)` input.

### 11.1 Workbench Home (dashboard)

```
┌────────────────────────────────────────────────────────────────────┐
│ Home   Chats   Library                              [ + New chat ] │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ( Ask anything…                                    ) [Send]      │
│   model: claude-sonnet ▾    □ Compare                              │
│                                                                    │
├──────────────────────────────┬─────────────────────────────────────┤
│ IDEAS (3)          [ + I ]   │ PINNED PROMPTS                      │
│ • cache invalidation angle…  │ ▣ Summarize for {{audience}}        │
│ • try compare on pricing q   │ ▣ Code review checklist             │
│ • blog: offline-first AI     │ ▣ Weekly plan from notes            │
│   promote ▾ · delete         │                                     │
├──────────────────────────────┴─────────────────────────────────────┤
│ RECENT                                                             │
│ ⌁ chat  SQLCipher key rotation approaches            ◷ 2h          │
│ ◆ card  Decision: stay on Tailwind 4                 ◷ 1d          │
│ ⌁ chat  compare: pricing page copy (3 models)        ◷ 1d          │
│ ◆ card  Prompt: summarize for {{audience}}           ◷ 3d          │
└────────────────────────────────────────────────────────────────────┘
```

- **Launcher** (top): a real input, focused on view entry and via Ctrl+K.
  Enter creates a chat and jumps to it. The model picker remembers its last
  choice; Compare checkbox expands into model checkboxes when ticked.
- **Ideas**: newest 5, one-line each, inline `promote ▾` (kind menu) and
  delete. Header count links to Library filtered to kind=idea.
- **Pinned prompts**: pinned `prompt` cards; click → variable fill-in (if any)
  → launch. Pinned non-prompt cards are *not* shown here (Home is for action).
- **Recent**: last 10 chats+cards by `updated_at`, one line each, click to open.

**Rationale**: Home answers exactly three questions — "let me ask something
now" (launcher, dominant), "what did I capture" (ideas), "where was I"
(recent). No stats, no charts, no streaks: a launcher, not a report.

**Empty state** (first run): launcher stays prominent; below it one quiet
block: *"Your ideas, prompts and recent work will appear here. Add a provider
key in Settings → AI Providers to start chatting."* with a [Open Settings]
button — shown only while no provider is enabled.
**Loading**: skeleton rows in the three blocks; launcher is interactive
immediately.
**Error**: per-block inline "Couldn't load — [Retry]" (blocks fail
independently; the launcher never blocks on them).

### 11.2 Chats — list + single chat

```
┌──────────────────────┬─────────────────────────────────────────────┐
│ (filter… /)  [+ New] │ SQLCipher key rotation      topic: personalos│
│──────────────────────│ claude-sonnet ▾   [Distill] [Archive]  ⋯    │
│ ● SQLCipher key rot… │─────────────────────────────────────────────│
│   ◷ 2h · personalos  │  you  ◷ 14:02                               │
│   pricing page copy  │  How do I rotate the SQLCipher key without… │
│   ◷ 1d · compare(3)  │                                             │
│   tailwind v4 quirks │  claude-sonnet  ◷ 14:02                     │
│   ◷ 3d               │  There are two viable approaches…           │
│                      │  ```rust … ```                              │
│ [show archived]      │  ── distilled into: ◆ Key rotation options ─│
│                      │─────────────────────────────────────────────│
│                      │ ( Message…                        ) [Send]  │
└──────────────────────┴─────────────────────────────────────────────┘
```

- Left pane: chats newest-first, `/` focuses filter (matches title/topic),
  compare chats badged `compare(n)`. Archived hidden behind a toggle.
- Right pane: transcript in rendered markdown (code blocks get a copy button —
  reusing the app's existing markdown/code styling). Sticky header: rename
  (click title), model switcher (affects future turns), topic field, Distill,
  Archive, ⋯ (delete, adopt-into-compare).
- Streaming: assistant message renders tokens as they arrive (Tauri events);
  a Stop button replaces Send during generation.
- Message selection mode (checkbox appears on hover) → header shows
  `[Distill selection]`.
- Distilled-into links render inline under the source messages.

**Rationale**: classic two-pane chat because it is the most-learned pattern in
the category; novelty here would only add friction. Distill lives in the
header — always visible, reinforcing the funnel (§7).

**Empty** (no chats): right pane shows the same launcher input as Home
(*"Start your first conversation"*).
**Loading**: list skeleton; opening a chat shows header instantly, transcript
skeleton under it.
**Errors**: a failed send renders as a red-tinted assistant bubble with the
error text (`error` column) and [Retry] — the user's message is already
persisted, so nothing is lost. Offline / no-key: composer stays enabled but
Send is replaced by a quiet inline note *"Offline — message will not send"* /
*"No provider configured — Settings → AI Providers"*. Locked vault mid-stream:
standard "locked" error path; the partial response is persisted with an error
marker so the chat is consistent after unlock.

### 11.3 Compare mode (same screen, chat in `mode='compare'`)

```
┌──────────────────────┬─────────────────────────────────────────────┐
│ (chats list…)        │ pricing page copy          compare · 3 models│
│                      │─────────────────────────────────────────────│
│                      │  you ◷ : Rewrite this pricing section…      │
│                      │ ┌───────────────┬───────────────┬──────────┐│
│                      │ │ claude-sonnet │ gpt-5         │ local    ││
│                      │ │ Here's a…     │ Consider…     │ Pricing… ││
│                      │ │               │               │          ││
│                      │ │ [Adopt →]     │ [Adopt →]     │ [Adopt →]││
│                      │ └───────────────┴───────────────┴──────────┘│
│                      │  you ◷ : Make variant B more concrete       │
│                      │ ┌───────────────┬───────────────┬──────────┐│
│                      │ │ …             │ …             │ …        ││
│                      │─────────────────────────────────────────────│
│                      │ ( Message all 3…                  ) [Send]  │
└──────────────────────┴─────────────────────────────────────────────┘
```

- Each user turn fans out; each model's history = shared user messages + its
  own prior responses (true parallel threads, honest multi-turn comparison).
- Columns share one scroll, aligned per turn; equal widths; 2–4 models
  (enforced cap — more is unreadable and expensive).
- **Adopt →** creates a new `single` chat containing the user messages + that
  model's responses, and navigates to it. The compare chat remains untouched.
- Distill works here too (selection includes which column).

**Rationale**: comparison as a chat mode means zero new IA. The per-turn
aligned grid is the only layout that makes multi-turn divergence legible.
Under ~900px columns stack per turn (model name as a small header) — readable,
if less comparable, on narrow windows.

**Partial failure**: a column whose request failed shows the error + [Retry]
in that column only; other columns are unaffected.

### 11.4 Library

```
┌────────────────────────────────────────────────────────────────────┐
│ Home  Chats  Library                                [ + New card ] │
├────────────────────────────────────────────────────────────────────┤
│ (search… /)  kind: All ▾  topic: All ▾  project: All ▾  □ archived │
├────────────────────────────────────────────────────────────────────┤
│ ▣ ◆ prompt   Summarize for {{audience}}          writing     ◷ 3d  │
│   ● decision Stay on Tailwind 4                  personalos  ◷ 1d  │
│   ◆ insight  SQLCipher key rotation options      personalos  ◷ 2h  │
│   ◇ snippet  FTS5 rebuild helper          rust · personalos  ◷ 5d  │
│   ○ idea     blog: offline-first AI                          ◷ 4h  │
│                                          [Send 4 filtered → file]  │
└────────────────────────────────────────────────────────────────────┘
```

- One flat list, newest-first. Row = pin marker, kind glyph+accent color,
  title, topic/project chips, updated time. Click → editor (11.5).
- Search box = FTS over cards; filters combine with it. Filter state persists
  for the session (so "my current project's cards" stays one click away).
- **Send filtered → file** appears when a project/topic filter is active:
  exports the filtered set as one markdown file (the §8 AIOS handoff).
- kind=idea filter shows promote/delete inline (the triage view).

**Rationale**: a single searchable list beats five per-kind screens — the user
thinks "that thing about key rotation", not "which category did I file it in".
Kinds are a filter, not places.

**Empty**: *"Nothing captured yet. Distill a chat, or press I for a quick
idea."* — teaching the funnel, with a [New card] button.
**Empty search/filter result**: *"No cards match — [clear filters]"*.
**Loading**: 8 skeleton rows. **Error**: inline banner + [Retry].

### 11.5 Card editor (modal over Library/Chats, per app Modal convention)

```
┌──────────── Card ────────────────────────────────────────┐
│ kind: decision ▾        topic: (personalos)  project: () │
│ Title (Stay on Tailwind 4                              ) │
│──────────────────────────────────────────────────────────│
│ ## Context                                               │
│ v4 broke @apply chaining…                                │
│ ## Options                                               │
│ 1. downgrade  2. stay + restyle                          │
│ ## Decision — stay. ## Why — …                           │
│──────────────────────────────────────────────────────────│
│ Review on: (2026-10-01)          from chat: tailwind v4… │
│ [AI summarize]        ▣ Pin   [Delete]   [Cancel] [Save] │
└──────────────────────────────────────────────────────────┘
```

- One editor for all kinds. Kind switcher at top; switching to `decision` on
  an **empty body** inserts the template; `snippet` adds the language field
  and monospace body; `prompt` shows a live list of detected `{{variables}}`
  under the body; `idea` is just title (body optional).
- Markdown body with a preview toggle. `review_on` field only for decisions
  (drives the timeline sync). `from chat:` provenance link when present.
- **AI summarize**: sends current body to the default model with a fixed
  condensing prompt, shows result as a replace/append choice. (The one place
  AI touches cards — assistive, never automatic.)
- Save = `card_save` → `onChanged()` per app refresh convention.

**Rationale**: a modal (not a route) keeps Library context and matches how
Notes/Vault edit records today. One editor for five kinds is the §2 decision
made visible: users learn it once.

**Loading** (existing card): field skeletons ~1 frame; **Error on save**:
toast + modal stays open with content intact. **AI summarize failure**: inline
note under the button, body untouched.

### 11.6 Prompt launch (small modal, from Home pinned prompts or Library)

```
┌──── Launch: Summarize for {{audience}} ────┐
│ audience: (engineering manager           ) │
│ text:     (…multi-line…                  ) │
│ model: claude-sonnet ▾                     │
│                        [Cancel] [Launch →] │
└────────────────────────────────────────────┘
```

One input per `{{variable}}` (multi-line if the variable is named `text`,
`content`, `input`, or `code`). Launch renders the body and starts a chat.
Prompts without variables skip the modal entirely.

### 11.7 Settings → AI Providers (a section inside existing Settings)

```
│ AI PROVIDERS                                    [ + Add ] │
│ Anthropic      api.anthropic.com   key ••••7f2a  enabled  │
│   models: claude-sonnet-5, claude-haiku-4-5       [edit]  │
│ Local (Ollama) localhost:11434     no key        enabled  │
│                                                           │
│ Default model: claude-sonnet-5 ▾                          │
│ □ Start PersonalOS on Workbench                           │
```

Add/edit form: name, kind (`anthropic` / `openai_compat`), base URL, API key
(password field; reveal gated by `verify_master_password`, mirroring bank
credentials), model list (comma-separated ids — **no model-list fetching from
the network**; the user pastes ids, keeping egress surface minimal). A [Test]
button sends a 1-token ping and reports ok/failure inline.

**Rationale**: lives in Settings, not the Workbench, because it's set up
twice a year. `openai_compat` covers OpenAI, OpenRouter, Ollama, LM Studio —
two provider kinds cover effectively the whole market without per-vendor code.

---

## 12. Component hierarchy

Existing modules are single files; the Workbench is bigger, so it gets a
folder — same pattern, one level deeper. All shared primitives (Modal,
Confirm, toasts) come from `components/ui.tsx`.

```
src/modules/workbench/
  Workbench.tsx        module root: sub-view tabs, focus-prop handling,
                       refreshKey plumbing, module-local shortcuts (N, I, /)
  Home.tsx             Launcher · IdeaInbox · PinnedPrompts · RecentList
  Chats.tsx            ChatList (rows, filter) · ChatView
  ChatView.tsx         ChatHeader · Transcript (MessageBubble ·
                       CompareTurnGrid → ModelColumn) · Composer (streaming
                       state, stop/retry) · selection→distill toolbar
  Library.tsx          FilterBar · CardRow list · export action
  CardEditor.tsx       modal: kind switcher, markdown body+preview,
                       kind-specific fields, AI-summarize
  PromptLaunch.tsx     modal: variable form → chat_send
```

`MessageBubble` is a top-level function component in its module file — never
defined inside another component (the CLAUDE.md remount footgun). Streaming
appends use functional `setState` (the race footgun). Settings' provider
section is added inside the existing `Settings.tsx`.

---

## 13. Future extensibility (design headroom, not commitments)

The schema and IA absorb these without migration pain — none are v1:

- **Attachments on chats** — a `chat_files` BLOB table modeled on
  `document_files` when vision/file models matter.
- **Card→card links** — a join table if provenance ever needs to go beyond
  `source_chat_id`; the UI slot ("from chat:") already exists.
- **Local semantic search** — an embeddings sidecar table; FTS remains the
  primary path so this stays additive.
- **System-prompt presets** — a `system_prompt` column on chats; prompt cards
  could then be used as presets, reusing the existing kind.
- **Other person's AI work** — the person picker UI, since `person_id` is
  already plumbed end-to-end.

Explicitly out of scope forever (fits the "boring architecture" rule): agents
and tool-use runtimes, plugin systems, sync/cloud, team features, usage
analytics, per-token cost accounting.

---

## 14. Simplification pass (performed; what was removed and why)

Cut from earlier drafts of this design:

1. **Separate Research module** → a topic filter over chats+cards does it.
2. **Spaces/folders/notebooks** → topic string + FTS. Hierarchy is where a
   solo user's knowledge dies.
3. **Dedicated Ideas screen** → Home inbox strip + Library kind filter.
4. **Activity/feed table** → derived from `updated_at`. Zero new state.
5. **Auto-summarize on chat close / auto-tagging** → violates "nothing is
   knowledge until a human says so"; produces noise and token spend.
6. **Chat branching/forking** → Adopt (compare → single) covers the real use
   case; general branching is enterprise-grade complexity for a solo user.
7. **Per-message ratings, favorites at message level** → Distill *is* the
   "this was good" gesture.
8. **Cost/token dashboards** → analytics the user would look at twice.
9. **Prompt marketplace/import formats** → prompt cards are markdown; paste.
10. **Live model-list fetching from providers** → user-pasted ids; smaller
    egress surface, no per-vendor API drift.
11. **Bidirectional AIOS sync / watched folders** → one-way explicit export;
    coupling two systems that are both healthy because they're independent.
12. **A sixth kind, `writing`** → indistinguishable from `insight` in
    practice; kinds must earn their existence.

What survived is: 3 tables + 1 config table, 3 sub-views, 2 modals, 5 card
kinds, 1 new keyboard shortcut, 1 network exception. Each maps to a daily
behavior; nothing exists "for completeness".

---

## 15. Implementation checklist (for the build phase)

1. Migration: 4 tables (idempotent, column-presence-checked), add to
   `backup.rs::TABLES` in order `ai_providers, chats, chat_messages, cards`.
2. `commands/workbench.rs` + `lib.rs` registration + `api.ts` wrappers (§5
   command list); every mutation: index/unindex, `sync_timeline` for decision
   `review_on`, `log_activity`.
3. `ai.rs`: reqwest streaming client for `anthropic` + `openai_compat`;
   Tauri event stream to the frontend; the *only* file with network access;
   SECURITY.md updated with the egress exception + key-handling rules.
4. Frontend per §12; `View` gains `"workbench"`; Ctrl+K global shortcut;
   UniversalSearch handles `chat`/`card` modules; Settings gains providers
   section + "Start on Workbench" toggle.
5. `person_overview` / `related_counts` / `person_delete` gain chats+cards.
6. Tests: migration idempotency, secret-never-indexed (api_key + assistant
   messages), distill provenance, compare fan-out storage, timeline sync on
   `review_on`, backup round-trip including the 4 new tables. E2E: launcher →
   chat → distill → library path (respect the WebDriver gotchas in CLAUDE.md).
