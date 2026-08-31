import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { PageToolbar } from "@/components/page-toolbar";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import {
  conversationList,
  conversationMessages,
  deliverabilityMessages,
} from "@/lib/conversations";
import {
  conversationCounts,
  deliverability,
  formatRate,
  matchesFilter,
  parseConversationFilter,
  CONVERSATION_FILTERS,
  CONVERSATION_FILTER_LABEL,
  CONVERSATION_STATE_LABEL,
  type ConversationFilter,
  type ConversationSummary,
} from "@/lib/domain/conversation-centre";
import { MESSAGE_STATE_LABEL, MESSAGE_STATE_MEANING } from "@/lib/domain/message-state";
import { ConversationThreadPane } from "@/components/conversation-centre";
import { KeyHint, QueueKeys } from "@/components/workspace/workspace-keys";
import { queuePosition } from "@/lib/domain/workspace-queue";
import { NeedsMatchingInbox } from "@/components/needs-matching-inbox";
import { needsMatching } from "@/lib/needs-matching";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

function href(filter: ConversationFilter, q: string, threadKey?: string | null): string {
  const p = new URLSearchParams();
  if (filter !== "all") p.set("filter", filter);
  if (q) p.set("q", q);
  if (threadKey) p.set("c", threadKey);
  const s = p.toString();
  return s ? `/communications?${s}` : "/communications";
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ageDays = (Date.now() - d.getTime()) / 86_400_000;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(ageDays < 1 ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function stateChipClass(state: ConversationSummary["state"]): string {
  const base = "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium";
  if (state === "delivery_failed") return `${base} bg-risk/15 text-risk`;
  if (state === "needs_reply" || state === "overdue") return `${base} bg-review/15 text-review`;
  if (state === "resolved") return `${base} bg-pursue/15 text-pursue`;
  return `${base} bg-slate-200 text-slate-600`;
}

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  /*
   * Reading is a view-level thing; sending is not. The composer is hidden for
   * anyone who could not send anyway, because offering a control that will
   * come back 403 is its own kind of lie. The API refuses it either way.
   */
  const canSend = can(ctx.user.orgRole, "outreach");
  /*
   * The raw text a remote mail server returned is a postmaster's diagnostic,
   * not something everybody reading a thread needs, and it names internal
   * message ids and host names. The plain-English reading of the code is what
   * the work turns on, and that is shown to everyone.
   */
  const canSeeRaw = can(ctx.user.orgRole, "manage_integrations");

  const raw = searchParams?.q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const filter = parseConversationFilter(searchParams?.filter);
  const selectedRaw = searchParams?.c;
  const selectedKey = (Array.isArray(selectedRaw) ? selectedRaw[0] : selectedRaw) ?? null;

  const [all, rates, pending, matchTargets] = await Promise.all([
    conversationList({ q: q || undefined }),
    deliverabilityMessages().then(deliverability),
    /*
     * Mail that arrived and could not be placed.
     *
     * On the Communications page rather than buried somewhere, because it IS
     * communications: a subcontractor wrote back and the product could not
     * work out about what. Before this it produced a line in the automation
     * log, which is a stream for when the machinery misbehaves, not a queue of
     * customer messages.
     */
    needsMatching(ctx.orgId).catch(() => []),
    query<{ id: string; title: string }>(
      `select id, title from opportunities
        where org_id = $1 and coalesce(pursuit_state,'active') = 'active'
          and stage not in ('archived','lost')
        order by coalesce(deadline, created_at) desc
        limit 100`,
      [ctx.orgId]
    ).catch(() => []),
  ]);

  /*
   * Counts over every conversation, never over the current filter or search.
   * A header that says "3 need your reply" and then says "1" because a search
   * is open is describing the search, not the inbox.
   */
  const counts = conversationCounts(all);
  const shown = all.filter((c) => matchesFilter(c, filter));

  const selected = selectedKey ? all.find((c) => c.threadKey === selectedKey) ?? null : null;
  /*
   * Where in the filtered list this conversation is, and what is either side.
   *
   * Over `shown` rather than `all`: the keys have to walk the list the reader
   * is looking at, or J from the last unread jumps into a thread the current
   * view deliberately excludes.
   */
  const threadPosition = queuePosition(
    shown.map((c) => c.threadKey),
    selectedKey
  );
  /*
   * Reading is recorded by the thread pane once it is mounted, never here.
   * Marking read during render looked simpler and was wrong: Next prefetches
   * the links in the list, a prefetch runs the server component, and hovering
   * the list marked every conversation in it read.
   */
  const messages = selected ? await conversationMessages(selected.threadKey) : [];

  if (all.length === 0 && !q) {
    return (
      <div className="flex page-shell">
        <PageFrame
          help={PAGE_HELP["email-log"]}
          title="Communications"
          status="No conversations yet"
          explanation="Every conversation with a subcontractor, what arrived, and who is waiting on whom."
        />
        <div className="scroll-thin flex-1 overflow-y-auto p-5">
          <EmptyState
            title="No mail either way yet"
            description="Conversations appear here once outreach runs on an opportunity you are pursuing, and once subcontractors write back."
            action={
              <Link href="/opportunities" className="btn-ghost text-sm">
                Open Opportunities
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex page-shell">
      {/*
        * Hidden on a narrow screen once a conversation is open, because the
        * thread is meant to be the whole screen there and the page header plus
        * the list's own search and filters were taking the top two thirds of
        * it. Both belong to the list; the thread carries its own header, its
        * subject, its sender and its way back.
        */}
      <div className={selected ? "hidden lg:contents" : "contents"}>
        <PageFrame
          help={PAGE_HELP["email-log"]}
          title="Communications"
          status={headline(counts, all.length)}
          explanation="Every conversation with a subcontractor, what arrived, and who is waiting on whom."
        />

        <PageToolbar>
        <form method="get" action="/communications" className="flex flex-wrap items-center gap-2">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by company, subject or solicitation…"
            aria-label="Search conversations by company, subject or solicitation"
            className="input w-full max-w-sm"
          />
          <button type="submit" className="btn-ghost text-sm">
            Search
          </button>
          {(q || filter !== "all") && (
            <Link href="/communications" className="tap text-xs text-slate-500 hover:text-accent">
              Clear
            </Link>
          )}
        </form>

        <nav aria-label="Conversation filters" className="mt-2 flex flex-wrap gap-2">
          {CONVERSATION_FILTERS.map((f) => {
            /*
             * Counted with the same predicate that decides membership, so a
             * chip can never advertise a number the view does not contain.
             * The switch this replaces fell through to the total for the two
             * filters it did not name, and both read "7" over one row.
             */
            const count = all.filter((c) => matchesFilter(c, f)).length;
            return (
              <Link
                key={f}
                href={href(f, q)}
                aria-current={f === filter ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1.5 ${
                  f === filter
                    ? "border-gold bg-gold/15 text-foreground"
                    : count === 0
                      ? "border-border text-muted-foreground"
                      : "border-border text-foreground hover:border-foreground/30"
                }`}
              >
                {CONVERSATION_FILTER_LABEL[f]}
                <span className="num text-muted-foreground">{count}</span>
              </Link>
            );
          })}
        </nav>
        </PageToolbar>

        {/*
          Above the conversation list, because a message nobody could place is
          more urgent than a thread that is filed correctly and waiting. It
          takes no space at all when the inbox is empty.
        */}
        {pending.length > 0 && (
          <div className="px-4 pb-2">
            <NeedsMatchingInbox
              messages={pending.map((m) => ({
                id: m.id,
                fromEmail: m.fromEmail,
                fromName: m.fromName,
                subject: m.subject,
                snippet: m.snippet,
                receivedAt: m.receivedAt.toISOString(),
                subcontractorId: m.subcontractorId,
                subcontractorName: m.subcontractorName,
              }))}
              opportunities={matchTargets}
              canAct={canSend}
            />
          </div>
        )}
      </div>

      {/*
        * Three panes on a wide screen, one at a time on a narrow one. The
        * mobile rule is the whole reason this is a query parameter rather than
        * client state: a chosen conversation is a URL, so the back button
        * returns to the list and a link to a conversation is shareable.
        */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <QueueKeys
          prevHref={threadPosition.prevId ? href(filter, q, threadPosition.prevId) : null}
          nextHref={threadPosition.nextId ? href(filter, q, threadPosition.nextId) : null}
          closeHref={href(filter, q)}
        />
        <section
          aria-label="Conversations"
          className={`scroll-thin w-full shrink-0 overflow-y-auto border-r border-border/55 dark:border-white/10 lg:w-[360px] ${
            selected ? "hidden lg:block" : "block"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-2 dark:border-white/5">
            <div className="flex flex-wrap gap-1.5">
              <KeyHint keys="J / K" label="move" />
              <KeyHint keys="Esc" label="back to the list" />
            </div>
            {threadPosition.index >= 0 && (
              <span className="num text-xs text-muted-foreground">
                {threadPosition.index + 1} of {threadPosition.total}
              </span>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="p-4">
              <EmptyState
                tone="success"
                title={q ? "No conversations match that search" : "Nothing in this view"}
                description={
                  q
                    ? "Try a company name, a subject, or the solicitation title."
                    : "The counts above are for every conversation. Pick another view."
                }
                action={
                  <Link href="/communications" className="btn-ghost text-sm">
                    Show everything
                  </Link>
                }
              />
            </div>
          ) : (
            <ul>
              {shown.map((c) => {
                const active = c.threadKey === selectedKey;
                return (
                  <li key={c.threadKey}>
                    <Link
                      href={href(filter, q, c.threadKey)}
                      aria-current={active ? "true" : undefined}
                      className={`block border-b border-border/40 px-4 py-3 transition-colors hover:bg-foreground/[0.03] dark:border-white/5 ${
                        active ? "bg-gold/10" : ""
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={`truncate text-sm ${
                            c.unreadCount > 0 ? "font-semibold text-foreground" : "text-foreground"
                          }`}
                        >
                          {c.subcontractorName}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-500">{when(c.lastAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="truncate text-xs text-slate-600">{c.subject}</span>
                        {c.unreadCount > 0 && (
                          <span className="num shrink-0 rounded-full bg-gold/25 px-1.5 text-[11px] text-foreground">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                      {c.preview && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">{c.preview}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={stateChipClass(c.state)}>
                          {CONVERSATION_STATE_LABEL[c.state]}
                        </span>
                        {c.opportunityTitle && (
                          <span className="truncate text-[11px] text-slate-500">
                            {c.opportunityTitle}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          aria-label="Conversation"
          className={`min-w-0 flex-1 ${selected ? "flex flex-col" : "hidden lg:flex lg:flex-col"}`}
        >
          {selected ? (
            <ConversationThreadPane
              conversation={selected}
              messages={messages}
              canSend={canSend}
              canSeeRaw={canSeeRaw}
              backHref={href(filter, q)}
              stateLabels={MESSAGE_STATE_LABEL}
              stateMeanings={MESSAGE_STATE_MEANING}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <p className="max-w-sm text-center text-sm text-slate-500">
                Pick a conversation to read it and reply. The list is ordered by the
                most recent message, and the view chips above narrow it to the ones
                that need something from you.
              </p>
            </div>
          )}
        </section>

        <aside
          aria-label="Deliverability"
          className="scroll-thin hidden w-[300px] shrink-0 overflow-y-auto border-l border-border/55 p-4 dark:border-white/10 xl:block"
        >
          {selected ? (
            <RelatedContext conversation={selected} rates={rates} />
          ) : (
            <Deliverability rates={rates} />
          )}
        </aside>
      </div>
    </div>
  );
}

function headline(
  counts: ReturnType<typeof conversationCounts>,
  total: number
): string {
  const parts: string[] = [];
  if (counts.needsReply > 0) parts.push(`${counts.needsReply} need your reply`);
  if (counts.deliveryFailed > 0) parts.push(`${counts.deliveryFailed} did not arrive`);
  if (counts.overdue > 0) parts.push(`${counts.overdue} follow-up overdue`);
  if (parts.length === 0) {
    return `${total} conversation${total === 1 ? "" : "s"} · nothing waiting on you`;
  }
  return `${parts.join(" · ")} · ${total} conversation${total === 1 ? "" : "s"}`;
}

/** The right pane when nothing is open: how the sending itself is doing. */
function Deliverability({ rates }: { rates: ReturnType<typeof deliverability> }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="label">Deliverability, last 90 days</h2>
        <p className="mt-1 text-xs text-slate-500">
          Measured over {rates.sent} message{rates.sent === 1 ? "" : "s"} you sent.
        </p>
      </div>
      <dl className="space-y-3">
        <Rate
          label="Arrived"
          value={formatRate(rates.deliveryRate)}
          note="Accepted by the receiving server."
        />
        <Rate
          label="Answered"
          value={formatRate(rates.responseRate)}
          note="People writing back. Out-of-office and bounce notices do not count."
        />
        <Rate
          label="Bounced"
          value={formatRate(rates.bounceRate)}
          note="Refused permanently. The address is wrong or gone."
        />
      </dl>
      {(rates.blocked > 0 || rates.failed > 0) && (
        <div className="rounded-md border border-border/60 p-3 text-xs text-slate-600">
          {rates.blocked > 0 && (
            <p>
              <span className="font-medium text-foreground">{rates.blocked} blocked</span> on policy
              grounds. That is about the sending domain rather than the addresses.
            </p>
          )}
          {rates.failed > 0 && (
            <p className={rates.blocked > 0 ? "mt-2" : ""}>
              <span className="font-medium text-foreground">{rates.failed} never sent.</span> The
              send itself failed, so those are ours to fix.{" "}
              <Link href="/agents" className="underline underline-offset-2">
                Automation Health
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Rate({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="num text-2xl text-foreground">{value}</dd>
      <p className="text-xs text-slate-500">{note}</p>
    </div>
  );
}

/** The right pane when a conversation is open: the records it belongs to. */
function RelatedContext({
  conversation,
  rates,
}: {
  conversation: ConversationSummary;
  rates: ReturnType<typeof deliverability>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="label">Related records</h2>
        <p className="mt-1 text-xs text-slate-500">{conversation.reason}</p>
      </div>

      <div className="space-y-2 text-sm">
        {conversation.subcontractorId ? (
          <Link
            href={`/subs/${conversation.subcontractorId}`}
            className="tap block text-foreground underline-offset-2 hover:underline"
          >
            {conversation.subcontractorName}
          </Link>
        ) : (
          <p className="text-foreground">{conversation.subcontractorName}</p>
        )}
        {conversation.subcontractorEmail && (
          <p className="break-all text-xs text-slate-500">{conversation.subcontractorEmail}</p>
        )}
        {conversation.trade && (
          <p className="text-xs text-slate-500">Trade: {conversation.trade}</p>
        )}
      </div>

      {conversation.opportunityId ? (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500">Solicitation</h3>
          <Link
            href={`/opportunity/${conversation.opportunityId}`}
            className="tap mt-1 block text-sm text-foreground underline-offset-2 hover:underline"
          >
            {conversation.opportunityTitle ?? "Open the opportunity"}
          </Link>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Not filed against a solicitation. Nothing links this conversation to a bid.
        </p>
      )}

      <div className="border-t border-border/55 pt-3 dark:border-white/10">
        <Deliverability rates={rates} />
      </div>
    </div>
  );
}
