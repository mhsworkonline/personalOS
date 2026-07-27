import { useCallback, useEffect, useMemo, useState } from "react";
import { api, CatalogEntry, FeedItem, FeedKind, FeedSource } from "../api";
import { Confirm, Empty, Field, FilterBar, Modal, useToast } from "../components/ui";
import { fmtDateTime } from "../lib/format";
import { CheckCheck, ExternalLink, Newspaper, Plus, RefreshCcw, Settings2, Trash2, Youtube } from "lucide-react";

const TOPIC_LABEL: Record<string, string> = {
  ai: "AI",
  technology: "Technology",
  science: "Science",
  business: "Business",
  world: "World News",
};
const topicLabel = (t: string) => TOPIC_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1);

export default function AiFeed({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [topic, setTopic] = useState("ai"); // AI is the default topic
  const [sourceFilter, setSourceFilter] = useState<number | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [managingSources, setManagingSources] = useState(false);
  const toast = useToast();

  const loadItems = useCallback(() => {
    api.feedItemList(sourceFilter, topic, unreadOnly).then(setItems).catch(() => {});
  }, [sourceFilter, topic, unreadOnly]);

  const loadSources = useCallback(() => {
    api.feedSourceList().then(setSources).catch(() => {});
  }, []);

  useEffect(loadSources, [loadSources, refreshKey]);
  useEffect(loadItems, [loadItems, refreshKey]);
  useEffect(() => {
    api.feedCatalog().then(setCatalog).catch(() => {});
  }, []);

  // Every topic that has a source (added or catalog), AI always first/default.
  const topics = useMemo(() => {
    const set = new Set<string>(["ai"]);
    sources.forEach((s) => set.add(s.topic));
    catalog.forEach((c) => set.add(c.topic));
    return ["ai", ...[...set].filter((t) => t !== "ai").sort()];
  }, [sources, catalog]);

  const topicSources = useMemo(() => sources.filter((s) => s.topic === topic), [sources, topic]);

  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items]);

  const refresh = async () => {
    if (sources.filter((s) => s.enabled).length === 0) {
      toast("No sources enabled — add one first", "bad");
      return;
    }
    setRefreshing(true);
    try {
      const results = await api.feedRefresh();
      const total = results.reduce((n, r) => n + r.new_items, 0);
      const failed = results.filter((r) => r.error);
      loadItems();
      toast(
        failed.length > 0
          ? `${total} new item${total === 1 ? "" : "s"} — ${failed.length} source(s) failed`
          : `${total} new item${total === 1 ? "" : "s"}`,
        failed.length > 0 ? "bad" : undefined
      );
    } catch (e) {
      toast(String(e), "bad");
    } finally {
      setRefreshing(false);
    }
  };

  const openItem = async (item: FeedItem) => {
    if (!item.read) {
      await api.feedItemMarkRead(item.id, true);
      loadItems();
    }
    try {
      await api.feedItemOpen(item.id);
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const markAllRead = async () => {
    await api.feedMarkAllRead();
    loadItems();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-4 pb-3 border-b border-edge flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">AI Feed</h1>
          <div className="text-mut text-[12px]">
            News &amp; YouTube from sources you choose · fetched only when you refresh
          </div>
        </div>
        <div className="flex-1" />
        {unreadCount > 0 && (
          <button className="btn-edge !py-1 text-[12px]" onClick={markAllRead}>
            <CheckCheck size={14} /> Mark all read
          </button>
        )}
        <button className="btn-edge" onClick={() => setManagingSources(true)}>
          <Settings2 size={15} /> Sources
        </button>
        <button className="btn-acc" onClick={refresh} disabled={refreshing}>
          <RefreshCcw size={15} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[820px]">
          <FilterBar>
            <select
              className="ctl !py-1 !w-auto text-[12.5px] font-medium"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                setSourceFilter(null);
              }}
            >
              {topics.map((t) => (
                <option key={t} value={t}>
                  {topicLabel(t)}
                </option>
              ))}
            </select>
            <select
              className="ctl !py-1 !w-auto text-[12.5px]"
              value={sourceFilter ?? ""}
              onChange={(e) => setSourceFilter(e.target.value ? Number(e.target.value) : null)}
              disabled={topicSources.length === 0}
            >
              <option value="">All sources</option>
              {topicSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[12.5px] text-mut cursor-pointer">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
              Unread only
            </label>
          </FilterBar>

          {topicSources.length === 0 ? (
            <Empty
              text={`No sources for ${topicLabel(topic)} yet`}
              hint='Click "Sources" to add one, or discover a verified free source for this topic.'
            />
          ) : (
            <>
              {items.length === 0 ? (
                <Empty
                  text={unreadOnly ? "No unread items" : "Nothing here yet"}
                  hint={unreadOnly ? undefined : 'Click "Refresh" to pull the latest.'}
                />
              ) : (
                <div className="card divide-y divide-edge">
                  {items.map((it) => (
                    <button
                      key={it.id}
                      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-panel2/60 group"
                      onClick={() => openItem(it)}
                    >
                      <span className="mt-0.5 shrink-0 text-mut">
                        {it.source_kind === "youtube" ? <Youtube size={15} /> : <Newspaper size={15} />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={`truncate ${it.read ? "text-mut" : "font-medium"}`}>{it.title}</div>
                        {it.summary && (
                          <div className="text-mut text-[12px] truncate mt-0.5">{it.summary}</div>
                        )}
                        <div className="text-[11px] text-[#5b6170] mt-1 flex items-center gap-2">
                          <span>{it.source_name}</span>
                          {it.published_at && <span>{fmtDateTime(it.published_at)}</span>}
                        </div>
                      </div>
                      {!it.read && <span className="w-1.5 h-1.5 rounded-full bg-acc mt-2 shrink-0" />}
                      <ExternalLink
                        size={13}
                        className="text-mut opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                      />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {managingSources && (
        <SourcesModal
          sources={sources}
          catalog={catalog}
          initialTopic={topic}
          onClose={() => setManagingSources(false)}
          onChanged={() => {
            loadSources();
            loadItems();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SourcesModal({
  sources,
  catalog,
  initialTopic,
  onClose,
  onChanged,
}: {
  sources: FeedSource[];
  catalog: CatalogEntry[];
  initialTopic: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FeedSource | null>(null);
  const [discoverTopic, setDiscoverTopic] = useState(initialTopic);
  const toast = useToast();

  const addedUrls = useMemo(() => new Set(sources.map((s) => s.url)), [sources]);
  const discoverable = catalog.filter((c) => c.topic === discoverTopic && !addedUrls.has(c.url));
  const discoverTopics = useMemo(() => [...new Set(catalog.map((c) => c.topic))], [catalog]);

  const addFromCatalog = async (c: CatalogEntry) => {
    try {
      await api.feedSourceAdd({ name: c.name, kind: c.kind, topic: c.topic, url: c.url });
      toast(`Added ${c.name}`);
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title="Feed sources" onClose={onClose} wide>
      <p className="text-mut text-[13px] mb-3">
        Only what you refresh here ever leaves the machine — just the feed URL, on that click.
      </p>

      {catalog.length > 0 && (
        <div className="mb-4 border border-edge rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] uppercase tracking-wide text-mut font-semibold">
              Discover — verified free sources
            </div>
            <select
              className="ctl !py-1 !w-auto text-[12px]"
              value={discoverTopic}
              onChange={(e) => setDiscoverTopic(e.target.value)}
            >
              {discoverTopics.map((t) => (
                <option key={t} value={t}>
                  {topicLabel(t)}
                </option>
              ))}
            </select>
          </div>
          {discoverable.length === 0 ? (
            <div className="text-mut text-[12.5px] py-1">All catalog sources for this topic are added.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {discoverable.map((c) => (
                <div key={c.url} className="flex items-center gap-2 py-1">
                  <span className="text-mut shrink-0">
                    {c.kind === "youtube" ? <Youtube size={13} /> : <Newspaper size={13} />}
                  </span>
                  <span className="flex-1 text-[13px] truncate">{c.name}</span>
                  <button className="btn-edge !py-0.5 !px-2 text-[11.5px]" onClick={() => addFromCatalog(c)}>
                    <Plus size={12} /> Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] uppercase tracking-wide text-mut font-semibold">Your sources</div>
        <button className="btn-edge !py-1 text-[12px]" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add custom source
        </button>
      </div>
      <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
        {sources.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-panel2 group">
            <span className="text-mut shrink-0">
              {s.kind === "youtube" ? <Youtube size={15} /> : <Newspaper size={15} />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">
                {s.name}
                <span className="ml-2 text-mut text-[10.5px] rounded-full border border-edge px-1.5 py-px">
                  {topicLabel(s.topic)}
                </span>
              </div>
              <div className="text-mut text-[11.5px] truncate">{s.url}</div>
            </div>
            <label className="flex items-center gap-1.5 text-[12px] text-mut cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={async (e) => {
                  await api.feedSourceSetEnabled(s.id, e.target.checked);
                  onChanged();
                }}
              />
              enabled
            </label>
            <button
              className="opacity-0 group-hover:opacity-100 btn-ghost !p-1.5 text-bad shrink-0"
              onClick={() => setConfirmDelete(s)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-3">
        <button className="btn-edge" onClick={onClose}>
          Close
        </button>
      </div>

      {adding && (
        <AddSourceModal
          initialTopic={discoverTopic}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          message={`Remove "${confirmDelete.name}"?`}
          detail="Its cached items are removed too. This doesn't affect the source itself, only this app's copy."
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await api.feedSourceDelete(confirmDelete.id);
              setConfirmDelete(null);
              onChanged();
            } catch (e) {
              toast(String(e), "bad");
            }
          }}
        />
      )}
    </Modal>
  );
}

function AddSourceModal({
  initialTopic,
  onClose,
  onSaved,
}: {
  initialTopic: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FeedKind>("news");
  const [topic, setTopic] = useState(initialTopic);
  const [url, setUrl] = useState("");
  const toast = useToast();

  const save = async () => {
    try {
      await api.feedSourceAdd({ name: name.trim(), kind, topic: topic.trim() || "ai", url: url.trim() });
      toast("Source added");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title="Add source" onClose={onClose}>
      <Field label="Name">
        <input className="ctl" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Anthropic News" />
      </Field>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Type">
          <select className="ctl" value={kind} onChange={(e) => setKind(e.target.value as FeedKind)}>
            <option value="news">News / blog (RSS or Atom)</option>
            <option value="youtube">YouTube channel</option>
          </select>
        </Field>
        <Field label="Topic">
          <input
            className="ctl"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="ai"
          />
        </Field>
      </div>
      <Field label={kind === "youtube" ? "Feed URL" : "RSS/Atom URL"}>
        <input
          className="ctl font-mono text-[12.5px]"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            kind === "youtube"
              ? "https://www.youtube.com/feeds/videos.xml?channel_id=..."
              : "https://example.com/feed.xml"
          }
        />
      </Field>
      {kind === "youtube" && (
        <div className="text-mut text-[11.5px] mb-3">
          Find the channel_id in the channel's page source, or use a channel-ID lookup site — no
          YouTube account or API key needed.
        </div>
      )}
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!name.trim() || !url.trim()}>
          Add
        </button>
      </div>
    </Modal>
  );
}
