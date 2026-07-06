import { fmtMoney } from "../lib/format";

/** Categorical palette, dark-surface steps, fixed order (never reassigned per-value). */
const CATEGORICAL = [
  "#3987e5", // blue
  "#199e70", // aqua
  "#c98500", // yellow
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
  "#d55181", // magenta
  "#d95926", // orange
];

/** Rounds a max value up to a "nice" 1/2/5 * 10^n step for axis ticks. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const frac = max / pow;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * pow;
}

const MONTH_LABEL = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
};

/** Grouped column chart: two series (e.g. income vs expense) across months. */
export function MonthlyFlowChart({
  months,
  currency,
}: {
  months: { month: string; income: number; expense: number }[];
  currency: string;
}) {
  const top = niceMax(Math.max(1, ...months.flatMap((m) => [m.income, m.expense])));
  const ticks = [0, 0.5, 1].map((f) => f * top);
  const H = 120;

  return (
    <div>
      <div className="flex items-center gap-4 mb-2 text-[11.5px] text-mut">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--color-ok)" }} />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--color-bad)" }} />
          Expense
        </span>
      </div>
      <div className="flex">
        <div className="flex flex-col justify-between text-[10.5px] text-mut pr-2 shrink-0" style={{ height: H }}>
          {[...ticks].reverse().map((t) => (
            <span key={t}>{fmtMoney(Math.round(t), currency)}</span>
          ))}
        </div>
        <div className="flex-1 relative border-l border-b border-edge" style={{ height: H }}>
          {ticks.slice(1).map((t) => (
            <div
              key={t}
              className="absolute left-0 right-0 border-t border-edge/60"
              style={{ bottom: `${(t / top) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end justify-around px-1">
            {months.map((m) => (
              <div
                key={m.month}
                tabIndex={0}
                className="group relative flex items-end gap-[2px] h-full outline-none"
              >
                <div
                  className="w-2.5 rounded-t-[3px] transition-opacity group-hover:opacity-80"
                  style={{ height: `${(m.income / top) * 100}%`, background: "var(--color-ok)" }}
                />
                <div
                  className="w-2.5 rounded-t-[3px] transition-opacity group-hover:opacity-80"
                  style={{ height: `${(m.expense / top) * 100}%`, background: "var(--color-bad)" }}
                />
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded-md border border-edge bg-panel2 px-2 py-1 text-[11px] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 z-10 shadow-lg"
                >
                  <div className="font-medium text-ink mb-0.5">{MONTH_LABEL(m.month)}</div>
                  <div className="text-ok">{fmtMoney(m.income, currency)} in</div>
                  <div className="text-bad">{fmtMoney(m.expense, currency)} out</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-around mt-1.5 pl-8">
        {months.map((m) => (
          <span key={m.month} className="text-[11px] text-mut">
            {MONTH_LABEL(m.month)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ranked horizontal bar list: each row is a distinct category (fixed-order categorical color). */
export function RankedBarChart({
  items,
  currency,
}: {
  items: { category: string; total: number }[];
  currency: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.total));
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it, i) => (
        <li key={it.category} className="flex items-center gap-2.5">
          <span className="w-24 shrink-0 truncate text-[12.5px] text-mut" title={it.category}>
            {it.category}
          </span>
          <div className="flex-1 h-3.5 relative">
            <div
              className="h-full rounded-[3px] transition-[width]"
              style={{
                width: `${(it.total / max) * 100}%`,
                background: CATEGORICAL[i % CATEGORICAL.length],
              }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-[12.5px]">{fmtMoney(it.total, currency)}</span>
        </li>
      ))}
    </ul>
  );
}
