import { useCallback, useEffect, useRef, useState } from "react";
import { api, Person, VaultCategory, VaultItem, VaultItemMeta } from "../api";
import {
  Confirm,
  Empty,
  Field,
  Modal,
  PersonBadge,
  personLabel,
  Tone,
  useCopy,
  useToast,
} from "../components/ui";
import { dueLabel, fmtDate } from "../lib/format";
import { generatePassword, GenOptions } from "../lib/passwordGen";
import {
  Copy,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  KeySquare,
  Plus,
  RefreshCcw,
  ScrollText,
  Shield,
  Terminal,
  Trash2,
  Wifi,
  FileKey2,
  Pencil,
} from "lucide-react";

const CATEGORIES: { id: VaultCategory | null; label: string; icon: React.ReactNode }[] = [
  { id: null, label: "All items", icon: <Shield size={15} /> },
  { id: "login", label: "Logins", icon: <Globe size={15} /> },
  { id: "api_key", label: "API keys", icon: <KeySquare size={15} /> },
  { id: "ssh_key", label: "SSH keys", icon: <Terminal size={15} /> },
  { id: "license", label: "Licenses", icon: <ScrollText size={15} /> },
  { id: "recovery_codes", label: "Recovery codes", icon: <FileKey2 size={15} /> },
  { id: "wifi", label: "Wi-Fi", icon: <Wifi size={15} /> },
  { id: "secure_note", label: "Secure notes", icon: <KeyRound size={15} /> },
];

const CATEGORY_LABEL = Object.fromEntries(
  CATEGORIES.filter((c) => c.id).map((c) => [c.id as string, c.label])
) as Record<string, string>;

interface FieldSpec {
  key: string;
  label: string;
  secret?: boolean;
  multiline?: boolean;
}

const CATEGORY_FIELDS: Record<VaultCategory, FieldSpec[]> = {
  login: [
    { key: "username", label: "Username / email" },
    { key: "password", label: "Password", secret: true },
  ],
  api_key: [
    { key: "username", label: "Account (optional)" },
    { key: "api_key", label: "API key", secret: true, multiline: true },
  ],
  ssh_key: [
    { key: "username", label: "Username" },
    { key: "private_key", label: "Private key", secret: true, multiline: true },
    { key: "public_key", label: "Public key", multiline: true },
    { key: "passphrase", label: "Passphrase", secret: true },
  ],
  license: [
    { key: "license_key", label: "License key", secret: true, multiline: true },
    { key: "licensed_to", label: "Licensed to" },
    { key: "version", label: "Version" },
  ],
  recovery_codes: [
    { key: "username", label: "Account (optional)" },
    { key: "codes", label: "Recovery codes", secret: true, multiline: true },
  ],
  wifi: [{ key: "password", label: "Wi-Fi password", secret: true }],
  secure_note: [],
};

