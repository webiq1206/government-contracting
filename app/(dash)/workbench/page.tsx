import Link from "next/link";
import { NextResponse } from "next/server";
import { PageFrame } from "@/components/page-frame";
import { PageToolbar } from "@/components/page-toolbar";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { workQueue } from "@/lib/data";
import { assignableMembers, ownersFor } from "@/lib/ownership";
import { parseOwnerFilter } from "@/lib/domain/ownership";
import type { Owner } from "@/lib/domain/ownership";
import { OwnerPicker } from "@/components/owner-picker";
import { getAutomationRules } from "@/lib/app-settings";
import {
  KIND_FILTER_LABEL,
  QUEUE_FILTERS,
  QUEUE_FILTER_LABEL,
  bucketOf,
  filterWorkItems,
  isCompletedFilter,
  parseKindFilter,
  parseQueueFilter,
  queueCounts,
  stateOf,
  summarizeQueue,
  type WorkItem,
  type WorkKind,
} from "@/lib/domain/work-queue";
import { PANE_CHIP, PANE_INTENT, PANE_TITLE, paneFor } from "@/lib/domain/workbench";
import {
  advanceTarget,
  queueHrefBuilder,
  queuePosition,
  resolveSelection,
} from "@/lib/domain/workspace-queue";
import { loadWorkbenchDetail } from "@/lib/workbench";
import {
  ContextSection,
  WorkspacePlaceholder,
  WorkspaceShell,
} from "@/components/workspace/workspace-shell";
import { QueueRail, type QueueEntry, type QueueTone } from "@/components/workspace/queue-rail";
import { KeyHint, QueueKeys } from "@/components/workspace/workspace-keys";
import { WorkbenchPanel } from "@/components/workbench/workbench-panel";
import { countdown, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * One screen that finishes work, rather than six screens that lead to it.
 *
 * Today already knew everything waiting on a person: `workQueue()` collapses
 * replies, decisions, calls, quotes, bids and blockers into one ordered list.
 * What it did with that list was render six kinds of link. Clearing five items
 * meant five page loads to five different layouts, five hunts for the control
 * that finishes the thing, and five journeys back to a list that had moved
 * underneath you.
 *
 * This is the same list with the work attached to it. The queue stays on the
 * left and keeps its place; the middle is whatever this particular item needs
 * -- a decision brief, a subcontractor's own words, a price field, an
 * assembled bid package -- and the right holds the facts the decision turns
 * on. Finishing an item lands on the next one.
 *
 * What it deliberately is NOT: a replacement for the record pages. An
 * opportunity is a large thing with seven tabs and people genuinely need all
 * of it. Every pane here carries a way into the record, and the record is
 * where you go to study rather than to process.
 */

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** The queue row's state word, from the same axis Today's filters use. */
function toneFor(item: WorkItem, now: Date): { label: string; tone: QueueTone } {
  const state = stateOf(item);
  if (state === "blocked") return { label: "Blocked", tone: "blocked" };
  if (state === "waiting_on_others") {
    return { label: `Waiting on ${item.waitingOn?.party ?? "them"}`, tone: "waiting" };
  }
  const bucket = bucketOf(item, now);
  if (bucket === "overdue") return { label: "Overdue", tone: "blocked" };
  if (bucket === "due_today") return { label: "Due today", tone: "attention" };
  return { label: PANE_CHIP[paneFor(item)], tone: "neutral" };
}

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  const [items, rules, members] = await Promise.all([
    workQueue().catch((e) => {
      console.error("[workbench] queue failed to load:", e);
      return [] as WorkItem[];
    }),
    getAutomationRules(),
    assignableMembers().catch(() => []),
  ]);

  const q = one(searchParams?.q)?.trim() ?? "";
  const rawBucket = parseQueueFilter(searchParams?.due);
  /*
   * "Completed today" is a cut of the ledger rather than of this list, and
   * filterWorkItems throws rather than quietly returning an empty array. The
   * workbench has nothing to work on in that view, so it is not offered here;
   * an old link carrying it falls back to everything rather than to a crash.
   */
  const bucket = isCompletedFilter(rawBucket) ? "all" : rawBucket;
  const kind: WorkKind | null = parseKindFilter(searchParams?.kind);
  const owner = parseOwnerFilter(searchParams?.owner);
  const selectedKey = one(searchParams?.i) ?? null;

  const counts = queueCounts(items);
  const kindCounts = (Object.keys(KIND_FILTER_LABEL) as WorkKind[]).reduce(
    (acc, k) => {
      acc[k] = items.filter((i) => i.kind === k).length;
      return acc;
    },
    {} as Record<WorkKind, number>
  );

  const shown = filterWorkItems(items, {
    bucket,
    kind,
    q,
    owner,
    viewerId: ctx.user.id,
  });

  const params: Record<string, string | undefined> = {
    q: q || undefined,
    due: bucket === "all" ? undefined : bucket,
    kind: kind ?? undefined,
    owner: owner === "anyone" ? undefined : owner,
  };
  const { forItem, base } = queueHrefBuilder("/workbench", params, "i");

  const selected = resolveSelection(shown, (i) => i.key, selectedKey);
  /*
   * Whether the URL actually names an item, as opposed to the page having
   * picked the first one for a wide screen.
   *
   * The two must not be conflated. On a phone there is one pane at a time, and
   * treating the default selection as "an item is open" hides both the queue
   * and the page header on arrival, leaving the back link pointing at the URL
   * that just did it. Auto-selecting is right on a desktop, where the queue is
   * still on screen beside it.
   */
  const opened = Boolean(selectedKey);
  const ids = shown.map((i) => i.key);
  const position = queuePosition(ids, selected?.key ?? null);
  const nextKey = advanceTarget(ids, selected?.key ?? null);
  const nextHref = nextKey ? forItem(nextKey) : null;
  const prevHref = position.prevId ? forItem(position.prevId) : null;

  const now = new Date();
  const entries: QueueEntry[] = shown.map((i) => ({
    id: i.key,
    href: forItem(i.key),
    title: i.title,
    context: i.context || null,
    meta: i.due ? countdown(i.due) : null,
    state: toneFor(i, now),
  }));

  const detail = selected ? await loadWorkbenchDetail(selected, ctx.orgId) : null;
  const owners = selected?.opportunityId
    ? await ownersFor("opportunity", [selected.opportunityId]).catch(() => new Map())
    : new Map();

  const filtered = bucket !== "all" || kind != null || q !== "" || owner !== "anyone";

  return (
    <div className="flex page-shell">
      <div className={opened ? "hidden lg:contents" : "contents"}>
        <PageFrame
          help={PAGE_HELP["workbench"]}
          title="Workbench"
          status={summarizeQueue(items)}
          explanation="Everything waiting on a person, worked one at a time without leaving this screen."
          primaryAction={
            <Link href="/today" className="btn-ghost text-xs">
              Back to Today
            </Link>
          }
        />

        <PageToolbar>
          <form method="get" action="/workbench" className="flex flex-wrap items-center gap-2">
            {bucket !== "all" && <input type="hidden" name="due" value={bucket} />}
            {kind && <input type="hidden" name="kind" value={kind} />}
            {owner !== "anyone" && <input type="hidden" name="owner" value={owner} />}
            <label htmlFor="workbench-q" className="sr-only">
              Search the queue
            </label>
            <input
              id="workbench-q"
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Company, solicitation, or why it is here…"
              className="input w-full max-w-sm"
            />
            <button type="submit" className="btn-ghost text-sm">
              Search
            </button>
            {filtered && (
              <Link href="/workbench" className="tap text-xs text-muted-foreground hover:text-accent">
                Clear
              </Link>
            )}
          </form>

          {/*
            * One scrolling row on a phone, wrapped on a desktop. Eleven chips
            * stacked five rows deep pushed the queue itself off the bottom of
            * the screen, which is the one thing this page exists to show.
            */}
          <nav
            aria-label="Queue views"
            className="scroll-thin -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {QUEUE_FILTERS.filter((f) => !isCompletedFilter(f)).map((f) => {
              const active = f === bucket;
              const n =
                f === "all"
                  ? counts.total
                  : f === "overdue"
                    ? counts.overdue
                    : f === "due_today"
                      ? counts.dueToday
                      : f === "remaining"
                        ? counts.remaining
                        : items.filter((i) => stateOf(i) === f).length;
              return (
                <Link
                  key={f}
                  href={chip({ due: f === "all" ? undefined : f })}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1.5 ${
                    active
                      ? "border-gold bg-gold/15 text-foreground"
                      : n === 0
                        ? "border-border text-muted-foreground"
                        : "border-border text-foreground hover:border-foreground/30"
                  }`}
                >
                  {QUEUE_FILTER_LABEL[f]}
                  <span className="num text-muted-foreground">{n}</span>
                </Link>
              );
            })}
          </nav>

          <nav
            aria-label="Kinds of work"
            className="scroll-thin -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {(Object.keys(KIND_FILTER_LABEL) as WorkKind[]).map((k) => {
              const active = k === kind;
              return (
                <Link
                  key={k}
                  href={chip({ kind: active ? undefined : k })}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1.5 ${
                    active
                      ? "border-gold bg-gold/15 text-foreground"
                      : kindCounts[k] === 0
                        ? "border-border text-muted-foreground"
                        : "border-border text-foreground hover:border-foreground/30"
                  }`}
                >
                  {KIND_FILTER_LABEL[k]}
                  <span className="num text-muted-foreground">{kindCounts[k]}</span>
                </Link>
              );
            })}
          </nav>
        </PageToolbar>
      </div>

      {items.length === 0 ? (
        <div className="scroll-thin flex-1 overflow-y-auto p-5">
          <EmptyState
            tone="success"
            title="Nothing is waiting on a person"
            description="The automation keeps running: notices are polled and scored, outreach goes out, and replies are read. Anything it will not decide on its own lands here."
            action={
              <Link href="/pipeline" className="btn-ghost text-sm">
                Open Opportunities
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <QueueKeys prevHref={prevHref} nextHref={nextHref} closeHref={base} />
          <WorkspaceShell
            selected={opened}
            queueLabel="Work queue"
            queueWidth="lg:w-[400px]"
            queue={
              <QueueRail
                entries={entries}
                selectedId={selected?.key ?? null}
                heading="Your queue"
                summary={summarizeQueue(shown)}
                toolbar={
                  <div className="flex flex-wrap gap-1.5">
                    <KeyHint keys="J / K" label="move" />
                    <KeyHint keys="⌘ ↵" label="finish and next" />
                    <KeyHint keys="Esc" label="back to the list" />
                  </div>
                }
                empty={
                  <EmptyState
                    tone="success"
                    title="Nothing in this view"
                    description="The counts above are for the whole queue. Pick another view."
                    action={
                      <Link href="/workbench" className="btn-ghost text-sm">
                        Show everything
                      </Link>
                    }
                  />
                }
              />
            }
            primary={
              selected && detail ? (
                <WorkbenchPanel
                  item={selected}
                  detail={detail}
                  nextHref={nextHref}
                  doneHref={base}
                  canDecide={can(ctx.user.orgRole, "decide")}
                  canOutreach={can(ctx.user.orgRole, "outreach")}
                  canSubmit={can(ctx.user.orgRole, "submit")}
                  position={{ index: position.index, total: position.total }}
                />
              ) : (
                <WorkspacePlaceholder>
                  Pick an item to work on it. The queue is ordered by how close each
                  one is to a submitted bid, then by deadline.
                </WorkspacePlaceholder>
              )
            }
            context={
              selected ? (
                <div className="space-y-4">
                  <ContextSection title="Why this is here">
                    <p className="text-sm text-foreground">
                      {selected.blocker ?? selected.reason ?? PANE_INTENT[paneFor(selected)]}
                    </p>
                  </ContextSection>

                  <ContextSection title="What you are doing">
                    <p className="text-sm text-foreground">{PANE_TITLE[paneFor(selected)]}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PANE_INTENT[paneFor(selected)]}
                    </p>
                  </ContextSection>

                  <ContextSection title="Dates">
                    <dl className="space-y-2 text-sm">
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          Bid deadline
                        </dt>
                        <dd className={selected.due ? "text-foreground" : "text-muted-foreground"}>
                          {selected.due
                            ? `${shortDate(selected.due)} · ${countdown(selected.due)}`
                            : "None on this record"}
                        </dd>
                      </div>
                      {selected.expiresAt && (
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                            Dismissed automatically
                          </dt>
                          <dd className="text-foreground">
                            {shortDate(selected.expiresAt)} · {countdown(selected.expiresAt)}
                          </dd>
                        </div>
                      )}
                      {selected.waitingOn?.since && (
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                            Sent
                          </dt>
                          <dd className="text-foreground">
                            {shortDate(selected.waitingOn.since)}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </ContextSection>

                  {selected.opportunityId && (
                    <ContextSection
                      title="Who is doing it"
                      note="Unassigned is a real state, not a missing one. Nothing here guesses."
                    >
                      <OwnerPicker
                        kind="opportunity"
                        recordId={selected.opportunityId}
                        owner={(owners.get(selected.opportunityId) as Owner | undefined) ?? null}
                        members={members}
                        viewerId={ctx.user.id}
                        canAssign={can(ctx.user.orgRole, "decide")}
                      />
                    </ContextSection>
                  )}

                  <ContextSection title="Elsewhere">
                    <ul className="space-y-1.5 text-sm">
                      <li>
                        <Link
                          href={selected.recordHref}
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          Open the full record
                        </Link>
                      </li>
                      {selected.opportunityId && (
                        <li>
                          <Link
                            href={`/call-queue?opportunity=${selected.opportunityId}`}
                            className="text-accent underline-offset-2 hover:underline"
                          >
                            Calls for this bid
                          </Link>
                        </li>
                      )}
                      <li>
                        <Link
                          href="/communications"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          Conversations
                        </Link>
                      </li>
                    </ul>
                  </ContextSection>

                  <ContextSection title="Deadline rules">
                    <p className="text-xs text-muted-foreground">
                      This account treats a bid as urgent inside {rules.urgent_days}{" "}
                      {rules.urgent_days === 1 ? "day" : "days"} of its deadline. Change that
                      in{" "}
                      <Link href="/settings/rules" className="text-accent hover:underline">
                        Rules
                      </Link>
                      .
                    </p>
                  </ContextSection>
                </div>
              ) : undefined
            }
          />
        </>
      )}
    </div>
  );

  /** A filter chip's link: this page, with one parameter swapped. */
  function chip(over: Partial<Record<"due" | "kind" | "owner", string | undefined>>): string {
    const p = new URLSearchParams();
    const next = { ...params, ...over };
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
    }
    const s = p.toString();
    return s ? `/workbench?${s}` : "/workbench";
  }
}
