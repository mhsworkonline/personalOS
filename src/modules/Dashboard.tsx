import { useCallback, useEffect, useState } from "react";
import {
  Account,
  Activity,
  api,
  DashboardData,
  Emi,
  FinanceCharts,
  InvestmentSummary,
  Person,
  Subscription,
  TimelineEvent,
  Transaction,
  TransactionCategory,
} from "../api";
import { NavTarget } from "../App";
import { Confirm, Empty, Field, Modal, personLabel, Tone, useToast } from "../components/ui";
import { MonthlyFlowChart, RankedBarChart } from "../components/charts";
import { AccountDetailModal, AccountEditor, EmiEditor, SubscriptionEditor, TransactionEditor } from "./Finance";
import { InvestmentDetailModal } from "./Investments";
import { dueLabel, fmtDate, fmtDateTime, fmtMoney, todayISO } from "../lib/format";
import {
  BellPlus,
  CalendarClock,
  CheckCircle2,
  Circle,
  CreditCard,
  KeyRound,
  Plus,
  RefreshCcw,
  StickyNote,
  Trash2,
} from "lucide-react";

const KIND_ICON: Record<string, React.ReactNode> = {
  renewal: <RefreshCcw size={14} className="text-acc2" />,
  emi: <CreditCard size={14} className="text-warn" />,
  expiration: <KeyRound size={14} className="text-bad" />,
  document_expiration: <KeyRound size={14} className="text-bad" />,
  task: <CheckCircle2 size={14} className="text-ok" />,
  reminder: <BellPlus size={14} className="text-acc2" />,
};

function eventTarget(ev: TimelineEvent): NavTarget {
  switch (ev.source_module) {
    case "vault":
      return { view: "vault", recordModule: "vault", recordId: ev.source_id ?? undefined };
    case "documents":
      return { view: "people", recordModule: "documents", recordId: ev.source_id ?? undefined };
    case "subscriptions":
    case "emis":
      return { view: "finance", recordModule: ev.source_module, recordId: ev.source_id ?? undefined };
    case "notes":
      return { view: "notes", recordModule: "notes", recordId: ev.source_id ?? undefined };
    case "investments":
      return { view: "investments", recordModule: "investments", recordId: ev.source_id ?? undefined };
    default:
      return { view: "dashboard" };
  }
}

/** Where a "Recent activity" row leads, if anywhere — most entries recorded
 *  for deletions carry no record_id (the record is gone), so those stay
 *  inert. Modules with more than one record type (finance) key off the
 *  action text since the activity log doesn't carry a finer module name. */
function activityTarget(a: Activity): NavTarget | null {
  if (a.record_id == null) return null;
  switch (a.module) {
    case "finance":
      if (a.action === "transfer") return { view: "finance", recordModule: "transactions", recordId: a.record_id };
      if (a.action === "renewed") return { view: "finance", recordModule: "subscriptions", recordId: a.record_id };
      return { view: "finance" };
    case "investments":
      if (a.action === "ended tenancy") return { view: "investments", recordModule: "investments", recordId: a.record_id };
      return { view: "investments" };
    case "documents":
      return { view: "people", recordModule: "documents", recordId: a.record_id };
    case "notes":
      return { view: "notes", recordModule: "notes", recordId: a.record_id };
    case "vault":
      return { view: "vault", recordModule: "vault", recordId: a.record_id };
    case "people":
      return { view: "people", recordModule: "person", recordId: a.record_id };
    case "portfolio":
      return { view: "portfolio", recordModule: "holdings", recordId: a.record_id };
    default:
      // tasks, timeline (reminders): no page of their own beyond this dashboard.
      return null;
  }
}

/** Record types that open as a self-contained popup elsewhere in the app —
 *  for these, a Timeline/Activity click should just pop that popup open on
 *  top of the dashboard, not switch to the owning module's tab. Record
 *  types that only exist as a full-page master/detail view (notes, vault,
 *  documents, people, portfolio holdings) still navigate there, since
 *  there's no separate popup to show in isolation. */
type QuickView =
  | { kind: "account"; id: number }
  | { kind: "transaction"; id: number }
  | { kind: "subscription"; id: number }
  | { kind: "emi"; id: number }
  | { kind: "investment"; id: number };

const QUICK_VIEW_KIND: Record<string, QuickView["kind"]> = {
  accounts: "account",
  transactions: "transaction",
  subscriptions: "subscription",
  emis: "emi",
  investments: "investment",
};

