import { useState } from "react";
import { api } from "../api";
import { Lock, ShieldCheck } from "lucide-react";

export default function LockScreen({
  setupRequired,
  onUnlocked,
}: {
  setupRequired: boolean;
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError("");
    if (setupRequired) {
      if (password.length < 8) {
        setError("Use at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }
    setBusy(true);
    try {
      if (setupRequired) await api.setupVault(password);
      else await api.unlockVault(password);
      setPassword("");
      setConfirm("");
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center">
      <div className="card w-[380px] p-6 pop-in">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl bg-acc flex items-center justify-center text-[#0d0e12]">
            {setupRequired ? <ShieldCheck size={19} /> : <Lock size={18} />}
          </div>
          <div>
            <div className="font-semibold">PersonalOS</div>
            <div className="text-mut text-[12px]">
              {setupRequired ? "Create your master password" : "Locked"}
            </div>
          </div>
        </div>

        {setupRequired && (
          <p className="text-mut text-[12px] my-3 leading-relaxed">
            Everything you store is encrypted on disk with a key derived from this password.
            It is never stored anywhere — <b className="text-warn">if you forget it, your data
            cannot be recovered.</b>
          </p>
        )}

        <input
          type="password"
          className="ctl mt-3"
          placeholder="Master password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (setupRequired ? undefined : submit())}
          disabled={busy}
        />
        {setupRequired && (
          <input
            type="password"
            className="ctl mt-2"
            placeholder="Confirm master password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            disabled={busy}
          />
        )}

        {error && <div className="text-bad text-[12px] mt-2">{error}</div>}

        <button className="btn-acc w-full mt-4" onClick={submit} disabled={busy}>
          {busy
            ? setupRequired
              ? "Creating encrypted vault…"
              : "Unlocking…"
            : setupRequired
              ? "Create vault"
              : "Unlock"}
        </button>
      </div>
    </div>
  );
}
