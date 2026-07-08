// ---------------------------------------------------------------------------
// AI Workbench — in-memory mock backend.
//
// UI-only preview build (see AI_WORKBENCH_DESIGN.md): no Rust commands, no
// network, no SQLCipher table. State lives in module-level arrays for the
// lifetime of the window and is seeded with a few example chats/cards so the
// module is navigable on first open. Every function returns a Promise and
// awaits a short artificial delay so loading/streaming states are visible,
// mirroring how the real `with_db` commands + Tauri events would behave.
//
// When a real backend lands, only this file + the six workbench components'
// imports change — the component code already matches the target IA.
// ---------------------------------------------------------------------------

import {
  AiProvider,
  AiProviderInput,
  Card,
  CardInput,
  CardKind,
  CardMeta,
  Chat,
  ChatMessage,
  ChatMeta,
  ChatSendInput,
  ChatUpdateInput,
} from "./types";

function wait(ms = 150 + Math.random() * 120): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function nowISO(): string {
  return new Date().toISOString();
}

let providerSeq = 1;
let chatSeq = 1;
let messageSeq = 1;
let cardSeq = 1;

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const providers: AiProvider[] = [
  {
    id: providerSeq++,
    name: "Anthropic",
    kind: "anthropic",
    base_url: "https://api.anthropic.com",
    api_key: "preview only, not a real key 7f2a",
    models: ["claude-sonnet-5", "claude-haiku-4-5"],
    enabled: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  },
  {
    id: providerSeq++,
    name: "OpenAI",
    kind: "openai_compat",
    base_url: "https://api.openai.com/v1",
    api_key: "",
    models: ["gpt-5"],
    enabled: false,
    created_at: nowISO(),
    updated_at: nowISO(),
  },
  {
    id: providerSeq++,
    name: "Local (Ollama)",
    kind: "openai_compat",
    base_url: "http://localhost:11434/v1",
    api_key: "",
    models: ["llama3.1"],
    enabled: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  },
];

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function msg(chat_id: number, role: ChatMessage["role"], model: string, content: string, error = "", ageDays = 0): ChatMessage {
  return { id: messageSeq++, chat_id, role, model, content, error, created_at: daysAgo(ageDays) };
}

const chats: Chat[] = [];
const cards: Card[] = [];

function seedChat(partial: Omit<Chat, "id" | "created_at" | "updated_at" | "messages"> & { ageDays: number }, buildMessages: (id: number) => ChatMessage[]): Chat {
  const id = chatSeq++;
  const chat: Chat = {
    id,
    person_id: partial.person_id,
    title: partial.title,
    mode: partial.mode,
    models: partial.models,
    topic: partial.topic,
    archived: partial.archived,
    created_at: daysAgo(partial.ageDays),
    updated_at: daysAgo(partial.ageDays),
    messages: [],
  };
  chat.messages = buildMessages(id);
  chats.push(chat);
  return chat;
}

const chatKeyRotation = seedChat(
  {
    person_id: null,
    title: "SQLCipher key rotation approaches",
    mode: "single",
    models: ["1:claude-sonnet-5"],
    topic: "personalos",
    archived: false,
    ageDays: 0.08,
  },
  (id) => [
    msg(id, "user", "", "How do I rotate the SQLCipher key without a full re-encrypt on every unlock?", "", 0.09),
    msg(
      id,
      "assistant",
      "1:claude-sonnet-5",
      "There are two viable approaches:\n\n1. **Rekey in place** — `PRAGMA rekey` re-encrypts the whole file under a new key. Simple, but O(db size) and blocks the UI.\n2. **Key-wrapping** — keep the SQLCipher key fixed and derive it from the master password via a wrapped key blob (Argon2id + XChaCha20). Rotating the password just re-wraps the blob, which is O(1).\n\n```rust\nfn rewrap_key(old_pw: &str, new_pw: &str) -> Result<()> {\n    let key = unwrap_key(old_pw)?;\n    wrap_key(&key, new_pw)\n}\n```\n\nOption 2 matches what PersonalOS already does for the master password change flow.",
      "",
      0.08
    ),
  ]
);

