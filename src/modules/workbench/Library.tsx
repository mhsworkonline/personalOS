import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Card, CardKind, CardMeta } from "./types";
import { wb } from "./mockData";
import { Empty, useToast } from "../../components/ui";
import { fmtDate } from "../../lib/format";
import CardEditor from "./CardEditor";
import { BookOpen, Code2, Download, Lightbulb, Pin, Plus, Scale, Wand2 } from "lucide-react";

const KIND_ICON: Record<CardKind, React.ReactNode> = {
  idea: <Lightbulb size={14} className="text-warn shrink-0" />,
  insight: <BookOpen size={14} className="text-acc2 shrink-0" />,
  decision: <Scale size={14} className="text-ok shrink-0" />,
  prompt: <Wand2 size={14} className="text-acc2 shrink-0" />,
  snippet: <Code2 size={14} className="text-mut shrink-0" />,
};

const ALL_KINDS: CardKind[] = ["idea", "insight", "decision", "prompt", "snippet"];
const PROMOTE_KINDS: CardKind[] = ["insight", "decision", "prompt", "snippet"];

export default function Library({
  refreshKey,
  focus,
  personId,
  onChanged,
}: {
  refreshKey: number;
  focus: { module: string; id: number; nonce: number } | null;
  personId: number | null;
  onChanged: () => void;
}) {
  const [cards, setCards] = useState<CardMeta[]>([]);
  const [kind, setKind] = useState<CardKind | "">("");
  const [topic, setTopic] = useState("");
  const [project, setProject] = useState("");
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Card | "new" | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(() => {
    wb
      .cardList(kind || null, topic || null, project || null, archived, query || null)
      .then(setCards)
      .catch(() => {});
  }, [kind, topic, project, archived, query]);

  useEffect(load, [load, refreshKey]);

  useEffect(() => {
    const f = () => searchRef.current?.focus();
    window.addEventListener("personalos:module-search", f);
    return () => window.removeEventListener("personalos:module-search", f);
  }, []);

  useEffect(() => {
    if (focus?.module !== "cards" || focus.id <= 0) return;
    wb.cardGet(focus.id).then(setEditing).catch(() => {});
  }, [focus]);

  const topics = useMemo(() => [...new Set(cards.map((c) => c.topic).filter(Boolean))].sort(), [cards]);
  const projects = useMemo(() => [...new Set(cards.map((c) => c.project).filter(Boolean))].sort(), [cards]);

  const togglePin = async (c: CardMeta) => {
    const full = await wb.cardGet(c.id);
    await wb.cardSave({ ...full, pinned: !full.pinned });
    load();
  };

  const promote = async (c: CardMeta, newKind: CardKind) => {
    try {
      const full = await wb.cardGet(c.id);
      await wb.cardSave({ ...full, kind: newKind });
      load();
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const exportFiltered = async () => {
    const path = await saveDialog({
      defaultPath: `workbench-export-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    try {
      const msg = await wb.cardExport(cards.map((c) => c.id), path);
      toast(msg);
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-edge flex items-center gap-2 flex-wrap">
        <input
          ref={searchRef}
          className="ctl !w-56"
          placeholder="Search cards… (/)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="ctl !w-32" value={kind} onChange={(e) => setKind(e.target.value as CardKind | "")}>
          <option value="">All kinds</option>
          {ALL_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select className="ctl !w-32" value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className="ctl !w-32" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[12px] text-mut cursor-pointer">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> archived
        </label>
        <div className="flex-1" />
        {(topic || project) && cards.length > 0 && (
          <button className="btn-edge !py-1 text-[12px]" onClick={exportFiltered}>
            <Download size={13} /> Send {cards.length} filtered → file
          </button>
        )}
        <button className="btn-acc shrink-0" title="New card" onClick={() => setEditing("new")}>
          <Plus size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {cards.length === 0 && (
          <Empty
            text={query || kind || topic || project ? "No cards match" : "Nothing captured yet"}
            hint="Distill a chat, or press I for a quick idea."
          />
        )}
        {cards.map((c) => (
          <div key={c.id} className="group flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-panel2/60">
            <button
              className={`shrink-0 ${c.pinned ? "text-acc2" : "text-mut opacity-0 group-hover:opacity-100"}`}
              title={c.pinned ? "Unpin" : "Pin"}
              onClick={() => togglePin(c)}
            >
              <Pin size={13} />
            </button>
            {KIND_ICON[c.kind]}
            <button className="flex-1 min-w-0 text-left" onClick={() => wb.cardGet(c.id).then(setEditing)}>
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium">{c.title}</span>
                {c.language && <span className="text-[10px] text-mut shrink-0">{c.language}</span>}
              </div>
              <div className="text-mut text-[11px] truncate">{c.preview}</div>
            </button>
            {c.kind === "idea" && (
              <select
                className="ctl !w-28 !py-1 !text-[11px] shrink-0 opacity-0 group-hover:opacity-100"
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
            )}
            <span className="text-mut text-[11px] shrink-0 w-20 truncate text-right">{c.topic || c.project || ""}</span>
            <span className="text-mut text-[11px] shrink-0 w-16 text-right">{fmtDate(c.updated_at)}</span>
          </div>
        ))}
      </div>

      {editing && (
        <CardEditor
          card={editing === "new" ? null : editing}
          personId={personId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onChanged();
          }}
          onDeleted={
            editing !== "new"
              ? async () => {
                  await wb.cardDelete((editing as Card).id);
                  setEditing(null);
                  load();
                  onChanged();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
