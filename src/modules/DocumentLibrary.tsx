import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, DocType, Person, ScanEntry, ScanResult } from "../api";
import { Confirm, Empty, Modal, personLabel, useToast } from "../components/ui";
import { DOC_TYPES } from "./People";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  RefreshCcw,
  Search,
  ShieldAlert,
  Unlink,
} from "lucide-react";

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Row state the user can change before importing. */
type Draft = { person_id: number | null; doc_type: DocType; selected: boolean };

export default function DocumentLibrary({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [root, setRoot] = useState<string>("");
  const [people, setPeople] = useState<Person[]>([]);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mapping, setMapping] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<ScanEntry | null>(null);
  const toast = useToast();

  const loadRoot = useCallback(() => {
    api
      .settingsGet()
      .then((s) => setRoot(s.documents_root ?? ""))
      .catch(() => {});
    api.personList().then(setPeople).catch(() => {});
  }, []);
  useEffect(loadRoot, [loadRoot, refreshKey]);

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const r = await api.documentScan();
      setScan(r);
      // Pre-select everything we could confidently place, so the common case
      // is "glance, then Import" rather than ticking 90 boxes.
      const next: Record<string, Draft> = {};
      for (const e of r.entries) {
        if (e.status !== "new") continue;
        next[e.rel_path] = {
          person_id: e.person_id,
          doc_type: e.doc_type,
          selected: e.person_id != null,
        };
      }
      setDrafts(next);
    } catch (e) {
      toast(String(e), "bad");
    } finally {
      setScanning(false);
    }
  }, [toast]);

  const pickFolder = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (!picked || typeof picked !== "string") return;
    await api.settingsSet("documents_root", picked);
    setRoot(picked);
    setScan(null);
    setDrafts({});
    toast("Documents folder set");
  };

  const buckets = useMemo(() => {
    const b: Record<string, ScanEntry[]> = {
      new: [],
      linked: [],
      moved: [],
      modified: [],
      missing: [],
      blocked: [],
    };
    for (const e of scan?.entries ?? []) b[e.status]?.push(e);
    return b;
  }, [scan]);

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const selectedCount = Object.values(drafts).filter((d) => d.selected && d.person_id != null).length;

  const doImport = async () => {
    const entries = (buckets.new ?? [])
      .filter((e) => drafts[e.rel_path]?.selected && drafts[e.rel_path]?.person_id != null)
      .map((e) => ({
        rel_path: e.rel_path,
        filename: e.filename,
        sha256: e.sha256,
        size: e.size,
        person_id: drafts[e.rel_path].person_id as number,
        doc_type: drafts[e.rel_path].doc_type,
      }));
    if (entries.length === 0) return;
    setImporting(true);
    try {
      const n = await api.documentImport(entries);
      toast(`Linked ${n} document${n === 1 ? "" : "s"}`);
      onChanged();
      await runScan();
    } catch (e) {
      toast(String(e), "bad");
    } finally {
      setImporting(false);
    }
  };

  const openFile = async (linkId: number | null) => {
    if (linkId == null) return;
    try {
      await api.documentLinkOpen(linkId);
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  // ---- no folder chosen yet -------------------------------------------------
  if (!root) {
    return (
      <div className="h-full flex flex-col">
        <Header root="" onPick={pickFolder} onScan={runScan} scanning={false} />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="card p-8 max-w-[520px] text-center">
            <FolderOpen size={32} className="mx-auto mb-3 text-acc" />
            <h2 className="font-semibold mb-1.5">Choose your documents folder</h2>
            <p className="text-mut text-[13px] leading-relaxed mb-4">
              Point PersonalOS at the folder where your documents already live — one subfolder per
              person. Files are <strong>never copied or moved</strong>; the app only remembers where
              they are, so they stay yours even if you uninstall it.
            </p>
            <button className="btn-acc mx-auto" onClick={pickFolder}>
              <FolderOpen size={15} /> Choose folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  const unmapped = scan?.unmapped_folders ?? [];

  return (
    <div className="h-full flex flex-col">
      <Header root={root} onPick={pickFolder} onScan={runScan} scanning={scanning} />

      <div className="flex-1 overflow-y-auto p-6">
        {!scan ? (
          <div className="max-w-[900px]">
            <Empty
              text="Not scanned yet"
              hint="Press Scan folder to see what's new, what's already linked, and anything that moved."
            />
          </div>
        ) : (
          <div className="max-w-[1100px] flex flex-col gap-4">
            <div className="flex gap-2 flex-wrap">
              <Chip label="New" n={buckets.new.length} tone="acc" />
              <Chip label="Linked" n={buckets.linked.length} tone="ok" />
              <Chip label="Moved" n={buckets.moved.length} tone="warn" />
              <Chip label="Changed" n={buckets.modified.length} tone="warn" />
              <Chip label="Missing" n={buckets.missing.length} tone="bad" />
              <Chip label="Blocked" n={buckets.blocked.length} tone="bad" />
            </div>

            {/* Folders must be mapped before their files can be imported. */}
            {unmapped.length > 0 && (
              <section className="card p-4 border-warn/40">
                <h2 className="font-semibold text-[13px] flex items-center gap-1.5 mb-2 text-warn">
                  <AlertTriangle size={14} /> Tell PersonalOS who these folders belong to
                </h2>
                <p className="text-mut text-[12.5px] mb-3">
                  Files in an unassigned folder can't be imported yet. Assign once — every future
                  scan remembers.
                </p>
                <div className="flex flex-wrap gap-2">
                  {unmapped.map((f) => (
                    <button key={f} className="btn-edge !py-1 text-[12.5px]" onClick={() => setMapping(f)}>
                      <FolderOpen size={13} /> {f}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {buckets.new.length > 0 && (
              <section className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut">
                    New — review and import
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn-edge !py-1 text-[12px]"
                      onClick={() =>
                        setDrafts((d) => {
                          const next = { ...d };
                          const allOn = buckets.new.every((e) => next[e.rel_path]?.selected);
                          for (const e of buckets.new)
                            next[e.rel_path] = { ...next[e.rel_path], selected: !allOn };
                          return next;
                        })
                      }
                    >
                      Toggle all
                    </button>
                    <button className="btn-acc !py-1 text-[12px]" onClick={doImport} disabled={importing || selectedCount === 0}>
                      {importing ? "Importing…" : `Import ${selectedCount} selected`}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] uppercase tracking-wide text-mut border-b border-edge">
                    <span className="w-6" />
                    <span className="flex-1">File</span>
                    <span className="w-32">Belongs to</span>
                    <span className="w-40">Type</span>
                    <span className="w-16 text-right">Size</span>
                  </div>
                  {buckets.new.map((e) => {
                    const d = drafts[e.rel_path];
                    if (!d) return null;
                    const blockedByPerson = d.person_id == null;
                    return (
                      <div
                        key={e.rel_path}
                        className={`flex items-center gap-2 px-2 py-1.5 border-b border-edge/60 last:border-0 ${
                          blockedByPerson ? "opacity-60" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="w-6"
                          checked={d.selected && !blockedByPerson}
                          disabled={blockedByPerson}
                          onChange={(ev) => setDraft(e.rel_path, { selected: ev.target.checked })}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-[13px]">{e.filename}</span>
                          <span className="block truncate text-[11.5px] text-mut">
                            {e.folder || "(root)"}
                            {!e.confident && " · type not obvious from the name"}
                          </span>
                        </span>
                        <select
                          className="ctl !py-1 w-32 text-[12px]"
                          value={d.person_id ?? ""}
                          onChange={(ev) =>
                            setDraft(e.rel_path, {
                              person_id: ev.target.value ? Number(ev.target.value) : null,
                              selected: !!ev.target.value,
                            })
                          }
                        >
                          <option value="">Choose…</option>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {personLabel(p)}
                            </option>
                          ))}
                        </select>
                        <select
                          className={`ctl !py-1 w-40 text-[12px] ${!e.confident ? "border-warn/50" : ""}`}
                          value={d.doc_type}
                          onChange={(ev) => setDraft(e.rel_path, { doc_type: ev.target.value as DocType })}
                        >
                          {DOC_TYPES.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <span className="w-16 text-right text-[11.5px] text-mut">{fmtSize(e.size)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {(buckets.moved.length > 0 || buckets.modified.length > 0 || buckets.missing.length > 0) && (
              <section className="card p-4">
                <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-3">
                  Needs attention
                </h2>
                {[...buckets.moved, ...buckets.modified, ...buckets.missing].map((e) => (
                  <div
                    key={`${e.status}-${e.link_id}-${e.rel_path}`}
                    className="flex items-center gap-3 py-2 border-b border-edge/60 last:border-0"
                  >
                    <StatusIcon status={e.status} />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-[13px]">{e.filename}</span>
                      <span className="block truncate text-[11.5px] text-mut">{e.note}</span>
                    </span>
                    {e.status === "moved" && (
                      <button
                        className="btn-edge !py-1 text-[12px]"
                        onClick={async () => {
                          await api.documentLinkRepair(e.link_id!, e.rel_path);
                          toast("Link repaired");
                          runScan();
                        }}
                      >
                        Repair link
                      </button>
                    )}
                    {e.status === "modified" && (
                      <button
                        className="btn-edge !py-1 text-[12px]"
                        onClick={async () => {
                          await api.documentLinkRefresh(e.link_id!);
                          toast("Link updated");
                          runScan();
                        }}
                      >
                        Accept change
                      </button>
                    )}
                    {e.status === "missing" && (
                      <button className="btn-edge !py-1 text-[12px] text-bad" onClick={() => setUnlinking(e)}>
                        <Unlink size={13} /> Unlink
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}

            {buckets.blocked.length > 0 && (
              <section className="card p-4 border-bad/40">
                <h2 className="font-semibold text-[13px] flex items-center gap-1.5 mb-2 text-bad">
                  <ShieldAlert size={14} /> Refused — never stored
                </h2>
                <p className="text-mut text-[12.5px] mb-2">
                  These look like PIN/OTP material. PersonalOS will not index them, by policy. They
                  are listed here only so you know they were skipped.
                </p>
                {buckets.blocked.map((e) => (
                  <div key={e.rel_path} className="text-[12.5px] py-0.5">
                    <span className="text-ink">{e.rel_path}</span>{" "}
                    <span className="text-mut">— {e.note}</span>
                  </div>
                ))}
              </section>
            )}

            {buckets.linked.length > 0 && (
              <section className="card p-4">
                <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-3">
                  Linked ({buckets.linked.length})
                </h2>
                <div className="flex flex-col">
                  {buckets.linked.map((e) => (
                    <button
                      key={e.rel_path}
                      className="flex items-center gap-3 py-1.5 px-1.5 -mx-1.5 rounded-md hover:bg-panel2 text-left"
                      onClick={() => openFile(e.link_id)}
                      title="Open in your default viewer"
                    >
                      <CheckCircle2 size={14} className="text-ok shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-[13px]">{e.filename}</span>
                      <span className="text-[11.5px] text-mut w-28 truncate">{e.person_name}</span>
                      <span className="text-[11.5px] text-mut w-32 truncate">
                        {DOC_TYPES.find((t) => t.id === e.doc_type)?.label}
                      </span>
                      <span className="text-[11.5px] text-mut w-16 text-right">{fmtSize(e.size)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {mapping && (
        <MapFolderModal
          folder={mapping}
          people={people}
          onClose={() => setMapping(null)}
          onSaved={() => {
            setMapping(null);
            runScan();
          }}
        />
      )}
      {unlinking && (
        <Confirm
          message={`Unlink "${unlinking.filename}"?`}
          detail="Only the link is removed — the file on disk is left exactly where it is."
          onClose={() => setUnlinking(null)}
          onConfirm={async () => {
            await api.documentLinkDelete(unlinking.link_id!);
            onChanged();
            runScan();
          }}
        />
      )}
    </div>
  );
}

function Header({
  root,
  onPick,
  onScan,
  scanning,
}: {
  root: string;
  onPick: () => void;
  onScan: () => void;
  scanning: boolean;
}) {
  return (
    <div className="px-6 pt-4 pb-3 border-b border-edge">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Documents</h1>
          <div className="text-mut text-[12px] truncate">
            {root ? root : "No folder chosen yet"}
          </div>
        </div>
        <div className="flex-1" />
        {root && (
          <>
            <button className="btn-edge" onClick={onPick} title="Change documents folder">
              <FolderOpen size={15} /> Change folder
            </button>
            <button className="btn-acc" onClick={onScan} disabled={scanning}>
              {scanning ? <RefreshCcw size={15} className="animate-spin" /> : <Search size={15} />}
              {scanning ? "Scanning…" : "Scan folder"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Chip({ label, n, tone }: { label: string; n: number; tone: string }) {
  if (n === 0) return null;
  return (
    <span className={`rounded-full border border-edge bg-panel2 px-2.5 py-1 text-[12px] text-${tone}`}>
      {label} <span className="text-ink font-medium">{n}</span>
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "missing") return <AlertTriangle size={14} className="text-bad shrink-0" />;
  return <AlertTriangle size={14} className="text-warn shrink-0" />;
}

function MapFolderModal({
  folder,
  people,
  onClose,
  onSaved,
}: {
  folder: string;
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [personId, setPersonId] = useState<number | null>(null);
  const toast = useToast();

  return (
    <Modal title={`Who is "${folder}"?`} onClose={onClose}>
      <p className="text-mut text-[13px] mb-3">
        Everything in this folder will be filed under the person you choose. Assigned once —
        future scans remember it.
      </p>
      <select
        className="ctl mb-4"
        value={personId ?? ""}
        autoFocus
        onChange={(e) => setPersonId(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Choose a person…</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {personLabel(p)}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-acc"
          disabled={personId == null}
          onClick={async () => {
            try {
              await api.documentFolderMapSet(folder, personId as number);
              toast("Folder assigned");
              onSaved();
            } catch (e) {
              toast(String(e), "bad");
            }
          }}
        >
          Assign
        </button>
      </div>
    </Modal>
  );
}
