import { useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Card, CardInput, CardKind } from "./types";
import { wb } from "./mockData";
import { Confirm, Field, Modal, useToast } from "../../components/ui";
import { Eye, Pencil, Pin, Sparkles, Trash2 } from "lucide-react";

marked.setOptions({ gfm: true, breaks: true });

const DECISION_TEMPLATE = "## Context\n\n\n## Options\n\n\n## Decision\n\n\n## Why\n\n";

const KIND_LABEL: Record<CardKind, string> = {
  idea: "Idea",
  insight: "Insight",
  decision: "Decision",
  prompt: "Prompt",
  snippet: "Snippet",
};

const ALL_KINDS = Object.keys(KIND_LABEL) as CardKind[];

/** Distinct `{{variable}}` names in a prompt card's body, in first-seen order. */
export function detectVariables(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

export default function CardEditor({
  card,
  defaultKind,
  defaultTopic,
  defaultProject,
  personId,
  onClose,
  onSaved,
  onDeleted,
}: {
  card: Card | null; // null = new
  defaultKind?: CardKind;
  defaultTopic?: string;
  defaultProject?: string;
  personId: number | null;
  onClose: () => void;
  onSaved: (c: Card) => void;
  onDeleted?: () => void;
}) {
  const [kind, setKind] = useState<CardKind>(card?.kind ?? defaultKind ?? "insight");
  const [title, setTitle] = useState(card?.title ?? "");
  const [body, setBody] = useState(card?.body ?? "");
  const [topic, setTopic] = useState(card?.topic ?? defaultTopic ?? "");
  const [project, setProject] = useState(card?.project ?? defaultProject ?? "");
  const [language, setLanguage] = useState(card?.language ?? "");
  const [reviewOn, setReviewOn] = useState(card?.review_on ?? "");
  const [pinned, setPinned] = useState(card?.pinned ?? false);
  const [preview, setPreview] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();

  const variables = useMemo(() => (kind === "prompt" ? detectVariables(body) : []), [kind, body]);
  const rendered = useMemo(
    () => (preview ? DOMPurify.sanitize(marked.parse(body) as string) : ""),
    [preview, body]
  );

  const changeKind = (k: CardKind) => {
    setKind(k);
    if (k === "decision" && !body.trim()) setBody(DECISION_TEMPLATE);
  };

  const save = async () => {
    if (!title.trim()) return;
    try {
      const input: CardInput = {
        id: card?.id ?? null,
        kind,
        title: title.trim(),
        body,
        topic,
        project,
        language,
        review_on: kind === "decision" ? reviewOn : "",
        pinned,
        person_id: card?.person_id ?? personId,
      };
      const saved = await wb.cardSave(input);
      onSaved(saved);
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const summarize = async () => {
    if (!body.trim() || summarizing) return;
    setSummarizing(true);
    try {
      const result = await wb.cardSummarize(body);
      setSummary(result);
    } catch (e) {
      toast(String(e), "bad");
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <Modal title={card ? `Edit ${KIND_LABEL[card.kind]}` : "New card"} onClose={onClose} wide>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Kind">
          <select className="ctl" value={kind} onChange={(e) => changeKind(e.target.value as CardKind)}>
            {ALL_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Topic">
          <input className="ctl" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
        <Field label="Project">
          <input className="ctl" value={project} onChange={(e) => setProject(e.target.value)} placeholder="AIOS project slug" />
        </Field>
      </div>

      <Field label="Title">
        <input className="ctl" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </Field>

      {kind === "snippet" && (
        <Field label="Language">
          <input className="ctl !w-40" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="rust, ts, sql…" />
        </Field>
      )}

      {kind === "decision" && (
        <Field label="Review on (optional — adds to the PersonalOS timeline)">
          <input type="date" className="ctl !w-44" value={reviewOn} onChange={(e) => setReviewOn(e.target.value)} />
        </Field>
      )}

      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] text-mut">Body</span>
        <div className="flex items-center gap-2">
          {card && (
            <button className="btn-ghost !py-1 text-[12px]" onClick={summarize} disabled={summarizing || !body.trim()}>
              <Sparkles size={13} /> {summarizing ? "Summarizing…" : "AI summarize"}
            </button>
          )}
          <button className="btn-ghost !p-1" title={preview ? "Edit" : "Preview"} onClick={() => setPreview((p) => !p)}>
            {preview ? <Pencil size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      {preview ? (
        <div
          className="card bg-panel2 px-3 py-2.5 mb-2.5 md min-h-32 max-h-64 overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      ) : (
        <textarea
          className={`ctl mb-2.5 min-h-32 max-h-64 ${kind === "snippet" ? "font-mono !text-[12.5px]" : ""}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      )}

      {kind === "prompt" && variables.length > 0 && (
        <div className="text-[12px] text-mut mb-2.5">
          Variables detected:{" "}
          {variables.map((v) => (
            <span key={v} className="kbd mx-0.5">{`{{${v}}}`}</span>
          ))}
        </div>
      )}

      {card?.source_chat_title && <div className="text-[12px] text-mut mb-2.5">from chat: {card.source_chat_title}</div>}

      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-3">
          <button
            className={`btn-ghost !p-1.5 ${pinned ? "text-acc2" : ""}`}
            title={pinned ? "Unpin" : "Pin"}
            onClick={() => setPinned((p) => !p)}
          >
            <Pin size={15} />
          </button>
          {card && onDeleted && (
            <button className="btn-ghost !p-1.5 text-bad" title="Delete" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn-edge" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-acc" onClick={save} disabled={!title.trim()}>
            {card ? "Save changes" : "Add card"}
          </button>
        </div>
      </div>

      {summary !== null && (
        <Modal title="AI summary" onClose={() => setSummary(null)}>
          <div className="card bg-panel2 px-3 py-2.5 mb-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] selectable">
            {summary}
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-edge" onClick={() => setSummary(null)}>
              Discard
            </button>
            <button
              className="btn-acc"
              onClick={() => {
                setBody(summary);
                setSummary(null);
              }}
            >
              Replace body
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && card && onDeleted && (
        <Confirm message={`Delete "${card.title}"?`} onClose={() => setConfirmDelete(false)} onConfirm={onDeleted} />
      )}
    </Modal>
  );
}
