import { useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { Field, Modal, useToast } from "../components/ui";
import { DownloadCloud, KeyRound, ShieldCheck, UploadCloud } from "lucide-react";

const SHORTCUTS: [string, string][] = [
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
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [changePw, setChangePw] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setAutoLock(settings.auto_lock_minutes ?? "5");
    setCurrency(settings.currency_symbol ?? "$");
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
        </section>

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
          <div className="flex gap-2">
            <button className="btn-edge" onClick={() => setExportOpen(true)}>
              <DownloadCloud size={14} /> Export backup…
            </button>
            <button className="btn-edge" onClick={() => setImportOpen(true)}>
              <UploadCloud size={14} /> Restore backup…
            </button>
          </div>
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