seedChat(
  {
    person_id: null,
    title: "compare: pricing page copy (3 models)",
    mode: "compare",
    models: ["1:claude-sonnet-5", "2:gpt-5", "3:llama3.1"],
    topic: "personalos",
    archived: false,
    ageDays: 1,
  },
  (id) => [
    msg(id, "user", "", "Rewrite this pricing section to lead with the offline-first angle, not price.", "", 1.02),
    msg(id, "assistant", "1:claude-sonnet-5", "**Own your data, forever.** PersonalOS runs entirely on your machine — no cloud, no subscription lock-in reading your files. Pricing is a one-time purchase because there's no server bill to pass on to you.", "", 1.01),
    msg(id, "assistant", "2:gpt-5", "Consider leading with *\"Your data never leaves your laptop\"* — it reframes the price as the cost of privacy, not a feature tier. Then list the one-time fee second.", "", 1.01),
    msg(id, "assistant", "3:llama3.1", "Pricing: one payment, runs offline, no subscription. Emphasize local-only storage before the number.", "", 1.01),
  ]
);

const chatTailwind = seedChat(
  {
    person_id: null,
    title: "Tailwind v4 @apply chaining quirks",
    mode: "single",
    models: ["1:claude-sonnet-5"],
    topic: "personalos",
    archived: false,
    ageDays: 3,
  },
  (id) => [
    msg(id, "user", "", "Why does @apply chaining break after the v4 upgrade?", "", 3.1),
    msg(id, "assistant", "1:claude-sonnet-5", "v4 moved to CSS-native `@layer` resolution, so `@apply` no longer sees classes defined later in cascade order within the same layer. Two fixes: reorder the source, or switch the chained utility to a `@utility` block so it resolves independently of position.", "", 3.05),
  ]
);

// ideas
function seedCard(partial: Omit<Card, "id" | "created_at" | "updated_at" | "source_chat_title">, ageDays: number): Card {
  const id = cardSeq++;
  const card: Card = {
    ...partial,
    id,
    created_at: daysAgo(ageDays),
    updated_at: daysAgo(ageDays),
    source_chat_title: partial.source_chat_id ? chats.find((c) => c.id === partial.source_chat_id)?.title ?? null : null,
  };
  cards.push(card);
  return card;
}

seedCard(
  { person_id: null, kind: "idea", title: "cache invalidation angle for the blog", body: "", topic: "", project: "", language: "", review_on: "", source_chat_id: null, pinned: false, archived: false },
  0.3
);
seedCard(
  { person_id: null, kind: "idea", title: "try compare mode on the pricing question", body: "", topic: "", project: "", language: "", review_on: "", source_chat_id: null, pinned: false, archived: false },
  1
);
seedCard(
  { person_id: null, kind: "idea", title: "blog: offline-first AI workbench", body: "", topic: "writing", project: "", language: "", review_on: "", source_chat_id: null, pinned: false, archived: false },
  0.15
);

seedCard(
  {
    person_id: null,
    kind: "decision",
    title: "Stay on Tailwind 4",
    body: "## Context\nv4 broke @apply chaining in a few components.\n\n## Options\n1. Downgrade to v3\n2. Stay on v4 and restyle the affected components with @utility blocks\n\n## Decision\nStay on v4.\n\n## Why\nv4's CSS-native layering is the direction Tailwind is committed to; downgrading only defers the migration cost.",
    topic: "personalos",
    project: "personalos",
    language: "",
    review_on: "2026-10-01",
    source_chat_id: chatTailwind.id,
    pinned: false,
    archived: false,
  },
  1
);

seedCard(
  {
    person_id: null,
    kind: "insight",
    title: "SQLCipher key rotation options",
    body: "Two viable approaches to rotating the SQLCipher key:\n\n1. **Rekey in place** via `PRAGMA rekey` — simple, O(db size), blocks the UI.\n2. **Key-wrapping** — keep the data key fixed, re-wrap it with Argon2id + XChaCha20 on password change. O(1).\n\nPersonalOS already does #2 for master password changes.",
    topic: "personalos",
    project: "personalos",
    language: "",
    review_on: "",
    source_chat_id: chatKeyRotation.id,
    pinned: false,
    archived: false,
  },
  0.08
);

seedCard(
  {
    person_id: null,
    kind: "prompt",
    title: "Summarize for {{audience}}",
    body: "Summarize the following for a {{audience}}. Keep it under 150 words and lead with the decision or takeaway, not the background.\n\n{{text}}",
    topic: "writing",
    project: "",
    language: "",
    review_on: "",
    source_chat_id: null,
    pinned: true,
    archived: false,
  },
  3
);
seedCard(
  {
    person_id: null,
    kind: "prompt",
    title: "Code review checklist",
    body: "Review the following {{code}} for correctness bugs, missing edge cases, and unnecessary complexity. List findings most-severe first.",
    topic: "",
    project: "",
    language: "",
    review_on: "",
    source_chat_id: null,
    pinned: true,
    archived: false,
  },
  4
);
seedCard(
  {
    person_id: null,
    kind: "prompt",
    title: "Weekly plan from notes",
    body: "Turn these rough notes into a prioritized plan for the week:\n\n{{text}}",
    topic: "",
    project: "",
    language: "",
    review_on: "",
    source_chat_id: null,
    pinned: true,
    archived: false,
  },
  5
);

