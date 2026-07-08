import { useCallback, useEffect, useRef, useState } from "react";
import { AiProvider, CardKind, Chat, ChatMeta } from "./types";
import { wb } from "./mockData";
import { Empty, useToast } from "../../components/ui";
import { fmtDate } from "../../lib/format";
import ChatView from "./ChatView";
import { Plus } from "lucide-react";

/** Model + single/compare picker, shared by the Home launcher and the
 *  new-chat composer here. */
export function ModelPicker({
  providers,
  mode,
  setMode,
  selected,
  setSelected,
}: {
  providers: AiProvider[];
  mode: "single" | "compare";
  setMode: (m: "single" | "compare") => void;
  selected: string[];
  setSelected: (s: string[]) => void;
}) {
  const options = providers
    .filter((p) => p.enabled)
    .flatMap((p) => p.models.map((m) => ({ key: `${p.id}:${m}`, label: `${p.name} · ${m}` })));

  if (options.length === 0) {
    return <span className="text-mut text-[12px]">No models configured — Settings → AI Providers</span>;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {mode === "single" ? (
        <select
          className="ctl !w-auto !py-1 text-[12.5px]"
          value={selected[0] ?? options[0].key}
          onChange={(e) => setSelected([e.target.value])}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <label
              key={o.key}
              className="flex items-center gap-1 text-[12px] border border-edge rounded-full px-2 py-0.5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.key)}
                onChange={(e) => {
                  setSelected(
                    e.target.checked ? [...selected, o.key].slice(-4) : selected.filter((k) => k !== o.key)
                  );
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
      <label className="flex items-center gap-1 text-[12px] text-mut cursor-pointer ml-1">
        <input
          type="checkbox"
          checked={mode === "compare"}
          onChange={(e) => {
            const next = e.target.checked ? "compare" : "single";
            setMode(next);
            if (next === "single") setSelected(selected.slice(0, 1));
          }}
        />
        Compare
      </label>
    </div>
  );
}

/** Models in `chat.models` whose most recent user turn has no assistant
 *  reply yet (new chat, or the last message before navigation was the
 *  user's). Drives the mock "generation" that a real backend would stream
 *  in via events. */
function unansweredModels(chat: Chat): string[] {
  const lastUserId = [...chat.messages].reverse().find((m) => m.role === "user")?.id;
  if (lastUserId == null) return [];
  const answered = new Set(
    chat.messages.filter((m) => m.role === "assistant" && m.id > lastUserId).map((m) => m.model)
  );
  return chat.models.filter((m) => !answered.has(m));
}

export default function Chats({
  refreshKey,
  focus,
  onChanged,
}: {
  refreshKey: number;
  focus: { module: string; id: number; nonce: number } | null;
  onChanged: () => void;
}) {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Chat | null>(null);
  const [pending, setPending] = useState<Record<string, { text: string }>>({});
  const [mode, setMode] = useState<"single" | "compare">("single");
  const [models, setModels] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const selectedIdRef = useRef<number | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected]);

  useEffect(() => {
    const f = () => filterRef.current?.focus();
    window.addEventListener("personalos:module-search", f);
    return () => window.removeEventListener("personalos:module-search", f);
  }, []);

  const loadChats = useCallback(() => {
    wb.chatList(showArchived, query || null).then(setChats).catch(() => {});
  }, [showArchived, query]);

  useEffect(loadChats, [loadChats, refreshKey]);

  useEffect(() => {
    wb.providerList().then(setProviders).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (models.length > 0) return;
    const first = providers.find((p) => p.enabled && p.models.length > 0);
    if (first) setModels([`${first.id}:${first.models[0]}`]);
  }, [providers, models.length]);

  /** Runs the mock reply for one model of the current turn: streams tokens
   *  into `pending`, then persists via commitAssistant and refreshes. */
  const runTurn = useCallback(
    async (chatId: number, model: string) => {
      setPending((p) => ({ ...p, [model]: { text: "" } }));
      const { content, error } = await wb.streamTurn(chatId, model, (delta) => {
        setPending((p) => (p[model] ? { ...p, [model]: { text: p[model].text + delta } } : p));
      });
      await wb.commitAssistant(chatId, model, content, error);
      setPending((p) => {
        const next = { ...p };
        delete next[model];
        return next;
      });
      if (selectedIdRef.current === chatId) {
        wb.chatGet(chatId).then(setSelected).catch(() => {});
      }
      loadChats();
      onChanged();
    },
    [loadChats, onChanged]
  );

  const openChat = (id: number) => {
    wb.chatGet(id)
      .then((c) => {
        setSelected(c);
        const unanswered = unansweredModels(c);
        setPending(Object.fromEntries(unanswered.map((m) => [m, { text: "" }])));
        unanswered.forEach((m) => runTurn(c.id, m));
      })
      .catch((e) => toast(String(e), "bad"));
  };

  const newChat = () => {
    setSelected(null);
    setPending({});
    setDraft("");
  };

  useEffect(() => {
    if (focus?.module !== "chats") return;
    if (focus.id === -1) {
      newChat();
    } else if (focus.id > 0) {
      openChat(focus.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const sendNew = async () => {
    if (!draft.trim() || models.length === 0) return;
    try {
      const chat = await wb.chatSend({
        chat_id: null,
        mode,
        models,
        topic: null,
        person_id: null,
        content: draft.trim(),
      });
      setDraft("");
      setSelected(chat);
      setPending(Object.fromEntries(chat.models.map((m) => [m, { text: "" }])));
      loadChats();
      chat.models.forEach((m) => runTurn(chat.id, m));
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const sendInChat = async (content: string) => {
    if (!selected) return;
    try {
      const chat = await wb.chatSend({
        chat_id: selected.id,
        mode: selected.mode,
        models: selected.models,
        topic: selected.topic,
        person_id: selected.person_id,
        content,
      });
      setSelected(chat);
      setPending(Object.fromEntries(chat.models.map((m) => [m, { text: "" }])));
      chat.models.forEach((m) => runTurn(chat.id, m));
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const distill = async (messageIds: number[] | null, kind: CardKind) => {
    if (!selected) return;
    try {
      await wb.cardDistill(selected.id, messageIds, kind);
      toast("Distilled into a card — see Library");
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <div className="h-full flex">
      <div className="w-[260px] shrink-0 border-r border-edge flex flex-col">
        <div className="p-2.5 flex gap-2">
          <input
            ref={filterRef}
            className="ctl"
            placeholder="Filter chats… (/)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn-acc shrink-0" title="New chat (N)" onClick={newChat}>
            <Plus size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {chats.length === 0 && (
            <Empty text={showArchived ? "No archived chats" : "No chats yet"} hint="Press + to start one." />
          )}
          {chats.map((c) => (
            <button
              key={c.id}
              className={`w-full text-left rounded-md px-2.5 py-2 mb-0.5 ${
                selected?.id === c.id ? "bg-panel2" : "hover:bg-panel2/60"
              }`}
              onClick={() => openChat(c.id)}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium text-[13px] flex-1">{c.title}</span>
                {c.mode === "compare" && (
                  <span className="text-[10px] text-acc2 shrink-0">compare({c.models.length})</span>
                )}
              </div>
              <div className="text-mut text-[11px] flex items-center gap-1.5 min-w-0">
                <span className="shrink-0">{fmtDate(c.updated_at)}</span>
                {c.topic && <span className="truncate">· {c.topic}</span>}
              </div>
            </button>
          ))}
        </div>
        <button className="mx-2.5 mb-2 btn-ghost !py-1 text-[12px]" onClick={() => setShowArchived((s) => !s)}>
          {showArchived ? "Show active" : "Show archived"}
        </button>
      </div>

      <div className="flex-1 min-w-0">
        {selected ? (
          <ChatView
            chat={selected}
            pending={pending}
            providers={providers}
            onSend={sendInChat}
            onRetry={(model) => runTurn(selected.id, model)}
            onAdopt={(model) =>
              wb
                .chatAdopt(selected.id, model)
                .then((c) => {
                  setSelected(c);
                  loadChats();
                  toast("Adopted into a new chat");
                })
                .catch((e) => toast(String(e), "bad"))
            }
            onDistill={distill}
            onRename={(title) => {
              setSelected({ ...selected, title });
              wb.chatUpdate({ id: selected.id, title, topic: null, archived: null }).then(loadChats).catch(() => {});
            }}
            onTopicChange={(topic) => {
              setSelected({ ...selected, topic });
              wb.chatUpdate({ id: selected.id, title: null, topic, archived: null }).then(loadChats).catch(() => {});
            }}
            onArchiveToggle={() => {
              const archived = !selected.archived;
              wb
                .chatUpdate({ id: selected.id, title: null, topic: null, archived })
                .then(() => {
                  setSelected({ ...selected, archived });
                  loadChats();
                })
                .catch((e) => toast(String(e), "bad"));
            }}
            onDelete={() => {
              wb.chatDelete(selected.id).then(() => {
                setSelected(null);
                loadChats();
                onChanged();
              });
            }}
          />
        ) : (
          <div className="h-full flex flex-col">
            <div className="flex-1 flex items-center justify-center text-mut text-sm">Start your first conversation</div>
            <div className="p-3 border-t border-edge flex flex-col gap-2">
              <ModelPicker providers={providers} mode={mode} setMode={setMode} selected={models} setSelected={setModels} />
              <div className="flex gap-2">
                <textarea
                  className="ctl flex-1 !min-h-[42px] resize-none"
                  placeholder="Start a conversation…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendNew();
                    }
                  }}
                />
                <button className="btn-acc self-end" onClick={sendNew} disabled={!draft.trim() || models.length === 0}>
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
