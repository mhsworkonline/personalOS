import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { AiProvider, CARD_KINDS, CardKind, Chat, ChatMessage } from "./types";
import { Confirm } from "../../components/ui";
import { Archive, ArchiveRestore, GitBranch, RefreshCcw, Send, Sparkles, Trash2 } from "lucide-react";

marked.setOptions({ gfm: true, breaks: true });

function renderMd(text: string): string {
  return DOMPurify.sanitize(marked.parse(text) as string);
}

function modelLabel(providers: AiProvider[], key: string): string {
  const [pid, modelId] = key.split(":");
  const provider = providers.find((p) => String(p.id) === pid);
  return provider ? `${provider.name} · ${modelId}` : key;
}

interface Turn {
  user: ChatMessage;
  byModel: Record<string, ChatMessage>;
}

function groupTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      current = { user: m, byModel: {} };
      turns.push(current);
    } else if (current) {
      current.byModel[m.model] = m;
    }
  }
  return turns;
}

function MessageBubble({
  msg,
  selecting,
  selected,
  onToggle,
  onRetry,
  onAdopt,
}: {
  msg: ChatMessage;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onRetry?: () => void;
  onAdopt?: () => void;
}) {
  const isUser = msg.role === "user";
  const hasError = !!msg.error;
  const html = useMemo(() => (isUser || hasError ? "" : renderMd(msg.content || "")), [isUser, hasError, msg.content]);

  return (
    <div className={`flex items-start gap-2 ${isUser ? "justify-end" : ""}`}>
      {selecting && <input type="checkbox" className="mt-2.5" checked={selected} onChange={onToggle} />}
      <div
        className={`card px-3 py-2 text-[13px] max-w-[85%] min-w-0 ${
          isUser ? "bg-acc/10" : hasError ? "border-[#4a2626]" : "bg-panel2"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words selectable">{msg.content}</div>
        ) : hasError ? (
          <div className="text-bad selectable break-words">{msg.error}</div>
        ) : (
          <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {(onRetry || (onAdopt && !hasError)) && (
          <div className="flex gap-3 mt-1.5">
            {onRetry && (
              <button className="btn-ghost !p-0 text-[11px] text-bad" onClick={onRetry}>
                <RefreshCcw size={11} /> Retry
              </button>
            )}
            {onAdopt && !hasError && (
              <button className="btn-ghost !p-0 text-[11px]" onClick={onAdopt}>
                <GitBranch size={11} /> Adopt
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DistillMenu({ onPick, onClose }: { onPick: (kind: CardKind) => void; onClose: () => void }) {
  return (
    <div className="absolute right-0 top-full mt-1 z-10 card p-1 flex flex-col w-36 shadow-lg">
      {CARD_KINDS.map((k) => (
        <button
          key={k}
          className="btn !justify-start w-full !py-1 text-[12.5px] capitalize"
          onClick={() => {
            onPick(k);
            onClose();
          }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

export default function ChatView({
  chat,
  pending,
  providers,
  onSend,
  onRetry,
  onAdopt,
  onDistill,
  onRename,
  onTopicChange,
  onArchiveToggle,
  onDelete,
}: {
  chat: Chat;
  pending: Record<string, { text: string }>;
  providers: AiProvider[];
  onSend: (content: string) => void;
  onRetry: (model: string) => void;
  onAdopt: (model: string) => void;
  onDistill: (messageIds: number[] | null, kind: CardKind) => void;
  onRename: (title: string) => void;
  onTopicChange: (topic: string) => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
}) {
  const [content, setContent] = useState("");
  const [titleDraft, setTitleDraft] = useState(chat.title);
  const [topicDraft, setTopicDraft] = useState(chat.topic);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [distillOpen, setDistillOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleDraft(chat.title);
    setTopicDraft(chat.topic);
  }, [chat.id, chat.title, chat.topic]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages.length, pending]);

  const turns = useMemo(() => groupTurns(chat.messages), [chat.messages]);
  const isCompare = chat.mode === "compare";
  const anyPending = Object.keys(pending).length > 0;

  const send = () => {
    if (!content.trim() || anyPending) return;
    onSend(content.trim());
    setContent("");
  };

  const toggleSelect = (id: number) =>
    setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2.5 border-b border-edge flex items-center gap-2">
        <input
          className="flex-1 bg-transparent font-semibold text-[14px] outline-none min-w-0"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => titleDraft.trim() && titleDraft !== chat.title && onRename(titleDraft.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
        <input
          className="ctl !w-36 !py-1 text-[12px] shrink-0"
          placeholder="topic"
          value={topicDraft}
          onChange={(e) => setTopicDraft(e.target.value)}
          onBlur={() => topicDraft !== chat.topic && onTopicChange(topicDraft)}
        />
        <button
          className={`btn-edge !py-1 text-[12px] shrink-0 ${selecting ? "text-acc2" : ""}`}
          onClick={() => {
            setSelecting((s) => !s);
            setSelectedIds([]);
          }}
        >
          {selecting ? "Cancel" : "Select"}
        </button>
        <div className="relative shrink-0">
          <button className="btn-edge !py-1 text-[12px]" onClick={() => setDistillOpen((d) => !d)}>
            <Sparkles size={13} /> Distill{selectedIds.length ? ` (${selectedIds.length})` : ""}
          </button>
          {distillOpen && (
            <DistillMenu
              onClose={() => setDistillOpen(false)}
              onPick={(kind) => {
                onDistill(selectedIds.length ? selectedIds : null, kind);
                setSelecting(false);
                setSelectedIds([]);
              }}
            />
          )}
        </div>
        <button
          className="btn-ghost !p-1.5 shrink-0"
          title={chat.archived ? "Unarchive" : "Archive"}
          onClick={onArchiveToggle}
        >
          {chat.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        </button>
        <button className="btn-ghost !p-1.5 shrink-0 text-bad" title="Delete chat" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {turns.map((turn, ti) => {
          const isLastTurn = ti === turns.length - 1;
          return (
            <div key={turn.user.id} className="flex flex-col gap-2">
              <MessageBubble
                msg={turn.user}
                selecting={selecting}
                selected={selectedIds.includes(turn.user.id)}
                onToggle={() => toggleSelect(turn.user.id)}
              />
              <div
                className={isCompare ? "grid gap-2" : ""}
                style={isCompare ? { gridTemplateColumns: `repeat(${Math.max(chat.models.length, 1)}, minmax(0,1fr))` } : undefined}
              >
                {chat.models.map((model) => {
                  const msg = turn.byModel[model];
                  const streaming = isLastTurn ? pending[model] : undefined;
                  return (
                    <div key={model} className="min-w-0">
                      {isCompare && (
                        <div className="text-[11px] text-mut mb-1 truncate">{modelLabel(providers, model)}</div>
                      )}
                      {msg ? (
                        <MessageBubble
                          msg={msg}
                          selecting={selecting}
                          selected={selectedIds.includes(msg.id)}
                          onToggle={() => toggleSelect(msg.id)}
                          onRetry={msg.error ? () => onRetry(model) : undefined}
                          onAdopt={isCompare ? () => onAdopt(model) : undefined}
                        />
                      ) : streaming ? (
                        <div className="card bg-panel2 px-3 py-2 text-[13px] max-w-[85%] min-w-0">
                          <div className="md" dangerouslySetInnerHTML={{ __html: renderMd(streaming.text || "…") }} />
                        </div>
                      ) : isLastTurn && anyPending ? (
                        <div className="text-mut text-[12px] px-1">waiting…</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-edge flex gap-2">
        <textarea
          className="ctl flex-1 !min-h-[42px] max-h-40 resize-none"
          placeholder={isCompare ? `Message all ${chat.models.length}…` : "Message…"}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn-acc self-end shrink-0" onClick={send} disabled={!content.trim() || anyPending}>
          {anyPending ? "Sending…" : <Send size={15} />}
        </button>
      </div>

      {confirmDelete && (
        <Confirm message={`Delete "${chat.title}"?`} onClose={() => setConfirmDelete(false)} onConfirm={onDelete} />
      )}
    </div>
  );
}
