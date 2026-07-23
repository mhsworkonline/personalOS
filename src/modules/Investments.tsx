import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Account,
  api,
  InvestmentDetail,
  InvestmentInput,
  InvestmentKind,
  InvestmentStatus,
  InvestmentSummary,
  InvestmentTransaction,
  InvestmentTxKind,
  Person,
  RentSchedule,
} from "../api";
import {
  Confirm,
  Empty,
  Field,
  FilterBar,
  Modal,
  PersonBadge,
  personLabel,
  useToast,
} from "../components/ui";
import { dueLabel, fmtDate, fmtMoney, todayISO } from "../lib/format";
import { Banknote, Check, Home, Pencil, Plus, Trash2, Users2 } from "lucide-react";

const KIND_LABEL: Record<InvestmentKind, string> = {
  land: "Land",
  plot: "Plot",
  flat: "Flat",
  house: "House",
  shop: "Shop",
  other: "Other",
};

const STATUS_META: Record<InvestmentStatus, { label: string; cls: string }> = {
  owned: { label: "Owned", cls: "text-mut border-edge" },
  rented: { label: "Rented", cls: "text-ok border-[#1d3d2a]" },
  sold: { label: "Sold", cls: "text-acc2 border-edge" },
};

const TX_LABEL: Record<InvestmentTxKind, string> = {
  purchase: "Purchase",
  expense: "Expense",
  rent_income: "Rent received",
  sale: "Sale",
};

