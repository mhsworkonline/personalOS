import { useEffect, useRef, useState } from "react";
import { api, Cycle, Person, VaultCategory } from "../api";
import { Field, personLabel, useToast } from "../components/ui";
import { todayISO } from "../lib/format";
import { Bell, CheckCircle2, Globe, RefreshCcw, StickyNote, Zap } from "lucide-react";

type CaptureType = "note" | "task" | "reminder" | "subscription" | "login";

const TYPES: { id: CaptureType; label: string; icon: React.ReactNode }[] = [
  { id: "note", label: "Note", icon: <StickyNote size={14} /> },
  { id: "task", label: "Task", icon: <CheckCircle2 size={14} /> },
  { id: "reminder", label: "Reminder", icon: <Bell size={14} /> },
  { id: "subscription", label: "Subscription", icon: <RefreshCcw size={14} /> },
  { id: "login", label: "Login", icon: <Globe size={14} /> },
];

export default function QuickCapture({
  onClose,
  onSaved,
  currency,
}: {
  onClose: () => void;
  onSaved: () => void;
  currency: string;
}) {
  const [type, setType] = useState<CaptureType>("note");
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    firstInput.current?.focus();
  }, [type]);

  useEffect(() => {
    api.personList().then(setPeople).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Ctrl+1..5 switches type
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        setType(TYPES[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      switch (type) {
        case "note":
          await api.quickNoteCreate(text);
          toast("Quick note saved to dashboard");
          break;
        case "task":
          await api.taskSave({ id: null, title: text, due_date: null, person_id: personId });
          toast("Task added");
          break;
        case "reminder":
          await api.reminderCreate(text, date, null, personId);
          toast("Reminder added to timeline");
          break;
        case "subscription":
          await api.subscriptionSave({
            id: null,
            name: text,
            amount: parseFloat(amount || "0"),
            cycle,
            next_renewal: date,
            active: true,
            notes: null,
            person_id: personId,
          });
          toast("Subscription added");
          break;
        case "login": {
          const fields: Record<string, string> = {};
          if (username) fields.username = username;
          if (password) fields.password = password;
          await api.vaultSave({
            id: null,
            category: "login" as VaultCategory,
            name: text,
            fields,
            url: null,
            notes: null,
            expires_at: null,
            person_id: personId,
          });
          toast("Saved to vault");
          break;
        }
      }
      onSaved();
      onClose();
    } catch (e) {
      toast(String(e), "bad");
      setBusy(false);
    }
  };

  const placeholder = {
    note: "Jot something down…",
    task: "What needs doing?",
    reminder: "Remind me about…",
    subscription: "Subscription name (e.g. Netflix)",
    login: "Website / service name",
  }[type];

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[14vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pop-in card w-[520px] max-w-[92vw] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3">
          <Zap size={15} className="text-acc2" />
          <span className="text-sm font-semibold flex-1">Quick capture</span>
          <span className="kbd">Ctrl+1…5</span>
          <span className="kbd">esc</span>
        </div>

        <div className="flex gap-1 px-4 pt-2.5">
          {TYPES.map((t, i) => (
            <button
              key={t.id}
              className={`btn !py-1 !px-2.5 text-[12.5px] ${
                type === t.id ? "bg-panel2 text-ink border border-edge" : "text-mut hover:text-ink"
              }`}
              title={`Ctrl+${i + 1}`}
              onClick={() => setType(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          <input
            ref={firstInput}
            className="ctl !py-2 text-[14px]"
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && type !== "login" && save()}
          />

          {type === "reminder" && (
            <div className="mt-2.5">
              <Field label="When">
                <input type="date" className="ctl" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
          )}

          {type === "subscription" && (
            <div className="grid grid-cols-3 gap-x-3 mt-2.5">
              <Field label={`Amount (${currency})`}>
                <input
                  type="number"
                  step="0.01"
                  className="ctl"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Cycle">
                <select className="ctl" value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)}>
                  {(["weekly", "monthly", "quarterly", "yearly"] as Cycle[]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Next renewal">
                <input type="date" className="ctl" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
          )}

          {type === "login" && (
            <div className="grid grid-cols-2 gap-x-3 mt-2.5">
              <Field label="Username">
                <input className="ctl" value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  className="ctl"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                />
              </Field>
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            {type !== "note" && (
              <select
                className="ctl !w-32 !py-1.5"
                title="Belongs to"
                value={personId ?? people.find((p) => p.is_default)?.id ?? ""}
                onChange={(e) => setPersonId(Number(e.target.value))}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
            )}
            <div className="flex-1" />
            <button className="btn-edge" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-acc" onClick={save} disabled={!text.trim() || busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
