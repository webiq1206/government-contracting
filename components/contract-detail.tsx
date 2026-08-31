import Link from "next/link";
import { GuidedPlanPanel } from "@/components/guided-plan";
import { OwnerPicker } from "@/components/owner-picker";
import { ContractRecordSections } from "@/components/contract-record";
import { buildContractPlan } from "@/lib/domain/contract-plan";
import { contractRisks, contractView } from "@/lib/domain/contract-status";
import { MARGIN_CONCERN_TEXT, MISSING_LABEL, marginConcern } from "@/lib/domain/contract-money";
import { shortDate } from "@/lib/format";
import type { ContractRecord } from "@/lib/contract-record";
import type { Owner } from "@/lib/domain/ownership";

/**
 * One contract, in full, wherever it is being read.
 *
 * Written once and rendered in two places: its own page, for a link somebody
 * sends, and the middle pane of the Contracts workspace, where the list stays
 * on the left. The whole reason it is a component rather than a page body is
 * that the second of those did not exist: reading five contracts meant five
 * page loads and five journeys back to a list that had reset to its first tab.
 */
export function ContractDetail({
  record,
  owner,
  members,
  viewerId,
  canEdit,
  /**
   * The column the sections sit in.
   *
   * A record page wants a measured column on a wide screen; the middle pane of
   * a workspace is already measured by the panes either side of it and a
   * second cap inside it just wastes the width the queue paid for.
   */
  className = "mx-auto max-w-4xl space-y-6",
}: {
  record: ContractRecord;
  owner: Owner | null;
  members: Owner[];
  viewerId?: string;
  canEdit: boolean;
  className?: string;
}) {
  const { header: h, money } = record;

  /*
   * One set of facts for both the view and the risks, built from the real
   * milestone rows.
   */
  const facts = {
    status: h.status,
    startDate: h.start_date,
    endDate: h.end_date,
    nonSsSubPct: h.non_ss_sub_pct,
    cparsDueAt: h.cpars_due_at,
    cparsStatus: h.cpars_status,
    milestones: record.milestones.map((m) => ({
      name: m.name,
      due: m.due_at ?? undefined,
      status: m.completed_at ? "complete" : "not started",
    })),
  };

  const risks = contractRisks(facts);
  const plan = buildContractPlan({
    completed: h.status === "completed" || h.status === "closed",
    hasBackupSub: Boolean(h.backup_sub_id),
    milestones: facts.milestones,
    coordinationCount: record.coordination.length,
    nonSsPct: Number(h.non_ss_sub_pct ?? 0),
    cparsStatus: h.cpars_status,
    cparsDue: h.cpars_due_at,
    now: new Date().toISOString(),
  });
  const concern = marginConcern(
    money.expectedMarginPct,
    h.target_margin_pct == null ? null : Number(h.target_margin_pct)
  );

  return (
<div className={className}>
          {risks.length > 0 && (
            <ul className="space-y-1 rounded-md border border-review/40 bg-review/10 px-3 py-2">
              {risks.map((r, i) => (
                <li key={i} className="text-xs text-foreground">
                  <span className={`label mr-1 inline ${r.blocking ? "text-risk" : "text-review"}`}>
                    {r.blocking ? "Blocked" : "Attention"}
                  </span>
                  {r.detail}
                </li>
              ))}
            </ul>
          )}

          <GuidedPlanPanel plan={plan} eyebrow="Running this contract" />

          <section className="card">
            <h2 className="mb-3 text-sm font-semibold text-foreground">The money</h2>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              <Money label="Contract value" cents={money.currentValueCents} />
              <Money label="Expected profit" cents={money.expectedProfitCents} />
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Expected margin
                </dt>
                <dd
                  className={`text-sm ${
                    concern === "negative"
                      ? "text-risk"
                      : concern === "below_target"
                        ? "text-review"
                        : money.expectedMarginPct === null
                          ? "text-muted-foreground"
                          : "text-foreground"
                  }`}
                >
                  {money.expectedMarginPct === null
                    ? "Not on file"
                    : `${money.expectedMarginPct.toFixed(1)}%`}
                </dd>
                {MARGIN_CONCERN_TEXT[concern] && (
                  <p className="text-xs text-muted-foreground">{MARGIN_CONCERN_TEXT[concern]}</p>
                )}
              </div>
              <Money label="Invoiced" cents={money.invoicedCents} />
              <Money label="Paid" cents={money.paidCents} />
              <Money label="Outstanding" cents={money.outstandingCents} />
              <Money label="Left to invoice" cents={money.remainingToInvoiceCents} />
              <Money label="Retainage held" cents={money.retainageCents} />
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Period</dt>
                <dd className="text-sm text-foreground">
                  {h.start_date || h.end_date
                    ? `${h.start_date ? shortDate(h.start_date) : "?"} to ${h.end_date ? shortDate(h.end_date) : "?"}`
                    : "Not on file"}
                </dd>
              </div>
            </dl>
            {money.missing.length > 0 && (
              <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                {/*
                  Names the numbers rather than leaving dashes to be guessed
                  at. A missing figure and a figure of zero read the same on a
                  page that only shows one of them.
                */}
                Some of this cannot be worked out yet. Still needed:{" "}
                {money.missing.map((m) => MISSING_LABEL[m]).join(", ")}.
              </p>
            )}
          </section>

          <section className="card">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Who and what</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Owner here</p>
                <div className="mt-1 max-w-xs">
                  {/*
                    * Compact, so the picker's own label is read out but not
                    * drawn. The heading above it already says what the control
                    * is, and printing "Owner here" over "Owner" made the field
                    * look like two fields.
                    */}
                  <OwnerPicker
                    kind="contract"
                    recordId={h.id}
                    owner={owner}
                    members={members}
                    viewerId={viewerId}
                    canAssign={canEdit}
                    compact
                  />
                </div>
              </div>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Fact label="Agency" value={h.agency} />
                <Fact
                  label="Primary subcontractor"
                  value={h.primary_sub_name}
                  href={h.primary_sub_id ? `/subs/${h.primary_sub_id}` : null}
                />
                <Fact
                  label="Backup subcontractor"
                  value={h.backup_sub_name}
                  href={h.backup_sub_id ? `/subs/${h.backup_sub_id}` : null}
                />
                <Fact label="Insurance the contract requires" value={h.insurance_required} />
                <Fact
                  label="Bond the contract requires"
                  value={
                    h.bond_required_cents == null
                      ? null
                      : `$${Math.round(Number(h.bond_required_cents) / 100).toLocaleString("en-US")}`
                  }
                />
                <Fact
                  label="Opportunity"
                  value={h.opportunity_title}
                  href={h.opportunity_id ? `/opportunity/${h.opportunity_id}` : null}
                />
              </dl>
            </div>
          </section>

          <ContractRecordSections
            contractId={h.id}
            milestones={record.milestones}
            modifications={record.modifications}
            invoices={record.invoices}
            issues={record.issues}
            coordination={record.coordination}
            canEdit={canEdit}
          />
        </div>
  );
}

