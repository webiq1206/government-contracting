import { complianceBoard } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { shortDate, complianceColorClass } from "@/lib/format";
import { statusColor } from "@/lib/domain/compliance";
import type { ComplianceStatus } from "@/lib/domain/compliance";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function asStatus(v: unknown): ComplianceStatus {
  const s = str(v);
  if (s === "warning" || s === "critical" || s === "blocked" || s === "resolved") return s;
  return "ok";
}
function detailObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

const CATEGORY_LABELS: Record<string, string> = {
  sam_registration: "SAM.gov Registration",
  certification: "Certifications",
  state_llc: "State / LLC Registration",
  insurance: "Insurance",
  non_ss_cap: "Non-Small-Business Sub Cap",
  contract_deadline: "Contract Deadlines",
};

function categoryLabel(cat: string): string {
  if (CATEGORY_LABELS[cat]) return CATEGORY_LABELS[cat];
  return cat
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default async function CompliancePage() {
  const rows = (await complianceBoard()) as Row[];

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Compliance Board" />
        <div className="p-6">
          <div className="card text-sm text-slate-600">
            Compliance Monitor has not run yet. Trigger it from{" "}
            <a href="/agents" className="text-accent hover:underline">
              Agents
            </a>
            .
          </div>
        </div>
      </div>
    );
  }

  // Split off the non-SS cap gauges; everything else is a deadline/renewal item.
  const capRows = rows.filter((r) => str(r.category) === "non_ss_cap");
  const deadlineRows = rows.filter((r) => str(r.category) !== "non_ss_cap");

  // Highlight blocked/critical up top (data already sorted by status).
  const urgent = deadlineRows.filter((r) => {
    const s = str(r.status);
    return s === "blocked" || s === "critical";
  });

  // Group deadline items by category (input is already sorted).
  const groups = new Map<string, Row[]>();
  for (const r of deadlineRows) {
    const cat = str(r.category) || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(r);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Compliance Board"
        subtitle={`${deadlineRows.length} tracked item${deadlineRows.length === 1 ? "" : "s"}${
          capRows.length ? ` · ${capRows.length} contract cap gauge${capRows.length === 1 ? "" : "s"}` : ""
        }`}
      >
        <Legend />
      </PageHeader>

      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        {urgent.length > 0 && (
          <section>
            <h2 className="label mb-2 text-risk">Needs attention now</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {urgent.map((r) => (
                <ComplianceItem key={str(r.id)} row={r} highlight />
              ))}
            </div>
          </section>
        )}

        {capRows.length > 0 && (
          <section>
            <h2 className="label mb-2">Non-small-business sub spend cap</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {capRows.map((r) => (
                <CapGauge key={str(r.id)} row={r} />
              ))}
            </div>
          </section>
        )}

        {[...groups.entries()].map(([cat, items]) => (
          <section key={cat}>
            <h2 className="label mb-2">{categoryLabel(cat)}</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {items.map((r) => (
                <ComplianceItem key={str(r.id)} row={r} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-pursue" /> On track
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-review" /> Warning
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-risk" /> Critical / blocked
      </span>
    </div>
  );
}

function ComplianceItem({ row, highlight = false }: { row: Row; highlight?: boolean }) {
  const status = asStatus(row.status);
  const color = statusColor(status);
  const days = num(row.days_remaining);
  const label = str(row.label) || "Untitled item";
  const contractNumber = str(row.contract_number);

  const countdownText =
    days == null
      ? "no date"
      : days < 0
        ? `${Math.abs(days)}d overdue`
        : days === 0
          ? "due today"
          : `${days}d left`;

  return (
    <div
      className={`card flex items-start justify-between gap-3 ${
        highlight ? "border-risk/50 bg-risk/5" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Due {shortDate(str(row.due_at) || null)}
          {contractNumber ? ` · ${contractNumber}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`badge ${complianceColorClass(color)}`}>{status}</span>
        <span
          className={`num text-xs ${
            color === "red" ? "text-risk" : color === "amber" ? "text-review" : "text-slate-600"
          }`}
        >
          {countdownText}
        </span>
      </div>
    </div>
  );
}

function CapGauge({ row }: { row: Row }) {
  const status = asStatus(row.status);
  const color = statusColor(status);
  const detail = detailObj(row.detail);
  const util =
    num(detail.utilization_pct) ??
    num(detail.utilization) ??
    num(detail.non_ss_pct) ??
    num(row.days_remaining) ?? // fallback: nothing sensible, keep 0
    0;
  const utilPct = Math.max(0, Math.min(100, util ?? 0));
  const capPct = num(detail.cap_pct) ?? 50;
  const label = str(row.label) || str(row.contract_number) || "Contract";
  const barColor =
    color === "red" ? "bg-risk" : color === "amber" ? "bg-review" : "bg-pursue";

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-slate-900">{label}</p>
        <span className={`badge ${complianceColorClass(color)}`}>{status}</span>
      </div>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${utilPct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-slate-600">
        <span className="num">{utilPct.toFixed(0)}% of cap used</span>
        <span>cap {capPct}%</span>
      </div>
    </div>
  );
}
