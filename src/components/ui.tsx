import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "bad";
}

const ToastCtx = createContext<(text: string, tone?: "ok" | "bad") => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pop-in card px-3.5 py-2 text-sm shadow-lg ${
              t.tone === "bad" ? "border-[#4a2626] text-bad" : "text-ink"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Copy to clipboard with a toast. */
export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (value: string, label = "Copied") => {
      try {
        await writeText(value);
        toast(label);
      } catch {
        toast("Copy failed", "bad");
      }
    },
    [toast]
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`pop-in card shadow-2xl flex flex-col max-h-[74vh] ${
          wide ? "w-[680px]" : "w-[520px]"
        } max-w-[92vw]`}
      >
        {title && (
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="text-sm font-semibold">{title}</div>
            <button className="btn-ghost !p-1" onClick={onClose} aria-label="Close">
              <X size={15} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({
  message,
  detail,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
}: {
  message: string;
  detail?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={message} onClose={onClose}>
      {detail && <p className="text-mut text-sm mb-3">{detail}</p>}
      <div className="flex justify-end gap-2 mt-1">
        <button className="btn-edge" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button
          className="btn-danger"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block mb-2.5">
      <div className="text-[12px] text-mut mb-1">{label}</div>
      {children}
    </label>
  );
}

export function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="text-mut text-sm">{text}</div>
      {hint && <div className="text-[12px] text-[#5b6170] mt-1">{hint}</div>}
    </div>
  );
}

export function Tone({ tone, children }: { tone: "bad" | "warn" | "mut" | "ok"; children: React.ReactNode }) {
  const cls = { bad: "text-bad", warn: "text-warn", mut: "text-mut", ok: "text-ok" }[tone];
  return <span className={`${cls} text-[12px]`}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Person helpers
// ---------------------------------------------------------------------------

import { api, Person } from "../api";

export function personLabel(p: Person): string {
  return p.nickname?.trim() ? p.nickname : p.full_name;
}

/** Select a person; defaults to the default person ("Me"). */
export function PersonSelect({
  people,
  value,
  onChange,
  compact,
  title,
}: {
  people: Person[];
  value: number | null;
  onChange: (id: number) => void;
  compact?: boolean;
  title?: string;
}) {
  const effective = value ?? people.find((p) => p.is_default)?.id ?? people[0]?.id ?? 0;
  return (
    <select
      className={`ctl ${compact ? "!w-28 !py-1 text-[12px]" : ""}`}
      value={effective}
      title={title ?? "Belongs to"}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {personLabel(p)}
        </option>
      ))}
    </select>
  );
}

/** Small chip naming the owner; hidden for the default person to reduce noise. */
export function PersonBadge({
  people,
  personId,
  showDefault,
}: {
  people: Person[];
  personId: number | null;
  showDefault?: boolean;
}) {
  const p = people.find((x) => x.id === personId);
  if (!p || (p.is_default && !showDefault)) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-edge bg-panel2 px-1.5 py-px text-[11px] text-acc2 whitespace-nowrap">
      {personLabel(p)}
    </span>
  );
}

/** Re-authentication gate: confirms the master password before revealing
 *  sensitive values (bank credentials, MPINs). */
export function MasterGate({
  onClose,
  onVerified,
}: {
  onClose: () => void;
  onVerified: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      const ok = await api.verifyMasterPassword(password);
      if (ok) {
        onVerified();
        onClose();
      } else {
        setError("Wrong master password.");
        setBusy(false);
      }
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Confirm master password" onClose={onClose}>
      <p className="text-mut text-[12.5px] mb-3">
        Revealing banking credentials requires your master password.
      </p>
      <input
        type="password"
        className="ctl"
        placeholder="Master password"
        value={password}
        autoFocus
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        disabled={busy}
      />
      {error && <div className="text-bad text-[12px] mt-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-3">
        <button className="btn-edge" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn-acc" onClick={submit} disabled={busy || !password}>
          {busy ? "Checking…" : "Reveal"}
        </button>
      </div>
    </Modal>
  );
}
