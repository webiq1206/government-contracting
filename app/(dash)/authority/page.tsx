import Link from "next/link";
import { notFound } from "next/navigation";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { currentUser } from "@/lib/auth";
import { PageFrame } from "@/components/page-frame";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { OutreachApprovalCard } from "@/components/outreach-approval";
import {
  authorityOverview,
  backlinkProspects,
  outreachQueue,
  outreachActivity,
  backlinkChanges,
  type ProspectRow,
  type OutreachActivityRow,
} from "@/lib/data";
import { integrationStatus } from "@/lib/config";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import { PAGE_HELP } from "@/lib/help-content";
import { shortDate } from "@/lib/format";
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

const DR_GOAL = 50;

function tierBadgeClass(tier: string | null): string {
  if (tier === "high") return "bg-pursue/15 text-pursue";
  if (tier === "medium") return "bg-review/15 text-review";
  return "bg-slate-200 text-slate-600";
}

function fmtInt(n: number | null): string {
  return n == null ? "-" : new Intl.NumberFormat("en-US").format(Math.round(n));
}

const OPP_LABELS: Record<string, string> = {
  competitor_gap: "Competitor link",
  broken_link: "Broken link",
  resource_page: "Resource page",
  unlinked_mention: "Unlinked mention",
  guest_post: "Guest post",
  directory: "Directory",
  association: "Association",
  partnership: "Partnership",
  supplier: "Supplier",
  haro: "HARO",
};
function oppLabel(t: string): string {
  return OPP_LABELS[t] ?? t.replace(/_/g, " ");
}

function reasonsOf(p: ProspectRow): string[] {
  const q = p.qualification_json;
  if (q && typeof q === "object" && "reasons" in q) {
    const r = (q as { reasons?: unknown }).reasons;
    if (Array.isArray(r)) return r.map(String);
  }
  return [];
}

