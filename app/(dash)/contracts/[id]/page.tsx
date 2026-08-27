import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { GuidedPlanPanel } from "@/components/guided-plan";
import { OwnerPicker } from "@/components/owner-picker";
import { ContractRecordSections } from "@/components/contract-record";
import { contractRecord } from "@/lib/contract-record";
import { buildContractPlan } from "@/lib/domain/contract-plan";
import { contractRisks, contractView, VIEW_LABEL } from "@/lib/domain/contract-status";
import { MARGIN_CONCERN_TEXT, MISSING_LABEL, marginConcern } from "@/lib/domain/contract-money";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { assignableMembers, ownerOf } from "@/lib/ownership";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/domain/roles";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * One contract, on its own page.
 *
 * There was no route for a contract at all. Everything lived as a card in a
 * list, which meant a contract could not be linked to, could not be reached
 * from search, and could never hold more than card-sized detail. The five
 * things a live federal contract actually accumulates after award had nowhere
 * to be shown because they had nowhere to be recorded.
 */
export default async function ContractPage({ params }: { params: { id: string } }) {
  const orgId = (await tryResolveTenantOrgId()) ?? "";
  const record = await contractRecord(orgId, params.id);
  if (!record) notFound();

  const { header: h, money } = record;
  const viewer = await currentUser().catch(() => null);
  const canEdit = can(viewer?.orgRole, "manage_contracts");
  const [teamMembers, owner] = await Promise.all([
    assignableMembers().catch(() => []),
    ownerOf("contract", params.id).catch(() => null),
  ]);

  /*
   * One set of facts for both the view and the risks, built from the real
   * milestone rows. Both used to read a jsonb column nothing could write, so
   * every contract was permanently "no milestones recorded".
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

  const view = contractView(facts);
  const risks = contractRisks(facts);

  const plan = buildContractPlan({
    completed: h.status === "completed" || h.status === "closed",
    hasBackupSub: Boolean(h.backup_sub_id),
    /*
     * From the real milestone rows now, not from a jsonb column nothing could
     * write. The plan used to reason over a list that was always empty, so
     * "no milestones recorded" was the permanent answer for every contract.
     */
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
    <div className="flex page-shell">
      <PageFrame
        breadcrumbs={[
          { label: "Contracts", href: "/contracts" },
          { label: h.contract_number ?? "Contract" },
        ]}
        title={h.contract_number ?? h.opportunity_title ?? "Contract"}
        explanation={
          [h.agency, h.opportunity_title].filter(Boolean).join(" · ") ||
          "No agency recorded on the opportunity behind this contract"
        }
        status={
          <span className="flex flex-wrap items-center gap-2">
            <span className="badge bg-surface-raised text-foreground">{VIEW_LABEL[view]}</span>
            {h.created_manually && (
              // Says where the record came from. A contract entered by hand
              // has no bid behind it, and several numbers on this page are
              // absent for that reason rather than by oversight.
              <span className="badge bg-surface-raised text-muted-foreground">Entered by hand</span>
            )}
            {h.solicitation_number && (
              <span className="text-muted-foreground">{h.solicitation_number}</span>
            )}
          </span>
        }
      />

      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-4xl space-y-6">
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
                  <OwnerPicker
                    kind="contract"
                    recordId={h.id}
                    owner={owner}
                    members={teamMembers}
                    viewerId={viewer?.id}
                    canAssign={canEdit}
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
      </div>
    </div>
  );
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
