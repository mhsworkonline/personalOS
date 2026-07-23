import { useCallback, useEffect, useState } from "react";
import { api, Holding, HoldingKind, Person, PortfolioSummary } from "../api";
import { Confirm, Empty, Field, Modal, PersonBadge, personLabel, useToast } from "../components/ui";
import { fmtDate, fmtMoney, todayISO } from "../lib/format";
import { Pencil, Plus, RefreshCcw, Trash2, TrendingUp } from "lucide-react";

const KIND_LABEL: Record<HoldingKind, string> = { stock: "Stock", fund: "Fund" };

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function Portfolio({
  refreshKey,
  currency,
  onChanged,
}: {
  refreshKey: number;
  currency: string;
  onChanged: () => void;
}) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [editing, setEditing] = useState<Holding | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Holding | null>(null);
  const [updatingPrices, setUpdatingPrices] = useState(false);

  const load = useCallback(() => {
    api.holdingList().then(setHoldings).catch(() => {});
    api.portfolioSummary().then(setSummary).catch(() => {});
    api.personList().then(setPeople).catch(() => {});
  }, []);
  useEffect(load, [load, refreshKey]);

  const changed = () => {
    load();
    onChanged();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-4 pb-3 border-b border-edge flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Portfolio</h1>
          <div className="text-mut text-[12px]">Stocks &amp; mutual funds · prices entered manually</div>
        </div>
        <div className="flex-1" />
        {holdings.length > 0 && (
          <button className="btn-edge" onClick={() => setUpdatingPrices(true)}>
            <RefreshCcw size={15} /> Update prices
          </button>
        )}
        <button className="btn-acc" onClick={() => setEditing("new")}>
          <Plus size={15} /> Add holding
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[960px]">
          {summary && summary.count > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div className="card p-4">
                <div className="text-mut text-[12px] mb-1">Invested</div>
                <div className="text-2xl font-semibold">{fmtMoney(summary.invested, currency)}</div>
              </div>
              <div className="card p-4">
                <div className="text-mut text-[12px] mb-1">Current value</div>
                <div className="text-2xl font-semibold">{fmtMoney(summary.current, currency)}</div>
              </div>
              <div className="card p-4">
                <div className="text-mut text-[12px] mb-1">Unrealized P&amp;L</div>
                <div className={`text-2xl font-semibold ${summary.pnl >= 0 ? "text-ok" : "text-bad"}`}>
                  {fmtMoney(summary.pnl, currency)}
                  <span className="text-[13px] ml-1.5">{pct(summary.pnl_pct)}</span>
                </div>
              </div>
            </div>
          )}

          {holdings.length === 0 ? (
            <Empty
              text="No holdings yet"
              hint="Add the stocks and funds you own. Enter their current price to see your gains."
            />
          ) : (
            <div className="card divide-y divide-edge">
              <div className="flex items-center gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-mut">
                <span className="flex-1">Holding</span>
                <span className="w-24 text-right">Qty</span>
                <span className="w-28 text-right">Avg cost</span>
                <span className="w-28 text-right">Price</span>
                <span className="w-32 text-right">Value</span>
                <span className="w-32 text-right">P&amp;L</span>
                <span className="w-16" />
              </div>
              {holdings.map((h) => (
                <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 group">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {h.symbol}
                      <span className="text-mut text-[10.5px] rounded-full border border-edge px-1.5 py-px">
                        {KIND_LABEL[h.kind]}
                      </span>
                      <PersonBadge people={people} personId={h.person_id} />
                    </div>
                    {h.name && <div className="text-mut text-[12px] truncate">{h.name}</div>}
                  </div>
                  <span className="w-24 text-right tabular-nums">{h.quantity}</span>
                  <span className="w-28 text-right tabular-nums text-mut">
                    {fmtMoney(h.avg_cost, currency)}
                  </span>
                  <span className="w-28 text-right tabular-nums">
                    {fmtMoney(h.last_price, currency)}
                    {h.price_date && (
                      <span className="block text-[10px] text-mut">{fmtDate(h.price_date)}</span>
                    )}
                  </span>
                  <span className="w-32 text-right tabular-nums">{fmtMoney(h.current, currency)}</span>
                  <span className={`w-32 text-right tabular-nums ${h.pnl >= 0 ? "text-ok" : "text-bad"}`}>
                    {fmtMoney(h.pnl, currency)}
                    <span className="block text-[10.5px]">{pct(h.pnl_pct)}</span>
                  </span>
                  <div className="w-16 flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                    <button className="btn-ghost !p-1.5" onClick={() => setEditing(h)}>
                      <Pencil size={14} />
                    </button>
                    <button className="btn-ghost !p-1.5 text-bad" onClick={() => setConfirmDelete(h)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {summary && summary.count > 0 && (
            <div className="text-mut text-[11.5px] mt-3 flex items-center gap-1.5">
              <TrendingUp size={12} /> Current value feeds your net worth in Finance. Prices are
              manual — use "Update prices" to refresh them.
            </div>
          )}
        </div>
      </div>

      {editing && (
        <HoldingEditor
          holding={editing === "new" ? null : editing}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            changed();
          }}
        />
      )}
      {updatingPrices && (
        <UpdatePricesModal
          holdings={holdings}
          currency={currency}
          onClose={() => setUpdatingPrices(false)}
          onSaved={() => {
            setUpdatingPrices(false);
            changed();
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          message={`Delete ${confirmDelete.symbol}?`}
          detail="Removes the holding from your portfolio. This can't be undone."
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await api.holdingDelete(confirmDelete.id);
            changed();
          }}
        />
      )}
    </div>
  );
}

function HoldingEditor({
  holding,
  people,
  onClose,
  onSaved,
}: {
  holding: Holding | null;
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [symbol, setSymbol] = useState(holding?.symbol ?? "");
  const [name, setName] = useState(holding?.name ?? "");
  const [kind, setKind] = useState<HoldingKind>(holding?.kind ?? "stock");
  const [quantity, setQuantity] = useState(String(holding?.quantity ?? ""));
  const [avgCost, setAvgCost] = useState(String(holding?.avg_cost ?? ""));
  const [lastPrice, setLastPrice] = useState(String(holding?.last_price ?? ""));
  const [quoteKey, setQuoteKey] = useState(holding?.quote_key ?? "");
  const [personId, setPersonId] = useState<number | null>(holding?.person_id ?? null);
  const [notes, setNotes] = useState(holding?.notes ?? "");
  const toast = useToast();

  const save = async () => {
    try {
      await api.holdingSave({
        id: holding?.id ?? null,
        symbol,
        name: name.trim() || null,
        kind,
        quantity: parseFloat(quantity || "0"),
        avg_cost: parseFloat(avgCost || "0"),
        last_price: parseFloat(lastPrice || avgCost || "0"),
        price_date: todayISO(),
        notes: notes.trim() || null,
        quote_key: quoteKey.trim() || null,
        person_id: personId,
      });
      toast("Holding saved");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const priceLabel = kind === "fund" ? "Current NAV" : "Current price";

  return (
    <Modal title={holding ? `Edit ${holding.symbol}` : "Add holding"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Symbol / ticker">
          <input
            className="ctl uppercase"
            value={symbol}
            autoFocus
            placeholder="RELIANCE"
            onChange={(e) => setSymbol(e.target.value)}
          />
        </Field>
        <Field label="Type">
          <select className="ctl" value={kind} onChange={(e) => setKind(e.target.value as HoldingKind)}>
            <option value="stock">Stock</option>
            <option value="fund">Mutual fund / ETF</option>
          </select>
        </Field>
      </div>
      <Field label="Name (optional)">
        <input
          className="ctl"
          value={name}
          placeholder={kind === "fund" ? "Parag Parikh Flexi Cap" : "Reliance Industries"}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label={kind === "fund" ? "Units" : "Quantity"}>
          <input
            type="number"
            step="any"
            min="0"
            className="ctl"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label={kind === "fund" ? "Avg buy NAV" : "Avg buy price"}>
          <input
            type="number"
            step="any"
            min="0"
            className="ctl"
            value={avgCost}
            onChange={(e) => setAvgCost(e.target.value)}
          />
        </Field>
        <Field label={priceLabel}>
          <input
            type="number"
            step="any"
            min="0"
            className="ctl"
            value={lastPrice}
            onChange={(e) => setLastPrice(e.target.value)}
          />
        </Field>
      </div>
      <Field
        label={
          kind === "fund"
            ? "AMFI scheme code — for live NAV (optional)"
            : "Quote symbol — for live price (optional)"
        }
      >
        <input
          className="ctl font-mono"
          value={quoteKey}
          placeholder={kind === "fund" ? "e.g. 122639" : "e.g. RELIANCE.NS  (BSE: .BO)"}
          onChange={(e) => setQuoteKey(e.target.value)}
        />
      </Field>
      <Field label="Belongs to">
        <select
          className="ctl"
          value={personId ?? people.find((p) => p.is_default)?.id ?? ""}
          onChange={(e) => setPersonId(Number(e.target.value))}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {personLabel(p)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes (optional)">
        <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="text-mut text-[12px] mb-3">
        Unrealized gain/loss is worked out from quantity, average cost and the {priceLabel.toLowerCase()}.
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!symbol.trim() || !(parseFloat(quantity) > 0)}>
          Save
        </button>
      </div>
    </Modal>
  );
}

/** Fast path: edit only the current price of every holding in one place. */
function UpdatePricesModal({
  holdings,
  currency,
  onClose,
  onSaved,
}: {
  holdings: Holding[];
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prices, setPrices] = useState<Record<number, string>>(
    Object.fromEntries(holdings.map((h) => [h.id, String(h.last_price)]))
  );
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<Record<number, "ok" | string>>({});
  const toast = useToast();

  const fetchable = holdings.filter((h) => h.quote_key && h.quote_key.trim());

  const fetchLive = async () => {
    setFetching(true);
    setStatus({});
    try {
      const results = await api.quoteFetch(
        fetchable.map((h) => ({ id: h.id, kind: h.kind, quote_key: h.quote_key as string }))
      );
      const nextPrices = { ...prices };
      const nextStatus: Record<number, "ok" | string> = {};
      let ok = 0;
      for (const r of results) {
        if (r.price != null) {
          nextPrices[r.id] = String(r.price);
          nextStatus[r.id] = "ok";
          ok++;
        } else {
          nextStatus[r.id] = r.error ?? "failed";
        }
      }
      setPrices(nextPrices);
      setStatus(nextStatus);
      toast(
        `Fetched ${ok} of ${results.length}${ok < results.length ? " — check the flagged rows" : ""}`,
        ok === results.length ? undefined : "bad"
      );
    } catch (e) {
      toast(String(e), "bad");
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const today = todayISO();
      await Promise.all(
        holdings
          .filter((h) => {
            const v = parseFloat(prices[h.id]);
            return !isNaN(v) && v !== h.last_price;
          })
          .map((h) => api.holdingSetPrice(h.id, parseFloat(prices[h.id]), today))
      );
      toast("Prices updated");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Update prices" onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-mut text-[13px]">
          Enter today's price (or NAV) for each holding, or fetch live prices for any with a quote
          symbol set. Blank or unchanged rows are left as they are.
        </p>
        {fetchable.length > 0 && (
          <button className="btn-edge shrink-0" onClick={fetchLive} disabled={fetching}>
            <RefreshCcw size={14} className={fetching ? "animate-spin" : ""} />
            {fetching ? "Fetching…" : `Fetch live (${fetchable.length})`}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1 max-h-[420px] overflow-y-auto">
        {holdings.map((h) => {
          const st = status[h.id];
          return (
            <div key={h.id} className="flex items-center gap-3 px-1 py-1.5 border-b border-edge/60">
              <div className="flex-1 min-w-0">
                <span className="font-medium">{h.symbol}</span>
                {h.name && <span className="text-mut text-[12px] ml-2 truncate">{h.name}</span>}
                {st && st !== "ok" && (
                  <span className="block text-bad text-[11px]">{st}</span>
                )}
                {st === "ok" && <span className="block text-ok text-[11px]">live price fetched</span>}
              </div>
              <span className="text-mut text-[12px] w-28 text-right">
                was {fmtMoney(h.last_price, currency)}
              </span>
              <input
                type="number"
                step="any"
                min="0"
                className="ctl !w-32 text-right"
                value={prices[h.id] ?? ""}
                onChange={(e) => setPrices((p) => ({ ...p, [h.id]: e.target.value }))}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save prices"}
        </button>
      </div>
    </Modal>
  );
}
