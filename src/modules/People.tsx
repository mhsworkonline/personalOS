import { useCallback, useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  api,
  Doc,
  DocType,
  DocumentFileMeta,
  Person,
  PersonInput,
  PersonOverview,
  Relationship,
} from "../api";
import { NavTarget } from "../App";
import { Confirm, Field, Modal, personLabel, Tone, useToast } from "../components/ui";
import { daysUntil, dueLabel, fmtDate, fmtMoney } from "../lib/format";
import {
  BadgeCheck,
  Banknote,
  Calendar,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  EyeOff,
  FileText,
  Home,
  Image as ImageIcon,
  KeyRound,
  Mail,
  MapPin,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  RefreshCcw,
  StickyNote,
  Trash2,
  UserPlus,
  UserRound,
} from "lucide-react";

export const RELATIONSHIPS: { id: Relationship; label: string }[] = [
  { id: "self", label: "Self" },
  { id: "wife", label: "Wife" },
  { id: "husband", label: "Husband" },
  { id: "father", label: "Father" },
  { id: "mother", label: "Mother" },
  { id: "son", label: "Son" },
  { id: "daughter", label: "Daughter" },
  { id: "brother", label: "Brother" },
  { id: "sister", label: "Sister" },
  { id: "friend", label: "Friend" },
  { id: "relative", label: "Relative" },
  { id: "employee", label: "Employee" },
  { id: "client", label: "Client" },
  { id: "other", label: "Other" },
];

export const DOC_TYPES: { id: DocType; label: string }[] = [
  { id: "aadhaar", label: "Aadhaar" },
  { id: "pan", label: "PAN" },
  { id: "passport", label: "Passport" },
  { id: "driving_licence", label: "Driving Licence" },
  { id: "voter_id", label: "Voter ID" },
  { id: "birth_certificate", label: "Birth Certificate" },
  { id: "insurance", label: "Insurance" },
  { id: "health_card", label: "Health Card" },
  { id: "pension_card", label: "Pension Card" },
  { id: "tax", label: "Tax Document" },
  { id: "education", label: "Education" },
  { id: "bank", label: "Bank Document" },
  { id: "legal", label: "Legal Document" },
  { id: "other", label: "Other" },
];

const relLabel = (r: string) => RELATIONSHIPS.find((x) => x.id === r)?.label ?? r;
const docLabel = (t: string) => DOC_TYPES.find((x) => x.id === t)?.label ?? "Document";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function maskNumber(n: string): string {
  const clean = n.trim();
  if (clean.length <= 4) return "••••";
  return "•••• " + clean.slice(-4);
}

function age(dob: string): number | null {
  const days = daysUntil(dob);
  if (isNaN(days)) return null;
  return Math.floor(-days / 365.25);
}

