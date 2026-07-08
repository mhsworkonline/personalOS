import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiProvider, Card, CardKind, CardMeta, Chat, ChatMeta } from "./types";
import { wb } from "./mockData";
import { Empty, useToast } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";
import { ModelPicker } from "./Chats";
import PromptLaunch from "./PromptLaunch";
import { detectVariables } from "./CardEditor";
import { BookOpen, MessageSquare, Pin, Send } from "lucide-react";

const PROMOTE_KINDS: CardKind[] = ["insight", "decision", "prompt", "snippet"];

export default function Home({
  refreshKey,
  providers,
  launcherFocusNonce,
  onFocusChat,
  onFocusCard,
  onChanged,
}: {
  refreshKey: number;
  providers: AiProvider[];
  launcherFocusNonce: number;
  onFocusChat: (id: number) => void;
  onFocusCard: (id: number) => void;
  onChanged: () => void;
}) {
  const [ideas, setIdeas] = useState<CardMeta[]>([]);
  const [prompts, setPrompts] = useState<CardMeta[]>([]);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [cards, setCards] = useState<CardMeta[]>([]);
  const [mode, setMode] = useState<"single" | "compare">("single");
  const [models, setModels] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState<Card | null>(null);
  const launcherRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  useEffect(() => {
    launcherRef.current?.focus();
  }, [launcherFocusNonce]);

  const load = useCallback(() => {
    wb.cardList("idea", null, null, false, null).then((c) => setIdeas(c.slice(0, 5))).catch(() => {});
    wb.cardList("prompt", null, null, false, null).then((c) => setPrompts(c.filter((p) => p.pinned).slice(0, 6))).catch(() => {});
    wb.chatList(false, null).then(setChats).catch(() => {});
    wb.cardList(null, null, null, false, null).then(setCards).catch(() => {});
  }, []);

  useEffect(load, [load, refreshKey]);

  useEffect(() => {
    if (models.length > 0) return;
    const first = providers.find((p) => p.enabled && p.models.length > 0);
    if (first) setModels([`${first.id}:${first.models[0]}`]);
  }, [providers, models.length]);

  const hasEnabledProvider = providers.some((p) => p.enabled && p.models.length > 0);

  const recent = useMemo(() => {
    const items: { key: string; kind: "chat" | "card"; id: number; title: string; updated_at: string }[] = [
      ...chats.map((c) => ({ key: `chat-${c.id}`, kind: "chat" as const, id: c.id, title: c.title, updated_at: c.updated_at })),
      ...cards.map((c) => ({ key: `card-${c.id}`, kind: "card" as const, id: c.id, title: c.title, updated_at: c.updated_at })),
    ];
    return items.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 10);
  }, [chats, cards]);

  const send = async () => {
    if (!draft.trim() || models.length === 0 || busy) return;
    setBusy(true);
    try {
      const chat = await wb.chatSend({ chat_id: null, mode, models, topic: null, person_id: null, content: draft.trim() });
      setDraft("");
      onFocusChat(chat.id);
    } catch (e) {
      toast(String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const promote = async (c: CardMeta, kind: CardKind) => {
    try {
      const full = await wb.cardGet(c.id);
      await wb.cardSave({ ...full, kind });
      load();
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const deleteIdea = async (id: number) => {
    await wb.cardDelete(id);
    load();
    onChanged();
  };

  const launchPrompt = async (meta: CardMeta) => {
    const full = await wb.cardGet(meta.id);
    if (detectVariables(full.body).length > 0) {
      setLaunching(full);
      return;
    }
    const first = providers.find((p) => p.enabled && p.models.length > 0);
    if (!first) {
      toast("Add an AI provider first — Settings → AI Providers", "bad");
      return;
    }
    try {
      const chat = await wb.chatSend({
        chat_id: null,
        mode: "single",
        models: [`${first.id}:${first.models[0]}`],
        topic: full.topic || null,
        person_id: full.person_id,
        content: full.body,
      });
      onFocusChat(chat.id);
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-[1000px] flex flex-col gap-4">
        <section className="card p-4">
          <textarea
            ref={launcherRef}
            className="ctl !text-[14px] !py-2 min-h-[52px] resize-none"
            placeholder="Ask anything…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center justify-between mt-2.5">
            <ModelPicker providers={providers} mode={mode} setMode={setMode} selected={models} setSelected={setModels} />
            <button className="btn-acc shrink-0" onClick={send} disabled={!draft.trim() || models.length === 0 || busy}>
              <Send size={14} /> {busy ? "Sending…" : "Send"}
            </button>
          </div>
          {!hasEnabledProvider && (
            <p className="text-mut text-[12px] mt-2">
              Add a provider and at least one model in Settings → AI Providers to start chatting.
            </p>
          )}
        </section>

        <div className="grid grid-cols-2 gap-4">
          <section className="card p-4">
            <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-2">Ideas ({ideas.length})</h2>
            {ideas.length === 0 && <Empty text="No ideas captured" hint="Press I anywhere to jot one down." />}
            <ul className="flex flex-col gap-1">
              {ideas.map((c) => (
                <li key={c.id} className="group flex items-center gap-2 py-1">
                  <span className="flex-1 truncate text-[13px]">{c.title}</span>
                  <select
                    className="ctl !w-24 !py-0.5 !text-[11px] shrink-0 opacity-0 group-hover:opacity-100"
                    defaultValue=""
                    onChange={(e) => e.target.value && promote(c, e.target.value as CardKind)}
                  >
                    <option value="" disabled>
                      promote…
                    </option>
                    {PROMOTE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <button
                    className="opacity-0 group-hover:opacity-100 btn-ghost !p-1 !py-0 text-[11px] text-bad shrink-0"
                    onClick={() => deleteIdea(c.id)}
                  >
                    delete
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-4">
            <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-2 flex items-center gap-1.5">
              <Pin size={13} /> Pinned prompts
            </h2>
            {prompts.length === 0 && <Empty text="No pinned prompts" hint="Pin a prompt card in the Library to see it here." />}
            <ul className="flex flex-col gap-1">
              {prompts.map((c) => (
                <li key={c.id}>
                  <button className="w-full text-left truncate text-[13px] py-1 hover:text-acc2" onClick={() => launchPrompt(c)}>
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="card p-4">
          <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-2">Recent</h2>
          {recent.length === 0 && <Empty text="Nothing yet — start a conversation above" />}
          <ul className="flex flex-col">
            {recent.map((r) => (
              <li key={r.key}>
                <button
                  className="w-full flex items-center gap-2.5 py-1.5 px-1.5 -mx-1.5 rounded-md hover:bg-panel2 text-left"
                  onClick={() => (r.kind === "chat" ? onFocusChat(r.id) : onFocusCard(r.id))}
                >
                  {r.kind === "chat" ? (
                    <MessageSquare size={14} className="text-acc2 shrink-0" />
                  ) : (
                    <BookOpen size={14} className="text-mut shrink-0" />
                  )}
                  <span className="flex-1 truncate text-[13px]">{r.title}</span>
                  <span className="text-mut text-[11px] shrink-0">{fmtDateTime(r.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {launching && (
        <PromptLaunch
          card={launching}
          providers={providers}
          onClose={() => setLaunching(null)}
          onLaunched={(chat: Chat) => {
            setLaunching(null);
            onFocusChat(chat.id);
          }}
        />
      )}
    </div>
  );
}