export default async function AuthorityPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  // Platform-owner tool: this tracks OUR marketing domain, not the customer's.
  // It was reachable by every signed-in customer, showing them our Ahrefs
  // data and a feature that means nothing to a contractor. 404 for everyone
  // else, matching how /admin/billing hides itself.
  const user = await currentUser().catch(() => null);
  if (!isPlatformAdmin(user?.email)) notFound();

  await hydrateIntegrationEnv();
  const status = integrationStatus();
  const connected = status.ahrefs;
  const [overview, prospects, pending, activity, changes] = await Promise.all([
    authorityOverview(),
    backlinkProspects(150),
    outreachQueue("pending"),
    outreachActivity(50),
    backlinkChanges(),
  ]);

  const dr = overview.latest?.domain_rating ?? null;
  const startDr = overview.first?.domain_rating ?? null;
  const drDelta = dr != null && startDr != null ? Math.round((dr - startDr) * 10) / 10 : null;
  const progressPct = dr != null ? Math.max(0, Math.min(100, (dr / DR_GOAL) * 100)) : 0;

  const highTier = prospects.filter((p) => p.tier === "high");
  const otherTier = prospects.filter((p) => p.tier !== "high");

  /*
   * The approval queue, as a workspace.
   *
   * `?draft=` swaps the dashboard for a three-pane screen: the pending drafts
   * on the left, the editable message in the middle, and what is actually
   * known about the domain on the right. The grid this replaces put two
   * editable letters side by side with the prospect's own numbers three
   * sections further down the page, so approving one meant scrolling away from
   * the only evidence that it was worth sending.
   */
  if (searchParams?.draft !== undefined) {
    const requested = Array.isArray(searchParams.draft)
      ? searchParams.draft[0]
      : searchParams.draft;
    const selected = resolveSelection(pending, (d) => d.id, requested || null);
    const ids = pending.map((d) => d.id);
    const currentId = selected?.id ?? null;
    /*
     * Whether the URL names a draft. The entry link is `?draft=` with no
     * value, which opens the first one on a wide screen and must still leave
     * the list in possession of a phone screen.
     */
    const opened = Boolean(requested);
    const pos = queuePosition(ids, currentId);
    const nextId = advanceTarget(ids, currentId);
    const { forItem, base } = queueHrefBuilder("/authority", {}, "draft");
    const prospectById = new Map(prospects.map((p) => [p.id, p]));
    const prospect = selected ? (prospectById.get(selected.prospect_id) ?? null) : null;

    const entries: QueueEntry[] = pending.map((d) => {
      const p = prospectById.get(d.prospect_id);
      return {
        id: d.id,
        href: forItem(d.id),
        title: d.domain,
        context: p ? oppLabel(p.opportunity_type) : d.channel,
        meta: p?.domain_rating != null ? `DR ${p.domain_rating}` : null,
        state: p?.tier
          ? {
              label: `${p.tier} priority`,
              tone: p.tier === "high" ? "attention" : "neutral",
            }
          : null,
      };
    });

    return (
      <div className="flex page-shell">
        <div className={currentId ? "hidden lg:contents" : "contents"}>
          <PageFrame
            title="Outreach approvals"
            help={PAGE_HELP["authority"]}
            breadcrumbs={[
              { label: "Site Authority", href: "/authority" },
              { label: "Approvals" },
            ]}
            status={
              pending.length === 0
                ? "Nothing waiting"
                : `${pending.length} draft${pending.length === 1 ? "" : "s"} awaiting approval`
            }
            explanation="Read the message and the evidence for the domain on one screen, then approve or reject. Nothing sends without a person."
          />
        </div>
        <QueueKeys
          prevHref={pos.prevId ? forItem(pos.prevId) : null}
          nextHref={nextId ? forItem(nextId) : null}
          closeHref={base}
        />
        <WorkspaceShell
          selected={opened}
          queueLabel="Drafts awaiting approval"
          queueWidth="lg:w-[320px]"
          queue={
            <QueueRail
              entries={entries}
              selectedId={currentId}
              heading="Awaiting approval"
              summary="Highest priority domain first."
              toolbar={
                <div className="flex flex-wrap gap-1.5">
                  <KeyHint keys="J / K" label="move" />
                  <KeyHint keys="Esc" label="back" />
                </div>
              }
              empty={
                <EmptyState
                  tone="success"
                  title="Nothing waiting for approval"
                  description="Draft outreach from a qualified prospect, then it appears here."
                  action={
                    <Link href="/authority" className="btn-ghost text-sm">
                      Back to Site Authority
                    </Link>
                  }
                />
              }
            />
          }
          primary={
            selected ? (
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
                        <p className="eyebrow mb-1">Outreach draft</p>
                        <h2 className="truncate text-base font-medium text-foreground">
                          {selected.domain}
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Written on {shortDate(selected.created_at)} · {selected.channel}
                        </p>
                      </div>
                      <span className="num shrink-0 text-xs text-muted-foreground">
                        {pos.index + 1} of {pos.total}
                      </span>
                    </div>
                  </div>
                }
              >
                <OutreachApprovalCard
                  draft={{
                    id: selected.id,
                    domain: selected.domain,
                    subject: selected.subject,
                    body: selected.body,
                  }}
                  nextHref={nextId ? forItem(nextId) : null}
                  doneHref={base}
                />
              </WorkspacePane>
            ) : (
              <WorkspacePlaceholder>
                Pick a draft to read it. Approving one moves you to the next, so a
                batch of drafts is a batch of decisions rather than a batch of page
                loads.
              </WorkspacePlaceholder>
            )
          }
          contextLabel="What is known about this domain"
          context={
            selected ? (
              <div className="space-y-4">
                <ContextSection
                  title="Why it qualified"
                  note="The reasons the scout recorded, not a summary of them."
                >
                  {prospect == null ? (
                    <p className="text-sm text-muted-foreground">
                      The prospect behind this draft is no longer in the qualified
                      list. Approving it would send to a domain nothing currently
                      vouches for.
                    </p>
                  ) : reasonsOf(prospect).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No reasons were recorded. That is worth knowing before sending.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-sm text-foreground">
                      {reasonsOf(prospect).map((r) => (
                        <li key={r}>· {r}</li>
                      ))}
                    </ul>
                  )}
                </ContextSection>

                {prospect && (
                  <ContextSection title="The numbers">
                    <dl className="space-y-2 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          Domain Rating
                        </dt>
                        <dd className="num text-foreground">
                          {fmtInt(prospect.domain_rating)}
                        </dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          Monthly traffic
                        </dt>
                        <dd className="num text-foreground">{fmtInt(prospect.traffic)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          Relevance
                        </dt>
                        <dd className="num text-foreground">{fmtInt(prospect.relevance)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          Priority
                        </dt>
                        <dd className="num text-foreground">
                          {fmtInt(prospect.priority_score)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2">
                      <span className={`badge ${tierBadgeClass(prospect.tier)}`}>
                        {prospect.tier ?? "untiered"}
                      </span>
                    </p>
                  </ContextSection>
                )}

                {prospect?.contact_email && (
                  <ContextSection title="Where it goes">
                    <p className="break-all text-sm text-foreground">
                      {prospect.contact_email}
                    </p>
                  </ContextSection>
                )}

                <ContextSection title="What approval does">
                  <p className="text-sm text-foreground">
                    Marks the message ready. Sending is a separate step and needs a
                    connected inbox, so approving never puts mail on the wire by
                    itself.
                  </p>
                  {!status.gmail && (
                    <p className="mt-2 text-xs text-review">
                      No inbox is connected, so approved drafts will queue rather than
                      go out.
                    </p>
                  )}
                </ContextSection>
              </div>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="flex page-shell">
      <PageFrame
        title="Site Authority"
        help={PAGE_HELP["authority"]}
        status={
          connected
            ? dr != null
              ? `DR ${dr} · ${pending.length} draft${pending.length === 1 ? "" : "s"} awaiting approval`
              : `${prospects.length} prospect${prospects.length === 1 ? "" : "s"} qualified`
            : "Ahrefs not connected"
        }
        explanation="Autonomous backlink discovery and qualification. Outreach is drafted for you; you approve before anything sends."
        primaryAction={
          connected ? (
            <ActionButton
              endpoint="/api/agents/backlink-scout/run"
              className="btn-primary text-sm"
            >
              Run scan now
            </ActionButton>
          ) : undefined
        }
      />

      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        {!connected && (
          <div className="callout-panel">
            <p className="text-sm font-medium text-foreground">Connect Ahrefs to turn this on.</p>
            <p className="mt-1 text-sm text-slate-600">
              Site Authority uses Ahrefs to track your Domain Rating, find backlink prospects from
              competitors, and watch for new or lost links. Add your API key on the{" "}
              <a href="/settings/integrations" className="text-accent hover:underline">
                Integrations
              </a>{" "}
              page.
            </p>
          </div>
        )}

        {/* Authority scorecards. */}
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="card">
            <p className="label">Domain Rating</p>
            <p className="num mt-1 text-3xl font-semibold text-foreground">{dr ?? "-"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {drDelta == null
                ? "Baseline pending"
                : drDelta >= 0
                  ? `▲ ${drDelta} since tracking began`
                  : `▼ ${Math.abs(drDelta)} since tracking began`}
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-pursue" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">Goal: DR {DR_GOAL}</p>
          </div>
          <div className="card">
            <p className="label">Referring domains</p>
            <p className="num mt-1 text-3xl font-semibold text-foreground">
              {fmtInt(overview.latest?.referring_domains ?? null)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {fmtInt(changes.liveCount)} tracked as live backlinks
            </p>
          </div>
          <div className="card">
            <p className="label">Prospects qualified</p>
            <p className="num mt-1 text-3xl font-semibold text-foreground">{fmtInt(prospects.length)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {highTier.length} high priority · {pending.length} awaiting your approval
            </p>
          </div>
        </section>

        {/* Approval queue — the human gate. */}
        <section>
          <h2 className="label mb-2">Outreach awaiting your approval</h2>
          {pending.length === 0 ? (
            <EmptyState
              title="Nothing waiting for approval"
              description="Draft outreach from a qualified prospect below, review the message, then approve it here. Drafts are never sent automatically."
            />
          ) : (
            <>
              <p className="mb-2">
                <Link href="/authority?draft=" className="btn-primary text-xs">
                  Work through them
                </Link>
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {pending.map((o) => (
                  <OutreachApprovalCard
                    key={o.id}
                    draft={{ id: o.id, domain: o.domain, subject: o.subject, body: o.body }}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        {/* In outreach — approved, sent, replied. */}
        {activity.length > 0 && (
          <section>
            <h2 className="label mb-2">In outreach</h2>
            {!status.gmail && activity.some((a) => !a.sent_at) && (
              <div className="callout-panel mb-2 text-sm text-slate-600">
                Some outreach is approved but not sent yet because Gmail isn&rsquo;t connected. Connect
                it on the{" "}
                <a href="/settings/integrations" className="text-accent hover:underline">
                  Integrations
                </a>{" "}
                page and it sends automatically.
              </div>
            )}
            <div className="card divide-y divide-border p-0">
              {activity.map((a) => (
                <OutreachActivityItem key={a.id} a={a} />
              ))}
            </div>
          </section>
        )}

        {/* Prospects. */}
        <section>
          <h2 className="label mb-2">
            Qualified prospects{" "}
            <span className="text-xs font-normal text-slate-500">
              (quality-first; spammy, off-topic, and no-index domains are rejected automatically)
            </span>
          </h2>
          {prospects.length === 0 ? (
            <EmptyState
              title="No prospects yet"
              description={
                connected
                  ? "Run a scan to discover competitor backlink opportunities."
                  : "Connect Ahrefs on Integrations to start discovering opportunities."
              }
              action={
                connected ? (
                  <ActionButton
                    endpoint="/api/agents/backlink-scout/run"
                    className="btn-primary text-sm"
                  >
                    Run scan now
                  </ActionButton>
                ) : (
                  <Link href="/settings/integrations" className="btn-primary text-sm">
                    Connect Ahrefs
                  </Link>
                )
              }
            />
          ) : (
            <div className="space-y-2">
              {[...highTier, ...otherTier].map((p) => (
                <ProspectItem key={p.id} p={p} />
              ))}
            </div>
          )}
        </section>

        {/* Backlink changes. */}
        <section className="grid gap-4 md:grid-cols-2">
          <div>
            {/*
              "Recently earned" claimed two things this list cannot support:
              that we did something to get these, and that they are worth
              having. It is a feed of newly-observed backlinks, and a scraper
              farm appears in it exactly like a trade publication does --
              which is how a page describing itself as quality-first came to
              present junk domains as wins. Named for what it is, with the
              ones that look like junk marked rather than blended in.
            */}
            <h2 className="label mb-2">New links detected</h2>
            {changes.recent.length === 0 ? (
              <EmptyState title="No backlinks recorded yet" />
            ) : (
              <div className="card divide-y divide-border p-0">
                {changes.recent.map((b) => {
                  // Ahrefs scores domain authority 0-100. Under ten is the
                  // band where link farms and expired-domain networks sit; it
                  // is not proof of anything, which is why this flags for a
                  // look rather than hiding the row.
                  const lowQuality = (b.domain_rating ?? 0) < 10;
                  return (
                    <div key={b.source_domain} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                      <span className="truncate text-foreground">{b.source_domain}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                        {lowQuality && (
                          <span className="badge bg-risk/15 text-risk">Check this</span>
                        )}
                        DR {b.domain_rating ?? "-"} · {shortDate(b.first_seen_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <h2 className="label mb-2 text-risk">Lost links</h2>
            {changes.lost.length === 0 ? (
              <EmptyState title="No lost links" tone="success" />
            ) : (
              <div className="card divide-y divide-border p-0">
                {changes.lost.map((b) => (
                  <div key={b.source_domain} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="truncate text-foreground">{b.source_domain}</span>
                    <span className="text-xs text-slate-500">
                      DR {b.domain_rating ?? "-"} · lost {b.lost_at ? shortDate(b.lost_at) : "-"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProspectItem({ p }: { p: ProspectRow }) {
  const reasons = reasonsOf(p);
  const canDraft = p.outreach_status !== "pending" && p.status !== "in_outreach";
  return (
    <div className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="num text-lg font-semibold text-foreground">{p.priority_score ?? "-"}</span>
          <span className={`badge uppercase ${tierBadgeClass(p.tier)}`}>{p.tier}</span>
          <span className="badge bg-slate-200 text-slate-600">{oppLabel(p.opportunity_type)}</span>
          <span className="truncate text-sm font-medium text-foreground">{p.domain}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          DR {p.domain_rating ?? "-"} · relevance {p.relevance != null ? Math.round(p.relevance * 100) : "-"}
          % · {fmtInt(p.traffic)} visits/mo · {p.link_type ?? "unknown"}
          {p.contact_email && <> · ✉ {p.contact_email}</>}
          {reasons.length > 0 && <> · {reasons.slice(0, 2).join(", ")}</>}
        </p>
      </div>
      <div className="shrink-0">
        {p.outreach_status === "pending" ? (
          <span className="badge bg-review/15 text-review">Drafted, awaiting approval</span>
        ) : p.status === "in_outreach" ? (
          <span className="badge bg-pursue/15 text-pursue">Approved</span>
        ) : canDraft ? (
          <ActionButton
            endpoint="/api/authority/draft"
            body={{ prospectId: p.id }}
            className="btn-ghost text-sm"
          >
            Draft outreach
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}

function OutreachActivityItem({ a }: { a: OutreachActivityRow }) {
  let state: { label: string; cls: string };
  if (a.replied_at) state = { label: `Replied ${shortDate(a.replied_at)}`, cls: "bg-pursue/15 text-pursue" };
  else if (a.send_error) state = { label: "Send failed", cls: "bg-risk/15 text-risk" };
  else if (a.sent_at)
    state = {
      label: `Sent ${shortDate(a.sent_at)}${a.follow_up_sent ? " · followed up" : ""}`,
      cls: "bg-slate-200 text-slate-600",
    };
  else if (a.contact_email) state = { label: "Approved · sending", cls: "bg-review/15 text-review" };
  else state = { label: "Approved · awaiting contact", cls: "bg-review/15 text-review" };

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
      <div className="min-w-0">
        <span className="text-foreground">{a.domain}</span>
        {a.contact_email && <span className="ml-2 text-xs text-slate-500">✉ {a.contact_email}</span>}
      </div>
      <span className={`badge shrink-0 ${state.cls}`}>{state.label}</span>
    </div>
  );
}
