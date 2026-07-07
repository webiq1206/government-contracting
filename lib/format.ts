/** Small formatting helpers shared across dashboard views. */

export function currency(n: number | null | undefined): string {
  if (n == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function currencyCents(n: number | null | undefined): string {
  if (n == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

export function pct(n: number | null | undefined): string {
  if (n == null) return "-";
  return `${Math.round(n)}%`;
}

/** Human countdown to a deadline, e.g. "3d 4h", "12h", "overdue". */
export function countdown(deadline: string | null | undefined, now: Date = new Date()): string {
  if (!deadline) return "-";
  const ms = new Date(deadline).getTime() - now.getTime();
  if (Number.isNaN(ms)) return "-";
  if (ms <= 0) return "overdue";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function timeAgo(ts: string | null | undefined, now: Date = new Date()): string {
  if (!ts) return "-";
  const ms = now.getTime() - new Date(ts).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function shortDate(ts: string | null | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function tierColor(tier: string | null | undefined): string {
  switch (tier) {
    case "pursue":
      return "bg-pursue/15 text-pursue";
    case "review":
      return "bg-review/15 text-review";
    case "dismiss":
      return "bg-dismiss/15 text-slate-400";
    default:
      return "bg-ink-700 text-slate-300";
  }
}

export function complianceColorClass(color: "green" | "amber" | "red"): string {
  return color === "green"
    ? "bg-pursue/15 text-pursue"
    : color === "amber"
      ? "bg-review/15 text-review"
      : "bg-risk/15 text-risk";
}
