import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ToastProvider } from "./components/ui";
import LockScreen from "./modules/LockScreen";
import Dashboard from "./modules/Dashboard";
import Vault from "./modules/Vault";
import Finance from "./modules/Finance";
import Investments from "./modules/Investments";
import Notes from "./modules/Notes";
import Settings from "./modules/Settings";
import UniversalSearch from "./modules/UniversalSearch";
import QuickCapture from "./modules/QuickCapture";
import People from "./modules/People";
import Workbench from "./modules/workbench/Workbench";
import {
  LayoutDashboard,
  KeyRound,
  Wallet,
  StickyNote,
  Settings as SettingsIcon,
  Search,
  Sparkles,
  Users,
  Zap,
  Lock,
  Home,
} from "lucide-react";

export type View =
  | "dashboard"
  | "workbench"
  | "people"
  | "vault"
  | "finance"
  | "investments"
  | "notes"
  | "settings";

/** Cross-module navigation: view + optionally a record to open inside it. */
export interface NavTarget {
  view: View;
  recordModule?: string;
  recordId?: number;
}

export default function App() {
  const [status, setStatus] = useState<"loading" | "locked" | "unlocked">("loading");
  const [setupRequired, setSetupRequired] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [focus, setFocus] = useState<{ module: string; id: number; nonce: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const lastActivity = useRef(Date.now());

  const currency = settings.currency_symbol ?? "$";

  const loadSettings = useCallback(async (): Promise<Record<string, string>> => {
    try {
      const s = await api.settingsGet();
      setSettings(s);
      return s;
    } catch {
      /* locked */
      return {};
    }
  }, []);

  useEffect(() => {
    api.vaultStatus().then((s) => {
      setSetupRequired(s === "setup_required");
      if (s === "unlocked") {
        setStatus("unlocked");
        loadSettings().then((set) => setView(set.start_on_workbench === "1" ? "workbench" : "dashboard"));
      } else {
        setStatus("locked");
      }
    });
  }, [loadSettings]);

  // Once-a-day local encrypted backup; silent unless it actually runs.
  useEffect(() => {
    if (status === "unlocked") api.autoBackupRun().catch(() => {});
  }, [status]);

  const lock = useCallback(async () => {
    try {
      await api.lockVault();
    } finally {
      setSearchOpen(false);
      setCaptureOpen(false);
      setStatus("locked");
    }
  }, []);

  // ---- auto-lock on inactivity ----
  useEffect(() => {
    if (status !== "unlocked") return;
    const bump = () => (lastActivity.current = Date.now());
    const events = ["mousemove", "mousedown", "keydown", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, bump));
    const iv = setInterval(() => {
      const minutes = parseInt(settings.auto_lock_minutes ?? "5", 10);
      if (!minutes) return; // 0 = never
      if (Date.now() - lastActivity.current > minutes * 60_000) lock();
    }, 5000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(iv);
    };
  }, [status, settings.auto_lock_minutes, lock]);

  // ---- global keyboard shortcuts ----
  useEffect(() => {
    if (status !== "unlocked") return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === " " || e.code === "Space") {
        e.preventDefault();
        if (e.shiftKey) {
          setCaptureOpen(true);
          setSearchOpen(false);
        } else {
          setSearchOpen(true);
          setCaptureOpen(false);
        }
      } else if (k === "n" && !e.shiftKey) {
        e.preventDefault();
        navigate({ view: "notes", recordModule: "notes", recordId: -1 }); // -1 = new note
      } else if (k === "k") {
        e.preventDefault();
        navigate({ view: "workbench", recordModule: "home", recordId: -1 });
      } else if (k === "v" && e.shiftKey) {
        e.preventDefault();
        navigate({ view: "vault" });
      } else if (k === "f" && !e.shiftKey) {
        // Search within the current module (also blocks the WebView find bar).
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("personalos:module-search"));
      } else if (k === ",") {
        e.preventDefault();
        navigate({ view: "settings" });
      } else if (k === "l" && e.shiftKey) {
        e.preventDefault();
        lock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lock]);

  const navigate = useCallback((t: NavTarget) => {
    setView(t.view);
    if (t.recordModule && t.recordId !== undefined) {
      setFocus({ module: t.recordModule, id: t.recordId, nonce: Date.now() });
    }
    setSearchOpen(false);
    setCaptureOpen(false);
  }, []);

  const dataChanged = useCallback(() => setRefreshKey((k) => k + 1), []);

  if (status === "loading") {
    return <div className="h-full flex items-center justify-center text-mut">Loading…</div>;
  }

  if (status === "locked") {
    return (
      <ToastProvider>
        <LockScreen
          setupRequired={setupRequired}
          onUnlocked={() => {
            setSetupRequired(false);
            setStatus("unlocked");
            lastActivity.current = Date.now();
            loadSettings().then((set) => setView(set.start_on_workbench === "1" ? "workbench" : "dashboard"));
          }}
        />
      </ToastProvider>
    );
  }

  const navItems: { view: View; label: string; icon: React.ReactNode; kbd?: string }[] = [
    { view: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={17} /> },
    { view: "workbench", label: "Workbench", icon: <Sparkles size={17} />, kbd: "Ctrl+K" },
    { view: "people", label: "People", icon: <Users size={17} /> },
    { view: "vault", label: "Vault", icon: <KeyRound size={17} />, kbd: "Ctrl+Shift+V" },
    { view: "finance", label: "Finance", icon: <Wallet size={17} /> },
    { view: "investments", label: "Investments", icon: <Home size={17} /> },
    { view: "notes", label: "Notes", icon: <StickyNote size={17} />, kbd: "Ctrl+N" },
  ];

  return (
    <ToastProvider>
      <div className="h-full flex">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 border-r border-edge bg-panel flex flex-col">
          <div className="px-4 pt-4 pb-3 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-acc flex items-center justify-center text-[#0d0e12] font-bold text-[13px]">
              P
            </div>
            <div className="font-semibold tracking-tight">PersonalOS</div>
          </div>

          <button
            className="mx-3 mb-1 btn-edge !justify-start text-mut"
            onClick={() => setSearchOpen(true)}
            title="Universal Search (Ctrl+Space)"
          >
            <Search size={15} />
            <span className="flex-1 text-left">Search</span>
            <span className="kbd">Ctrl+Spc</span>
          </button>
          <button
            className="mx-3 mb-2 btn-edge !justify-start text-mut"
            onClick={() => setCaptureOpen(true)}
            title="Quick Capture (Ctrl+Shift+Space)"
          >
            <Zap size={15} />
            <span className="flex-1 text-left">Capture</span>
            <span className="kbd">⇧Ctrl+Spc</span>
          </button>

          <nav className="px-3 flex flex-col gap-0.5">
            {navItems.map((item) => (
              <button
                key={item.view}
                title={item.kbd}
                className={`btn !justify-start w-full ${
                  view === item.view
                    ? "bg-panel2 text-ink"
                    : "text-mut hover:text-ink hover:bg-panel2/60"
                }`}
                onClick={() => setView(item.view)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto px-3 pb-3 flex flex-col gap-0.5">
            <button
              className={`btn !justify-start w-full ${
                view === "settings" ? "bg-panel2 text-ink" : "text-mut hover:text-ink hover:bg-panel2/60"
              }`}
              onClick={() => setView("settings")}
              title="Ctrl+,"
            >
              <SettingsIcon size={17} />
              Settings
            </button>
            <button className="btn !justify-start w-full text-mut hover:text-ink hover:bg-panel2/60" onClick={lock} title="Ctrl+Shift+L">
              <Lock size={17} />
              Lock
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-hidden">
          {view === "dashboard" && (
            <Dashboard
              refreshKey={refreshKey}
              currency={currency}
              navigate={navigate}
              onChanged={dataChanged}
            />
          )}
          {view === "workbench" && <Workbench refreshKey={refreshKey} focus={focus} onChanged={dataChanged} />}
          {view === "people" && (
            <People
              refreshKey={refreshKey}
              focus={focus}
              currency={currency}
              navigate={navigate}
              onChanged={dataChanged}
            />
          )}
          {view === "vault" && <Vault refreshKey={refreshKey} focus={focus} onChanged={dataChanged} />}
          {view === "finance" && (
            <Finance refreshKey={refreshKey} focus={focus} currency={currency} onChanged={dataChanged} />
          )}
          {view === "investments" && (
            <Investments refreshKey={refreshKey} focus={focus} currency={currency} onChanged={dataChanged} />
          )}
          {view === "notes" && <Notes refreshKey={refreshKey} focus={focus} onChanged={dataChanged} />}
          {view === "settings" && (
            <Settings
              settings={settings}
              reloadSettings={loadSettings}
              onLock={lock}
              onChanged={dataChanged}
            />
          )}
        </main>
      </div>

      {searchOpen && <UniversalSearch onClose={() => setSearchOpen(false)} navigate={navigate} />}
      {captureOpen && (
        <QuickCapture
          onClose={() => setCaptureOpen(false)}
          onSaved={dataChanged}
          currency={currency}
        />
      )}
    </ToastProvider>
  );
}