seedCard(
  {
    person_id: null,
    kind: "snippet",
    title: "FTS5 rebuild helper",
    body: "```sql\nINSERT INTO search_index(search_index) VALUES('rebuild');\n```",
    topic: "personalos",
    project: "personalos",
    language: "sql",
    review_on: "",
    source_chat_id: null,
    pinned: false,
    archived: false,
  },
  5
);

// ---------------------------------------------------------------------------
// Reply generation (mock "model" output) — deterministic-ish, no network.
// ---------------------------------------------------------------------------

const REPLY_BANK = [
  "Here's one way to think about it: break the problem into the part that's genuinely novel and the part that's a known pattern, then only spend design effort on the former.",
  "A few options come to mind, roughly in order of effort:\n\n1. The quick, slightly hacky fix\n2. The clean fix that touches one more file\n3. The bigger refactor, only worth it if you'll hit this again\n\nI'd start with option 2 unless you're under real time pressure.",
  "```ts\nfunction example(input: string): string {\n  return input.trim().toLowerCase();\n}\n```\n\nThat should cover the common case — let me know if the input can be `null`/`undefined` and I'll add a guard.",
  "Worth double-checking the assumption first: is this actually the bottleneck, or does it just look like one? If you haven't profiled it, that's the highest-leverage next step before optimizing anything.",
  "Short answer: yes, and here's why — the two approaches converge once you account for the edge case where the collection is empty, so pick whichever reads more clearly at the call site.",
];

function pickReply(seed: number): string {
  return REPLY_BANK[seed % REPLY_BANK.length];
}

function chunk(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 3 + Math.floor(Math.random() * 4)) {
    out.push(text.slice(i, i + 3 + Math.floor(Math.random() * 4)));
  }
  return out;
}

function providerName(key: string): string {
  const [pid] = key.split(":");
  return providers.find((p) => String(p.id) === pid)?.name ?? key;
}

