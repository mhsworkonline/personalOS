import { useCallback, useEffect, useState } from "react";
import {
  Account,
  AccountDetails,
  AccountKind,
  api,
  BankCard,
  Cycle,
  Emi,
  FinanceOverview,
  InvestmentSummary,
  Person,
  Subscription,
  Transaction,
  TransactionCategory,
} from "../api";
import {
  Confirm,
  Empty,
  Field,
  MasterGate,
  Modal,
  PersonBadge,
  personLabel,
  Tone,
  useToast,
} from "../components/ui";
import { dueLabel, fmtDate, fmtMoney, todayISO } from "../lib/format";
import { ArrowLeftRight, Check, ListTree, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";

type Tab = "overview" | "accounts" | "transactions" | "subscriptions" | "emis";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "accounts", label: "Accounts" },
  { id: "transactions", label: "Transactions" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "emis", label: "EMIs" },
];

const KIND_LABEL: Record<AccountKind, string> = {
  bank: "Bank",
  cash: "Cash",
  credit_card: "Credit card",
  investment: "Investment",
};

export default function Finance({
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
  const [tab, setTab] = useState<Tab>("overview");
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    api.personList().then(setPeople).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (!focus) return;
    if (focus.module === "subscriptions") setTab("subscriptions");
    else if (focus.module === "emis") setTab("emis");
    else if (focus.module === "accounts") setTab("accounts");
    else if (focus.module === "transactions") setTab("transactions");
  }, [focus]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-4 pb-0 border-b border-edge">
        <h1 className="text-lg font-semibold mb-2.5">Finance</h1>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`px-3 py-1.5 text-[13px] rounded-t-md border-b-2 ${
                tab === t.id
                  ? "border-acc text-ink"
                  : "border-transparent text-mut hover:text-ink"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "overview" && <Overview refreshKey={refreshKey} currency={currency} />}
        {tab === "accounts" && (
          <Accounts refreshKey={refreshKey} people={people} currency={currency} onChanged={onChanged} />
        )}
        {tab === "transactions" && (
          <Transactions refreshKey={refreshKey} currency={currency} onChanged={onChanged} />
        )}
        {tab === "subscriptions" && (
          <Subscriptions refreshKey={refreshKey} people={people} currency={currency} onChanged={onChanged} />
        )}
        {tab === "emis" && <Emis refreshKey={refreshKey} currency={currency} onChanged={onChanged} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview({ refreshKey, currency }: { refreshKey: number; currency: string }) {
  const [data, setData] = useState<FinanceOverview | null>(null);
  useEffect(() => {
    api.financeOverview().then(setData).catch(() => {});
  }, [refreshKey]);

  if (!data) return null;
  const cashOnHand = data.by_kind.find((k) => k.kind === "cash")?.total ?? 0;

  return (
    <div className="max-w-[860px]">
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="card p-4">
          <div className="text-mut text-[12px] mb-1">Net worth</div>
          <div className={`text-2xl font-semibold ${data.net_worth < 0 ? "text-bad" : ""}`}>
            {fmtMoney(data.net_worth, currency)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-mut text-[12px] mb-1">Assets</div>
          <div className="text-2xl font-semibold text-ok">{fmtMoney(data.assets, currency)}</div>
        </div>
        <div className="card p-4">
          <div className="text-mut text-[12px] mb-1">Liabilities</div>
          <div className="text-2xl font-semibold text-bad">{fmtMoney(data.liabilities, currency)}</div>
        </div>
        <div className="card p-4">
          <div className="text-mut text-[12px] mb-1">Cash on hand</div>
          <div className="text-2xl font-semibold">{fmtMoney(cashOnHand, currency)}</div>
          {!data.by_kind.some((k) => k.kind === "cash") && (
            <div className="text-mut text-[11px] mt-1">Add a Cash account under Accounts to track this.</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-[13px] uppercase tracking-wide text-mut font-semibold mb-3">
            By account type
          </div>
          {data.by_kind.length === 0 && <Empty text="No accounts yet" hint="Add them under the Accounts tab." />}
          {data.by_kind.map((k) => (
            <div key={k.kind} className="flex justify-between py-1.5 border-b border-edge last:border-0">
              <span>
                {KIND_LABEL[k.kind]} <span className="text-mut text-[12px]">×{k.count}</span>
              </span>
              <span className={k.kind === "credit_card" ? "text-bad" : ""}>
                {fmtMoney(k.total, currency)}
              </span>
            </div>
          ))}
        </div>
        <div className="card p-4">
          <div className="text-[13px] uppercase tracking-wide text-mut font-semibold mb-3">
            Recurring outflow
          </div>
          <div className="flex justify-between py-1.5 border-b border-edge">
            <span>
              Subscriptions <span className="text-mut text-[12px]">×{data.active_subscriptions}</span>
            </span>
            <span>{fmtMoney(data.monthly_subscriptions, currency)}/mo</span>
          </div>
          <div className="flex justify-between py-1.5">
            <span>
              EMIs <span className="text-mut text-[12px]">×{data.active_emis}</span>
            </span>
            <span>{fmtMoney(data.monthly_emi, currency)}/mo</span>
          </div>
          <div className="flex justify-between pt-3 mt-1 border-t border-edge font-semibold">
            <span>Total monthly</span>
            <span>{fmtMoney(data.monthly_subscriptions + data.monthly_emi, currency)}/mo</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

function Accounts({
  refreshKey,
  people,
  currency,
  onChanged,
}: {
  refreshKey: number;
  people: Person[];
  currency: string;
  onChanged: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    api.accountList().then(setAccounts).catch(() => {});
  }, []);
  useEffect(load, [load, refreshKey]);

  return (
    <div className="max-w-[760px]">
      <div className="flex justify-end mb-3">
        <button className="btn-acc" onClick={() => setEditing("new")}>
          <Plus size={15} /> Add account
        </button>
      </div>
      {accounts.length === 0 && (
        <Empty text="No accounts yet" hint="Track bank accounts, cash, credit cards and investments." />
      )}
      <div className="flex flex-col gap-2">
        {accounts.map((a) => (
          <div
            key={a.id}
            className="card px-4 py-3 flex items-center gap-3 group cursor-pointer hover:border-acc/40"
            onClick={() => setOpenId(a.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate flex items-center gap-2">
                {a.name}
                <PersonBadge people={people} personId={a.person_id} />
              </div>
              <div className="text-mut text-[12px] truncate">
                {KIND_LABEL[a.kind]}
                {a.details.bank_name ? ` · ${a.details.bank_name}` : ""}
                {a.notes ? ` · ${a.notes}` : ""}
              </div>
            </div>
            {(a.details.cards?.length ?? 0) > 0 && (
              <span className="text-mut text-[11.5px]">
                {a.details.cards!.length} card{a.details.cards!.length === 1 ? "" : "s"}
              </span>
            )}
            <div className={`font-semibold ${a.kind === "credit_card" ? "text-bad" : ""}`}>
              {fmtMoney(a.balance, currency)}
              {a.kind === "credit_card" && <span className="text-[11px] text-mut ml-1">owed</span>}
            </div>
            <div className="opacity-0 group-hover:opacity-100 flex gap-1" onClick={(e) => e.stopPropagation()}>
              <button className="btn-ghost !p-1.5" onClick={() => setEditing(a)}>
                <Pencil size={14} />
              </button>
              <button className="btn-ghost !p-1.5 text-bad" onClick={() => setConfirmDelete(a)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <AccountEditor
          account={editing === "new" ? null : editing}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {openId != null && (
        <AccountDetailModal
          accountId={openId}
          accounts={accounts}
          currency={currency}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <DeleteAccountModal
          account={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onDeleted={() => {
            setConfirmDelete(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete an account — two steps: show what's affected, then type the name
// to confirm. Deleting removes the account's own transactions; anything
// settled via it from Investments (rent/EMI/property expenses) just loses
// the "via account" link, its own history stays.
// ---------------------------------------------------------------------------

const ACCOUNT_COUNT_LABELS: Record<string, (n: number) => string> = {
  transactions: (n) => `${n} transaction${n === 1 ? "" : "s"} recorded against this account — deleted`,
  investment_transactions: (n) =>
    `${n} property transaction${n === 1 ? "" : "s"} settled via this account — history stays, just unlinked`,
  rent_schedules: (n) => `${n} tenancy settlement${n === 1 ? "" : "s"} — stays, just unlinked`,
  emis: (n) => `${n} EMI${n === 1 ? "" : "s"} settled via this account — stays, just unlinked`,
};

function DeleteAccountModal({
  account,
  onClose,
  onDeleted,
}: {
  account: Account;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ack, setAck] = useState("");
  const toast = useToast();

  useEffect(() => {
    api.accountRelatedCounts(account.id).then(setCounts).catch(() => {});
  }, [account.id]);

  const lines = Object.entries(counts).filter(([, n]) => n > 0);

  if (step === 1) {
    return (
      <Modal title={`Delete "${account.name}"?`} onClose={onClose}>
        <p className="text-mut text-[13px] mb-2">This permanently removes the account. It affects:</p>
        {lines.length === 0 ? (
          <p className="text-mut text-[13px] mb-3">No transactions or linked records yet.</p>
        ) : (
          <ul className="text-[13px] mb-3 list-disc pl-5 flex flex-col gap-1">
            {lines.map(([key, n]) => (
              <li key={key}>{ACCOUNT_COUNT_LABELS[key]?.(n) ?? `${key}: ${n}`}</li>
            ))}
          </ul>
        )}
        <p className="text-warn text-[12.5px] mb-3">This cannot be undone.</p>
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
        Type the account name to confirm. This cannot be undone.
      </p>
      <Field label={`Type "${account.name}" to confirm`}>
        <input className="ctl" value={ack} autoFocus onChange={(e) => setAck(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-danger"
          disabled={ack.trim().toLowerCase() !== account.name.trim().toLowerCase()}
          onClick={async () => {
            try {
              await api.accountDelete(account.id);
              toast("Account deleted");
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

function AccountDetailModal({
  accountId,
  accounts,
  currency,
  onClose,
  onChanged,
}: {
  accountId: number;
  accounts: Account[];
  currency: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const account = accounts.find((a) => a.id === accountId);
  // The current account first, so "Add transaction" defaults to it.
  const orderedAccounts = account ? [account, ...accounts.filter((a) => a.id !== account.id)] : accounts;
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [adding, setAdding] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Transaction | null>(null);

  const loadCategories = useCallback(() => {
    api.categoryList().then(setCategories).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api.transactionList(accountId, 500).then(setTxs).catch(() => {});
    loadCategories();
  }, [accountId, loadCategories]);
  useEffect(load, [load]);

  if (!account) return null;

  return (
    <Modal title={account.name} onClose={onClose} wide>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-mut text-[12px]">{KIND_LABEL[account.kind]}</span>
        {account.details.bank_name && <span className="text-mut text-[12px]">· {account.details.bank_name}</span>}
        {account.notes && <span className="text-mut text-[12px]">· {account.notes}</span>}
      </div>
      <div className="card p-3 mb-4">
        <div className="text-mut text-[11px] mb-0.5">
          {account.kind === "credit_card" ? "Amount owed" : "Balance"}
        </div>
        <div className={`text-2xl font-semibold ${account.kind === "credit_card" ? "text-bad" : ""}`}>
          {fmtMoney(account.balance, currency)}
        </div>
        <div className="text-mut text-[11px] mt-0.5">
          Opened with {fmtMoney(account.opening_balance, currency)}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] uppercase tracking-wide text-mut font-semibold">Transaction history</div>
        <div className="flex gap-1.5">
          <button
            className="btn-edge !py-1 text-[12px]"
            onClick={() => setTransferring(true)}
            disabled={orderedAccounts.length < 2}
            title="Move money to or from another account (e.g. a cash withdrawal)"
          >
            <ArrowLeftRight size={13} /> Transfer
          </button>
          <button className="btn-edge !py-1 text-[12px]" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add transaction
          </button>
        </div>
      </div>
      {txs.length === 0 ? (
        <Empty text="No transactions yet" />
      ) : (
        <div className="card divide-y divide-edge mb-1">
          {txs.map((t) => (
            <div key={t.id} className="px-3 py-2 flex items-center gap-3 group">
              <div className="w-20 shrink-0 text-mut text-[12px]">{fmtDate(t.date)}</div>
              <div className="flex-1 min-w-0">
                <div className="truncate">{t.description || t.category || t.kind}</div>
                {t.category && <div className="text-mut text-[12px] truncate">{t.category}</div>}
              </div>
              <div
                className={`font-medium ${
                  t.kind === "expense" || t.kind === "transfer_out"
                    ? "text-bad"
                    : t.kind === "income"
                      ? "text-ok"
                      : "text-mut"
                }`}
              >
                {t.kind === "expense" || t.kind === "transfer_out" ? "−" : "+"}
                {fmtMoney(t.amount, currency)}
              </div>
              <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                {!t.transfer_peer_id && (
                  <button className="btn-ghost !p-1" onClick={() => setEditingTx(t)}>
                    <Pencil size={13} />
                  </button>
                )}
                <button className="btn-ghost !p-1 text-bad" onClick={() => setConfirmDelete(t)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editingTx) && (
        <TransactionEditor
          transaction={editingTx}
          accounts={orderedAccounts}
          categories={categories}
          onAddCategory={loadCategories}
          onClose={() => {
            setAdding(false);
            setEditingTx(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditingTx(null);
            load();
            onChanged();
          }}
        />
      )}
      {transferring && (
        <TransferEditor
          accounts={orderedAccounts}
          onClose={() => setTransferring(false)}
          onSaved={() => {
            setTransferring(false);
            load();
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          message="Delete this transaction?"
          detail={
            confirmDelete.transfer_peer_id
              ? "This is one leg of a transfer — both sides are removed together and both balances adjust back."
              : "The account balance is adjusted back."
          }
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await api.transactionDelete(confirmDelete.id);
            load();
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11.5px] uppercase tracking-wide text-mut font-semibold mt-3 mb-2 border-t border-edge pt-3">
      {children}
    </div>
  );
}

/** Secret input: masked until the master password has been confirmed.
 *  Defined at module scope so React preserves the input across re-renders. */
function Secret({
  label,
  value,
  revealed,
  onChange,
}: {
  label: string;
  value: string;
  revealed: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type={revealed ? "text" : "password"}
        className="ctl font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function AccountEditor({
  account,
  people,
  onClose,
  onSaved,
}: {
  account: Account | null;
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "bank");
  const [openingBalance, setOpeningBalance] = useState(
    String(account?.opening_balance ?? account?.balance ?? "")
  );
  const [notes, setNotes] = useState(account?.notes ?? "");
  const [personId, setPersonId] = useState<number | null>(account?.person_id ?? null);
  const [details, setDetails] = useState<AccountDetails>(account?.details ?? {});
  const [revealed, setRevealed] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const toast = useToast();

  const d = (k: keyof AccountDetails) => (details[k] as string | undefined) ?? "";
  const setD = (k: keyof AccountDetails, v: string) =>
    setDetails((x) => ({ ...x, [k]: v || undefined }));
  const nb = (k: string) => (details.netbanking as Record<string, string> | undefined)?.[k] ?? "";
  const setNb = (k: string, v: string) =>
    setDetails((x) => ({ ...x, netbanking: { ...x.netbanking, [k]: v || undefined } }));
  const mb = (k: string) => (details.mobile as Record<string, string> | undefined)?.[k] ?? "";
  const setMb = (k: string, v: string) =>
    setDetails((x) => ({ ...x, mobile: { ...x.mobile, [k]: v || undefined } }));
  const cards = details.cards ?? [];
  const setCard = (i: number, k: keyof BankCard, v: string) =>
    setDetails((x) => {
      const next = [...(x.cards ?? [])];
      next[i] = { ...next[i], [k]: v };
      return { ...x, cards: next };
    });

  const hasSecrets =
    !!nb("password") || !!mb("mpin") || !!mb("app_pin") || !!d("account_number") || !!d("cif");

  const save = async () => {
    try {
      const cleanCards = cards.filter((c) => c.nickname?.trim() || c.last4?.trim());
      await api.accountSave({
        id: account?.id ?? null,
        name,
        kind,
        opening_balance: parseFloat(openingBalance || "0"),
        notes: notes || null,
        person_id: personId,
        details: { ...details, cards: cleanCards.length ? cleanCards : undefined },
      });
      toast("Account saved");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const isBank = kind === "bank";
  const showCards = kind === "bank" || kind === "credit_card";

  return (
    <Modal title={account ? `Edit ${account.name}` : "Add account"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Account name">
          <input className="ctl" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
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
          <select className="ctl" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={kind === "credit_card" ? "Opening amount owed" : "Opening balance"}>
          <input
            type="number"
            step="0.01"
            className="ctl"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
          />
        </Field>
      </div>
      <div className="text-mut text-[12px] -mt-2 mb-2">
        {account
          ? "Adjusts the current balance by the same amount — no transaction is created."
          : "The balance before you started tracking here. Every transaction after this adjusts it automatically."}
      </div>
      <Field label="Notes (optional)">
        <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {isBank && (
        <>
          {hasSecrets && !revealed && (
            <button className="btn-edge w-full mb-1" onClick={() => setGateOpen(true)}>
              <ShieldCheck size={14} /> Reveal saved credentials (master password required)
            </button>
          )}

          <SectionTitle>Bank details</SectionTitle>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Bank name">
              <input className="ctl" value={d("bank_name")} onChange={(e) => setD("bank_name", e.target.value)} />
            </Field>
            <Field label="Branch">
              <input className="ctl" value={d("branch")} onChange={(e) => setD("branch", e.target.value)} />
            </Field>
            <Secret label="Account number" revealed={revealed} value={d("account_number")} onChange={(v) => setD("account_number", v)} />
            <Field label="IFSC">
              <input className="ctl font-mono" value={d("ifsc")} onChange={(e) => setD("ifsc", e.target.value)} />
            </Field>
            <Secret label="CIF / Customer ID" revealed={revealed} value={d("cif")} onChange={(v) => setD("cif", v)} />
            <Field label="Registered mobile">
              <input className="ctl" value={d("registered_mobile")} onChange={(e) => setD("registered_mobile", e.target.value)} />
            </Field>
            <Field label="Nominee">
              <input className="ctl" value={d("nominee")} onChange={(e) => setD("nominee", e.target.value)} />
            </Field>
          </div>

          <SectionTitle>Internet banking</SectionTitle>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Login ID">
              <input className="ctl" value={nb("login_id")} onChange={(e) => setNb("login_id", e.target.value)} />
            </Field>
            <Field label="Username">
              <input className="ctl" value={nb("username")} onChange={(e) => setNb("username", e.target.value)} />
            </Field>
            <Secret label="Password" revealed={revealed} value={nb("password")} onChange={(v) => setNb("password", v)} />
            <Field label="User alias">
              <input className="ctl" value={nb("alias")} onChange={(e) => setNb("alias", e.target.value)} />
            </Field>
          </div>
          <Field label="Security notes">
            <input className="ctl" value={nb("security_notes")} onChange={(e) => setNb("security_notes", e.target.value)} />
          </Field>

          <SectionTitle>Mobile banking &amp; UPI</SectionTitle>
          <div className="grid grid-cols-2 gap-x-3">
            <Secret label="MPIN" revealed={revealed} value={mb("mpin")} onChange={(v) => setMb("mpin", v)} />
            <Secret label="Mobile app PIN" revealed={revealed} value={mb("app_pin")} onChange={(v) => setMb("app_pin", v)} />
            <Field label="UPI ID">
              <input className="ctl" value={mb("upi_id")} onChange={(e) => setMb("upi_id", e.target.value)} />
            </Field>
            <Field label="UPI PIN hint (never the PIN itself)">
              <input className="ctl" value={mb("upi_pin_hint")} onChange={(e) => setMb("upi_pin_hint", e.target.value)} />
            </Field>
          </div>
          <div className="text-[11.5px] text-warn mb-2">
            ATM PINs, CVVs, UPI PINs and OTPs are never stored — entries containing them are rejected.
          </div>
        </>
      )}

      {showCards && (
        <>
          <SectionTitle>Cards</SectionTitle>
          {cards.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_80px_80px_1fr_auto] gap-2 mb-2 items-center">
              <select className="ctl !py-1" value={c.card_type ?? "debit"} onChange={(e) => setCard(i, "card_type", e.target.value)}>
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
                <option value="prepaid">Prepaid</option>
                <option value="other">Other</option>
              </select>
              <input className="ctl !py-1" placeholder="Nickname" value={c.nickname ?? ""} onChange={(e) => setCard(i, "nickname", e.target.value)} />
              <input className="ctl !py-1 font-mono" placeholder="Last 4" maxLength={4} value={c.last4 ?? ""} onChange={(e) => setCard(i, "last4", e.target.value.replace(/\D/g, ""))} />
              <input className="ctl !py-1 font-mono" placeholder="MM/YY" maxLength={5} value={c.expiry ?? ""} onChange={(e) => setCard(i, "expiry", e.target.value)} />
              <input className="ctl !py-1" placeholder="Notes" value={c.notes ?? ""} onChange={(e) => setCard(i, "notes", e.target.value)} />
              <button
                className="btn-ghost !p-1 text-bad"
                onClick={() => setDetails((x) => ({ ...x, cards: (x.cards ?? []).filter((_, j) => j !== i) }))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            className="btn-edge !py-1 text-[12px] mb-2"
            onClick={() =>
              setDetails((x) => ({
                ...x,
                cards: [...(x.cards ?? []), { card_type: "debit", nickname: "", last4: "", expiry: "", notes: "" }],
              }))
            }
          >
            <Plus size={13} /> Add card
          </button>
        </>
      )}

      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!name.trim()}>
          Save
        </button>
      </div>

      {gateOpen && <MasterGate onClose={() => setGateOpen(false)} onVerified={() => setRevealed(true)} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

function Transactions({
  refreshKey,
  currency,
  onChanged,
}: {
  refreshKey: number;
  currency: string;
  onChanged: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [managingCategories, setManagingCategories] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Transaction | null>(null);

  const loadCategories = useCallback(() => {
    api.categoryList().then(setCategories).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api.accountList().then(setAccounts).catch(() => {});
    api.transactionList(filter, 200).then(setTxs).catch(() => {});
    loadCategories();
  }, [filter, loadCategories]);
  useEffect(load, [load, refreshKey]);

  return (
    <div className="max-w-[760px]">
      <div className="flex items-center gap-2 mb-3">
        <select
          className="ctl !w-56"
          value={filter ?? ""}
          onChange={(e) => setFilter(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button className="btn-edge !p-1.5" title="Manage categories" onClick={() => setManagingCategories(true)}>
          <ListTree size={15} />
        </button>
        <button className="btn-edge" onClick={() => setTransferring(true)} disabled={accounts.length < 2}>
          <ArrowLeftRight size={15} /> Transfer
        </button>
        <button className="btn-acc" onClick={() => setAdding(true)} disabled={accounts.length === 0}>
          <Plus size={15} /> Add transaction
        </button>
      </div>

      {accounts.length === 0 ? (
        <Empty text="Add an account first" hint="Transactions are recorded against an account." />
      ) : txs.length === 0 ? (
        <Empty text="No transactions yet" />
      ) : (
        <div className="card divide-y divide-edge">
          {txs.map((t) => (
            <div key={t.id} className="px-4 py-2.5 flex items-center gap-3 group">
              <div className="w-20 shrink-0 text-mut text-[12px]">{fmtDate(t.date)}</div>
              <div className="flex-1 min-w-0">
                <div className="truncate">{t.description || t.category || t.kind}</div>
                <div className="text-mut text-[12px] truncate">
                  {t.account_name}
                  {t.category ? ` · ${t.category}` : ""}
                </div>
              </div>
              <div
                className={`font-medium ${
                  t.kind === "expense" || t.kind === "transfer_out"
                    ? "text-bad"
                    : t.kind === "income"
                      ? "text-ok"
                      : "text-mut"
                }`}
              >
                {t.kind === "expense" || t.kind === "transfer_out" ? "−" : "+"}
                {fmtMoney(t.amount, currency)}
              </div>
              <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                {!t.transfer_peer_id && (
                  <button className="btn-ghost !p-1" onClick={() => setEditingTx(t)}>
                    <Pencil size={13} />
                  </button>
                )}
                <button className="btn-ghost !p-1 text-bad" onClick={() => setConfirmDelete(t)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editingTx) && (
        <TransactionEditor
          transaction={editingTx}
          accounts={accounts}
          categories={categories}
          onAddCategory={loadCategories}
          onClose={() => {
            setAdding(false);
            setEditingTx(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditingTx(null);
            onChanged();
          }}
        />
      )}
      {managingCategories && (
        <CategoryManagerModal onClose={() => setManagingCategories(false)} onChanged={loadCategories} />
      )}
      {transferring && (
        <TransferEditor
          accounts={accounts}
          onClose={() => setTransferring(false)}
          onSaved={() => {
            setTransferring(false);
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          message="Delete this transaction?"
          detail={
            confirmDelete.transfer_peer_id
              ? "This is one leg of a transfer — both sides are removed together and both balances adjust back."
              : "The account balance is adjusted back."
          }
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await api.transactionDelete(confirmDelete.id);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function TransactionEditor({
  transaction,
  accounts,
  categories,
  onAddCategory,
  onClose,
  onSaved,
}: {
  transaction?: Transaction | null;
  accounts: Account[];
  categories: TransactionCategory[];
  onAddCategory: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [accountId, setAccountId] = useState(transaction?.account_id ?? accounts[0]?.id ?? 0);
  const [kind, setKind] = useState<"expense" | "income">(
    transaction && (transaction.kind === "expense" || transaction.kind === "income") ? transaction.kind : "expense"
  );
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [category, setCategory] = useState(transaction?.category ?? "");
  const [addingCategory, setAddingCategory] = useState(false);
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const toast = useToast();

  const save = async () => {
    try {
      await api.transactionSave({
        id: transaction?.id ?? null,
        account_id: accountId,
        kind,
        amount: parseFloat(amount),
        category: category || null,
        description: description || null,
        date,
      });
      toast(transaction ? "Transaction updated" : "Transaction added");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title={transaction ? "Edit transaction" : "Add transaction"} onClose={onClose}>
      <div className="flex gap-1 mb-3">
        {(["expense", "income"] as const).map((k) => (
          <button
            key={k}
            className={`btn flex-1 ${
              kind === k
                ? k === "expense"
                  ? "bg-[#2a1717] text-bad"
                  : "bg-[#12271a] text-ok"
                : "border border-edge text-mut"
            }`}
            onClick={() => setKind(k)}
          >
            {k === "expense" ? "Expense" : "Income"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Account">
          <select className="ctl" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
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
        <Field label="Category (optional)">
          <select
            className="ctl"
            value={category}
            onChange={(e) => {
              if (e.target.value === "__new__") setAddingCategory(true);
              else setCategory(e.target.value);
            }}
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
            <option value="__new__">+ Add new category…</option>
          </select>
        </Field>
        <Field label="Date">
          <input type="date" className="ctl" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Description (optional)">
        <input className="ctl" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="text-mut text-[12px] mb-3">
        The account balance is adjusted automatically.
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-acc"
          onClick={save}
          disabled={!accountId || !(parseFloat(amount) > 0)}
        >
          {transaction ? "Save" : "Add"}
        </button>
      </div>
      {addingCategory && (
        <NewCategoryModal
          onClose={() => setAddingCategory(false)}
          onCreated={(name) => {
            setCategory(name);
            setAddingCategory(false);
            onAddCategory();
          }}
        />
      )}
    </Modal>
  );
}

function NewCategoryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const toast = useToast();

  const save = async () => {
    try {
      const c = await api.categoryCreate(name);
      toast("Category added");
      onCreated(c.name);
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title="New category" onClose={onClose}>
      <Field label="Category name">
        <input
          className="ctl"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!name.trim()}>
          Add
        </button>
      </div>
    </Modal>
  );
}

function RenameCategoryModal({
  category,
  onClose,
  onSaved,
}: {
  category: TransactionCategory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category.name);
  const toast = useToast();

  const save = async () => {
    try {
      await api.categoryRename(category.id, name);
      toast("Category renamed");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title="Rename category" onClose={onClose}>
      <Field label="Category name">
        <input
          className="ctl"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
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

function CategoryManagerModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<TransactionCategory | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TransactionCategory | null>(null);

  const load = useCallback(() => {
    api.categoryList().then(setCategories).catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <Modal title="Manage categories" onClose={onClose}>
      <div className="flex justify-end mb-2">
        <button className="btn-edge !py-1 text-[12px]" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add category
        </button>
      </div>
      {categories.length === 0 ? (
        <Empty text="No categories yet" />
      ) : (
        <div className="flex flex-col gap-0.5 max-h-[320px] overflow-y-auto">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-panel2 group">
              <span className="flex-1 truncate text-[13px]">{c.name}</span>
              <button
                className="opacity-0 group-hover:opacity-100 btn-ghost !p-1"
                onClick={() => setRenaming(c)}
              >
                <Pencil size={13} />
              </button>
              <button
                className="opacity-0 group-hover:opacity-100 btn-ghost !p-1 text-bad"
                onClick={() => setConfirmDelete(c)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <NewCategoryModal
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            load();
            onChanged();
          }}
        />
      )}
      {renaming && (
        <RenameCategoryModal
          category={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null);
            load();
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          message={`Delete category "${confirmDelete.name}"?`}
          detail="Past transactions already using this category keep their label — it's only removed from the picker."
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await api.categoryDelete(confirmDelete.id);
            load();
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

function TransferEditor({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fromId, setFromId] = useState(accounts[0]?.id ?? 0);
  const [toId, setToId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? 0);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const toast = useToast();

  const save = async () => {
    try {
      await api.transactionTransfer({
        from_account_id: fromId,
        to_account_id: toId,
        amount: parseFloat(amount),
        date,
        notes: notes.trim() || null,
      });
      toast("Transfer recorded");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title="Transfer between accounts" onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="From">
          <select className="ctl" value={fromId} onChange={(e) => setFromId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select className="ctl" value={toId} onChange={(e) => setToId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
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
      </div>
      <Field label="Notes (optional)">
        <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="text-mut text-[12px] mb-3">
        Moves money between two accounts (e.g. a cash withdrawal). Not counted as income or
        expense — it's the same money, just in a different place.
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-acc"
          onClick={save}
          disabled={!fromId || !toId || fromId === toId || !(parseFloat(amount) > 0)}
        >
          Transfer
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

const CYCLES: Cycle[] = ["weekly", "monthly", "quarterly", "yearly"];

function Subscriptions({
  refreshKey,
  people,
  currency,
  onChanged,
}: {
  refreshKey: number;
  people: Person[];
  currency: string;
  onChanged: () => void;
}) {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [editing, setEditing] = useState<Subscription | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Subscription | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.subscriptionList().then(setSubs).catch(() => {});
  }, [refreshKey]);

  return (
    <div className="max-w-[760px]">
      <div className="flex justify-end mb-3">
        <button className="btn-acc" onClick={() => setEditing("new")}>
          <Plus size={15} /> Add subscription
        </button>
      </div>
      {subs.length === 0 && (
        <Empty text="No subscriptions" hint="Renewals appear on the dashboard timeline automatically." />
      )}
      <div className="flex flex-col gap-2">
        {subs.map((s) => {
          const due = dueLabel(s.next_renewal);
          return (
            <div key={s.id} className={`card px-4 py-3 flex items-center gap-3 group ${!s.active ? "opacity-50" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">
                  {s.name}
                  <PersonBadge people={people} personId={s.person_id} />
                </div>
                <div className="text-mut text-[12px]">
                  {fmtMoney(s.amount, currency)} / {s.cycle.replace("ly", "")}
                  {s.notes ? ` · ${s.notes}` : ""}
                </div>
              </div>
              {s.active ? (
                <div className="text-right">
                  <div className="text-[12px] text-mut">renews {fmtDate(s.next_renewal)}</div>
                  <Tone tone={due.tone}>{due.text}</Tone>
                </div>
              ) : (
                <span className="text-mut text-[12px]">paused</span>
              )}
              {s.active && (
                <button
                  className="btn-edge !py-1 text-[12px]"
                  title="Move the next renewal one cycle forward"
                  onClick={() =>
                    api.subscriptionAdvance(s.id).then(() => {
                      toast("Renewal advanced");
                      onChanged();
                    })
                  }
                >
                  <Check size={13} /> Renewed
                </button>
              )}
              <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                <button className="btn-ghost !p-1.5" onClick={() => setEditing(s)}>
                  <Pencil size={14} />
                </button>
                <button className="btn-ghost !p-1.5 text-bad" onClick={() => setConfirmDelete(s)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <SubscriptionEditor
          sub={editing === "new" ? null : editing}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          message={`Delete “${confirmDelete.name}”?`}
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await api.subscriptionDelete(confirmDelete.id);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SubscriptionEditor({
  sub,
  people,
  onClose,
  onSaved,
}: {
  sub: Subscription | null;
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(sub?.name ?? "");
  const [amount, setAmount] = useState(String(sub?.amount ?? ""));
  const [cycle, setCycle] = useState<Cycle>(sub?.cycle ?? "monthly");
  const [nextRenewal, setNextRenewal] = useState(sub?.next_renewal ?? todayISO());
  const [active, setActive] = useState(sub?.active ?? true);
  const [notes, setNotes] = useState(sub?.notes ?? "");
  const [personId, setPersonId] = useState<number | null>(sub?.person_id ?? null);
  const toast = useToast();

  const save = async () => {
    try {
      await api.subscriptionSave({
        id: sub?.id ?? null,
        name,
        amount: parseFloat(amount || "0"),
        cycle,
        next_renewal: nextRenewal,
        active,
        notes: notes || null,
        person_id: personId,
      });
      toast("Subscription saved");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title={sub ? `Edit ${sub.name}` : "Add subscription"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Name">
          <input className="ctl" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
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
      </div>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Amount">
          <input
            type="number"
            step="0.01"
            className="ctl"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Billing cycle">
          <select className="ctl" value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)}>
            {CYCLES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Next renewal">
          <input
            type="date"
            className="ctl"
            value={nextRenewal}
            onChange={(e) => setNextRenewal(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-[13px] mb-3 cursor-pointer">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (shows on the timeline)
      </label>
      <div className="flex justify-end gap-2">
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
// EMIs
// ---------------------------------------------------------------------------

function Emis({
  refreshKey,
  currency,
  onChanged,
}: {
  refreshKey: number;
  currency: string;
  onChanged: () => void;
}) {
  const [emis, setEmis] = useState<Emi[]>([]);
  const [investments, setInvestments] = useState<InvestmentSummary[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Emi | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Emi | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.emiList().then(setEmis).catch(() => {});
    api.investmentList().then(setInvestments).catch(() => {});
    api.accountList().then(setAccounts).catch(() => {});
  }, [refreshKey]);

  const investmentName = (id: number | null) => (id == null ? null : investments.find((i) => i.id === id)?.name);

  return (
    <div className="max-w-[760px]">
      <div className="flex justify-end mb-3">
        <button className="btn-acc" onClick={() => setEditing("new")}>
          <Plus size={15} /> Add EMI
        </button>
      </div>
      {emis.length === 0 && (
        <Empty text="No EMIs tracked" hint="Due dates appear on the dashboard timeline automatically." />
      )}
      <div className="flex flex-col gap-2">
        {emis.map((e) => {
          const remaining = e.total_months - e.months_paid;
          const due = dueLabel(e.next_due);
          return (
            <div key={e.id} className={`card px-4 py-3 group ${!e.active ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{e.name}</div>
                  <div className="text-mut text-[12px]">
                    {fmtMoney(e.monthly_amount, currency)}/mo
                    {e.lender ? ` · ${e.lender}` : ""} · {e.months_paid}/{e.total_months} paid
                    {investmentName(e.investment_id) ? ` · for ${investmentName(e.investment_id)}` : ""}
                  </div>
                </div>
                {e.active ? (
                  <div className="text-right">
                    <div className="text-[12px] text-mut">due {fmtDate(e.next_due)}</div>
                    <Tone tone={due.tone}>{due.text}</Tone>
                  </div>
                ) : (
                  <span className="text-ok text-[12px]">completed</span>
                )}
                {e.active && (
                  <button
                    className="btn-edge !py-1 text-[12px]"
                    onClick={() =>
                      api.emiMarkPaid(e.id).then((updated) => {
                        toast(updated.active ? "EMI marked paid" : "EMI completed 🎉");
                        onChanged();
                      })
                    }
                  >
                    <Check size={13} /> Paid
                  </button>
                )}
                <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                  <button className="btn-ghost !p-1.5" onClick={() => setEditing(e)}>
                    <Pencil size={14} />
                  </button>
                  <button className="btn-ghost !p-1.5 text-bad" onClick={() => setConfirmDelete(e)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-panel2 overflow-hidden">
                <div
                  className="h-full bg-acc rounded-full transition-all"
                  style={{ width: `${(e.months_paid / Math.max(1, e.total_months)) * 100}%` }}
                />
              </div>
              {e.active && remaining > 0 && (
                <div className="text-mut text-[11px] mt-1">
                  {remaining} payment{remaining === 1 ? "" : "s"} left ·{" "}
                  {fmtMoney(remaining * e.monthly_amount, currency)} remaining
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <EmiEditor
          emi={editing === "new" ? null : editing}
          investments={investments}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          message={`Delete “${confirmDelete.name}”?`}
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await api.emiDelete(confirmDelete.id);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function EmiEditor({
  emi,
  investments,
  accounts,
  onClose,
  onSaved,
}: {
  emi: Emi | null;
  investments: InvestmentSummary[];
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(emi?.name ?? "");
  const [lender, setLender] = useState(emi?.lender ?? "");
  const [monthly, setMonthly] = useState(String(emi?.monthly_amount ?? ""));
  const [totalMonths, setTotalMonths] = useState(String(emi?.total_months ?? ""));
  const [monthsPaid, setMonthsPaid] = useState(String(emi?.months_paid ?? "0"));
  const [nextDue, setNextDue] = useState(emi?.next_due ?? todayISO());
  const [notes, setNotes] = useState(emi?.notes ?? "");
  const [investmentId, setInvestmentId] = useState<number | null>(emi?.investment_id ?? null);
  const [settleAccountId, setSettleAccountId] = useState<number | null>(emi?.settle_account_id ?? null);
  const toast = useToast();

  const save = async () => {
    try {
      const total = parseInt(totalMonths, 10);
      const paid = parseInt(monthsPaid || "0", 10);
      await api.emiSave({
        id: emi?.id ?? null,
        name,
        lender: lender || null,
        monthly_amount: parseFloat(monthly || "0"),
        total_months: total,
        months_paid: paid,
        next_due: nextDue,
        active: emi?.active ?? true,
        notes: notes || null,
        investment_id: investmentId,
        settle_account_id: settleAccountId,
      });
      toast("EMI saved");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title={emi ? `Edit ${emi.name}` : "Add EMI"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Name">
          <input className="ctl" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Car loan" />
        </Field>
        <Field label="Lender (optional)">
          <input className="ctl" value={lender} onChange={(e) => setLender(e.target.value)} />
        </Field>
        <Field label="Monthly amount">
          <input type="number" step="0.01" className="ctl" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </Field>
        <Field label="Next due date">
          <input type="date" className="ctl" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
        </Field>
        <Field label="Total months">
          <input type="number" min="1" className="ctl" value={totalMonths} onChange={(e) => setTotalMonths(e.target.value)} />
        </Field>
        <Field label="Months already paid">
          <input type="number" min="0" className="ctl" value={monthsPaid} onChange={(e) => setMonthsPaid(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Financing a property? (optional)">
          <select
            className="ctl"
            value={investmentId ?? ""}
            onChange={(e) => setInvestmentId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Not linked to a property</option>
            {investments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Settle payments from account (optional)">
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
      </div>
      {investmentId != null && (
        <div className="text-mut text-[12px] mb-3">
          Each "Paid" click logs this amount as an expense against that property, on top of rolling the
          due date forward.
        </div>
      )}
      <div className="flex justify-end gap-2 mt-2">
        <button
          className="btn-acc"
          onClick={save}
          disabled={!name.trim() || !(parseInt(totalMonths, 10) > 0)}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