export default function Vault({
  refreshKey,
  focus,
  onChanged,
}: {
  refreshKey: number;
  focus: { module: string; id: number; nonce: number } | null;
  onChanged: () => void;
}) {
  const [category, setCategory] = useState<VaultCategory | null>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<VaultItemMeta[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<VaultItem | null>(null);
  const [editing, setEditing] = useState<VaultItem | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<VaultItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(() => {
    api.vaultList(category, query || null).then(setItems).catch(() => {});
  }, [category, query]);

  useEffect(load, [load, refreshKey]);

  useEffect(() => {
    api.personList().then(setPeople).catch(() => {});
  }, [refreshKey]);

  // Ctrl+F focuses in-module search
  useEffect(() => {
    const f = () => searchRef.current?.focus();
    window.addEventListener("personalos:module-search", f);
    return () => window.removeEventListener("personalos:module-search", f);
  }, []);

  // Open a specific record when navigated from search / timeline
  useEffect(() => {
    if (focus?.module === "vault" && focus.id > 0) {
      api.vaultGet(focus.id).then(setSelected).catch(() => {});
    }
  }, [focus]);

  const open = (id: number) => api.vaultGet(id).then(setSelected).catch((e) => toast(String(e), "bad"));

  return (
    <div className="h-full flex">
      {/* Category rail */}
      <div className="w-44 shrink-0 border-r border-edge p-2.5 flex flex-col gap-0.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.label}
            className={`btn !justify-start w-full !py-1.5 ${
              category === c.id ? "bg-panel2 text-ink" : "text-mut hover:text-ink hover:bg-panel2/60"
            }`}
            onClick={() => setCategory(c.id)}
          >
            {c.icon}
            <span className="text-[13px]">{c.label}</span>
          </button>
        ))}
      </div>

      {/* Item list */}
      <div className="w-[300px] shrink-0 border-r border-edge flex flex-col">
        <div className="p-2.5 flex gap-2">
          <input
            ref={searchRef}
            className="ctl"
            placeholder="Search vault…  (Ctrl+F)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn-acc shrink-0" title="New item" onClick={() => setEditing("new")}>
            <Plus size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {items.length === 0 && <Empty text="No items" hint="Press + to add your first entry." />}
          {items.map((it) => (
            <button
              key={it.id}
              className={`w-full text-left rounded-md px-2.5 py-2 mb-0.5 ${
                selected?.id === it.id ? "bg-panel2" : "hover:bg-panel2/60"
              }`}
              onClick={() => open(it.id)}
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-[13px] flex-1">{it.name}</span>
                {it.expires_at && (
                  <Tone tone={dueLabel(it.expires_at).tone}>{dueLabel(it.expires_at).text}</Tone>
                )}
              </div>
              <div className="text-mut text-[12px] truncate flex items-center gap-1.5">
                <span className="truncate">
                  {CATEGORY_LABEL[it.category]}
                  {it.username ? ` · ${it.username}` : ""}
                </span>
                <PersonBadge people={people} personId={it.person_id} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-mut text-sm">
            Select an item, or press <span className="kbd mx-1.5">+</span> to add one
          </div>
        ) : (
          <ItemDetail
            item={selected}
            people={people}
            onEdit={() => setEditing(selected)}
            onDelete={() => setConfirmDelete(selected)}
          />
        )}
      </div>

      {editing && (
        <ItemEditor
          item={editing === "new" ? null : editing}
          people={people}
          initialCategory={editing === "new" && category ? category : undefined}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setSelected(saved);
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <Confirm
          message={`Delete “${confirmDelete.name}”?`}
          detail="This permanently removes the entry from your vault."
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await api.vaultDelete(confirmDelete.id);
            setSelected(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SecretValue({ value, mono }: { value: string; mono?: boolean }) {
  const [shown, setShown] = useState(false);
  const copy = useCopy();
  return (
    <div className="flex items-start gap-1.5">
      <div
        className={`flex-1 selectable break-all whitespace-pre-wrap ${
          mono ? "font-mono text-[12.5px]" : ""
        }`}
      >
        {shown ? value : "•".repeat(Math.min(24, Math.max(8, value.length)))}
      </div>
      <button className="btn-ghost !p-1" onClick={() => setShown(!shown)} title={shown ? "Hide" : "Reveal"}>
        {shown ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button className="btn-ghost !p-1" onClick={() => copy(value)} title="Copy">
        <Copy size={14} />
      </button>
    </div>
  );
}

function ItemDetail({
  item,
  people,
  onEdit,
  onDelete,
}: {
  item: VaultItem;
  people: Person[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const copy = useCopy();
  const specs = CATEGORY_FIELDS[item.category];
  const owner = people.find((p) => p.id === item.person_id);

  return (
    <div className="p-6 max-w-[640px]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">{item.name}</h2>
          <div className="text-mut text-[12px] flex items-center gap-1.5">
            <span>
              {CATEGORY_LABEL[item.category]} · updated {fmtDate(item.updated_at)}
            </span>
            {owner && (
              <span className="rounded-full border border-edge bg-panel2 px-1.5 py-px text-[11px] text-acc2">
                {personLabel(owner)}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5">
          <button className="btn-edge" onClick={onEdit}>
            <Pencil size={14} /> Edit
          </button>
          <button className="btn-danger" onClick={onDelete}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="card divide-y divide-edge">
        {specs.map((spec) => {
          const value = item.fields[spec.key];
          if (!value) return null;
          return (
            <div key={spec.key} className="px-4 py-3">
              <div className="text-[12px] text-mut mb-1">{spec.label}</div>
              {spec.secret ? (
                <SecretValue value={value} mono={spec.multiline} />
              ) : (
                <div className="flex items-start gap-1.5">
                  <div className={`flex-1 selectable break-all ${spec.multiline ? "font-mono text-[12.5px] whitespace-pre-wrap" : ""}`}>
                    {value}
                  </div>
                  <button className="btn-ghost !p-1" onClick={() => copy(value)} title="Copy">
                    <Copy size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {item.url && (
          <div className="px-4 py-3">
            <div className="text-[12px] text-mut mb-1">Website</div>
            <div className="flex items-center gap-1.5">
              <span className="flex-1 selectable break-all text-acc2">{item.url}</span>
              <button className="btn-ghost !p-1" onClick={() => copy(item.url!)} title="Copy">
                <Copy size={14} />
              </button>
            </div>
          </div>
        )}
        {item.expires_at && (
          <div className="px-4 py-3">
            <div className="text-[12px] text-mut mb-1">Expires</div>
            <div className="flex items-center gap-2">
              {fmtDate(item.expires_at)}
              <Tone tone={dueLabel(item.expires_at).tone}>{dueLabel(item.expires_at).text}</Tone>
            </div>
          </div>
        )}
        {item.notes && (
          <div className="px-4 py-3">
            <div className="text-[12px] text-mut mb-1">Notes</div>
            <div className="selectable whitespace-pre-wrap">{item.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ItemEditor({
  item,
  people,
  initialCategory,
  onClose,
  onSaved,
}: {
  item: VaultItem | null;
  people: Person[];
  initialCategory?: VaultCategory;
  onClose: () => void;
  onSaved: (item: VaultItem) => void;
}) {
  const [category, setCategory] = useState<VaultCategory>(item?.category ?? initialCategory ?? "login");
  const [personId, setPersonId] = useState<number | null>(item?.person_id ?? null);
  const [name, setName] = useState(item?.name ?? "");
  const [fields, setFields] = useState<Record<string, string>>(item?.fields ?? {});
  const [url, setUrl] = useState(item?.url ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [expiresAt, setExpiresAt] = useState(item?.expires_at ?? "");
  const [genFor, setGenFor] = useState<string | null>(null);
  const toast = useToast();

  const specs = CATEGORY_FIELDS[category];

  const save = async () => {
    try {
      const cleanFields: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v && specs.some((s) => s.key === k)) cleanFields[k] = v;
      }
      const saved = await api.vaultSave({
        id: item?.id ?? null,
        category,
        name,
        fields: cleanFields,
        url: url || null,
        notes: notes || null,
        expires_at: expiresAt || null,
        person_id: personId,
      });
      toast(item ? "Saved" : "Added to vault");
      onSaved(saved);
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title={item ? `Edit ${item.name}` : "New vault item"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Type">
          <select
            className="ctl"
            value={category}
            disabled={!!item}
            onChange={(e) => setCategory(e.target.value as VaultCategory)}
          >
            {CATEGORIES.filter((c) => c.id).map((c) => (
              <option key={c.id} value={c.id!}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={category === "wifi" ? "Network name (SSID)" : "Name"}>
          <input className="ctl" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>

      <Field label="Belongs to">
        <select
          className="ctl"
          value={personId ?? people.find((p) => p.is_default)?.id ?? ""}
          onChange={(e) => setPersonId(Number(e.target.value))}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {personLabel(p)}
            </option>
          ))}
        </select>
      </Field>

      {specs.map((spec) => (
        <Field key={spec.key} label={spec.label}>
          <div className="flex gap-1.5">
            {spec.multiline ? (
              <textarea
                className="ctl font-mono !text-[12.5px] min-h-20"
                value={fields[spec.key] ?? ""}
                onChange={(e) => setFields({ ...fields, [spec.key]: e.target.value })}
              />
            ) : (
              <input
                className="ctl"
                type="text"
                value={fields[spec.key] ?? ""}
                onChange={(e) => setFields({ ...fields, [spec.key]: e.target.value })}
              />
            )}
            {spec.secret && !spec.multiline && (
              <button
                className="btn-edge shrink-0"
                title="Generate password"
                onClick={() => setGenFor(spec.key)}
              >
                <RefreshCcw size={14} />
              </button>
            )}
          </div>
        </Field>
      ))}

      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Website / URL (optional)">
          <input className="ctl" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Expires on (optional)">
          <input
            type="date"
            className="ctl"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <textarea className="ctl min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!name.trim()}>
          {item ? "Save changes" : "Add to vault"}
        </button>
      </div>

      {genFor && (
        <GeneratorModal
          onClose={() => setGenFor(null)}
          onUse={(pw) => {
            setFields((f) => ({ ...f, [genFor]: pw }));
            setGenFor(null);
          }}
        />
      )}
    </Modal>
  );
}

function GeneratorModal({ onClose, onUse }: { onClose: () => void; onUse: (pw: string) => void }) {
  const [opts, setOpts] = useState<GenOptions>({
    length: 20,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
  });
  const [pw, setPw] = useState(() =>
    generatePassword({ length: 20, upper: true, lower: true, digits: true, symbols: true })
  );
  const copy = useCopy();

  const regen = (next: GenOptions) => {
    setOpts(next);
    setPw(generatePassword(next));
  };

  return (
    <Modal title="Password generator" onClose={onClose}>
      <div className="card bg-panel2 px-3 py-2.5 font-mono text-[14px] break-all selectable mb-3">
        {pw || "select at least one character set"}
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-mut text-[12px] w-16">Length {opts.length}</span>
        <input
          type="range"
          min={8}
          max={64}
          value={opts.length}
          className="flex-1"
          onChange={(e) => regen({ ...opts, length: parseInt(e.target.value, 10) })}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4">
        {(["upper", "lower", "digits", "symbols"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={opts[k]}
              onChange={(e) => regen({ ...opts, [k]: e.target.checked })}
            />
            {k === "upper" ? "A–Z" : k === "lower" ? "a–z" : k === "digits" ? "0–9" : "!@#$"}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={() => setPw(generatePassword(opts))}>
          <RefreshCcw size={14} /> Regenerate
        </button>
        <button className="btn-edge" onClick={() => copy(pw)}>
          <Copy size={14} /> Copy
        </button>
        <button className="btn-acc" onClick={() => onUse(pw)} disabled={!pw}>
          Use password
        </button>
      </div>
    </Modal>
  );
}
