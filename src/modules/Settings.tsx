import { useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { Confirm, Field, MasterGate, Modal, useToast } from "../components/ui";
import { wb } from "./workbench/mockData";
import { AiProvider, AiProviderInput, ProviderKind } from "./workbench/types";
import {
  Bot,
  DownloadCloud,
  Eye,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";

const SHORTCUTS: [string, string][] = [
  ["Ctrl + K", "Open Workbench"],
  ["Ctrl + Space", "Universal Search"],
  ["Ctrl + Shift + Space", "Quick Capture"],
  ["Ctrl + N", "New note"],
  ["Ctrl + Shift + V", "Open Vault"],
  ["Ctrl + F", "Search within current module"],
  ["Ctrl + ,", "Settings"],
  ["Ctrl + S", "Save note"],
  ["Ctrl + Shift + L", "Lock now"],
];

export default function Settings({
  settings,
  reloadSettings,
  onLock,
  onChanged,
}: {
  settings: Record<string, string>;
  reloadSettings: () => void;
  onLock: () => void;
  onChanged: () => void;
}) {
  const [autoLock, setAutoLock] = useState(settings.auto_lock_minutes ?? "5");
  const [currency, setCurrency] = useState(settings.currency_symbol ?? "$");
  const [startOnWorkbench, setStartOnWorkbench] = useState(settings.start_on_workbench === "1");
  const [autoBackup, setAutoBackup] = useState(settings.auto_backup_enabled !== "0");
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [changePw, setChangePw] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setAutoLock(settings.auto_lock_minutes ?? "5");
    setCurrency(settings.currency_symbol ?? "$");
    setStartOnWorkbench(settings.start_on_workbench === "1");
    setAutoBackup(settings.auto_backup_enabled !== "0");
  }, [settings]);

  useEffect(() => {
    api.dataFileInfo().then(setPaths).catch(() => {});
  }, []);

  const setSetting = async (key: string, value: string) => {
    await api.settingsSet(key, value);
    reloadSettings();
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-lg font-semibold mb-4">Settings</h1>
      <div className="max-w-[620px] flex flex-col gap-4">
        {/* General */}
        <section className="card p-4">
          <h2 className="text-[13px] uppercase tracking-wide text-mut font-semibold mb-3">General</h2>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Auto-lock after inactivity">
              <select
                className="ctl"
                value={autoLock}
                onChange={(e) => {
                  setAutoLock(e.target.value);
                  setSetting("auto_lock_minutes", e.target.value);
                }}
              >
                <option value="1">1 minute</option>
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="30">30 minutes</option>
                <option value="0">Never</option>
              </select>
            </Field>
            <Field label="Currency symbol">
              <input
                className="ctl"
                value={currency}
                maxLength={4}
                onChange={(e) => setCurrency(e.target.value)}
                onBlur={() => setSetting("currency_symbol", currency || "$")}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={startOnWorkbench}
              onChange={(e) => {
                setStartOnWorkbench(e.target.checked);
                setSetting("start_on_workbench", e.target.checked ? "1" : "0");
              }}
            />
            Start PersonalOS on Workbench
          </label>
        </section>

        {/* AI Providers */}
        <ProvidersSection />

        {/* Security */}
        <section className="card p-4">
          <h2 className="text-[13px] uppercase tracking-wide text-mut font-semibold mb-3 flex items-center gap-1.5">
            <ShieldCheck size={14} /> Security
          </h2>
          <p className="text-mut text-[12.5px] leading-relaxed mb-3">
            The whole database is encrypted at rest with SQLCipher (AES-256). The key is derived
            from your master password with Argon2id and only ever lives in memory while unlocked.
            See <span className="font-mono text-[12px]">SECURITY.md</span> in the project folder for the full write-up.
          </p>
          <button className="btn-edge" onClick={() => setChangePw(true)}>
            <KeyRound size={14} /> Change master password
          </button>
        </section>

        {/* Backup */}
        <section className="card p-4">
          <h2 className="text-[13px] uppercase tracking-wide text-mut font-semibold mb-3">
            Encrypted backup
          </h2>
          <p className="text-mut text-[12.5px] leading-relaxed mb-3">
            Exports every record as one file encrypted with a password you choose (Argon2id +
            XChaCha20-Poly1305). Restoring <b className="text-warn">replaces all current data</b>.
          </p>
          <div className="flex gap-2 mb-3">
            <button className="btn-edge" onClick={() => setExportOpen(true)}>
              <DownloadCloud size={14} /> Export backup…
            </button>
            <button className="btn-edge" onClick={() => setImportOpen(true)}>
              <UploadCloud size={14} /> Restore backup…
            </button>
          </div>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={autoBackup}
              onChange={(e) => {
                setAutoBackup(e.target.checked);
                setSetting("auto_backup_enabled", e.target.checked ? "1" : "0");
              }}
            />
            Automatic daily backup (encrypted copy kept under the app's data folder)
          </label>
          {settings.last_auto_backup && (
            <div className="text-mut text-[11.5px] mt-1">Last automatic backup: {settings.last_auto_backup}</div>
          )}
        </section>

        {/* Shortcuts */}
        <section className="card p-4">
          <h2 className="text-[13px] uppercase tracking-wide text-mut font-semibold mb-3">
            Keyboard shortcuts
          </h2>
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-6">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="flex items-center justify-between text-[13px]">
                <span className="text-mut">{what}</span>
                <span className="kbd">{keys}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Data location */}
        <section className="card p-4">
          <h2 className="text-[13px] uppercase tracking-wide text-mut font-semibold mb-2">Data files</h2>
          <div className="text-[12px] text-mut font-mono selectable break-all leading-relaxed">
            <div>{paths.db_path}</div>
            <div>{paths.meta_path}</div>
          </div>
        </section>
      </div>

      {changePw && <ChangePasswordModal onClose={() => setChangePw(false)} onDone={onLock} />}
      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false);
            reloadSettings();
            onChanged();
            toast("Backup restored");
          }}
        />
      )}
    </div>
  );
}

function ChangePasswordModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  const submit = async () => {
    setError("");
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    if (next !== confirm) return setError("New passwords do not match.");
    setBusy(true);
    try {
      await api.changeMasterPassword(current, next);
      toast("Master password changed — unlocking again");
      onClose();
      onDone(); // lock so the user confirms the new password immediately
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Change master password" onClose={onClose}>
      <p className="text-mut text-[12.5px] mb-3">
        The database is re-encrypted under the new password. This can take a moment.
      </p>
      <Field label="Current password">
        <input type="password" className="ctl" value={current} autoFocus onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password">
        <input type="password" className="ctl" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Confirm new password">
        <input type="password" className="ctl" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
      {error && <div className="text-bad text-[12px] mb-2">{error}</div>}
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn-acc" onClick={submit} disabled={busy || !current || !next}>
          {busy ? "Re-encrypting…" : "Change password"}
        </button>
      </div>
    </Modal>
  );
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  const submit = async () => {
    setError("");
    if (password.length < 8) return setError("Backup password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    const stamp = new Date().toISOString().slice(0, 10);
    const path = await saveDialog({
      defaultPath: `personalos-backup-${stamp}.posb`,
      filters: [{ name: "PersonalOS backup", extensions: ["posb"] }],
    });
    if (!path) return;
    setBusy(true);
    try {
      await api.exportBackup(path, password);
      toast("Encrypted backup exported");
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Export encrypted backup" onClose={onClose}>
      <Field label="Backup password">
        <input type="password" className="ctl" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirm password">
        <input type="password" className="ctl" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
      <p className="text-mut text-[12px] mb-2">
        You will need this password to restore the backup. It can differ from your master password.
      </p>
      {error && <div className="text-bad text-[12px] mb-2">{error}</div>}
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn-acc" onClick={submit} disabled={busy || !password}>
          {busy ? "Exporting…" : "Choose file & export"}
        </button>
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "PersonalOS backup", extensions: ["posb"] }],
    });
    if (!path || typeof path !== "string") return;
    setBusy(true);
    try {
      await api.importBackup(path, password);
      onDone();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Restore from backup" onClose={onClose}>
      <p className="text-[12.5px] leading-relaxed mb-3 text-warn">
        Restoring replaces <b>everything</b> currently stored — vault, finance, notes, tasks and
        settings. This cannot be undone.
      </p>
      <Field label="Backup password">
        <input type="password" className="ctl" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label={'Type "replace" to confirm'}>
        <input className="ctl" value={ack} onChange={(e) => setAck(e.target.value)} />
      </Field>
      {error && <div className="text-bad text-[12px] mb-2">{error}</div>}
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn-danger"
          onClick={submit}
          disabled={busy || !password || ack.toLowerCase() !== "replace"}
        >
          {busy ? "Restoring…" : "Choose file & restore"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AI Providers (AI Workbench §11.7) — UI-only preview backed by ./workbench/
// mockData; nothing here opens a socket. See AI_WORKBENCH_DESIGN.md.
// ---------------------------------------------------------------------------

function maskKey(key: string): string {
  if (!key.trim()) return "no key";
  return `key ••••${key.slice(-4)}`;
}

function ProvidersSection() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [editing, setEditing] = useState<AiProvider | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AiProvider | null>(null);
  const [revealing, setRevealing] = useState<AiProvider | null>(null);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [testing, setTesting] = useState<number | null>(null);
  const toast = useToast();

  const load = () => wb.providerList().then(setProviders).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const test = async (p: AiProvider) => {
    setTesting(p.id);
    try {
      const msg = await wb.providerTest(p.id);
      toast(msg);
    } catch (e) {
      toast(String(e), "bad");
    } finally {
      setTesting(null);
    }
  };

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] uppercase tracking-wide text-mut font-semibold flex items-center gap-1.5">
          <Bot size={14} /> AI Providers
        </h2>
        <button className="btn-edge !py-1 text-[12px]" onClick={() => setEditing("new")}>
          <Plus size={13} /> Add
        </button>
      </div>
      <p className="text-mut text-[12.5px] leading-relaxed mb-3">
        This build previews the AI Workbench UI with sample data — no key here is ever sent
        anywhere. A real provider connection is a future addition (see AI_WORKBENCH_DESIGN.md).
      </p>
      {providers.length === 0 && <p className="text-mut text-[12.5px] mb-2">No providers configured.</p>}
      <div className="flex flex-col gap-2">
        {providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md border border-edge px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-medium">{p.name}</span>
                <span className="text-mut text-[11px] truncate">{p.base_url}</span>
                {!p.enabled && <span className="text-mut text-[11px]">disabled</span>}
              </div>
              <div className="text-mut text-[11px] flex items-center gap-2 mt-0.5">
                <span>{revealed[p.id] ? `key: ${p.api_key || "(none)"}` : maskKey(p.api_key)}</span>
                {p.api_key && !revealed[p.id] && (
                  <button className="btn-ghost !p-0 text-[11px]" onClick={() => setRevealing(p)}>
                    <Eye size={11} /> reveal
                  </button>
                )}
                <span className="truncate">models: {p.models.join(", ") || "none"}</span>
              </div>
            </div>
            <button className="btn-edge !py-1 text-[12px] shrink-0" onClick={() => test(p)} disabled={testing === p.id}>
              {testing === p.id ? "Testing…" : "Test"}
            </button>
            <button className="btn-ghost !p-1.5 shrink-0" title="Edit" onClick={() => setEditing(p)}>
              <Pencil size={14} />
            </button>
            <button className="btn-ghost !p-1.5 shrink-0 text-bad" title="Delete" onClick={() => setConfirmDelete(p)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <ProviderFormModal
          provider={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {revealing && (
        <MasterGate
          onClose={() => setRevealing(null)}
          onVerified={() => setRevealed((r) => ({ ...r, [revealing.id]: true }))}
        />
      )}
      {confirmDelete && (
        <Confirm
          message={`Delete "${confirmDelete.name}"?`}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => wb.providerDelete(confirmDelete.id).then(load)}
        />
      )}
    </section>
  );
}

function ProviderFormModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: AiProvider | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(provider?.name ?? "");
  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? "anthropic");
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? "");
  const [apiKey, setApiKey] = useState(provider?.api_key ?? "");
  const [models, setModels] = useState(provider?.models.join(", ") ?? "");
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const toast = useToast();

  const save = async () => {
    if (!name.trim() || !baseUrl.trim()) return;
    const input: AiProviderInput = {
      id: provider?.id ?? null,
      name: name.trim(),
      kind,
      base_url: baseUrl.trim(),
      api_key: apiKey,
      models: models
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean),
      enabled,
    };
    try {
      await wb.providerSave(input);
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title={provider ? "Edit provider" : "Add provider"} onClose={onClose}>
      <Field label="Name">
        <input className="ctl" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Anthropic" />
      </Field>
      <Field label="Kind">
        <select className="ctl" value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
          <option value="anthropic">Anthropic</option>
          <option value="openai_compat">OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio…)</option>
        </select>
      </Field>
      <Field label="Base URL">
        <input className="ctl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.anthropic.com" />
      </Field>
      <Field label="API key (leave blank for local providers)">
        <input type="password" className="ctl" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </Field>
      <Field label="Models (comma-separated ids)">
        <input className="ctl" value={models} onChange={(e) => setModels(e.target.value)} placeholder="claude-sonnet-5, claude-haiku-4-5" />
      </Field>
      <label className="flex items-center gap-2 text-[13px] mb-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
      </label>
      <div className="flex justify-end gap-2 mt-1">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!name.trim() || !baseUrl.trim()}>
          {provider ? "Save changes" : "Add provider"}
        </button>
      </div>
    </Modal>
  );
}
