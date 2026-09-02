import Link from "next/link";
import { NextResponse } from "next/server";
import { reviewQueue } from "@/lib/data";
import { PageFrame } from "@/components/page-frame";
import { PAGE_HELP } from "@/lib/help-content";
import { BulkReviewList } from "@/components/bulk-review-list";
import { ReviewBriefPanel } from "@/components/review-brief";
import { EmptyState } from "@/components/empty-state";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { countdown, shortDate } from "@/lib/format";
import { briefFor, briefSubtitle, sourceLinksFor } from "@/lib/review-brief";
import {
  ContextSection,
  WorkspacePlaceholder,
  WorkspaceShell,
} from "@/components/workspace/workspace-shell";
import { KeyHint, QueueKeys } from "@/components/workspace/workspace-keys";
import {
  advanceTarget,
  queueHrefBuilder,
  queuePosition,
  resolveSelection,
} from "@/lib/domain/workspace-queue";
import { EstimatedValue } from "@/components/estimated-value";
import { QuickViewDrawer } from "@/components/quick-view";
import {
  parseQuickView,
  quickViewValue,
} from "@/lib/domain/quick-view";
import { opportunityQuickViewData } from "@/lib/quick-view-data";
import { opportunityRowActions } from "@/lib/domain/row-actions";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Borderline scores, decided one after another.
 *
 * Three panes: the queue, the case, and the evidence the case was built from.
 * The third one is new and it is the one that stops the decision needing a
 * second screen. The brief says "weak on past performance"; the evidence pane
 * says which dimension scored what, out of how much, and how much of the
 * notice could be read at all. Before this, checking the brief's arithmetic
 * meant opening the record page and losing the queue.
 *
 * A decision now lands on the next decision rather than on the record just
 * decided. That is the whole difference between a screen you work and a screen
 * you visit.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const canDecide = can(ctx.user.orgRole, "decide");

  const opps = await reviewQueue();

  const rawSelected = searchParams?.o;
  const selectedId = (Array.isArray(rawSelected) ? rawSelected[0] : rawSelected) ?? null;
  /*
   * Default to the first in the queue rather than to nothing. The queue is
   * already ordered by how soon each one is dismissed automatically, so the
   * first is the one to decide, and an empty right-hand panel on a page whose
   * job is deciding is a page asking to be clicked before it does anything.
   */
  const selected: Opportunity | null = resolveSelection(
    opps,
    (o) => String(o.id),
    selectedId
  );

  const { forItem, base } = queueHrefBuilder("/review", {}, "o");
  const ids = opps.map((o) => String(o.id));
  const currentId = selected ? String(selected.id) : null;
  const position = queuePosition(ids, currentId);
  const nextId = advanceTarget(ids, currentId);
  const nextHref = nextId ? forItem(nextId) : null;
  const prevHref = position.prevId ? forItem(position.prevId) : null;

  const brief = selected ? briefFor(selected) : null;

  const peekTarget = parseQuickView(searchParams?.peek, {
    allowed: ["opportunity"],
  });
  const peeked = peekTarget
    ? await opportunityQuickViewData(peekTarget.id)
    : null;
  const peekValues = opps.map((o) =>
    quickViewValue({ kind: "opportunity", id: String(o.id) })
  );
  const peekValue = peekTarget ? quickViewValue(peekTarget) : null;
  const peekPosition = queuePosition(peekValues, peekValue);
  const {
    forItem: forPeek,
    base: closePeekHref,
  } = queueHrefBuilder("/review", searchParams ?? {}, "peek");
  const peekBaseQuery = (() => {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (key === "peek" || value == null) continue;
      if (Array.isArray(value)) value.forEach((item) => p.append(key, item));
      else p.set(key, value);
    }
    const query = p.toString();
    return query ? `/review?${query}&peek=` : "/review?peek=";
  })();

  /*
   * Which pane a phone gets, decided from the URL rather than from whichever
   * record happened to resolve. A quick look counts as opened: on a phone the
   * drawer is the screen, and leaving the queue mounted underneath it would
   * put two scrolling lists on top of each other.
   */
  const opened = selectedId != null || peekTarget != null;

  const urgent = opps.filter((o) => {
    const c = countdown(o.review_expires_at);
    return c === "overdue" || /^(\d|1\d)h/.test(c);
  }).length;

  return (
    <div className="flex page-shell">
      <div className={opened ? "hidden lg:contents" : "contents"}>
        <PageFrame
          help={PAGE_HELP["review"]}
          title="Review"
          status={
            opps.length === 0
              ? "Nothing waiting"
              : `${opps.length} to decide${urgent > 0 ? ` · ${urgent} dismissed within a day` : ""}`
          }
          explanation="Borderline scores. Read the case, then pursue or pass. Anything nobody decides is dismissed on its own timer."
        />
      </div>

      {opps.length === 0 ? (
        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          <EmptyState
            tone="success"
            title="No decisions waiting"
            description="Borderline opportunities will appear here for a quick pursue or pass decision."
            action={
              <Link href="/today" className="btn-ghost text-sm">
                Back to Today
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <QueueKeys
            prevHref={
              peeked
                ? peekPosition.prevId
                  ? forPeek(peekPosition.prevId)
                  : null
                : prevHref
            }
            nextHref={
              peeked
                ? peekPosition.nextId
                  ? forPeek(peekPosition.nextId)
                  : null
                : nextHref
            }
            closeHref={peeked ? closePeekHref : base}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
          <WorkspaceShell
            selected={opened}
            queueLabel="Decision queue"
            queueWidth="lg:w-[420px]"
            queue={
              <div data-guide-target="review-list">
                <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-background px-4 py-2 dark:border-white/5">
                  <div className="flex flex-wrap gap-1.5">
                    <KeyHint keys="J / K" label="move" />
                    <KeyHint keys="⌘ ↵" label="pursue and next" />
                  </div>
                  {position.index >= 0 && (
                    <span className="num text-xs text-muted-foreground">
                      {position.index + 1} of {position.total}
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <BulkReviewList
                    opps={opps}
                    selectedId={currentId}
                    hrefBase="/review?o="
                    peekHrefBase={peekBaseQuery}
                    role={ctx.user.orgRole}
                  />
                </div>
              </div>
            }
            primary={
              selected && brief ? (
                <ReviewBriefPanel
                  opportunityId={String(selected.id)}
                  title={selected.title ?? "Untitled opportunity"}
                  subtitle={briefSubtitle(selected)}
                  brief={brief}
                  canDecide={canDecide}
                  closeHref={base}
                  nextHref={nextHref}
                />
              ) : (
                <WorkspacePlaceholder>
                  Pick an opportunity to read the case for it. The queue is ordered by
                  how soon each one is dismissed on its own.
                </WorkspacePlaceholder>
              )
            }
            context={selected && !peeked ? <Evidence o={selected} /> : undefined}
            contextLabel="The evidence behind the score"
          />

          {/*
            * The drawer is a column of the page, not a pane inside the shell.
            *
            * Nesting it in the shell's context slot put a fixed-width drawer
            * inside a narrower fixed-width aside, where it was clipped on a
            * wide screen and stacked underneath the brief on a medium one.
            * Beside the shell it behaves the way it does on every other list:
            * its own column on a wide screen, a full sheet on a phone. The
            * evidence pane steps aside while it is open, so the widest layout
            * is still three columns rather than four.
            */}
          {peeked && (
            <QuickViewDrawer
              view={peeked.view}
              closeHref={closePeekHref}
              actions={opportunityRowActions(peeked.actionFacts, {
                role: ctx.user.orgRole,
              })}
              viewerId={ctx.user.id}
              nav={{
                prevHref: peekPosition.prevId ? forPeek(peekPosition.prevId) : null,
                nextHref: peekPosition.nextId ? forPeek(peekPosition.nextId) : null,
                index: peekPosition.index,
                total: peekPosition.total,
              }}
            />
          )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The third pane: where the recommendation came from.
 *
 * Deliberately raw. The brief above it is an argument, and an argument is
 * worth exactly as much as the reader's ability to check it. Every number here
 * is one the scoring actually used, named the way the rubric names it, so a
 * "weak on past performance" in the brief can be traced to a dimension, its
 * points, and the maximum it was scored out of.
 */
function Evidence({ o }: { o: Opportunity }) {
  const dims = o.score_breakdown?.dimensions ?? [];
  const confidence = o.score_breakdown?.data_confidence ?? null;
  const links = sourceLinksFor(o);
  const flags = o.risk_flags ?? [];

  return (
    <div className="space-y-4">
      <ContextSection
        title="Score, dimension by dimension"
        note="The rubric's own numbers, not a summary of them."
      >
        {dims.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No breakdown was stored for this one, so the score cannot be traced.
            That is itself worth knowing before deciding on it.
          </p>
        ) : (
          <ul className="space-y-2">
            {dims.map((d) => {
              const share = d.max_points > 0 ? d.points / d.max_points : 0;
              return (
                <li key={d.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-foreground">{d.label}</span>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {d.points} / {d.max_points}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${
                        share >= 0.7 ? "bg-pursue" : share >= 0.4 ? "bg-review" : "bg-risk"
                      }`}
                      style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
                    />
                  </div>
                  {d.reasoning && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{d.reasoning}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ContextSection>

      <ContextSection title="How much of the notice could be read">
        {confidence ? (
          <p className="text-sm text-foreground">
            <span className="num">{Math.round(confidence.percent)}</span> / 100 ·{" "}
            {confidence.level}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Never measured on this record. A score from a headline and a score from a
            full solicitation look identical until somebody checks.
          </p>
        )}
      </ContextSection>

      <ContextSection title="The record">
        <dl className="space-y-2 text-sm">
          <Row label="Agency" value={o.agency ?? null} />
          <Row label="Set-aside" value={o.set_aside_type ?? null} />
          <Row label="NAICS" value={o.naics_code ? String(o.naics_code) : null} />
          <Row label="Where" value={o.location_state ?? null} />
          <Row
            label="Deadline"
            value={o.deadline ? `${shortDate(String(o.deadline))} · ${countdown(o.deadline)}` : null}
          />
        </dl>
        <div className="mt-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Value</p>
          <EstimatedValue value={o.value_estimated} source={o.value_estimated_source} />
        </div>
      </ContextSection>

      {flags.length > 0 && (
        <ContextSection title="Flags on the record">
          <ul className="space-y-1 text-sm text-risk">
            {flags.map((f) => (
              <li key={String(f)}>· {String(f).replace(/_/g, " ")}</li>
            ))}
          </ul>
        </ContextSection>
      )}

      <ContextSection title="Read the original">
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No source URL was stored with this notice, so there is nothing to link
            to. The solicitation documents, if any were fetched, are on the record.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/opportunity/${o.id}`}
          className="mt-2 inline-flex text-sm text-accent underline-offset-2 hover:underline"
        >
          Open the full record
        </Link>
      </ContextSection>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={`min-w-0 truncate text-right ${value ? "text-foreground" : "text-muted-foreground"}`}>
        {value ?? "Not stated"}
      </dd>
    </div>
  );
}