export default function People({
  refreshKey,
  focus,
  currency,
  navigate,
  onChanged,
}: {
  refreshKey: number;
  focus: { module: string; id: number; nonce: number } | null;
  currency: string;
  navigate: (t: NavTarget) => void;
  onChanged: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [overview, setOverview] = useState<PersonOverview | null>(null);
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const [deleting, setDeleting] = useState<Person | null>(null);
  const toast = useToast();

  const loadPeople = useCallback(async () => {
    try {
      const list = await api.personList();
      setPeople(list);
      // Functional update: never clobber a selection made while the fetch
      // was in flight (e.g. arriving from a search result).
      setSelectedId((prev) => prev ?? list.find((p) => p.is_default)?.id ?? list[0]?.id ?? null);
    } catch {
      /* locked */
    }
  }, []);

  useEffect(() => {
    loadPeople();
  }, [loadPeople, refreshKey]);

  useEffect(() => {
    if (selectedId === null) return;
    api.personOverview(selectedId).then(setOverview).catch(() => setOverview(null));
  }, [selectedId, refreshKey]);

  // Navigation from universal search: person id, or resolve a document to its owner.
  useEffect(() => {
    if (!focus) return;
    if (focus.module === "person") {
      setSelectedId(focus.id);
    } else if (focus.module === "documents") {
      api.documentList(null).then((docs) => {
        const d = docs.find((x) => x.id === focus.id);
        if (d) setSelectedId(d.person_id);
      });
    }
  }, [focus]);

  return (
    <div className="h-full flex">
      {/* People rail */}
      <div className="w-56 shrink-0 border-r border-edge flex flex-col">
        <div className="p-2.5">
          <button className="btn-acc w-full" onClick={() => setEditing("new")}>
            <UserPlus size={15} /> Add person
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {people.map((p) => (
            <button
              key={p.id}
              className={`w-full text-left rounded-md px-2.5 py-2 mb-0.5 flex items-center gap-2.5 ${
                selectedId === p.id ? "bg-panel2" : "hover:bg-panel2/60"
              }`}
              onClick={() => setSelectedId(p.id)}
            >
              <span className="w-8 h-8 rounded-full bg-acc/20 text-acc2 flex items-center justify-center text-[12px] font-semibold shrink-0">
                {initials(p.full_name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-[13px]">{personLabel(p)}</span>
                <span className="block text-mut text-[11.5px]">{relLabel(p.relationship)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Person dashboard */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {overview ? (
          <PersonDashboard
            overview={overview}
            people={people}
            currency={currency}
            navigate={navigate}
            onEdit={() => setEditing(overview.person)}
            onDelete={() => setDeleting(overview.person)}
            onChanged={onChanged}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-mut text-sm">
            Select a person
          </div>
        )}
      </div>

      {editing && (
        <PersonEditor
          person={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null);
            setSelectedId(p.id);
            onChanged();
          }}
        />
      )}
      {deleting && (
        <DeletePersonModal
          person={deleting}
          people={people}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            setSelectedId(people.find((p) => p.is_default)?.id ?? null);
            toast("Person deleted");
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person dashboard
// ---------------------------------------------------------------------------

function PersonDashboard({
  overview,
  people,
  currency,
  navigate,
  onEdit,
  onDelete,
  onChanged,
}: {
  overview: PersonOverview;
  people: Person[];
  currency: string;
  navigate: (t: NavTarget) => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const p = overview.person;
  const toast = useToast();
  const [docEditing, setDocEditing] = useState<Doc | "new" | null>(null);
  const [docDeleting, setDocDeleting] = useState<Doc | null>(null);
  const [docFilter, setDocFilter] = useState("");

  // Matches the visible title, the type label and any linked filename, so
  // "gujcet" or "marksheet" narrows a long list straight away.
  const q = docFilter.trim().toLowerCase();
  const filteredDocs = !q
    ? overview.documents
    : overview.documents.filter((d) =>
        [
          d.notes ?? "",
          d.name_on_document ?? "",
          docLabel(d.doc_type),
          ...d.links.map((l) => l.filename),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );

  const setPhoto = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (!path || typeof path !== "string") return;
    try {
      await api.personSetPhoto(p.id, path);
      toast("Photo updated");
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const expiring = overview.timeline.filter(
    (e) => e.kind === "document_expiration" || e.kind === "expiration"
  );
  const renewals = overview.timeline.filter((e) => e.kind === "renewal");
  const otherEvents = overview.timeline.filter(
    (e) => !expiring.includes(e) && !renewals.includes(e)
  );

  return (
    <div className="p-6 max-w-[1100px]">
      {/* Header */}
      <div className="flex items-start gap-4 mb-5">
        {overview.photo ? (
          <img
            src={overview.photo}
            alt={p.full_name}
            className="w-16 h-16 rounded-2xl object-cover border border-edge cursor-pointer"
            title="Change photo"
            onClick={setPhoto}
          />
        ) : (
          <button
            className="w-16 h-16 rounded-2xl bg-acc/20 text-acc2 flex items-center justify-center text-xl font-semibold"
            title="Add photo"
            onClick={setPhoto}
          >
            {initials(p.full_name)}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold truncate">{p.full_name}</h1>
            {p.nickname && <span className="text-mut">“{p.nickname}”</span>}
            <span className="rounded-full border border-edge bg-panel2 px-2 py-0.5 text-[11.5px] text-acc2">
              {relLabel(p.relationship)}
            </span>
            {p.is_default && <BadgeCheck size={15} className="text-acc2" />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[12.5px] text-mut">
            {p.dob && (
              <span className="flex items-center gap-1">
                <Calendar size={12} /> {fmtDate(p.dob)}
                {age(p.dob) !== null && ` (${age(p.dob)})`}
              </span>
            )}
            {p.phone && (
              <span className="flex items-center gap-1 selectable">
                <Phone size={12} /> {p.phone}
              </span>
            )}
            {p.email && (
              <span className="flex items-center gap-1 selectable">
                <Mail size={12} /> {p.email}
              </span>
            )}
            {p.address && (
              <span className="flex items-center gap-1 selectable">
                <MapPin size={12} /> {p.address}
              </span>
            )}
          </div>
          {p.notes && <div className="text-[12.5px] text-mut mt-1 selectable">{p.notes}</div>}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button className="btn-edge" onClick={onEdit}>
            <Pencil size={14} /> Edit
          </button>
          {!p.is_default && (
            <button className="btn-danger" onClick={onDelete} title="Delete person">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Upcoming */}
        <Section
          title="Upcoming"
          icon={<Calendar size={14} />}
          className="col-span-2"
          empty={overview.timeline.length === 0 ? "Nothing scheduled for this person" : undefined}
        >
          {[...expiring, ...renewals, ...otherEvents]
            .sort((a, b) => a.event_date.localeCompare(b.event_date))
            .slice(0, 12)
            .map((ev) => {
              const due = dueLabel(ev.event_date);
              return (
                <div key={ev.id} className="flex items-center gap-2.5 py-1.5">
                  <span className="flex-1 truncate">{ev.title}</span>
                  {ev.amount != null && ev.amount > 0 && (
                    <span className="text-mut text-[12px]">{fmtMoney(ev.amount, currency)}</span>
                  )}
                  <span className="text-mut text-[12px] w-20 text-right">{fmtDate(ev.event_date)}</span>
                  <span className="w-20 text-right">
                    <Tone tone={due.tone}>{due.text}</Tone>
                  </span>
                </div>
              );
            })}
        </Section>

        {/* Documents */}
        <Section
          title={`Documents (${overview.documents.length})`}
          icon={<FileText size={14} />}
          className="col-span-2"
          action={
            <button className="btn-ghost !py-1 text-[12px]" onClick={() => setDocEditing("new")}>
              <Plus size={13} /> Add document
            </button>
          }
          empty={overview.documents.length === 0 ? "No documents yet — Aadhaar, PAN, passport, insurance…" : undefined}
        >
          {overview.documents.length > 6 && (
            <input
              className="ctl mb-2"
              placeholder="Filter documents… (name, type, file)"
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            {filteredDocs.map((d) => (
              <DocumentCard
                key={d.id}
                doc={d}
                onEdit={() => setDocEditing(d)}
                onDelete={() => setDocDeleting(d)}
              />
            ))}
          </div>
          {overview.documents.length > 0 && filteredDocs.length === 0 && (
            <div className="text-mut text-[13px] py-2">No documents match "{docFilter}"</div>
          )}
        </Section>

        {/* Bank accounts */}
        <Section
          title={`Bank accounts (${overview.accounts.length})`}
          icon={<Banknote size={14} />}
          empty={overview.accounts.length === 0 ? "No accounts" : undefined}
        >
          {overview.accounts.map((a) => (
            <button
              key={a.id}
              className="w-full flex items-center gap-2 py-1.5 hover:bg-panel2 rounded-md px-1.5 -mx-1.5 text-left"
              onClick={() => navigate({ view: "finance", recordModule: "accounts", recordId: a.id })}
            >
              <span className="flex-1 truncate">{a.name}</span>
              <span className="text-mut text-[12px]">{a.kind.replace("_", " ")}</span>
              <span className={a.kind === "credit_card" ? "text-bad" : ""}>
                {fmtMoney(a.balance, currency)}
              </span>
            </button>
          ))}
        </Section>

        {/* Vault */}
        <Section
          title={`Vault entries (${overview.vault.length})`}
          icon={<KeyRound size={14} />}
          empty={overview.vault.length === 0 ? "No vault entries" : undefined}
        >
          {overview.vault.slice(0, 8).map((v) => (
            <button
              key={v.id}
              className="w-full flex items-center gap-2 py-1.5 hover:bg-panel2 rounded-md px-1.5 -mx-1.5 text-left"
              onClick={() => navigate({ view: "vault", recordModule: "vault", recordId: v.id })}
            >
              <span className="flex-1 truncate">{v.name}</span>
              {v.username && <span className="text-mut text-[12px] truncate">{v.username}</span>}
            </button>
          ))}
        </Section>

        {/* Subscriptions */}
        <Section
          title={`Subscriptions (${overview.subscriptions.length})`}
          icon={<RefreshCcw size={14} />}
          empty={overview.subscriptions.length === 0 ? "No subscriptions" : undefined}
        >
          {overview.subscriptions.map((s) => (
            <div key={s.id} className={`flex items-center gap-2 py-1.5 ${!s.active ? "opacity-50" : ""}`}>
              <span className="flex-1 truncate">{s.name}</span>
              <span className="text-mut text-[12px]">
                {fmtMoney(s.amount, currency)}/{s.cycle.replace("ly", "")}
              </span>
              {s.active && <Tone tone={dueLabel(s.next_renewal).tone}>{dueLabel(s.next_renewal).text}</Tone>}
            </div>
          ))}
        </Section>

        {/* Investments */}
        <Section
          title={`Investments (${overview.investments.length})`}
          icon={<Home size={14} />}
          empty={overview.investments.length === 0 ? "No properties" : undefined}
        >
          {overview.investments.map((inv) => (
            <button
              key={inv.id}
              className="w-full flex items-center gap-2 py-1.5 hover:bg-panel2 rounded-md px-1.5 -mx-1.5 text-left"
              onClick={() => navigate({ view: "investments", recordModule: "investments", recordId: inv.id })}
            >
              <span className="flex-1 truncate">{inv.name}</span>
              <span className="text-mut text-[12px] capitalize">{inv.status}</span>
              <span>{fmtMoney(inv.total_purchase, currency)}</span>
            </button>
          ))}
        </Section>

        {/* Tasks */}
        <Section
          title={`Tasks (${overview.tasks.filter((t) => !t.done).length} open)`}
          icon={<CheckCircle2 size={14} />}
          empty={overview.tasks.length === 0 ? "No tasks" : undefined}
        >
          {overview.tasks.slice(0, 8).map((t) => (
            <div key={t.id} className="flex items-center gap-2 py-1.5">
              <button
                className="text-mut hover:text-ok"
                onClick={() => api.taskToggle(t.id).then(onChanged)}
              >
                {t.done ? <CheckCircle2 size={15} className="text-ok" /> : <Circle size={15} />}
              </button>
              <span className={`flex-1 truncate ${t.done ? "line-through text-mut" : ""}`}>{t.title}</span>
              {t.due_date && !t.done && (
                <Tone tone={dueLabel(t.due_date).tone}>{dueLabel(t.due_date).text}</Tone>
              )}
            </div>
          ))}
        </Section>

        {/* Notes */}
        <Section
          title={`Notes (${overview.notes.length})`}
          icon={<StickyNote size={14} />}
          className="col-span-2"
          empty={overview.notes.length === 0 ? "No notes" : undefined}
        >
          <div className="grid grid-cols-2 gap-x-4">
            {overview.notes.slice(0, 8).map((n) => (
              <button
                key={n.id}
                className="flex items-center gap-2 py-1.5 hover:bg-panel2 rounded-md px-1.5 -mx-1.5 text-left min-w-0"
                onClick={() => navigate({ view: "notes", recordModule: "notes", recordId: n.id })}
              >
                <span className="truncate">{n.title}</span>
                <span className="text-mut text-[12px] truncate flex-1">{n.preview}</span>
              </button>
            ))}
          </div>
        </Section>
      </div>

      {docEditing && (
        <DocumentEditor
          doc={docEditing === "new" ? null : docEditing}
          personId={p.id}
          people={people}
          onClose={() => setDocEditing(null)}
          onChanged={onChanged}
        />
      )}
      {docDeleting && (
        <Confirm
          message={`Delete ${docLabel(docDeleting.doc_type)}?`}
          detail="The document record and all attached files are permanently removed."
          onClose={() => setDocDeleting(null)}
          onConfirm={async () => {
            await api.documentDelete(docDeleting.id);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  action,
  empty,
  className,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  empty?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`card p-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-[12.5px] uppercase tracking-wide text-mut flex items-center gap-1.5">
          {icon} {title}
        </h2>
        {action}
      </div>
      {empty ? <div className="text-mut text-[13px] py-2">{empty}</div> : children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function DocumentCard({
  doc,
  onEdit,
  onDelete,
}: {
  doc: Doc;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [shown, setShown] = useState(false);
  const toast = useToast();
  const hasImages = doc.files.some((f) => f.kind === "front" || f.kind === "back");
  const attachments = doc.files.filter((f) => f.kind === "attachment").length;

  // A linked file's own name is far more useful than the type label — with 26
  // education records, "Education" 26 times identifies nothing.
  const title = doc.notes?.trim() || doc.name_on_document?.trim() || docLabel(doc.doc_type);
  const single = doc.links.length === 1 ? doc.links[0] : null;

  const openLink = async (id: number) => {
    try {
      await api.documentLinkOpen(id);
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <div
      className={`border border-edge rounded-lg px-3 py-2.5 group ${
        single ? "cursor-pointer hover:border-acc/50" : ""
      }`}
      onClick={single ? () => openLink(single.id) : undefined}
      title={single ? `Open ${single.filename}` : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium truncate">{title}</span>
        <span className="shrink-0 rounded-full border border-edge bg-panel2 px-1.5 py-px text-[10.5px] text-mut">
          {docLabel(doc.doc_type)}
        </span>
        {single && !single.present && <span className="text-bad text-[11px] shrink-0">missing</span>}
        {doc.expiry_date && (
          <Tone tone={dueLabel(doc.expiry_date).tone}>
            expires {dueLabel(doc.expiry_date).text}
          </Tone>
        )}
        <span className="flex-1" />
        <button
          className="opacity-0 group-hover:opacity-100 btn-ghost !p-1"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil size={13} />
        </button>
        <button
          className="opacity-0 group-hover:opacity-100 btn-ghost !p-1 text-bad"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {doc.name_on_document && doc.name_on_document.trim() !== title && (
        <div className="text-mut text-[12px] truncate">{doc.name_on_document}</div>
      )}
      {/* Grouped identity documents hold several scans — list them all. */}
      {doc.links.length > 1 && (
        <div className="mt-1.5 flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
          {doc.links.map((l) => (
            <button
              key={l.id}
              className="flex items-center gap-1.5 text-[12px] text-left px-1.5 py-1 -mx-1.5 rounded-md hover:bg-panel2"
              onClick={() => openLink(l.id)}
              title={`Open ${l.filename}`}
            >
              <FileText size={11} className="shrink-0 text-mut" />
              <span className="truncate flex-1">{l.filename}</span>
              {!l.present && <span className="text-bad text-[11px]">missing</span>}
            </button>
          ))}
        </div>
      )}
      {doc.doc_number && (
        <div className="flex items-center gap-1.5 text-[12.5px] font-mono mt-0.5">
          <span className="selectable">{shown ? doc.doc_number : maskNumber(doc.doc_number)}</span>
          <button className="btn-ghost !p-0.5" onClick={() => setShown(!shown)}>
            {shown ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 mt-1 text-[11.5px] text-mut">
        {hasImages && (
          <span className="flex items-center gap-1">
            <ImageIcon size={11} /> scans
          </span>
        )}
        {attachments > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip size={11} /> {attachments}
          </span>
        )}
        {doc.issue_date && <span>issued {fmtDate(doc.issue_date)}</span>}
        {doc.expiry_date && <span>expires {fmtDate(doc.expiry_date)}</span>}
      </div>
    </div>
  );
}

function DocumentEditor({
  doc,
  personId,
  people,
  onClose,
  onChanged,
}: {
  doc: Doc | null;
  personId: number;
  people: Person[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [saved, setSaved] = useState<Doc | null>(doc);
  const [docType, setDocType] = useState<DocType>(doc?.doc_type ?? "aadhaar");
  const [owner, setOwner] = useState(doc?.person_id ?? personId);
  const [number, setNumber] = useState(doc?.doc_number ?? "");
  const [nameOn, setNameOn] = useState(doc?.name_on_document ?? "");
  const [issueDate, setIssueDate] = useState(doc?.issue_date ?? "");
  const [expiryDate, setExpiryDate] = useState(doc?.expiry_date ?? "");
  const [authority, setAuthority] = useState(doc?.issuing_authority ?? "");
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [preview, setPreview] = useState<{ title: string; data: string } | null>(null);
  const toast = useToast();

  const save = async () => {
    try {
      const result = await api.documentSave({
        id: saved?.id ?? null,
        person_id: owner,
        doc_type: docType,
        doc_number: number.trim() || null,
        name_on_document: nameOn.trim() || null,
        issue_date: issueDate || null,
        expiry_date: expiryDate || null,
        issuing_authority: authority.trim() || null,
        notes: notes.trim() || null,
        investment_id: saved?.investment_id ?? null,
      });
      setSaved(result);
      toast(saved ? "Document saved" : "Document added — attach scans below");
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const addFile = async (kind: "front" | "back" | "attachment") => {
    if (!saved) return;
    const filters =
      kind === "attachment"
        ? [{ name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "webp"] }]
        : [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }];
    const path = await openDialog({ multiple: false, filters });
    if (!path || typeof path !== "string") return;
    try {
      await api.documentFileAdd(saved.id, kind, path);
      const docs = await api.documentList(owner);
      setSaved(docs.find((d) => d.id === saved.id) ?? saved);
      toast("File stored encrypted");
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const viewFile = async (f: DocumentFileMeta) => {
    try {
      const data = await api.documentFileData(f.id);
      if (f.mime.startsWith("image/")) {
        setPreview({ title: f.filename, data });
      } else {
        // Non-image (PDF etc.): offer decrypted export instead of inline view.
        exportFile(f);
      }
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const exportFile = async (f: DocumentFileMeta) => {
    const dest = await saveDialog({ defaultPath: f.filename });
    if (!dest) return;
    try {
      await api.documentFileExport(f.id, dest);
      toast("Decrypted copy exported");
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const removeFile = async (f: DocumentFileMeta) => {
    if (!saved) return;
    await api.documentFileDelete(f.id);
    const docs = await api.documentList(owner);
    setSaved(docs.find((d) => d.id === saved.id) ?? saved);
    onChanged();
  };

  const fileRow = (f: DocumentFileMeta) => (
    <div key={f.id} className="flex items-center gap-1.5 text-[12.5px] py-1">
      {f.mime.startsWith("image/") ? <ImageIcon size={13} /> : <FileText size={13} />}
      <span className="truncate flex-1">
        {f.kind !== "attachment" && <span className="text-mut">{f.kind}: </span>}
        {f.filename}
      </span>
      <span className="text-mut text-[11px]">{(f.size / 1024).toFixed(0)} KB</span>
      <button className="btn-ghost !p-1" title="View" onClick={() => viewFile(f)}>
        <Eye size={13} />
      </button>
      <button className="btn-ghost !p-1" title="Export decrypted copy" onClick={() => exportFile(f)}>
        <Download size={13} />
      </button>
      <button className="btn-ghost !p-1 text-bad" title="Delete" onClick={() => removeFile(f)}>
        <Trash2 size={13} />
      </button>
    </div>
  );

  return (
    <Modal title={saved ? `Edit ${docLabel(docType)}` : "Add document"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Document type">
          <select className="ctl" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Belongs to">
          <select className="ctl" value={owner} onChange={(e) => setOwner(Number(e.target.value))}>
            {people.map((pp) => (
              <option key={pp.id} value={pp.id}>
                {personLabel(pp)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Document number">
          <input className="ctl font-mono" value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label="Name on document">
          <input className="ctl" value={nameOn} onChange={(e) => setNameOn(e.target.value)} />
        </Field>
        <Field label="Issue date (optional)">
          <input type="date" className="ctl" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
        <Field label="Expiry date (optional — appears on the timeline)">
          <input type="date" className="ctl" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </Field>
        <Field label="Issuing authority (optional)">
          <input className="ctl" value={authority} onChange={(e) => setAuthority(e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      {saved ? (
        <div className="border border-edge rounded-lg px-3 py-2.5 mb-3">
          <div className="text-[12px] text-mut mb-1.5">
            Files — stored encrypted inside the vault database
          </div>
          {saved.files.map(fileRow)}
          <div className="flex gap-2 mt-1.5">
            <button className="btn-edge !py-1 text-[12px]" onClick={() => addFile("front")}>
              <ImageIcon size={13} /> {saved.files.some((f) => f.kind === "front") ? "Replace front" : "Front image"}
            </button>
            <button className="btn-edge !py-1 text-[12px]" onClick={() => addFile("back")}>
              <ImageIcon size={13} /> {saved.files.some((f) => f.kind === "back") ? "Replace back" : "Back image"}
            </button>
            <button className="btn-edge !py-1 text-[12px]" onClick={() => addFile("attachment")}>
              <Paperclip size={13} /> Attach PDF / file
            </button>
          </div>
        </div>
      ) : (
        <div className="text-mut text-[12px] mb-3">Save the document first to attach scans and PDFs.</div>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose}>
          Close
        </button>
        <button className="btn-acc" onClick={save}>
          {saved ? "Save changes" : "Add document"}
        </button>
      </div>

      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)} wide>
          <img src={preview.data} alt={preview.title} className="max-w-full rounded-lg" />
        </Modal>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Person editor + delete flow
// ---------------------------------------------------------------------------

function PersonEditor({
  person,
  onClose,
  onSaved,
}: {
  person: Person | null;
  onClose: () => void;
  onSaved: (p: Person) => void;
}) {
  const [input, setInput] = useState<PersonInput>({
    id: person?.id ?? null,
    full_name: person?.full_name ?? "",
    nickname: person?.nickname ?? null,
    relationship: person?.relationship ?? "other",
    dob: person?.dob ?? null,
    phone: person?.phone ?? null,
    email: person?.email ?? null,
    address: person?.address ?? null,
    notes: person?.notes ?? null,
  });
  const toast = useToast();
  const set = (k: keyof PersonInput, v: string) =>
    setInput((i) => ({ ...i, [k]: v.trim() === "" ? null : v }));

  const save = async () => {
    try {
      const saved = await api.personSave(input);
      toast(person ? "Person updated" : `${saved.full_name} added`);
      onSaved(saved);
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title={person ? `Edit ${person.full_name}` : "Add person"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Full name">
          <input
            className="ctl"
            value={input.full_name}
            autoFocus
            onChange={(e) => setInput((i) => ({ ...i, full_name: e.target.value }))}
          />
        </Field>
        <Field label="Nickname (optional)">
          <input className="ctl" value={input.nickname ?? ""} onChange={(e) => set("nickname", e.target.value)} />
        </Field>
        <Field label="Relationship">
          <select
            className="ctl"
            value={input.relationship}
            onChange={(e) => setInput((i) => ({ ...i, relationship: e.target.value as Relationship }))}
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date of birth (optional)">
          <input type="date" className="ctl" value={input.dob ?? ""} onChange={(e) => set("dob", e.target.value)} />
        </Field>
        <Field label="Phone (optional)">
          <input className="ctl" value={input.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email (optional)">
          <input className="ctl" value={input.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
      </div>
      <Field label="Address (optional)">
        <input className="ctl" value={input.address ?? ""} onChange={(e) => set("address", e.target.value)} />
      </Field>
      <Field label="Notes (optional)">
        <textarea className="ctl min-h-16" value={input.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-1">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!input.full_name.trim()}>
          {person ? "Save" : "Add person"}
        </button>
      </div>
    </Modal>
  );
}

function DeletePersonModal({
  person,
  people,
  onClose,
  onDeleted,
}: {
  person: Person;
  people: Person[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [reassignTo, setReassignTo] = useState<number>(
    people.find((p) => p.is_default)?.id ?? people.find((p) => p.id !== person.id)?.id ?? 0
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const others = people.filter((p) => p.id !== person.id);

  useEffect(() => {
    api.personRelatedCounts(person.id).then(setCounts).catch(() => setCounts({}));
  }, [person.id]);

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  const doDelete = async () => {
    setBusy(true);
    setError("");
    try {
      await api.personDelete(person.id, total > 0 ? reassignTo : null);
      onDeleted();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Delete ${person.full_name}?`} onClose={onClose}>
      {counts === null ? (
        <div className="text-mut text-sm py-4">Checking related records…</div>
      ) : total === 0 ? (
        <p className="text-mut text-[13px] mb-3">
          {person.full_name} has no related records. This only removes the person entry.
        </p>
      ) : (
        <>
          <p className="text-[13px] mb-2">
            <UserRound size={13} className="inline mr-1" />
            {person.full_name} still owns{" "}
            <b>
              {Object.entries(counts)
                .map(([k, v]) => `${v} ${k}`)
                .join(", ")}
            </b>
            .
          </p>
          <p className="text-mut text-[12.5px] mb-3">
            Nothing is deleted with the person — choose who these records should move to:
          </p>
          <Field label="Move all records to">
            <select className="ctl" value={reassignTo} onChange={(e) => setReassignTo(Number(e.target.value))}>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {personLabel(p)}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {error && <div className="text-bad text-[12px] mb-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-1">
        <button className="btn-edge" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn-danger" onClick={doDelete} disabled={busy || counts === null}>
          {busy ? "Deleting…" : total > 0 ? "Move records & delete person" : "Delete person"}
        </button>
      </div>
    </Modal>
  );
}
