export function fmtMoney(n: number, symbol: string): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${symbol}${abs.toLocaleString(undefined, {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Days from today to a YYYY-MM-DD date (negative = past). */
export function daysUntil(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type DatePreset = "all" | "this_month" | "last_month" | "last_3m" | "this_fy" | "custom";

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "last_3m", label: "Last 3 months" },
  { id: "this_fy", label: "This FY (Apr–Mar)" },
  { id: "custom", label: "Custom range" },
];

/** {from,to} (inclusive, YYYY-MM-DD) for a preset, or null bounds for "all". */
export function presetRange(p: DatePreset): { from: string | null; to: string | null } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (p) {
    case "this_month":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "last_month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "last_3m":
      return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "this_fy": {
      // Indian financial year: 1 Apr – 31 Mar.
      const fyStart = m >= 3 ? y : y - 1;
      return { from: iso(new Date(fyStart, 3, 1)), to: iso(new Date(fyStart + 1, 2, 31)) };
    }
    default:
      return { from: null, to: null };
  }
}

export function dueLabel(iso: string): { text: string; tone: "bad" | "warn" | "mut" } {
  const days = daysUntil(iso);
  if (days < 0) return { text: `${-days}d overdue`, tone: "bad" };
  if (days === 0) return { text: "today", tone: "warn" };
  if (days === 1) return { text: "tomorrow", tone: "warn" };
  if (days <= 7) return { text: `in ${days}d`, tone: "warn" };
  return { text: `in ${days}d`, tone: "mut" };
}
