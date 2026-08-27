import Link from "next/link";
import { complianceBoard, subcontractorComplianceRows } from "@/lib/data";
import { PageFrame } from "@/components/page-frame";
import { EmptyState } from "@/components/empty-state";
import { AddComplianceItem } from "@/components/add-compliance-item";
import { PAGE_HELP } from "@/lib/help-content";
import { shortDate, complianceColorClass } from "@/lib/format";
import { statusColor } from "@/lib/domain/compliance";
import type { ComplianceStatus } from "@/lib/domain/compliance";
import {
  areaFor,
  parseArea,
  parseState,
  stateOf,
  subcontractorComplianceBoard,
  STATE_LABEL,
  AREA_LABEL,
  AREA_EXPLANATION,
  AREA_ORDER,
  type ComplianceArea,
  type SubComplianceInput,
  type SubComplianceItem,
  type BoardState,
} from "@/lib/domain/compliance-areas";
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
  /*
   * "On track" is a claim about a date, so it is only sayable when there is
   * one. An item with no expiry was reading as a green "On track" -- the
   * system asserting an item was fine when it had nothing at all to check it
   * against. See cannotMonitor below.
   */
  cannot_monitor: "Cannot monitor",
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
  /*
   * No date and nobody has said otherwise: there is nothing to be on track
   * against. Reporting that as "On track" is the exact failure the audit
   * named -- a green badge asserting an item is fine when the system has no
   * way to know. An override still wins, because a person saying "this is
   * handled" is information the system does not otherwise have.
   */
  const cannotMonitor = !statusOverride && effDue == null;
  const monitorStatus = cannotMonitor ? "cannot_monitor" : str(row.status) || "ok";
  const effStatus = statusOverride || monitorStatus;

  let color: ComplianceCardData["color"];
  if (statusOverride) {
    color = statusColor(asStatus(statusOverride));
  } else if (days != null) {
    color = days < 0 ? "red" : days <= 30 ? "amber" : "green";
  } else {
    // Slate rather than green: neutral, because nothing is known, and a
    // colour that reads as "fine" would be the same lie in another form.
    color = effDue ? "green" : "slate";
  }

  const countdownText =
    days == null
      ? "No expiry date, so this cannot be tracked"
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
    daysLeft: days,
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

/**
 * Flat document rows into one entry per subcontractor.
 *
 * The query left-joins documents, so a subcontractor with no paperwork arrives
 * as a single row with every document column null. That is a real state -- on
 * a contract, nothing on file -- and it has to survive into an empty docs
 * array rather than being read as a document of type "".
 */
function groupSubRows(rows: Row[]): SubComplianceInput[] {
  const bySub = new Map<string, SubComplianceInput>();
  for (const r of rows) {
    const id = str(r.sub_id);
    if (!id) continue;
    let entry = bySub.get(id);
    if (!entry) {
      entry = {
        subId: id,
        companyName: str(r.company_name) || "Unnamed subcontractor",
        docs: [],
        onContract: r.on_contract === true,
      };
      bySub.set(id, entry);
    }
    const docType = str(r.doc_type);
    if (!docType) continue;
    entry.docs.push({
      doc_type: docType,
      status: str(r.status),
      expires_at: str(r.expires_at) || null,
      signed_at: str(r.signed_at) || null,
      verified_at: str(r.verified_at) || null,
    });
  }
  return [...bySub.values()];
}

/** How far out a date sits across the timeline window, as a percentage. */
const TIMELINE_DAYS = 90;

/** Chip styling shared by the state and area filters, matching Contracts. */
function chipClass(active: boolean, empty: boolean): string {
  const base =
    "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1.5";
  if (active) return `${base} border-gold bg-gold/15 text-foreground`;
  if (empty) return `${base} border-border text-muted-foreground`;
  return `${base} border-border text-foreground hover:border-foreground/30`;
}

function filterHref(area: ComplianceArea | null, state: BoardState | null): string {
  const params = new URLSearchParams();
  if (area) params.set("area", area);
  if (state) params.set("state", state);
  const q = params.toString();
  return q ? `/compliance?${q}` : "/compliance";
}

