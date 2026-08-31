import Link from "next/link";
import { allContracts } from "@/lib/data";
import {
  contractView,
  contractRisks,
  contractsHeadline,
  VIEW_LABEL,
  VIEW_EXPLANATION,
  VIEW_ORDER,
  type ContractView,
} from "@/lib/domain/contract-status";
import { PageFrame } from "@/components/page-frame";
import { PageToolbar } from "@/components/page-toolbar";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { shortDate, pct } from "@/lib/format";
import { CreateContract } from "@/components/create-contract";
import { assignableMembers } from "@/lib/ownership";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/domain/roles";
import { contractRecord } from "@/lib/contract-record";
import { ContractDetail } from "@/components/contract-detail";
import { ownerOf } from "@/lib/ownership";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import {
  ContextSection,
  WorkspacePane,
  WorkspacePlaceholder,
  WorkspaceShell,
} from "@/components/workspace/workspace-shell";
import { QueueRail, type QueueEntry } from "@/components/workspace/queue-rail";
import { KeyHint, QueueKeys } from "@/components/workspace/workspace-keys";
import {
  advanceTarget,
  queueHrefBuilder,
  queuePosition,
  resolveSelection,
} from "@/lib/domain/workspace-queue";

export const dynamic = "force-dynamic";

function NonSsGauge({ pctValue }: { pctValue: number }) {
  const cap = 50;
  const ratio = Math.min(1, Math.max(0, pctValue / cap));
  const barClass =
    pctValue >= 49 ? "bg-risk" : pctValue >= 45 ? "bg-review" : "bg-pursue";
  const textClass =
    pctValue >= 49
      ? "text-risk"
      : pctValue >= 45
        ? "text-review"
        : "text-pursue";
  return (
    <div>
      {/*
        * Wraps rather than collides.
        *
        * This row lives in a 320px context pane as well as in a full-width
        * card, and at that width the label and the figure were overlapping:
        * a percentage printed on top of the words saying what it is a
        * percentage of.
        */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="label" title="Federal rules cap how much of the work can go to subcontractors that are not small businesses">
          Non-small-business sub spend
        </p>
        <span className={`text-sm font-semibold ${textClass}`}>
          {pct(pctValue)} of {cap}% cap
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        Federal rules: subs that are not small businesses can do at most 50% of
        the work. We warn at 45% and block new non-small-business subs at the cap.
      </p>
      <div className="relative mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${barClass}`}
          style={{ width: `${ratio * 100}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-slate-500"
          style={{ left: `${(45 / cap) * 100}%` }}
          title="45% alert"
        />
      </div>
    </div>
  );
}


export default async function ContractsPage({
  searchParams,
}: {
  searchParams?: { view?: string; c?: string };
}) {
  const [rows, teamMembers, viewer] = await Promise.all([
    allContracts(),
    // Tolerant: a picker that cannot load its list is a read-only owner
    // field, where a throw is a Contracts page that will not open.
    assignableMembers().catch(() => []),
    currentUser().catch(() => null),
  ]);

  /*
   * Offered only to a role that could actually save it. A control that comes
   * back 403 when pressed is its own kind of lie; the API refuses it either
   * way.
   */
  const canManage = can(viewer?.orgRole, "manage_contracts");

  /*
   * Bucket once, in one place. Splitting by stored status in SQL would mean
   * re-deriving "at risk" wherever it is needed, and a contract that reads
   * differently depending on which list you opened it from is worse than one
   * that reads badly in both.
   */
  const byView = new Map<ContractView, Record<string, unknown>[]>(
    VIEW_ORDER.map((v) => [v, [] as Record<string, unknown>[]])
  );
  const risksById = new Map<string, ReturnType<typeof contractRisks>>();
  for (const c of rows) {
    const facts = {
      status: c.status as string | null,
      startDate: c.start_date as string | null,
      endDate: c.end_date as string | null,
      nonSsSubPct: c.non_ss_sub_pct as number | string | null,
      cparsDueAt: c.cpars_due_at as string | null,
      cparsStatus: c.cpars_status as string | null,
      milestones: Array.isArray(c.milestones)
        ? (c.milestones as { name?: string; due?: string; status?: string }[])
        : null,
    };
    const view = contractView(facts);
    byView.get(view)!.push(c);
    if (view === "at_risk") risksById.set(String(c.id), contractRisks(facts));
  }

  const counts = Object.fromEntries(
    VIEW_ORDER.map((v) => [v, byView.get(v)!.length])
  ) as Record<ContractView, number>;

  const requested = (searchParams?.view ?? "") as ContractView;
  // Default to whichever view has something in it, worst first: opening on an
  // empty "At risk" tab hides the work rather than showing there is none.
  const active: ContractView =
    VIEW_ORDER.includes(requested) && counts[requested] > 0
      ? requested
      : (VIEW_ORDER.find((v) => counts[v] > 0) ?? "active");

  const shown = byView.get(active)!;

  /*
   * Master and detail, rather than a list that leads somewhere.
   *
   * Every contract on this page was a card with a link on it, and reading five
   * of them was five page loads and five journeys back to a list that had
   * reset to its first tab. The list holds still on the left now, the contract
   * opens beside it, and the risks that decide which one to open next stay
   * visible in the right-hand pane while you read.
   *
   * The record's own page is untouched and still the destination for a link
   * somebody sends. This is the same component, hosted differently.
   */
  const ids = shown.map((c) => String(c.id));
  const selectedRow = resolveSelection(shown, (c) => String(c.id), searchParams?.c ?? null);
  const currentId = selectedRow ? String(selectedRow.id) : null;
  /*
   * Whether the URL names a contract, as opposed to the page having opened the
   * first one for a wide screen. On a phone the difference decides whether the
   * list or the record gets the screen, and defaulting to the record there
   * hides the list on arrival.
   */
  const opened = Boolean(searchParams?.c);
  const pos = queuePosition(ids, currentId);
  const nextId = advanceTarget(ids, currentId);
  const { forItem, base } = queueHrefBuilder(
    "/contracts",
    { view: active },
    "c"
  );
  const orgId = (await tryResolveTenantOrgId()) ?? "";
  const [record, owner] = currentId
    ? await Promise.all([
        contractRecord(orgId, currentId).catch(() => null),
        ownerOf("contract", currentId).catch(() => null),
      ])
    : [null, null];

  const railEntries: QueueEntry[] = shown.map((c) => {
    const risks = risksById.get(String(c.id)) ?? [];
    const blocking = risks.some((r) => r.blocking);
    return {
      id: String(c.id),
      href: forItem(String(c.id)),
      title:
        (c.contract_number as string | null) ??
        (c.opportunity_title as string | null) ??
        "Contract",
      context: (c.agency as string | null) ?? (c.opportunity_title as string | null) ?? null,
      meta:
        c.end_date != null ? shortDate(String(c.end_date)) : null,
      state:
        risks.length > 0
          ? {
              label: blocking ? "Blocked" : `${risks.length} to look at`,
              tone: blocking ? "blocked" : "attention",
            }
          : { label: VIEW_LABEL[active], tone: "neutral" },
    };
  });

  return (
    <div className="flex page-shell">
      <div className={opened ? "hidden lg:contents" : "contents"}>
        <PageFrame
          help={PAGE_HELP["contracts"]}
          title="Contracts"
          status={contractsHeadline(counts)}
          explanation="Awarded work under performance tracking: milestones, coordination proof, and non-small-business sub spend caps."
          primaryAction={canManage ? <CreateContract /> : undefined}
        />

        {rows.length > 0 && (
          <PageToolbar>
            {/* The five views, in the order an operator works them. A view
                with nothing in it is still shown, so "no contracts at risk"
                is visible as an answer rather than as an absence. */}
            <nav
              aria-label="Contract views"
              className="scroll-thin flex gap-2 overflow-x-auto pb-1"
            >
              {VIEW_ORDER.map((v) => (
                <Link
                  key={v}
                  href={`/contracts?view=${v}`}
                  aria-current={v === active ? "page" : undefined}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1.5 ${
                    v === active
                      ? "border-gold bg-gold/15 text-foreground"
                      : counts[v] === 0
                        ? "border-border text-muted-foreground"
                        : "border-border text-foreground hover:border-foreground/30"
                  }`}
                >
                  {VIEW_LABEL[v]}
                  <span className={v === active ? "num text-foreground/70" : "num text-muted-foreground"}>
                    {counts[v]}
                  </span>
                </Link>
              ))}
            </nav>
            <p className="mt-2 text-xs text-muted-foreground">{VIEW_EXPLANATION[active]}</p>
          </PageToolbar>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-4xl">
            <EmptyState
              title="No contracts yet"
              description="When you record a win on an opportunity, the contract appears here for milestone tracking, coordination logs, and compliance caps."
              action={
                <div className="space-y-3">
                  <Link href="/pipeline" className="btn-ghost text-sm">
                    Open opportunities
                  </Link>
                  {canManage && <CreateContract />}
                </div>
              }
            />
          </div>
        </div>
      ) : (
        <>
          <QueueKeys
            prevHref={pos.prevId ? forItem(pos.prevId) : null}
            nextHref={nextId ? forItem(nextId) : null}
            closeHref={base}
          />
          <WorkspaceShell
            selected={opened}
            queueLabel="Contracts"
            queueWidth="lg:w-[340px]"
            queue={
              <QueueRail
                entries={railEntries}
                selectedId={currentId}
                heading={VIEW_LABEL[active]}
                summary={VIEW_EXPLANATION[active]}
                toolbar={
                  <div className="flex flex-wrap gap-1.5">
                    <KeyHint keys="J / K" label="move" />
                    <KeyHint keys="Esc" label="clear" />
                  </div>
                }
                empty={
                  <EmptyState
                    tone="success"
                    title={`Nothing ${VIEW_LABEL[active].toLowerCase()}`}
                    description="Pick another view above to see the rest."
                  />
                }
              />
            }
            primary={
              record ? (
                <WorkspacePane
                  header={
                    <div>
                      <Link
                        href={base}
                        className="tap mb-2 inline-flex text-xs text-muted-foreground hover:text-accent lg:hidden"
                      >
                        Back to the list
                      </Link>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="eyebrow mb-1">Contract</p>
                          <h2 className="truncate text-base font-medium text-foreground">
                            {record.header.contract_number ??
                              record.header.opportunity_title ??
                              "Contract"}
                          </h2>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {[record.header.agency, record.header.solicitation_number]
                              .filter(Boolean)
                              .join(" · ") || "No agency on the opportunity behind it"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="num text-xs text-muted-foreground">
                            {pos.index + 1} of {pos.total}
                          </span>
                          <Link
                            href={`/contracts/${record.header.id}`}
                            className="btn-ghost text-xs"
                          >
                            Own page
                          </Link>
                        </div>
                      </div>
                    </div>
                  }
                >
                  <ContractDetail
                    record={record}
                    owner={owner}
                    members={teamMembers}
                    viewerId={viewer?.id}
                    canEdit={canManage}
                    className="space-y-6"
                  />
                </WorkspacePane>
              ) : currentId ? (
                <WorkspacePlaceholder>
                  That contract could not be loaded. It may have been removed, or it
                  belongs to another account.
                </WorkspacePlaceholder>
              ) : (
                <WorkspacePlaceholder>
                  Pick a contract to open it here. The list stays where it is, so
                  reading four of them is four clicks rather than four page loads.
                </WorkspacePlaceholder>
              )
            }
            contextLabel="What needs watching"
            context={
              selectedRow ? (
                <div className="space-y-4">
                  <ContextSection
                    title="What is wrong"
                    note="The reason this contract is in front of you, kept in view while you read the rest."
                  >
                    {(risksById.get(String(selectedRow.id)) ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nothing is flagged on this one. Milestones, invoices and the
                        sub-spend cap are all inside their tolerances.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {risksById.get(String(selectedRow.id))!.map((r, i) => (
                          <li key={i} className="text-sm text-foreground">
                            <span
                              className={`label mr-1 inline ${r.blocking ? "text-risk" : "text-review"}`}
                            >
                              {r.blocking ? "Blocked" : "Attention"}
                            </span>
                            {r.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </ContextSection>

                  <ContextSection title="Sub spend against the cap">
                    <NonSsGauge pctValue={Number(selectedRow.non_ss_sub_pct ?? 0)} />
                  </ContextSection>

                  <ContextSection title="Elsewhere">
                    <ul className="space-y-1.5 text-sm">
                      <li>
                        <Link
                          href={`/contracts/${String(selectedRow.id)}`}
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          This contract on its own page
                        </Link>
                      </li>
                      {selectedRow.opportunity_id != null && (
                        <li>
                          <Link
                            href={`/opportunity/${String(selectedRow.opportunity_id)}`}
                            className="text-accent underline-offset-2 hover:underline"
                          >
                            The bid that won it
                          </Link>
                        </li>
                      )}
                      <li>
                        <Link
                          href="/compliance"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          Compliance board
                        </Link>
                      </li>
                    </ul>
                  </ContextSection>
                </div>
              ) : undefined
            }
          />
        </>
      )}
    </div>
  );
}