export default function Dashboard({
  refreshKey,
  currency,
  navigate,
  onChanged,
}: {
  refreshKey: number;
  currency: string;
  navigate: (t: NavTarget) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [charts, setCharts] = useState<FinanceCharts | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskPerson, setTaskPerson] = useState<number | null>(null);
  const [quickText, setQuickText] = useState("");
  const [reminderOpen, setReminderOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "task" | "quick" | "event"; id: number } | null>(null);
  const toast = useToast();

  // Quick view: pops a record's own popup open right here on the dashboard,
  // without switching views — see the QuickView type above.
  const [quickView, setQuickView] = useState<QuickView | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [qvAccounts, setQvAccounts] = useState<Account[]>([]);
  const [qvCategories, setQvCategories] = useState<TransactionCategory[]>([]);
  const [qvInvestments, setQvInvestments] = useState<InvestmentSummary[]>([]);
  const [qvTransaction, setQvTransaction] = useState<Transaction | null>(null);
  const [qvSubscription, setQvSubscription] = useState<Subscription | null>(null);
  const [qvEmi, setQvEmi] = useState<Emi | null>(null);

  const loadQuickView = useCallback((qv: QuickView) => {
    api.accountList().then(setQvAccounts).catch(() => {});
    if (qv.kind === "transaction") {
      api.categoryList().then(setQvCategories).catch(() => {});
      api
        .transactionList(null, 1000)
        .then((txs) => setQvTransaction(txs.find((t) => t.id === qv.id) ?? null))
        .catch(() => {});
    } else if (qv.kind === "subscription") {
      api
        .subscriptionList()
        .then((subs) => setQvSubscription(subs.find((s) => s.id === qv.id) ?? null))
        .catch(() => {});
    } else if (qv.kind === "emi") {
      api.investmentList().then(setQvInvestments).catch(() => {});
      api
        .emiList()
        .then((emis) => setQvEmi(emis.find((e) => e.id === qv.id) ?? null))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (quickView) loadQuickView(quickView);
  }, [quickView, loadQuickView]);

  // Timeline/Activity rows: open the record's own popup in place when it has
  // one, otherwise fall back to actually navigating there (notes, vault,
  // documents, people, portfolio holdings — full pages, not popups).
  const openRecord = (t: NavTarget) => {
    const kind = t.recordModule && QUICK_VIEW_KIND[t.recordModule];
    if (kind && t.recordId != null) {
      setQuickView({ kind, id: t.recordId } as QuickView);
      return;
    }
    navigate(t);
  };

  const load = useCallback(() => {
    api.getDashboard(30).then(setData).catch(() => {});
    api.personList().then(setPeople).catch(() => {});
    api.financeCharts().then(setCharts).catch(() => {});
  }, []);

  useEffect(load, [load, refreshKey]);

  if (!data) return <div className="p-6 text-mut">Loading…</div>;

  const overdue = data.timeline.filter((e) => e.event_date < data.today);
  const upcoming = data.timeline.filter((e) => e.event_date >= data.today);
  const openTasks = data.tasks.filter((t) => !t.done);
  const doneTasks = data.tasks.filter((t) => t.done);

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    try {
      await api.taskSave({
        id: null,
        title: taskTitle,
        due_date: taskDue || null,
        person_id: taskPerson,
      });
      setTaskTitle("");
      setTaskDue("");
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const addQuick = async () => {
    if (!quickText.trim()) return;
    try {
      await api.quickNoteCreate(quickText);
      setQuickText("");
      onChanged();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">{todayLabel}</h1>
        <div className="text-mut text-[13px] mt-0.5">
          {openTasks.length} open task{openTasks.length === 1 ? "" : "s"} ·{" "}
          {overdue.length > 0 ? (
            <span className="text-bad">{overdue.length} overdue</span>
          ) : (
            "nothing overdue"
          )}{" "}
          · {upcoming.length} upcoming in 30 days
        </div>
      </div>

      <div className="grid grid-cols-[1.6fr_1fr] gap-4 max-w-[1200px]">
        <div className="flex flex-col gap-4 min-w-0">
          {/* Timeline */}
          <section className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut flex items-center gap-1.5">
                <CalendarClock size={14} /> Timeline — next 30 days
              </h2>
              <button className="btn-ghost !py-1 text-[12px]" onClick={() => setReminderOpen(true)}>
                <BellPlus size={13} /> Add reminder
              </button>
            </div>
            {data.timeline.length === 0 ? (
              <Empty
                text="Nothing scheduled"
                hint="Subscriptions, EMIs, expiring vault items, task due dates and reminders show up here automatically."
              />
            ) : (
              <ul className="flex flex-col">
                {[...overdue, ...upcoming].map((ev) => {
                  const due = dueLabel(ev.event_date);
                  return (
                    <li
                      key={ev.id}
                      className="group flex items-center gap-2.5 py-1.5 px-1.5 -mx-1.5 rounded-md hover:bg-panel2 cursor-pointer"
                      onClick={() => openRecord(eventTarget(ev))}
                    >
                      {KIND_ICON[ev.kind] ?? KIND_ICON.reminder}
                      <span className="flex-1 truncate flex items-center gap-1.5 min-w-0">
                        <span className="truncate">{ev.title}</span>
                        {ev.person_name &&
                          !people.find((p) => p.id === ev.person_id)?.is_default && (
                            <span className="shrink-0 rounded-full border border-edge bg-panel2 px-1.5 py-px text-[11px] text-acc2">
                              {ev.person_name}
                            </span>
                          )}
                      </span>
                      {ev.amount != null && ev.amount > 0 && (
                        <span className="text-mut text-[12px]">{fmtMoney(ev.amount, currency)}</span>
                      )}
                      <span className="text-mut text-[12px] w-20 text-right">{fmtDate(ev.event_date)}</span>
                      <span className="w-20 text-right">
                        <Tone tone={due.tone}>{due.text}</Tone>
                      </span>
                      {ev.source_module === "reminder" && (
                        <button
                          className="opacity-0 group-hover:opacity-100 btn-ghost !p-1"
                          title="Delete reminder"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDelete({ kind: "event", id: ev.id });
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Tasks */}
          <section className="card p-4">
            <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-3">Tasks</h2>
            <div className="flex gap-2 mb-3">
              <input
                className="ctl flex-1"
                placeholder="Add a task…"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTask()}
              />
              <input
                type="date"
                className="ctl !w-36"
                value={taskDue}
                onChange={(e) => setTaskDue(e.target.value)}
                title="Due date (optional)"
              />
              <select
                className="ctl !w-28"
                title="Belongs to"
                value={taskPerson ?? people.find((p) => p.is_default)?.id ?? ""}
                onChange={(e) => setTaskPerson(Number(e.target.value))}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
              <button className="btn-acc" onClick={addTask}>
                <Plus size={15} />
              </button>
            </div>
            {data.tasks.length === 0 && <Empty text="No tasks yet" />}
            <ul>
              {[...openTasks, ...doneTasks].map((t) => (
                <li
                  key={t.id}
                  className="group flex items-center gap-2.5 py-1.5 px-1.5 -mx-1.5 rounded-md hover:bg-panel2"
                >
                  <button
                    className="text-mut hover:text-ok"
                    onClick={() => api.taskToggle(t.id).then(onChanged)}
                    title={t.done ? "Mark as not done" : "Mark as done"}
                  >
                    {t.done ? <CheckCircle2 size={16} className="text-ok" /> : <Circle size={16} />}
                  </button>
                  <span className={`flex-1 truncate ${t.done ? "line-through text-mut" : ""}`}>
                    {t.title}
                  </span>
                  {t.due_date && !t.done && (
                    <Tone tone={dueLabel(t.due_date).tone}>{dueLabel(t.due_date).text}</Tone>
                  )}
                  <button
                    className="opacity-0 group-hover:opacity-100 btn-ghost !p-1"
                    onClick={() => setConfirmDelete({ kind: "task", id: t.id })}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          {/* Quick notes */}
          <section className="card p-4">
            <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-3 flex items-center gap-1.5">
              <StickyNote size={14} /> Quick notes
            </h2>
            <div className="flex gap-2 mb-3">
              <input
                className="ctl flex-1"
                placeholder="Jot something down…"
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuick()}
              />
              <button className="btn-acc" onClick={addQuick}>
                <Plus size={15} />
              </button>
            </div>
            {data.quick_notes.length === 0 && <Empty text="No quick notes" />}
            <ul>
              {data.quick_notes.map((q) => (
                <li key={q.id} className="group flex gap-2 py-1.5 px-1.5 -mx-1.5 rounded-md hover:bg-panel2">
                  <span className="flex-1 whitespace-pre-wrap break-words selectable">{q.content}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 btn-ghost !p-1 self-start"
                    onClick={() => setConfirmDelete({ kind: "quick", id: q.id })}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Recent activity */}
          <section className="card p-4">
            <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-2">
              Recent activity
            </h2>
            {data.activity.length === 0 && <Empty text="No activity yet" />}
            <ul>
              {data.activity.map((a) => {
                const target = activityTarget(a);
                return (
                  <li
                    key={a.id}
                    className={`flex items-baseline gap-2 py-1 px-1.5 -mx-1.5 rounded-md text-[13px] ${
                      target ? "cursor-pointer hover:bg-panel2" : ""
                    }`}
                    onClick={() => target && openRecord(target)}
                  >
                    <span className="text-mut w-24 shrink-0 text-[12px]">{fmtDateTime(a.created_at)}</span>
                    <span className="text-mut">{a.module}</span>
                    <span className="truncate">
                      {a.action} · {a.title}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      {charts && (
        <div className="grid grid-cols-2 gap-4 max-w-[1200px] mt-4">
          <section className="card p-4">
            <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-3">
              Cash flow — last 6 months
            </h2>
            {charts.monthly.some((m) => m.income || m.expense) ? (
              <MonthlyFlowChart months={charts.monthly} currency={currency} />
            ) : (
              <Empty
                text="No transactions recorded yet"
                hint="Add income and expenses under Finance → Transactions to see monthly trends here."
              />
            )}
          </section>
          <section className="card p-4">
            <h2 className="font-semibold text-[13px] uppercase tracking-wide text-mut mb-3">
              Top spending categories — this month
            </h2>
            {charts.categories.length === 0 ? (
              <Empty text="No expenses recorded this month" />
            ) : (
              <RankedBarChart items={charts.categories} currency={currency} />
            )}
          </section>
        </div>
      )}

      {reminderOpen && (
        <ReminderModal
          people={people}
          onClose={() => setReminderOpen(false)}
          onSaved={() => {
            setReminderOpen(false);
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <Confirm
          message={
            confirmDelete.kind === "task"
              ? "Delete this task?"
              : confirmDelete.kind === "quick"
                ? "Delete this quick note?"
                : "Delete this reminder?"
          }
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const { kind, id } = confirmDelete;
            if (kind === "task") await api.taskDelete(id);
            else if (kind === "quick") await api.quickNoteDelete(id);
            else await api.timelineDelete(id);
            onChanged();
          }}
        />
      )}

      {quickView?.kind === "account" && (
        <AccountDetailModal
          key={quickView.id}
          accountId={quickView.id}
          accounts={qvAccounts}
          currency={currency}
          onClose={() => setQuickView(null)}
          onEdit={(a) => setEditingAccount(a)}
          onChanged={() => {
            loadQuickView(quickView);
            onChanged();
          }}
        />
      )}
      {editingAccount && (
        <AccountEditor
          key={editingAccount.id}
          account={editingAccount}
          people={people}
          onClose={() => setEditingAccount(null)}
          onSaved={() => {
            setEditingAccount(null);
            if (quickView) loadQuickView(quickView);
            onChanged();
          }}
        />
      )}
      {quickView?.kind === "transaction" && qvTransaction && (
        <TransactionEditor
          key={qvTransaction.id}
          transaction={qvTransaction}
          accounts={qvAccounts}
          categories={qvCategories}
          onAddCategory={() => api.categoryList().then(setQvCategories).catch(() => {})}
          onClose={() => setQuickView(null)}
          onSaved={() => {
            setQuickView(null);
            onChanged();
          }}
        />
      )}
      {quickView?.kind === "subscription" && qvSubscription && (
        <SubscriptionEditor
          key={qvSubscription.id}
          sub={qvSubscription}
          people={people}
          onClose={() => setQuickView(null)}
          onSaved={() => {
            setQuickView(null);
            onChanged();
          }}
        />
      )}
      {quickView?.kind === "emi" && qvEmi && (
        <EmiEditor
          key={qvEmi.id}
          emi={qvEmi}
          investments={qvInvestments}
          accounts={qvAccounts}
          onClose={() => setQuickView(null)}
          onSaved={() => {
            setQuickView(null);
            onChanged();
          }}
        />
      )}
      {quickView?.kind === "investment" && (
        <InvestmentDetailModal
          key={quickView.id}
          id={quickView.id}
          people={people}
          accounts={qvAccounts}
          currency={currency}
          onClose={() => setQuickView(null)}
          onChanged={() => {
            loadQuickView(quickView);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ReminderModal({
  people,
  onClose,
  onSaved,
}: {
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [personId, setPersonId] = useState<number | null>(null);
  const toast = useToast();

  const save = async () => {
    try {
      await api.reminderCreate(title, date, notes || null, personId);
      toast("Reminder added");
      onSaved();
    } catch (e) {
      toast(String(e), "bad");
    }
  };

  return (
    <Modal title="Add reminder" onClose={onClose}>
      <Field label="What should we remind you about?">
        <input
          className="ctl"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="e.g. Renew car insurance"
        />
      </Field>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Date">
          <input type="date" className="ctl" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="For">
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
      <Field label="Notes (optional)">
        <input className="ctl" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={save} disabled={!title.trim()}>
          Add reminder
        </button>
      </div>
    </Modal>
  );
}