export default async function CompliancePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const [rows, subRows] = (await Promise.all([
    complianceBoard(),
    subcontractorComplianceRows(),
  ])) as [Row[], Row[]];

  const stateFilter = parseState(searchParams?.state);
  const areaFilter = parseArea(searchParams?.area);

  const subBoard = subcontractorComplianceBoard(groupSubRows(subRows));

  if (rows.length === 0 && subBoard.items.length === 0 && subBoard.currentCount === 0) {
    return (
      <div className="flex page-shell">
        <PageFrame
          help={PAGE_HELP["compliance"]}
          title="Compliance Board"
          status="Not set up yet"
          explanation="Renewals, registrations, and contract deadlines in one place. Brost Co watches dates; renewing is your job."
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

  /*
   * Counted across everything, then filtered. A summary that only counts what
   * is currently on screen would change every time a filter is applied, which
   * makes it a description of the filter rather than of the account.
   */
  const stateCounts: Record<BoardState, number> = {
    attention: 0,
    expiring: 0,
    cannot_monitor: 0,
    on_track: 0,
  };
  for (const r of deadlineRows) {
    const card = cardById.get(str(r.id));
    if (card) stateCounts[stateOf(card.color)] += 1;
  }
  for (const item of subBoard.items) {
    stateCounts[item.color === "red" ? "attention" : "expiring"] += 1;
  }
  stateCounts.on_track += subBoard.currentCount;

  /*
   * The next ninety days, in date order. Everything on this strip is also in
   * its area below; it exists because "which of these lands first" is the one
   * question an area listing cannot answer, and it was being answered by
   * reading every card and doing the arithmetic by hand.
   */
  const timeline: {
    key: string;
    label: string;
    daysLeft: number;
    dueDisplay: string;
    color: "red" | "amber" | "green";
  }[] = [];
  for (const r of deadlineRows) {
    const card = cardById.get(str(r.id));
    if (!card || card.daysLeft == null) continue;
    if (card.daysLeft < 0 || card.daysLeft > TIMELINE_DAYS) continue;
    timeline.push({
      key: card.id,
      label: card.label,
      daysLeft: card.daysLeft,
      dueDisplay: card.dueDisplay,
      color: card.color === "slate" ? "green" : card.color,
    });
  }
  for (const item of subBoard.items) {
    if (!item.dueDay) continue;
    const d = new Date(item.dueDay);
    if (Number.isNaN(d.getTime())) continue;
    const daysLeft = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
    if (daysLeft < 0 || daysLeft > TIMELINE_DAYS) continue;
    timeline.push({
      key: item.subId,
      label: `${item.companyName}: ${item.statusLabel.toLowerCase()}`,
      daysLeft,
      dueDisplay: shortDate(item.dueDay),
      color: item.color,
    });
  }
  timeline.sort((a, b) => a.daysLeft - b.daysLeft);

  const visibleRows = deadlineRows.filter((r) => {
    const card = cardById.get(str(r.id));
    if (!card) return false;
    if (stateFilter && stateOf(card.color) !== stateFilter) return false;
    if (areaFilter && areaFor(str(r.category)) !== areaFilter) return false;
    return true;
  });

  // Highlight overdue/blocking items up top.
  const urgent = visibleRows.filter((r) => cardById.get(str(r.id))?.color === "red");
  /*
   * Grouped by area, not by the raw category column. The category is kept as a
   * subheading inside an area that holds more than one of them, so no heading
   * that existed before has been taken away -- SAM registration and the state
   * filing still say which is which, they just now sit under the one question
   * they both answer.
   */
  const urgentIds = new Set(urgent.map((r) => str(r.id)));
  const groups = new Map<ComplianceArea, Map<string, Row[]>>();
  /*
   * Counted per area rather than dropped silently: an item pinned to the
   * attention section has left its area, and an area that just looks emptier
   * than it is would send someone looking for an item that is on the page.
   */
  const pinnedByArea = new Map<ComplianceArea, number>();
  for (const r of visibleRows) {
    const cat = str(r.category) || "other";
    const area = areaFor(cat);
    if (urgentIds.has(str(r.id))) {
      pinnedByArea.set(area, (pinnedByArea.get(area) ?? 0) + 1);
      continue;
    }
    if (!groups.has(area)) groups.set(area, new Map());
    const byCat = groups.get(area)!;
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r);
  }

  /*
   * The sixth area obeys the same filters. Leaving it unfiltered would make it
   * the one part of the board that ignores what was asked for, which reads as
   * a bug long before it reads as a feature.
   */
  const subVisible =
    areaFilter && areaFilter !== "subcontractor"
      ? { items: [], currentCount: 0 }
      : {
          items: subBoard.items.filter((i) => {
            if (!stateFilter) return true;
            return stateFilter === (i.color === "red" ? "attention" : "expiring");
          }),
          currentCount:
            !stateFilter || stateFilter === "on_track" ? subBoard.currentCount : 0,
        };

  const urgentCount = urgent.length;
  const subUrgent = subVisible.items.filter((i) => i.color === "red").length;
  /*
   * The headline describes the account, not the current filter. A number in
   * the page title that moves when a filter is applied is answering a
   * different question than the one it looks like it is answering.
   */
  const attentionCount = stateCounts.attention;
  const trackedCount = deadlineRows.length + subBoard.items.length + subBoard.currentCount;

  return (
    <div className="flex page-shell">
      <PageFrame
        help={PAGE_HELP["compliance"]}
        title="Compliance Board"
        status={
          attentionCount > 0
            ? `${attentionCount} need${attentionCount === 1 ? "s" : ""} attention now · ${trackedCount} tracked`
            : `${trackedCount} tracked item${trackedCount === 1 ? "" : "s"}${
                capRows.length ? ` · ${capRows.length} cap gauge${capRows.length === 1 ? "" : "s"}` : ""
              }`
        }
        explanation="Brost Co checks these daily and warns before anything lapses. Set renewal dates and links so countdowns work."
      >
        <Legend />
      </PageFrame>

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

        {/*
          * Summary and filter are one control rather than two. A summary row
          * that only reports, sitting above a filter row that only filters,
          * makes a person read a count and then find the matching filter --
          * two steps to answer "show me those four".
          */}
        <nav aria-label="Compliance status" className="flex flex-wrap gap-2">
          <Link
            href={areaFilter ? `/compliance?area=${areaFilter}` : "/compliance"}
            aria-current={stateFilter == null ? "page" : undefined}
            className={chipClass(stateFilter == null, false)}
          >
            Everything
            <span className="num text-muted-foreground">
              {stateCounts.attention +
                stateCounts.expiring +
                stateCounts.cannot_monitor +
                stateCounts.on_track}
            </span>
          </Link>
          {(["attention", "expiring", "cannot_monitor", "on_track"] as BoardState[]).map((st) => (
            <Link
              key={st}
              href={filterHref(areaFilter, stateFilter === st ? null : st)}
              aria-current={stateFilter === st ? "page" : undefined}
              className={chipClass(stateFilter === st, stateCounts[st] === 0)}
            >
              {STATE_LABEL[st]}
              <span className="num text-muted-foreground">{stateCounts[st]}</span>
            </Link>
          ))}
        </nav>

        <nav aria-label="Compliance areas" className="flex flex-wrap gap-2">
          {AREA_ORDER.map((a) => (
            <Link
              key={a}
              href={filterHref(areaFilter === a ? null : a, stateFilter)}
              aria-current={areaFilter === a ? "page" : undefined}
              className={chipClass(areaFilter === a, false)}
            >
              {AREA_LABEL[a]}
            </Link>
          ))}
        </nav>

        {timeline.length > 0 && (
          <section aria-labelledby="expiring-soon">
            <h2 id="expiring-soon" className="label mb-1">
              Landing in the next 90 days
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              In date order. Everything here is also in its area below; this is
              the one question an area listing cannot answer.
            </p>
            <ol className="space-y-1.5">
              {timeline.map((t) => (
                <li key={t.key} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-xs text-slate-500">{t.dueDisplay}</span>
                  <span className="hidden h-1.5 flex-1 rounded-full bg-slate-200 sm:block">
                    {/*
                      * Position, not width: the bar is a ruler across the
                      * ninety days, and the marker is where this item falls
                      * on it. A bar that grew with the number would read as
                      * "more" when it means "later".
                      */}
                    <span
                      className={`block h-1.5 w-1.5 rounded-full ${
                        t.color === "red"
                          ? "bg-risk"
                          : t.color === "amber"
                            ? "bg-review"
                            : "bg-pursue"
                      }`}
                      style={{
                        marginLeft: `${Math.min(99, (t.daysLeft / TIMELINE_DAYS) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground sm:flex-none sm:basis-1/3">
                    {t.label}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {t.daysLeft === 0 ? "due today" : `${t.daysLeft}d`}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {(stateFilter || areaFilter) &&
          visibleRows.length === 0 &&
          subVisible.items.length === 0 &&
          subVisible.currentCount === 0 && (
            <EmptyState
              tone="success"
              title="Nothing matches that filter"
              description="The counts above are for the whole board. Pick another one, or go back to everything."
              action={
                <Link href="/compliance" className="btn-ghost text-sm">
                  Show everything
                </Link>
              }
            />
          )}

        {(urgent.length > 0 || subUrgent > 0) && (
          <section data-guide-target="compliance-attention">
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
              {/*
                * Lapsed subcontractor coverage belongs here for the same reason
                * a lapsed registration does: it is one attention list, and an
                * exposure that only shows up further down the page is one the
                * person scanning the top of the board will not see.
                */}
              {subVisible.items
                .filter((i) => i.color === "red")
                .map((i) => (
                  <SubComplianceCard key={i.subId} item={i} />
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

        {AREA_ORDER.map((area) => {
          if (area === "subcontractor") {
            return <SubcontractorArea key={area} board={subVisible} />;
          }
          const byCat = groups.get(area);
          const pinned = pinnedByArea.get(area) ?? 0;
          if ((!byCat || byCat.size === 0) && pinned === 0) return null;
          const cats = byCat ? [...byCat.entries()] : [];
          const multipleCategories = cats.length > 1;
          return (
            <section key={area}>
              <h2 className="label mb-1">{AREA_LABEL[area]}</h2>
              <p className="mb-3 text-xs text-slate-500">{AREA_EXPLANATION[area]}</p>
              <div className="space-y-4">
                {cats.map(([cat, items]) => {
                  /*
                   * A heading over a single card whose own title says the same
                   * thing is noise. It earns its place when it groups.
                   */
                  const showHeading = multipleCategories && items.length > 1;
                  return (
                    <div key={cat}>
                      {showHeading && (
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {categoryLabel(cat)}
                        </h3>
                      )}
                      <div className="grid gap-2 md:grid-cols-2">
                        {items.map((r) => (
                          <ComplianceItemCard
                            key={str(r.id)}
                            item={cardById.get(str(r.id))!}
                            info={infoFor(cat)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {pinned > 0 && (
                <p className={cats.length > 0 ? "mt-2 text-xs text-slate-500" : "text-xs text-slate-500"}>
                  {pinned} item{pinned === 1 ? " in this area needs" : "s in this area need"} attention
                  now and {pinned === 1 ? "is" : "are"} shown at the top of the page.
                </p>
              )}
            </section>
          );
        })}
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
        <span className={`badge ${complianceColorClass(color)}`}>
          {STATUS_LABEL[status] ?? status}
        </span>
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

/**
 * The sixth area: paperwork the company does not hold itself.
 *
 * Rendered even when there is nothing to act on, because an empty area here is
 * information -- it says the check ran and found nothing -- while an absent
 * area is indistinguishable from a feature that does not exist. That was the
 * state this board was in before.
 */
function SubcontractorArea({ board }: { board: ReturnType<typeof subcontractorComplianceBoard> }) {
  const { items, currentCount } = board;
  if (items.length === 0 && currentCount === 0) return null;

  const pinned = items.filter((i) => i.color === "red");
  const rest = items.filter((i) => i.color !== "red");

  return (
    <section>
      <h2 className="label mb-1">{AREA_LABEL.subcontractor}</h2>
      <p className="mb-3 text-xs text-slate-500">{AREA_EXPLANATION.subcontractor}</p>

      {rest.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {rest.map((item) => (
            <SubComplianceCard key={item.subId} item={item} />
          ))}
        </div>
      ) : (
        pinned.length === 0 && (
          <p className="text-sm text-slate-600">
            Every subcontractor you are working with has current paperwork on file.
          </p>
        )
      )}

      {pinned.length > 0 && (
        <p className={rest.length > 0 ? "mt-2 text-xs text-slate-500" : "text-xs text-slate-500"}>
          {pinned.length} subcontractor{pinned.length === 1 ? "" : "s"} in this area need
          {pinned.length === 1 ? "s" : ""} attention now and {pinned.length === 1 ? "is" : "are"}{" "}
          shown at the top of the page.
        </p>
      )}

      {currentCount > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          {currentCount} other subcontractor{currentCount === 1 ? " has" : "s have"} current
          paperwork on file.{" "}
          <Link href="/subs" className="underline underline-offset-2">
            See all subcontractors
          </Link>
        </p>
      )}
    </section>
  );
}

function SubComplianceCard({ item }: { item: SubComplianceItem }) {
  const badge = item.color === "red" ? "bg-risk/15 text-risk" : "bg-review/15 text-review";
  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-2">
        {/*
          * The name is text, not a second link to the same place. One target
          * per destination: a 20px-tall title link is below the 44px minimum
          * and only repeated the button at the foot of the card.
          */}
        <p className="text-sm font-medium text-foreground">{item.companyName}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
          {item.statusLabel}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-slate-600">{item.reason}</p>
      <p className="mt-1 text-sm text-slate-600">{item.nextAction}</p>
      {item.dueDay && (
        <p className="mt-1.5 text-xs text-slate-500">Date on the document: {shortDate(item.dueDay)}</p>
      )}
      <Link
        href={`/subs/${item.subId}`}
        className="btn-ghost mt-2 inline-flex text-xs"
        data-guide-target="sub-compliance-open"
      >
        Open subcontractor
      </Link>
    </div>
  );
}