function StatusBadge({ status }: { status: InvestmentStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-px text-[11px] whitespace-nowrap ${m.cls}`}>
      {m.label}
    </span>
  );
}

export default function Investments({
  refreshKey,
  focus,
  currency,
  onChanged,
}: {
  refreshKey: number;
  focus: { module: string; id: number; nonce: number } | null;
  currency: string;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<InvestmentSummary[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<InvestmentSummary | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<InvestmentSummary | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const toast = useToast();

  // Filters (view-only; reset on navigation).
  const [status, setStatus] = useState<InvestmentStatus | "">("");
  const [kind, setKind] = useState<InvestmentKind | "">("");
  const [personId, setPersonId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "value">("name");

  const filtersActive =
    status !== "" || kind !== "" || personId != null || search.trim() !== "" || sort !== "name";
  const clearFilters = () => {
    setStatus("");
    setKind("");
    setPersonId(null);
    setSearch("");
    setSort("name");
  };

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = items.filter((inv) => {
      if (status && inv.status !== status) return false;
      if (kind && inv.kind !== kind) return false;
      if (personId != null && inv.person_id !== personId) return false;
      if (q && !`${inv.name} ${inv.address ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list.sort((a, b) =>
      sort === "value"
        ? b.total_purchase - a.total_purchase
        : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    return list;
  }, [items, status, kind, personId, q, sort]);

  const load = useCallback(() => {
    api.investmentList().then(setItems).catch(() => {});
  }, []);
  useEffect(load, [load, refreshKey]);
  useEffect(() => {
    api.personList().then(setPeople).catch(() => {});
    api.accountList().then(setAccounts).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (focus && focus.module === "investments" && focus.id > 0) {
      setOpenId(focus.id);
    }
  }, [focus]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-4 pb-3 border-b border-edge flex items-center justify-between">
        <h1 className="text-lg font-semibold">Investments</h1>
        <button className="btn-acc" onClick={() => setEditing("new")}>
          <Plus size={15} /> Add property
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[860px]">
          {items.length > 0 && (
            <>
              <FilterBar active={filtersActive} onClear={clearFilters}>
                <select
                  className="ctl !py-1 !w-auto text-[12.5px]"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as InvestmentStatus | "")}
                >
                  <option value="">Any status</option>
                  <option value="owned">Owned</option>
                  <option value="rented">Rented</option>
                  <option value="sold">Sold</option>
                </select>
                <select
                  className="ctl !py-1 !w-auto text-[12.5px]"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as InvestmentKind | "")}
                >
                  <option value="">Any type</option>
                  {Object.entries(KIND_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  className="ctl !py-1 !w-auto text-[12.5px]"
                  value={personId ?? ""}
                  onChange={(e) => setPersonId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Everyone</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {personLabel(p)}
                    </option>
                  ))}
                </select>
                <select
                  className="ctl !py-1 !w-auto text-[12.5px]"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as "name" | "value")}
                >
                  <option value="name">Sort: name</option>
                  <option value="value">Sort: value</option>
                </select>
                <input
                  className="ctl !py-1 !w-44 text-[12.5px]"
                  placeholder="Search name or address…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </FilterBar>
              <div className="text-mut text-[12.5px] mb-2 px-1">
                {shown.length} of {items.length} shown
              </div>
            </>
          )}
          {items.length === 0 && (
            <Empty
              text="No properties yet"
              hint="Track land, plots, flats or houses you own — purchase, rent income and eventual sale."
            />
          )}
          {items.length > 0 && shown.length === 0 && (
            <Empty text="No properties match these filters" hint="Try clearing the filters." />
          )}
          <div className="flex flex-col gap-2">
            {shown.map((inv) => (
              <div
                key={inv.id}
                className="card px-4 py-3 flex items-center gap-3 group cursor-pointer hover:border-acc/40"
                onClick={() => setOpenId(inv.id)}
              >
                <div className="w-8 h-8 rounded-md bg-panel2 flex items-center justify-center shrink-0 text-mut">
                  <Home size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-2">
                    {inv.name}
                    <PersonBadge people={people} personId={inv.person_id} />
                    <StatusBadge status={inv.status} />
                  </div>
                  <div className="text-mut text-[12px] truncate">
                    {KIND_LABEL[inv.kind]}
                    {inv.address ? ` · ${inv.address}` : ""}
                    {inv.rent_schedule && (
                      <>
                        {" "}
                        · {fmtMoney(inv.rent_schedule.monthly_amount, currency)}/mo rent
                        {inv.rent_schedule.tenant_name ? ` from ${inv.rent_schedule.tenant_name}` : ""}
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{fmtMoney(inv.total_purchase, currency)}</div>
                  <div className="text-mut text-[11px]">invested</div>
                </div>
                {inv.status === "sold" && (
                  <div className={`text-right ${inv.gain >= 0 ? "text-ok" : "text-bad"}`}>
                    <div className="font-semibold">{fmtMoney(inv.gain, currency)}</div>
                    <div className="text-[11px]">gain</div>
                  </div>
                )}
                <div
                  className="opacity-0 group-hover:opacity-100 flex gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="btn-ghost !p-1.5" onClick={() => setEditing(inv)}>
                    <Pencil size={14} />
                  </button>
                  <button className="btn-ghost !p-1.5 text-bad" onClick={() => setConfirmDelete(inv)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing && (
        <InvestmentEditor
          investment={editing === "new" ? null : editing}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <DeleteInvestmentModal
          investment={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onDeleted={() => {
            setConfirmDelete(null);
            load();
            onChanged();
            toast("Investment deleted");
          }}
        />
      )}
      {openId != null && (
        <InvestmentDetailModal
          id={openId}
          people={people}
          accounts={accounts}
          currency={currency}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete a property — two steps: show what's affected, then type the name
// to confirm. Deleting is permanent and reverses any Finance balances this
// property's transactions settled into, so it gets extra friction on purpose.
// ---------------------------------------------------------------------------

const COUNT_LABELS: Record<string, (n: number) => string> = {
  transactions: (n) => `${n} transaction${n === 1 ? "" : "s"} (purchase / rent / expense / sale history)`,
  tenancy: () => "The active tenancy on this property",
  emis: (n) => `${n} linked EMI${n === 1 ? "" : "s"} — the loan record itself stays, just unlinked`,
  documents: (n) => `${n} document${n === 1 ? "" : "s"} — the documents stay, just unlinked from this property`,
};

function DeleteInvestmentModal({
  investment,
  onClose,
  onDeleted,
}: {
  investment: InvestmentSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ack, setAck] = useState("");
  const toast = useToast();

  useEffect(() => {
    api.investmentRelatedCounts(investment.id).then(setCounts).catch(() => {});
  }, [investment.id]);

  const lines = Object.entries(counts).filter(([, n]) => n > 0);

  if (step === 1) {
    return (
      <Modal title={`Delete "${investment.name}"?`} onClose={onClose}>
        <p className="text-mut text-[13px] mb-2">
          This permanently removes the property and everything recorded against it:
        </p>
        {lines.length === 0 ? (
          <p className="text-mut text-[13px] mb-3">No transactions, tenancy or linked records yet.</p>
        ) : (
          <ul className="text-[13px] mb-3 list-disc pl-5 flex flex-col gap-1">
            {lines.map(([key, n]) => (
              <li key={key}>{COUNT_LABELS[key]?.(n) ?? `${key}: ${n}`}</li>
            ))}
          </ul>
        )}
        <p className="text-warn text-[12.5px] mb-3">
          Any Finance account balance this property's transactions settled into is reversed. This
          cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button className="btn-edge" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-danger" onClick={() => setStep(2)}>
            Continue
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Confirm deletion" onClose={onClose}>
      <p className="text-[12.5px] leading-relaxed mb-3 text-warn">
        Type the property name to confirm. This cannot be undone.
      </p>
      <Field label={`Type "${investment.name}" to confirm`}>
        <input className="ctl" value={ack} autoFocus onChange={(e) => setAck(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-danger"
          disabled={ack.trim().toLowerCase() !== investment.name.trim().toLowerCase()}
          onClick={async () => {
            try {
              await api.investmentDelete(investment.id);
              onDeleted();
            } catch (e) {
              toast(String(e), "bad");
            }
          }}
        >
          Delete forever
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Add / edit a property
// ---------------------------------------------------------------------------

function InvestmentEditor({
  investment,
  people,
  onClose,
  onSaved,
}: {
  investment: InvestmentSummary | null;
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(investment?.name ?? "");
  const [kind, setKind] = useState<InvestmentKind>(investment?.kind ?? "flat");
  const [address, setAddress] = useState(investment?.address ?? "");
  const [notes, setNotes] = useState(investment?.notes ?? "");
  const [personId, setPersonId] = useState<number | null>(investment?.person_id ?? null);
  const toast = useToast();

  const save = async () => {
    try {
      const input: InvestmentInput = {
        id: investment?.id ?? null,
        person_id: personId,
        name: name.trim(),
        kind,
        address: address.trim() || null,
        notes: notes.trim() || null,
      };
      await api.investmentSave(input);
      toast("Investment saved");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title={investment ? `Edit ${investment.name}` : "Add property"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Name">
          <input
            className="ctl"
            value={name}
            autoFocus
            placeholder="Plot 14, Sector 9"
            onChange={(e) => setName(e.target.value)}
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
        <Field label="Type">
          <select className="ctl" value={kind} onChange={(e) => setKind(e.target.value as InvestmentKind)}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Address / location (optional)">
          <input className="ctl" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!name.trim()}>
          Save
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Property detail: transactions + rent schedule
// ---------------------------------------------------------------------------

function InvestmentDetailModal({
  id,
  people,
  accounts,
  currency,
  onClose,
  onChanged,
}: {
  id: number;
  people: Person[];
  accounts: Account[];
  currency: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<InvestmentDetail | null>(null);
  const [addingTx, setAddingTx] = useState(false);
  const [editingTx, setEditingTx] = useState<InvestmentTransaction | null>(null);
  const [rentEditing, setRentEditing] = useState(false);
  const [confirmDeleteTx, setConfirmDeleteTx] = useState<InvestmentTransaction | null>(null);
  const [confirmEndTenancy, setConfirmEndTenancy] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    api.investmentDetail(id).then(setDetail).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  const accountName = (accountId: number | null) =>
    accountId == null ? null : accounts.find((a) => a.id === accountId)?.name;

  if (!detail) return null;
  const { summary, transactions, emis } = detail;
  const rent = summary.rent_schedule;

  return (
    <Modal title={summary.name} onClose={onClose} wide>
      <div className="flex items-center gap-2 mb-3">
        <StatusBadge status={summary.status} />
        <span className="text-mut text-[12px]">
          {KIND_LABEL[summary.kind]}
          {summary.address ? ` · ${summary.address}` : ""}
        </span>
        <PersonBadge people={people} personId={summary.person_id} showDefault />
      </div>

      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="card p-3">
          <div className="text-mut text-[11px] mb-0.5">Invested</div>
          <div className="font-semibold">{fmtMoney(summary.total_purchase + summary.total_expense, currency)}</div>
        </div>
        <div className="card p-3">
          <div className="text-mut text-[11px] mb-0.5">Rent income</div>
          <div className="font-semibold text-ok">{fmtMoney(summary.total_rent_income, currency)}</div>
        </div>
        <div className="card p-3">
          <div className="text-mut text-[11px] mb-0.5">Sale proceeds</div>
          <div className="font-semibold">{summary.total_sale ? fmtMoney(summary.total_sale, currency) : "—"}</div>
        </div>
        <div className="card p-3">
          <div className="text-mut text-[11px] mb-0.5">Gain / loss</div>
          <div className={`font-semibold ${summary.gain >= 0 ? "text-ok" : "text-bad"}`}>
            {fmtMoney(summary.gain, currency)}
          </div>
        </div>
      </div>

      {/* Rent / tenancy */}
      <div className="card p-3 mb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[12px] uppercase tracking-wide text-mut font-semibold flex items-center gap-1.5">
            <Users2 size={13} /> Tenancy
          </div>
          {!rent && (
            <button className="btn-edge !py-1 text-[12px]" onClick={() => setRentEditing(true)}>
              <Plus size={13} /> Add tenant
            </button>
          )}
        </div>
        {rent ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0 text-[13px]">
              <span className="font-medium">{rent.tenant_name || "Tenant"}</span>
              <span className="text-mut">
                {" "}
                · {fmtMoney(rent.monthly_amount, currency)}/mo · next due {fmtDate(rent.next_due)} ·{" "}
              </span>
              <span className={`text-[12px] ${dueLabel(rent.next_due).tone === "bad" ? "text-bad" : "text-mut"}`}>
                {dueLabel(rent.next_due).text}
              </span>
              {accountName(rent.settle_account_id) && (
                <span className="text-mut text-[12px]"> · into {accountName(rent.settle_account_id)}</span>
              )}
            </div>
            <button
              className="btn-edge !py-1 text-[12px]"
              onClick={async () => {
                await api.rentScheduleMarkPaid(rent.id);
                toast("Rent recorded");
                load();
                onChanged();
              }}
            >
              <Check size={13} /> Rent received
            </button>
            <button className="btn-ghost !p-1.5" onClick={() => setRentEditing(true)}>
              <Pencil size={14} />
            </button>
            <button className="btn-ghost !p-1.5 text-bad" onClick={() => setConfirmEndTenancy(true)}>
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <div className="text-mut text-[12.5px]">Not currently rented.</div>
        )}
      </div>

      {/* Loan (EMI) */}
      {emis.length > 0 && (
        <div className="card p-3 mb-4">
          <div className="text-[12px] uppercase tracking-wide text-mut font-semibold flex items-center gap-1.5 mb-1">
            <Banknote size={13} /> Loan
          </div>
          {emis.map((e) => {
            const remaining = e.total_months - e.months_paid;
            return (
              <div key={e.id} className="flex items-center gap-3 py-1">
                <div className="flex-1 min-w-0 text-[13px]">
                  <span className="font-medium">{e.name}</span>
                  <span className="text-mut">
                    {" "}
                    · {fmtMoney(e.monthly_amount, currency)}/mo
                    {e.lender ? ` · ${e.lender}` : ""} · {e.months_paid}/{e.total_months} paid
                  </span>
                  {e.active && (
                    <span className={`text-[12px] ${dueLabel(e.next_due).tone === "bad" ? "text-bad" : "text-mut"}`}>
                      {" "}
                      · due {fmtDate(e.next_due)} ({dueLabel(e.next_due).text})
                    </span>
                  )}
                  {!e.active && <span className="text-ok text-[12px]"> · completed</span>}
                </div>
                {e.active && (
                  <button
                    className="btn-edge !py-1 text-[12px]"
                    onClick={async () => {
                      const updated = await api.emiMarkPaid(e.id);
                      toast(updated.active ? "EMI marked paid" : "EMI completed 🎉");
                      load();
                      onChanged();
                    }}
                  >
                    <Check size={13} /> Paid
                  </button>
                )}
                {e.active && remaining > 0 && (
                  <span className="text-mut text-[11px]">{remaining} left</span>
                )}
              </div>
            );
          })}
          <div className="text-mut text-[11px] mt-1">
            Edit lender, total months and more under Finance → EMIs.
          </div>
        </div>
      )}

      {/* Transactions */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] uppercase tracking-wide text-mut font-semibold">History</div>
        <button className="btn-edge !py-1 text-[12px]" onClick={() => setAddingTx(true)}>
          <Plus size={13} /> Add transaction
        </button>
      </div>
      {transactions.length === 0 ? (
        <Empty text="No transactions recorded yet" hint="Start with a purchase entry." />
      ) : (
        <div className="card divide-y divide-edge mb-1">
          {transactions.map((t) => (
            <div key={t.id} className="px-3 py-2 flex items-center gap-3 group">
              <div className="w-20 shrink-0 text-mut text-[12px]">{fmtDate(t.date)}</div>
              <div className="flex-1 min-w-0">
                <div className="truncate">{TX_LABEL[t.kind]}</div>
                {(t.counterparty || t.notes || accountName(t.settle_account_id)) && (
                  <div className="text-mut text-[12px] truncate">
                    {[t.counterparty, t.notes, accountName(t.settle_account_id) && `via ${accountName(t.settle_account_id)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </div>
              <div
                className={`font-medium ${
                  t.kind === "expense" ? "text-bad" : t.kind === "rent_income" || t.kind === "sale" ? "text-ok" : ""
                }`}
              >
                {fmtMoney(t.amount, currency)}
              </div>
              <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                <button className="btn-ghost !p-1" onClick={() => setEditingTx(t)}>
                  <Pencil size={13} />
                </button>
                <button className="btn-ghost !p-1 text-bad" onClick={() => setConfirmDeleteTx(t)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(addingTx || editingTx) && (
        <TransactionAddModal
          transaction={editingTx}
          investmentId={id}
          accounts={accounts}
          onClose={() => {
            setAddingTx(false);
            setEditingTx(null);
          }}
          onSaved={() => {
            setAddingTx(false);
            setEditingTx(null);
            load();
            onChanged();
          }}
        />
      )}
      {rentEditing && (
        <RentEditor
          investmentId={id}
          rent={rent}
          accounts={accounts}
          onClose={() => setRentEditing(false)}
          onSaved={() => {
            setRentEditing(false);
            load();
            onChanged();
          }}
        />
      )}
      {confirmDeleteTx && (
        <Confirm
          message="Delete this transaction?"
          onClose={() => setConfirmDeleteTx(null)}
          onConfirm={async () => {
            await api.investmentTransactionDelete(confirmDeleteTx.id);
            load();
            onChanged();
          }}
        />
      )}
      {confirmEndTenancy && rent && (
        <Confirm
          message="End this tenancy?"
          detail="Past rent payments already recorded stay in the history. This only stops future reminders."
          onClose={() => setConfirmEndTenancy(false)}
          onConfirm={async () => {
            await api.rentScheduleDelete(rent.id);
            load();
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

function TransactionAddModal({
  transaction,
  investmentId,
  accounts,
  onClose,
  onSaved,
}: {
  transaction?: InvestmentTransaction | null;
  investmentId: number;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<InvestmentTxKind>(transaction?.kind ?? "purchase");
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const [counterparty, setCounterparty] = useState(transaction?.counterparty ?? "");
  const [notes, setNotes] = useState(transaction?.notes ?? "");
  const [settleAccountId, setSettleAccountId] = useState<number | null>(transaction?.settle_account_id ?? null);
  const toast = useToast();

  const save = async () => {
    try {
      await api.investmentTransactionSave({
        id: transaction?.id ?? null,
        investment_id: investmentId,
        kind,
        amount: parseFloat(amount),
        date,
        counterparty: counterparty.trim() || null,
        notes: notes.trim() || null,
        settle_account_id: settleAccountId,
      });
      toast(transaction ? "Transaction updated" : "Transaction added");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const counterpartyLabel =
    kind === "purchase" ? "Seller (optional)" : kind === "sale" ? "Buyer (optional)" : "Counterparty (optional)";

  return (
    <Modal title={transaction ? "Edit transaction" : "Add transaction"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Type">
          <select className="ctl" value={kind} onChange={(e) => setKind(e.target.value as InvestmentTxKind)}>
            {Object.entries(TX_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <input
            type="number"
            step="0.01"
            min="0"
            className="ctl"
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Date">
          <input type="date" className="ctl" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={counterpartyLabel}>
          <input className="ctl" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Field label="Settle via account (optional)">
        <select
          className="ctl"
          value={settleAccountId ?? ""}
          onChange={(e) => setSettleAccountId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Don't track against an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      {settleAccountId != null && (
        <div className="text-mut text-[12px] mb-3">
          {kind === "purchase" || kind === "expense"
            ? "This amount will be deducted from the selected account's balance."
            : "This amount will be added to the selected account's balance."}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!(parseFloat(amount) > 0)}>
          {transaction ? "Save" : "Add"}
        </button>
      </div>
    </Modal>
  );
}

function RentEditor({
  investmentId,
  rent,
  accounts,
  onClose,
  onSaved,
}: {
  investmentId: number;
  rent: RentSchedule | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tenantName, setTenantName] = useState(rent?.tenant_name ?? "");
  const [monthlyAmount, setMonthlyAmount] = useState(String(rent?.monthly_amount ?? ""));
  const [nextDue, setNextDue] = useState(rent?.next_due ?? todayISO());
  const [notes, setNotes] = useState(rent?.notes ?? "");
  const [settleAccountId, setSettleAccountId] = useState<number | null>(rent?.settle_account_id ?? null);
  const toast = useToast();

  const save = async () => {
    try {
      await api.rentScheduleSave({
        id: rent?.id ?? null,
        investment_id: investmentId,
        monthly_amount: parseFloat(monthlyAmount || "0"),
        next_due: nextDue,
        tenant_name: tenantName.trim() || null,
        notes: notes.trim() || null,
        settle_account_id: settleAccountId,
      });
      toast("Tenancy saved");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title={rent ? "Edit tenancy" : "Add tenant"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Tenant name (optional)">
          <input className="ctl" value={tenantName} autoFocus onChange={(e) => setTenantName(e.target.value)} />
        </Field>
        <Field label="Monthly rent">
          <input
            type="number"
            step="0.01"
            className="ctl"
            value={monthlyAmount}
            onChange={(e) => setMonthlyAmount(e.target.value)}
          />
        </Field>
        <Field label="Next due date">
          <input type="date" className="ctl" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Field label="Settle rent into account (optional)">
        <select
          className="ctl"
          value={settleAccountId ?? ""}
          onChange={(e) => setSettleAccountId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Don't track against an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="text-mut text-[12px] mb-3">
        Marking rent as received records it in the property's history, rolls the due date forward a
        month, and — if an account is selected above — adds the rent to that account's balance.
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!(parseFloat(monthlyAmount) > 0) || !nextDue}>
          Save
        </button>
      </div>
    </Modal>
  );
}
