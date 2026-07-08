import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { wb } from "./mockData";
import { AiProvider } from "./types";
import { Modal, useToast } from "../../components/ui";
import Home from "./Home";
import Chats from "./Chats";
import Library from "./Library";
import { BookOpen, MessageSquare, Sparkles } from "lucide-react";

type SubView = "home" | "chats" | "library";

/** Module root: sub-view tabs, cross-module focus routing, refreshKey
 *  plumbing, and the module-local N / I / shortcuts (§3, §12 of
 *  AI_WORKBENCH_DESIGN.md). Backed entirely by ./mockData — see that file's
 *  header for why. */
export default function Workbench({
  refreshKey,
  focus,
  onChanged,
}: {
  refreshKey: number;
  focus: { module: string; id: number; nonce: number } | null;
  onChanged: () => void;
}) {
  const [subview, setSubview] = useState<SubView>("home");
  const [localKey, setLocalKey] = useState(0);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [personId, setPersonId] = useState<number | null>(null);
  const [launcherFocusNonce, setLauncherFocusNonce] = useState(0);
  const [chatFocus, setChatFocus] = useState<{ module: string; id: number; nonce: number } | null>(null);
  const [cardFocus, setCardFocus] = useState<{ module: string; id: number; nonce: number } | null>(null);
  const [quickIdea, setQuickIdea] = useState<string | null>(null);
  const toast = useToast();
  const bump = useCallback(() => {
    setLocalKey((k) => k + 1);
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    wb.providerList().then(setProviders).catch(() => {});
  }, [refreshKey, localKey]);

  useEffect(() => {
    api
      .personList()
      .then((people) => setPersonId(people.find((p) => p.is_default)?.id ?? people[0]?.id ?? null))
      .catch(() => {});
  }, []);

  // Cross-module navigation in (Ctrl+K, UniversalSearch, Home → Chats/Library).
  useEffect(() => {
    if (!focus) return;
    if (focus.module === "home") {
      setSubview("home");
      setLauncherFocusNonce(focus.nonce);
    } else if (focus.module === "chats") {
      setSubview("chats");
      setChatFocus(focus);
    } else if (focus.module === "cards") {
      setSubview("library");
      setCardFocus(focus);
    }
  }, [focus]);

  // N / I / (no modifier, only while no input is focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement | null)?.isContentEditable;
      if (typing) return;
      if (e.key === "n") {
        e.preventDefault();
        setSubview("chats");
        setChatFocus({ module: "chats", id: -1, nonce: Date.now() });
      } else if (e.key === "i") {
        e.preventDefault();
        setQuickIdea("");
      } else if (e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("personalos:module-search"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveQuickIdea = async () => {
    const title = (quickIdea ?? "").trim();
    if (!title) {
      setQuickIdea(null);
      return;
    }
    try {
      await wb.cardSave({
        id: null,
        kind: "idea",
        title,
        body: "",
        topic: "",
        project: "",
        language: "",
        review_on: "",
        pinned: false,
        person_id: personId,
      });
      setQuickIdea(null);
      toast("Idea captured");
      bump();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const tabs: { key: SubView; label: string; icon: React.ReactNode }[] = [
    { key: "home", label: "Home", icon: <Sparkles size={14} /> },
    { key: "chats", label: "Chats", icon: <MessageSquare size={14} /> },
    { key: "library", label: "Library", icon: <BookOpen size={14} /> },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-2 border-b border-edge flex items-center gap-1 shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`btn !py-1.5 ${subview === t.key ? "bg-panel2 text-ink" : "text-mut hover:text-ink hover:bg-panel2/60"}`}
            onClick={() => setSubview(t.key)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          className="btn-acc !py-1.5"
          onClick={() => {
            setSubview("chats");
            setChatFocus({ module: "chats", id: -1, nonce: Date.now() });
          }}
        >
          + New chat
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {subview === "home" && (
          <Home
            refreshKey={refreshKey + localKey}
            providers={providers}
            launcherFocusNonce={launcherFocusNonce}
            onFocusChat={(id) => {
              setSubview("chats");
              setChatFocus({ module: "chats", id, nonce: Date.now() });
            }}
            onFocusCard={(id) => {
              setSubview("library");
              setCardFocus({ module: "cards", id, nonce: Date.now() });
            }}
            onChanged={bump}
          />
        )}
        {subview === "chats" && <Chats refreshKey={refreshKey + localKey} focus={chatFocus} onChanged={bump} />}
        {subview === "library" && (
          <Library refreshKey={refreshKey + localKey} focus={cardFocus} personId={personId} onChanged={bump} />
        )}
      </div>

      {quickIdea !== null && (
        <Modal title="Quick idea" onClose={() => setQuickIdea(null)}>
          <input
            className="ctl"
            placeholder="One line…"
            autoFocus
            value={quickIdea}
            onChange={(e) => setQuickIdea(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveQuickIdea()}
          />
          <div className="flex justify-end gap-2 mt-3">
            <button className="btn-edge" onClick={() => setQuickIdea(null)}>
              Cancel
            </button>
            <button className="btn-acc" onClick={saveQuickIdea} disabled={!quickIdea.trim()}>
              Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