function isReachable(key: string): boolean {
  const [pid] = key.split(":");
  const p = providers.find((x) => String(x.id) === pid);
  if (!p || !p.enabled) return false;
  if (p.kind === "anthropic" && !p.api_key.trim()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Card list preview + FTS-ish filter
// ---------------------------------------------------------------------------

function toMeta(c: Card): CardMeta {
  return {
    id: c.id,
    person_id: c.person_id,
    kind: c.kind,
    title: c.title,
    preview: c.body.replace(/[#*`\n]+/g, " ").trim().slice(0, 90),
    topic: c.topic,
    project: c.project,
    language: c.language,
    pinned: c.pinned,
    archived: c.archived,
    updated_at: c.updated_at,
  };
}

function toChatMeta(c: Chat): ChatMeta {
  return {
    id: c.id,
    person_id: c.person_id,
    title: c.title,
    mode: c.mode,
    models: c.models,
    topic: c.topic,
    archived: c.archived,
    updated_at: c.updated_at,
  };
}

function cloneChat(c: Chat): Chat {
  return { ...c, messages: c.messages.map((m) => ({ ...m })) };
}

function cloneCard(c: Card): Card {
  return { ...c };
}

// ---------------------------------------------------------------------------
// Public mock API — method names/shapes mirror the real command surface
// described in AI_WORKBENCH_DESIGN.md §5 so this file is a drop-in seam.
// ---------------------------------------------------------------------------

export const wb = {
  // -- providers --------------------------------------------------------
  async providerList(): Promise<AiProvider[]> {
    await wait();
    return providers.map((p) => ({ ...p }));
  },
  async providerSave(input: AiProviderInput): Promise<AiProvider> {
    await wait();
    if (input.id != null) {
      const idx = providers.findIndex((p) => p.id === input.id);
      if (idx < 0) throw new Error("Provider not found");
      providers[idx] = { ...providers[idx], ...input, id: providers[idx].id, updated_at: nowISO() };
      return { ...providers[idx] };
    }
    const p: AiProvider = { ...input, id: providerSeq++, created_at: nowISO(), updated_at: nowISO() };
    providers.push(p);
    return { ...p };
  },
  async providerDelete(id: number): Promise<void> {
    await wait();
    const idx = providers.findIndex((p) => p.id === id);
    if (idx >= 0) providers.splice(idx, 1);
  },
  async providerTest(id: number): Promise<string> {
    await wait(500);
    const p = providers.find((x) => x.id === id);
    if (!p) throw new Error("Provider not found");
    if (p.kind === "anthropic" && !p.api_key.trim()) throw new Error("No API key set");
    if (p.models.length === 0) throw new Error("No models configured");
    return `Preview mode — would ping ${p.name} (${p.models[0]}). No network call is made in this build.`;
  },

  // -- chats --------------------------------------------------------------
  async chatList(archived: boolean, query: string | null): Promise<ChatMeta[]> {
    await wait();
    const q = query?.trim().toLowerCase();
    return chats
      .filter((c) => c.archived === archived)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.topic.toLowerCase().includes(q))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .map(toChatMeta);
  },
  async chatGet(id: number): Promise<Chat> {
    await wait();
    const c = chats.find((x) => x.id === id);
    if (!c) throw new Error("Chat not found");
    return cloneChat(c);
  },
  async chatSend(input: ChatSendInput): Promise<Chat> {
    await wait();
    let chat: Chat;
    if (input.chat_id != null) {
      const found = chats.find((c) => c.id === input.chat_id);
      if (!found) throw new Error("Chat not found");
      chat = found;
    } else {
      chat = {
        id: chatSeq++,
        person_id: input.person_id,
        title: input.content.slice(0, 60) || "New chat",
        mode: input.mode,
        models: input.models,
        topic: input.topic ?? "",
        archived: false,
        created_at: nowISO(),
        updated_at: nowISO(),
        messages: [],
      };
      chats.push(chat);
    }
    chat.messages.push(msg(chat.id, "user", "", input.content));
    chat.updated_at = nowISO();
    return cloneChat(chat);
  },
  /** Simulates one model's streamed reply for the most recent user turn.
   *  Calls `onDelta` as chunks arrive; resolves with the final text/error. */
  async streamTurn(chatId: number, model: string, onDelta: (delta: string) => void): Promise<{ content: string; error: string }> {
    if (!isReachable(model)) {
      await wait(300);
      return { content: "", error: `${providerName(model)} is disabled or missing an API key — Settings → AI Providers.` };
    }
    const chat = chats.find((c) => c.id === chatId);
    const lastUser = chat ? [...chat.messages].reverse().find((m) => m.role === "user") : undefined;
    const seed = (lastUser?.content.length ?? 0) + model.length + chatId;
    const full = pickReply(seed);
    for (const part of chunk(full)) {
      await wait(28 + Math.random() * 35);
      onDelta(part);
    }
    return { content: full, error: "" };
  },
  async commitAssistant(chatId: number, model: string, content: string, error: string): Promise<Chat> {
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) throw new Error("Chat not found");
    const lastUserId = [...chat.messages].reverse().find((m) => m.role === "user")?.id ?? 0;
    const existingIdx = chat.messages.findIndex((m) => m.role === "assistant" && m.model === model && m.id > lastUserId);
    if (existingIdx >= 0) {
      chat.messages[existingIdx] = { ...chat.messages[existingIdx], content, error, created_at: nowISO() };
    } else {
      chat.messages.push(msg(chat.id, "assistant", model, content, error));
    }
    chat.updated_at = nowISO();
    return cloneChat(chat);
  },
  async chatUpdate(input: ChatUpdateInput): Promise<ChatMeta> {
    await wait();
    const chat = chats.find((c) => c.id === input.id);
    if (!chat) throw new Error("Chat not found");
    if (input.title != null) chat.title = input.title;
    if (input.topic != null) chat.topic = input.topic;
    if (input.archived != null) chat.archived = input.archived;
    chat.updated_at = nowISO();
    return toChatMeta(chat);
  },
  async chatDelete(id: number): Promise<void> {
    await wait();
    const idx = chats.findIndex((c) => c.id === id);
    if (idx >= 0) chats.splice(idx, 1);
  },
  async chatAdopt(chatId: number, model: string): Promise<Chat> {
    await wait();
    const source = chats.find((c) => c.id === chatId);
    if (!source) throw new Error("Chat not found");
    const messages = source.messages.filter((m) => m.role === "user" || m.model === model);
    const fresh: Chat = {
      id: chatSeq++,
      person_id: source.person_id,
      title: `${source.title} (adopted)`,
      mode: "single",
      models: [model],
      topic: source.topic,
      archived: false,
      created_at: nowISO(),
      updated_at: nowISO(),
      messages: messages.map((m) => ({ ...m, id: messageSeq++, chat_id: 0 })),
    };
    fresh.messages.forEach((m) => (m.chat_id = fresh.id));
    chats.push(fresh);
    return cloneChat(fresh);
  },

  // -- cards ----------------------------------------------------------------
  async cardList(kind: CardKind | null, topic: string | null, project: string | null, archived: boolean, query: string | null): Promise<CardMeta[]> {
    await wait();
    const q = query?.trim().toLowerCase();
    return cards
      .filter((c) => c.archived === archived)
      .filter((c) => !kind || c.kind === kind)
      .filter((c) => !topic || c.topic === topic)
      .filter((c) => !project || c.project === project)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.body.toLowerCase().includes(q))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .map(toMeta);
  },
  async cardGet(id: number): Promise<Card> {
    await wait();
    const c = cards.find((x) => x.id === id);
    if (!c) throw new Error("Card not found");
    return cloneCard(c);
  },
  async cardSave(input: CardInput): Promise<Card> {
    await wait();
    if (input.id != null) {
      const idx = cards.findIndex((c) => c.id === input.id);
      if (idx < 0) throw new Error("Card not found");
      cards[idx] = { ...cards[idx], ...input, id: cards[idx].id, updated_at: nowISO() };
      return cloneCard(cards[idx]);
    }
    const c: Card = {
      ...input,
      id: cardSeq++,
      source_chat_id: null,
      source_chat_title: null,
      archived: false,
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    cards.push(c);
    return cloneCard(c);
  },
  async cardDelete(id: number): Promise<void> {
    await wait();
    const idx = cards.findIndex((c) => c.id === id);
    if (idx >= 0) cards.splice(idx, 1);
  },
  async cardDistill(chatId: number, messageIds: number[] | null, kind: CardKind): Promise<Card> {
    await wait(300);
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) throw new Error("Chat not found");
    const source = messageIds ? chat.messages.filter((m) => messageIds.includes(m.id)) : chat.messages;
    const body = source
      .filter((m) => !m.error)
      .map((m) => (m.role === "user" ? `**You:** ${m.content}` : `**${providerName(m.model)}:** ${m.content}`))
      .join("\n\n");
    const c: Card = {
      id: cardSeq++,
      person_id: chat.person_id,
      kind,
      title: chat.title,
      body: kind === "decision" ? `## Context\n${body}\n\n## Options\n\n\n## Decision\n\n\n## Why\n\n` : body,
      topic: chat.topic,
      project: "",
      language: "",
      review_on: "",
      source_chat_id: chat.id,
      source_chat_title: chat.title,
      pinned: false,
      archived: false,
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    cards.push(c);
    return cloneCard(c);
  },
  async cardExport(ids: number[], path: string): Promise<string> {
    await wait(300);
    return `Preview mode — would write ${ids.length} card(s) to ${path}. No file is written in this build.`;
  },
  async cardSummarize(body: string): Promise<string> {
    await wait(500);
    const words = body.replace(/[#*`]+/g, "").split(/\s+/).filter(Boolean);
    if (words.length <= 40) return body.trim();
    return words.slice(0, 40).join(" ") + "…";
  },
};

// ---------------------------------------------------------------------------
// Universal Search integration — client-side filter over the mock store.
// ---------------------------------------------------------------------------

export interface WorkbenchSearchResult {
  module: "chat" | "card";
  record_id: number;
  title: string;
  snippet: string;
  person: string | null;
}

export function searchWorkbench(query: string): WorkbenchSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const chatHits: WorkbenchSearchResult[] = chats
    .filter((c) => !c.archived && (c.title.toLowerCase().includes(q) || c.topic.toLowerCase().includes(q)))
    .slice(0, 5)
    .map((c) => ({ module: "chat", record_id: c.id, title: c.title, snippet: c.topic, person: null }));
  const cardHits: WorkbenchSearchResult[] = cards
    .filter((c) => !c.archived && (c.title.toLowerCase().includes(q) || c.body.toLowerCase().includes(q)))
    .slice(0, 5)
    .map((c) => ({ module: "card", record_id: c.id, title: c.title, snippet: c.topic || c.project, person: null }));
  return [...chatHits, ...cardHits];
}
