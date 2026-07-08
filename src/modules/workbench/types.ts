// ---------------------------------------------------------------------------
// AI Workbench — frontend-only types.
//
// This module is a UI-only preview (see AI_WORKBENCH_DESIGN.md): there is no
// backend yet, so these types are NOT part of src/api.ts and every workbench
// screen reads/writes through ./mockData instead of Tauri `invoke`. The
// shapes mirror the data model in the design doc (§5) so a real backend can
// be dropped in later without reshaping the UI.
// ---------------------------------------------------------------------------

export type ProviderKind = "anthropic" | "openai_compat";

export interface AiProvider {
  id: number;
  name: string;
  kind: ProviderKind;
  base_url: string;
  api_key: string;
  models: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiProviderInput {
  id: number | null;
  name: string;
  kind: ProviderKind;
  base_url: string;
  api_key: string;
  models: string[];
  enabled: boolean;
}

export type ChatMode = "single" | "compare";

export interface ChatMessage {
  id: number;
  chat_id: number;
  role: "user" | "assistant";
  model: string; // "" for user messages; "provider_id:model_id" for assistant
  content: string;
  error: string; // non-empty = this turn failed
  created_at: string;
}

export interface ChatMeta {
  id: number;
  person_id: number | null;
  title: string;
  mode: ChatMode;
  models: string[];
  topic: string;
  archived: boolean;
  updated_at: string;
}

export interface Chat extends ChatMeta {
  messages: ChatMessage[];
  created_at: string;
}

export interface ChatSendInput {
  chat_id: number | null; // null = start a new chat
  mode: ChatMode;
  models: string[];
  topic: string | null;
  person_id: number | null;
  content: string;
}

export interface ChatUpdateInput {
  id: number;
  title: string | null;
  topic: string | null;
  archived: boolean | null;
}

export type CardKind = "idea" | "insight" | "decision" | "prompt" | "snippet";

export const CARD_KINDS: CardKind[] = ["idea", "insight", "decision", "prompt", "snippet"];

export interface CardMeta {
  id: number;
  person_id: number | null;
  kind: CardKind;
  title: string;
  preview: string;
  topic: string;
  project: string;
  language: string;
  pinned: boolean;
  archived: boolean;
  updated_at: string;
}

export interface Card {
  id: number;
  person_id: number | null;
  kind: CardKind;
  title: string;
  body: string;
  topic: string;
  project: string;
  language: string;
  review_on: string;
  source_chat_id: number | null;
  source_chat_title: string | null;
  pinned: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CardInput {
  id: number | null;
  kind: CardKind;
  title: string;
  body: string;
  topic: string;
  project: string;
  language: string;
  review_on: string;
  pinned: boolean;
  person_id: number | null;
}