/** The contract's view label, so a host can badge it without re-deriving. */
export function contractViewOf(record: ContractRecord) {
  return contractView({
    status: record.header.status,
    startDate: record.header.start_date,
    endDate: record.header.end_date,
    nonSsSubPct: record.header.non_ss_sub_pct,
    cparsDueAt: record.header.cpars_due_at,
    cparsStatus: record.header.cpars_status,
    milestones: record.milestones.map((m) => ({
      name: m.name,
      due: m.due_at ?? undefined,
      status: m.completed_at ? "complete" : "not started",
    })),
  });
}

function Money({ label, cents }: { label: string; cents: number | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${cents === null ? "text-muted-foreground" : "text-foreground"}`}>
        {/*
          "Not on file" rather than a dash or a zero. A contract with no
          invoices has not invoiced nothing; nobody has recorded anything
          either way, and "$0 invoiced" three months into a job is a statement
          somebody would act on.
        */}
        {cents === null
          ? "Not on file"
          : `${cents < 0 ? "-" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`}
      </dd>
    </div>
  );
}

function Fact({
  label, value, href,
}: {
  label: string;
  value: string | null;
  href?: string | null;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${value ? "text-foreground" : "text-muted-foreground"}`}>
        {value ? (
          href ? (
            <Link href={href} className="text-accent hover:underline">
              {value}
            </Link>
          ) : (
            value
          )
        ) : (
          "Not on file"
        )}
      </dd>
    </div>
  );
}
