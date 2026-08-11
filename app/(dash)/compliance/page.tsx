import Link from "next/link";
import { complianceBoard } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { AddComplianceItem } from "@/components/add-compliance-item";
import { PAGE_HELP } from "@/lib/help-content";
import { shortDate, complianceColorClass } from "@/lib/format";
import { statusColor } from "@/lib/domain/compliance";
import type { ComplianceStatus } from "@/lib/domain/compliance";
import {
  ComplianceItemCard,
  type ComplianceCardData,
  type CategoryInfo,
} from "@/components/compliance-item";

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

const STATUS_LABEL: Record<string, string> = {
  ok: "On track",
  resolved: "Resolved",
  warning: "Warning",
  critical: "Critical",
  blocked: "Blocked",
};

/** Plain-English "what this is + where to renew" per compliance category. */
const CATEGORY_INFO: Record<string, CategoryInfo> = {
  sam_registration: {
    what: "Your federal vendor registration. You can't receive an award without it, and it expires every year.",
    how: "Renew it free on SAM.gov before the date below.",
    links: [{ label: "Renew on SAM.gov", url: "https://sam.gov/" }],
  },
  certification: {
    what: "Your small-business or set-aside certifications (SDVOSB, HUBZone, 8(a), WOSB).",
    how: "Recertify through the program that issued it before it lapses.",
    links: [
      { label: "SBA certifications", url: "https://certify.sba.gov/" },
      { label: "SDVOSB (VetCert)", url: "https://veterans.certify.sba.gov/" },
    ],
  },
  state_llc: {
    what: "Your state business registration and annual report.",
    how: "File the annual report with your Secretary of State to stay in good standing.",
    links: [],
  },
  insurance: {
    what: "General liability or bonding coverage that many solicitations require.",
    how: "Renew with your insurance agent and keep the certificate on hand.",
    links: [],
  },
  far_change: {
    what: "Federal Acquisition Regulation updates that can change what a bid must include.",
    how: "Skim the latest changes so nothing surprises you mid-bid.",
    links: [{ label: "acquisition.gov", url: "https://www.acquisition.gov/" }],
  },
  cpars: {
    what: "Your past-performance ratings from completed contracts.",
    how: "Review and respond to any evaluation in CPARS.",
    links: [{ label: "CPARS", url: "https://www.cpars.gov/" }],
  },
  contract_deadline: {
    what: "A deliverable or milestone on an active contract.",
    how: "Complete and submit it before the date below.",
    links: [],
  },
};

function infoFor(cat: string): CategoryInfo | undefined {
  if (cat === "sb_cert") return CATEGORY_INFO.certification;
  return CATEGORY_INFO[cat];
}

