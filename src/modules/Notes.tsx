import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, Folder, Note, NoteMeta, Person } from "../api";
import { Confirm, Empty, Field, Modal, personLabel, useToast } from "../components/ui";
import { fmtDate, todayISO } from "../lib/format";
import {
  BellPlus,
  Eye,
  FolderPlus,
  Folder as FolderIcon,
  Hash,
  Inbox,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";

marked.setOptions({ gfm: true, breaks: true });

export default function Notes({
  refreshKey,
  focus,
  onChanged,
}: {
  refreshKey: number;
  focus: { module: string; id: number; nonce: number } | null;
  onChanged: () => void;
}) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<number | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<Folder | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const loadLists = useCallback(() => {
    api.folderList().then(setFolders).catch(() => {});
    api.personList().then(setPeople).catch(() => {});
    api.tagList().then(setTags).catch(() => {});
    api.noteList(folderFilter, tagFilter, query || null).then(setNotes).catch(() => {});
  }, [folderFilter, tagFilter, query]);

  useEffect(loadLists, [loadLists, refreshKey]);

  useEffect(() => {
    const f = () => searchRef.current?.focus();
    window.addEventListener("personalos:module-search", f);
    return () => window.removeEventListener("personalos:module-search", f);
  }, []);

  // Navigation from search / Ctrl+N (id === -1 means "create new")
  useEffect(() => {
    if (focus?.module !== "notes") return;
    if (focus.id === -1) {
      createNote();
    } else if (focus.id > 0) {
      api.noteGet(focus.id).then(setNote).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const createNote = async () => {
    try {
      const created = await api.noteSave({
        id: null,
        title: "Untitled",
        content: "",
        folder_id: folderFilter,
        pinned: false,
        tags: [],
        person_id: null, // defaults to "Me"
      });
      setNote(created);
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <div className="h-full flex">
      {/* Folder / tag rail */}
      <div className="w-48 shrink-0 border-r border-edge p-2.5 flex flex-col overflow-y-auto">
        <button
          className={`btn !justify-start w-full !py-1.5 ${
            folderFilter === null && tagFilter === null ? "bg-panel2 text-ink" : "text-mut hover:text-ink"
          }`}
          onClick={() => {
            setFolderFilter(null);
            setTagFilter(null);
          }}
        >
          <Inbox size={15} />
          <span className="text-[13px]">All notes</span>
        </button>

        <div className="flex items-center justify-between mt-3 mb-1 px-1">
          <span className="text-[11px] uppercase tracking-wide text-mut">Folders</span>
          <button className="btn-ghost !p-1" title="New folder" onClick={() => setNewFolderOpen(true)}>
            <FolderPlus size={13} />
          </button>
        </div>
        {folders.map((f) => (
          <div key={f.id} className="group flex items-center">
            <button
              className={`btn !justify-start flex-1 !py-1.5 min-w-0 ${
                folderFilter === f.id ? "bg-panel2 text-ink" : "text-mut hover:text-ink"
              }`}
              onClick={() => {
                setFolderFilter(folderFilter === f.id ? null : f.id);
                setTagFilter(null);
              }}
            >
              <FolderIcon size={15} className="shrink-0" />
              <span className="text-[13px] truncate">{f.name}</span>
            </button>
            <button
              className="opacity-0 group-hover:opacity-100 btn-ghost !p-1"
              title="Delete folder"
              onClick={() => setConfirmFolderDelete(f)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {tags.length > 0 && (
          <>
            <div className="text-[11px] uppercase tracking-wide text-mut mt-3 mb-1 px-1">Tags</div>
            <div className="flex flex-wrap gap-1 px-1">
              {tags.map((t) => (
                <button
                  key={t}
                  className={`text-[12px] rounded-full px-2 py-0.5 border ${
                    tagFilter === t
                      ? "border-acc text-acc2 bg-panel2"
                      : "border-edge text-mut hover:text-ink"
                  }`}
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                >
                  #{t}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Note list */}
      <div className="w-[280px] shrink-0 border-r border-edge flex flex-col">
        <div className="p-2.5 flex gap-2">
          <input
            ref={searchRef}
            className="ctl"
            placeholder="Search notes…  (Ctrl+F)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn-acc shrink-0" title="New note (Ctrl+N)" onClick={createNote}>
            <Plus size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {notes.length === 0 && <Empty text="No notes" hint="Ctrl+N creates a new note." />}
          {notes.map((n) => (
            <button
              key={n.id}
              className={`w-full text-left rounded-md px-2.5 py-2 mb-0.5 ${
                note?.id === n.id ? "bg-panel2" : "hover:bg-panel2/60"
              }`}
              onClick={() => api.noteGet(n.id).then(setNote)}
            >
              <div className="flex items-center gap-1.5">
                {n.pinned && <Pin size={12} className="text-acc2 shrink-0" />}
                <span className="truncate font-medium text-[13px]">{n.title}</span>
              </div>
              <div className="text-mut text-[12px] truncate">{n.preview || "Empty note"}</div>
              <div className="flex gap-1 mt-0.5 items-center">
                <span className="text-[11px] text-[#5b6170]">{fmtDate(n.updated_at)}</span>
                {n.tags.map((t) => (
                  <span key={t} className="text-[11px] text-acc2">
                    #{t}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0">
        {note ? (
          <NoteEditor
            key={note.id}
            note={note}
            folders={folders}
            people={people}
            onChanged={(n) => {
              setNote(n);
              onChanged();
            }}
            onDelete={() => setConfirmDelete(note)}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-mut text-sm">
            Select a note, or press <span className="kbd mx-1.5">Ctrl+N</span> for a new one
          </div>
        )}
      </div>

      {newFolderOpen && (
        <FolderModal
          onClose={() => setNewFolderOpen(false)}
          onSaved={() => {
            setNewFolderOpen(false);
            loadLists();
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          message={`Delete “${confirmDelete.title}”?`}
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await api.noteDelete(confirmDelete.id);
            setNote(null);
            onChanged();
          }}
        />
      )}
      {confirmFolderDelete && (
        <Confirm
          message={`Delete folder “${confirmFolderDelete.name}”?`}
          detail="Notes inside are kept and moved to All notes."
          onClose={() => setConfirmFolderDelete(null)}
          onConfirm={async () => {
            await api.folderDelete(confirmFolderDelete.id);
            if (folderFilter === confirmFolderDelete.id) setFolderFilter(null);
            loadLists();
          }}
        />
      )}
    </div>
  );
}

function FolderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const toast = useToast();
  const save = async () => {
    try {
      await api.folderCreate(name);
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };
  return (
    <Modal title="New folder" onClose={onClose}>
      <Field label="Folder name">
        <input
          className="ctl"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!name.trim()}>
          Create
        </button>
      </div>
    </Modal>
  );
}

function NoteEditor({
  note,
  folders,
  people,
  onChanged,
  onDelete,
}: {
  note: Note;
  folders: Folder[];
  people: Person[];
  onChanged: (n: Note) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [folderId, setFolderId] = useState<number | null>(note.folder_id);
  const [personId, setPersonId] = useState<number | null>(note.person_id);
  const [pinned, setPinned] = useState(note.pinned);
  const [tagsText, setTagsText] = useState(note.tags.join(", "));
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const toast = useToast();
  const saveTimer = useRef<number | undefined>(undefined);

  const doSave = useCallback(
    async (opts?: {
      folder_id?: number | null;
      pinned?: boolean;
      person_id?: number | null;
      toastMsg?: string;
    }) => {
      try {
        const saved = await api.noteSave({
          id: note.id,
          title: title.trim() || "Untitled",
          content,
          folder_id: opts?.folder_id !== undefined ? opts.folder_id : folderId,
          pinned: opts?.pinned !== undefined ? opts.pinned : pinned,
          person_id: opts?.person_id !== undefined ? opts.person_id : personId,
          tags: tagsText
            .split(/[,\s]+/)
            .map((t) => t.trim())
            .filter(Boolean),
        });
        setDirty(false);
        onChanged(saved);
        if (opts?.toastMsg) toast(opts.toastMsg);
      } catch (e) {
        toast(String(e), "bad");
      }
    },
    [note.id, title, content, folderId, pinned, personId, tagsText, onChanged, toast]
  );

  // Debounced autosave + Ctrl+S
  useEffect(() => {
    if (!dirty) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => doSave(), 1500);
    return () => window.clearTimeout(saveTimer.current);
  }, [title, content, tagsText, dirty, doSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave({ toastMsg: "Saved" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  const rendered = useMemo(
    () => (preview ? DOMPurify.sanitize(marked.parse(content) as string) : ""),
    [preview, content]
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-4 pb-2 flex items-center gap-2 border-b border-edge">
        <input
          className="flex-1 bg-transparent text-lg font-semibold outline-none min-w-0"
          value={title}
          placeholder="Title"
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
        />
        <button
          className={`btn-ghost !p-1.5 ${pinned ? "text-acc2" : ""}`}
          title={pinned ? "Unpin" : "Pin note"}
          onClick={() => {
            setPinned(!pinned);
            doSave({ pinned: !pinned, toastMsg: pinned ? "Unpinned" : "Pinned" });
          }}
        >
          <Pin size={16} />
        </button>
        <button
          className="btn-ghost !p-1.5"
          title="Set a follow-up reminder"
          onClick={() => setReminderOpen(true)}
        >
          <BellPlus size={16} />
        </button>
        <button
          className={`btn-ghost !p-1.5 ${preview ? "text-acc2" : ""}`}
          title={preview ? "Edit markdown" : "Preview markdown"}
          onClick={() => setPreview(!preview)}
        >
          {preview ? <Pencil size={16} /> : <Eye size={16} />}
        </button>
        <button className="btn-ghost !p-1.5 text-bad" title="Delete note" onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </div>

      <div className="px-5 py-2 flex items-center gap-3 border-b border-edge">
        <select
          className="ctl !w-40 !py-1"
          value={folderId ?? ""}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : null;
            setFolderId(v);
            doSave({ folder_id: v });
          }}
        >
          <option value="">No folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          className="ctl !w-32 !py-1"
          title="Belongs to"
          value={personId ?? people.find((p) => p.is_default)?.id ?? ""}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPersonId(v);
            doSave({ person_id: v });
          }}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {personLabel(p)}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Hash size={13} className="text-mut shrink-0" />
          <input
            className="bg-transparent outline-none text-[13px] flex-1 min-w-0"
            placeholder="tags, comma separated"
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <span className="text-[11px] text-mut shrink-0">
          {dirty ? "editing…" : "saved"} · Ctrl+S
        </span>
      </div>

      {preview ? (
        <div className="flex-1 overflow-y-auto px-5 py-4 md" dangerouslySetInnerHTML={{ __html: rendered }} />
      ) : (
        <textarea
          className="flex-1 bg-transparent outline-none resize-none px-5 py-4 leading-relaxed font-[Consolas,monospace] text-[13.5px]"
          placeholder="Write in markdown…"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
        />
      )}

      {reminderOpen && (
        <NoteReminderModal
          noteId={note.id}
          onClose={() => setReminderOpen(false)}
          onSaved={() => {
            setReminderOpen(false);
            toast("Reminder set — it shows on the dashboard timeline");
          }}
        />
      )}
    </div>
  );
}

function NoteReminderModal({
  noteId,
  onClose,
  onSaved,
}: {
  noteId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const toast = useToast();
  return (
    <Modal title="Follow-up reminder" onClose={onClose}>
      <Field label="Remind me on">
        <input type="date" className="ctl" value={date} autoFocus onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className="flex justify-between gap-2 mt-1">
        <button
          className="btn-ghost text-[12px]"
          onClick={async () => {
            await api.noteSetReminder(noteId, null);
            toast("Reminder cleared");
            onClose();
          }}
        >
          Clear reminder
        </button>
        <div className="flex gap-2">
          <button className="btn-edge" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-acc"
            onClick={async () => {
              try {
                await api.noteSetReminder(noteId, date);
                onSaved();
              } catch (e) {
                toast(String(e), "bad");
              }
            }}
          >
            Set reminder
          </button>
        </div>
      </div>
    </Modal>
  );
}
