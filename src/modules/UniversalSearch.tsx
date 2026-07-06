import { useEffect, useMemo, useRef, useState } from "react";
import { api, SearchResult } from "../api";
import { NavTarget } from "../App";
import {
  CheckCircle2,
  CreditCard,
  FileText,
  KeyRound,
  Landmark,
  Receipt,
  RefreshCcw,
  Search,
  StickyNote,
  Bell,
  Users,
  Zap,
} from "lucide-react";

const MODULE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  person: { label: "People", icon: <Users size={14} /> },
  documents: { label: "Documents", icon: <FileText size={14} /> },
  tasks: { label: "Tasks", icon: <CheckCircle2 size={14} /> },
  quick: { label: "Quick notes", icon: <Zap size={14} /> },
  vault: { label: "Vault", icon: <KeyRound size={14} /> },
  accounts: { label: "Accounts", icon: <Landmark size={14} /> },
  transactions: { label: "Transactions", icon: <Receipt size={14} /> },
  subscriptions: { label: "Subscriptions", icon: <RefreshCcw size={14} /> },
  emis: { label: "EMIs", icon: <CreditCard size={14} /> },
  notes: { label: "Notes", icon: <StickyNote size={14} /> },
  reminder: { label: "Reminders", icon: <Bell size={14} /> },
};

function targetFor(r: SearchResult): NavTarget {
  switch (r.module) {
    case "person":
    case "documents":
      return { view: "people", recordModule: r.module, recordId: r.record_id };
    case "vault":
      return { view: "vault", recordModule: "vault", recordId: r.record_id };
    case "notes":
      return { view: "notes", recordModule: "notes", recordId: r.record_id };
    case "accounts":
    case "transactions":
    case "subscriptions":
    case "emis":
      return { view: "finance", recordModule: r.module, recordId: r.record_id };
    default:
      return { view: "dashboard" };
  }
}

export default function UniversalSearch({
  onClose,
  navigate,
}: {
  onClose: () => void;
  navigate: (t: NavTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced instant search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setActive(0);
      return;
    }
    const mySeq = ++seq.current;
    const t = setTimeout(() => {
      api
        .universalSearch(q)
        .then((r) => {
          if (seq.current === mySeq) {
            setResults(r);
            setActive(0);
          }
        })
        .catch(() => {});
    }, 100);
    return () => clearTimeout(t);
  }, [query]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SearchResult[]>();
    for (const r of results) {
      if (!map.has(r.module)) {
        map.set(r.module, []);
        order.push(r.module);
      }
      map.get(r.module)!.push(r);
    }
    return order.map((m) => ({ module: m, items: map.get(m)! }));
  }, [results]);

  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  const open = (r: SearchResult) => navigate(targetFor(r));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      open(flat[active]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let idx = -1;

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pop-in card w-[600px] max-w-[92vw] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-edge">
          <Search size={16} className="text-mut" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none text-[15px]"
            placeholder="Search everything…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <span className="kbd">esc</span>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto">
          {query.trim() && flat.length === 0 && (
            <div className="px-4 py-8 text-center text-mut text-sm">No results for “{query}”</div>
          )}
          {!query.trim() && (
            <div className="px-4 py-6 text-center text-mut text-[13px]">
              Search notes, vault, finance, tasks and reminders.
              <div className="mt-1.5 text-[12px] text-[#5b6170]">
                <span className="kbd">↑↓</span> navigate · <span className="kbd">Enter</span> open
              </div>
            </div>
          )}
          {grouped.map((g) => (
            <div key={g.module} className="pb-1">
              <div className="px-4 pt-2.5 pb-1 text-[11px] uppercase tracking-wide text-mut flex items-center gap-1.5">
                {MODULE_META[g.module]?.icon}
                {MODULE_META[g.module]?.label ?? g.module}
              </div>
              {g.items.map((r) => {
                idx += 1;
                const i = idx;
                return (
                  <button
                    key={`${r.module}-${r.record_id}`}
                    data-idx={i}
                    className={`w-full text-left px-4 py-2 flex flex-col ${
                      i === active ? "bg-panel2" : "hover:bg-panel2/60"
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => open(r)}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-[13.5px]">{r.title}</span>
                      {r.person && r.module !== "person" && (
                        <span className="shrink-0 rounded-full border border-edge bg-panel2 px-1.5 py-px text-[11px] text-acc2">
                          {r.person}
                        </span>
                      )}
                    </span>
                    {r.snippet && r.snippet !== r.title && (
                      <span className="truncate text-[12px] text-mut">{r.snippet}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