/** Build the serializable card projection (all date math done here on the server). */
function buildCard(row: Row): ComplianceCardData {
  const override = str(row.due_at_override) || null;
  const monitorDue = str(row.due_at) || null;
  const effDue = override || monitorDue;

  let dateInputValue = "";
  let days: number | null = null;
  if (effDue) {
    const d = new Date(effDue);
    if (!Number.isNaN(d.getTime())) {
      dateInputValue = d.toISOString().slice(0, 10);
      days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
    }
  }

  const statusOverride = str(row.status_override);
  const monitorStatus = str(row.status) || "ok";
  const effStatus = statusOverride || monitorStatus;

  let color: ComplianceCardData["color"];
  if (statusOverride) {
    color = statusColor(asStatus(statusOverride));
  } else if (days != null) {
    color = days < 0 ? "red" : days <= 30 ? "amber" : "green";
  } else {
    color = effDue ? "green" : "slate";
  }

  const countdownText =
    days == null
      ? "no date set"
      : days < 0
        ? `${Math.abs(days)}d overdue`
        : days === 0
          ? "due today"
          : `${days}d left`;

  return {
    id: str(row.id),
    label: str(row.label) || "Untitled item",
    contract_number: str(row.contract_number) || null,
    dueDisplay: effDue ? shortDate(effDue) : "-",
    dateInputValue,
    statusValue: statusOverride, // "" = automatic
    statusLabel: STATUS_LABEL[effStatus] ?? effStatus,
    countdownText,
    color,
    notes: str(row.notes),
    link_url: str(row.link_url),
    doc_url: str(row.doc_url),
    manual: str(row.source) === "operator",
  };
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
      <div className="flex page-shell">
        <PageHeader
          help={PAGE_HELP["compliance"]}
          title="Compliance Board"
          status="Not set up yet"
          subtitle="Renewals, registrations, and contract deadlines in one place. Brost Co watches dates; renewing is your job."
        />
        <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
          <EmptyState
            title="Compliance Monitor has not run yet"
            description="Trigger Compliance Monitor from Automation Log, or add your own renewal items below to start tracking dates."
            action={
              <Link href="/agents" className="btn-ghost text-sm">
                Open Automation Log
              </Link>
            }
          />
          <AddComplianceItem />
        </div>
      </div>
    );
  }

  // Split off the non-SS cap gauges; everything else is a deadline/renewal item.
  const capRows = rows.filter((r) => str(r.category) === "non_ss_cap");
  const deadlineRows = rows.filter((r) => str(r.category) !== "non_ss_cap");

  // Build each card's display projection once (respects operator overrides).
  const cardById = new Map<string, ComplianceCardData>(
    deadlineRows.map((r) => [str(r.id), buildCard(r)])
  );

  // Highlight overdue/blocking items up top.
  const urgent = deadlineRows.filter((r) => cardById.get(str(r.id))?.color === "red");
  const groups = new Map<string, Row[]>();
  for (const r of deadlineRows) {
    const cat = str(r.category) || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(r);
  }

  const urgentCount = urgent.length;

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["compliance"]}
        title="Compliance Board"
        status={
          urgentCount > 0
            ? `${urgentCount} need${urgentCount === 1 ? "s" : ""} attention now · ${deadlineRows.length} tracked`
            : `${deadlineRows.length} tracked item${deadlineRows.length === 1 ? "" : "s"}${
                capRows.length ? ` · ${capRows.length} cap gauge${capRows.length === 1 ? "" : "s"}` : ""
              }`
        }
        subtitle="Brost Co checks these daily and warns before anything lapses. Set renewal dates and links so countdowns work."
      >
        <Legend />
      </PageHeader>

      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        {/* How this board works: automatic tracking vs your job. */}
        <div className="callout-panel">
          <p className="text-sm font-medium text-foreground">
            The system watches these for you. Renewing is your job.
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Every day it checks each item and warns you before anything lapses.
            For it to count down, it needs a date. Open any item, set its renewal
            date, add the renewal link and a link to your document, and you&rsquo;ll
            get alerts as the deadline gets close. Items showing &ldquo;no date
            set&rdquo; can&rsquo;t be tracked yet.
          </p>
          <div className="mt-3">
            <AddComplianceItem />
          </div>
        </div>

        {urgent.length > 0 && (
          <section>
            <h2 className="label mb-2 text-risk">Needs attention now</h2>
            <p className="mb-2 text-xs text-slate-500">
              These are overdue or blocking. Handle each one today: renew it, then
              update the date or mark it resolved.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {urgent.map((r) => (
                <ComplianceItemCard
                  key={str(r.id)}
                  item={cardById.get(str(r.id))!}
                  info={infoFor(str(r.category))}
                  highlight
                />
              ))}
            </div>
          </section>
        )}

        {capRows.length > 0 && (
          <section>
            <h2 className="label mb-2">Non-small-business sub spend cap</h2>
            <p className="mb-2 text-xs text-slate-500">
              Federal rules: subs that are not small businesses can do at most
              50% of each contract. We warn at 45%.
            </p>
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
                <ComplianceItemCard
                  key={str(r.id)}
                  item={cardById.get(str(r.id))!}
                  info={infoFor(cat)}
                />
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
        <span className={`badge ${complianceColorClass(color)}`}>{status === "ok" ? "On track" : status}</span>
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
