/**
 * Turning yesterday's facts into the eight sections somebody reads at six in
 * the morning.
 *
 * Every judgement in the recap lives here and nowhere else: what counts as
 * urgent, how an item that has been urgent for four days is described, what an
 * empty section says, and when the whole thing collapses into the short
 * "nothing happened" note. The queries upstream only fetch; the renderers
 * downstream only draw.
 *
 * Two rules the whole file is built around:
 *
 *   1. Nothing is invented. Every number traces to rows that exist and every
 *      item links to the record it is about. A recap that rounds, estimates or
 *      fills a gap with a plausible figure is worse than no recap, because it
 *      is believed.
 *
 *   2. A repeat is not news. An item that appeared yesterday is shown as what
 *      it is, an old problem getting older, and sorted above the new ones
 *      rather than mixed in with them. Otherwise the urgent section becomes
 *      wallpaper inside a week.
 *
 * Pure.
 */
import {
  RECAP_SECTION_BLURBS,
  RECAP_SECTION_KEYS,
  RECAP_SECTION_TITLES,
  type Recap,
  type RecapFacts,
  type RecapItem,
  type RecapSection,
  type RecapSectionKey,
  type RecapSettings,
  type RecapTotal,
} from "./types";
import {
  callDestination,
  draftDestination,
  replyDestination,
  reviewDestination,
} from "./destinations";

// ---------------------------------------------------------------------------
// Time in words. Local to this module so the wording is one edit, not six.
// ---------------------------------------------------------------------------

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "in 6 hours", "in 3 days", "2 days ago". Never a bare timestamp. */
export function whenDue(iso: string | null | undefined, now: Date): string {
  if (!iso) return "no date on file";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "no date on file";
  const hours = hoursBetween(now, at);
  if (hours < 0) {
    const overdue = Math.abs(hours);
    if (overdue < 24) return `${plural(Math.max(1, Math.round(overdue)), "hour")} ago`;
    return `${plural(Math.round(overdue / 24), "day")} ago`;
  }
  if (hours < 1) return "within the hour";
  if (hours < 48) return `in ${plural(Math.round(hours), "hour")}`;
  return `in ${plural(Math.round(hours / 24), "day")}`;
}

/** "4 hours ago", "yesterday", "6 days ago". */
export function whenSince(iso: string | null | undefined, now: Date): string {
  if (!iso) return "at an unrecorded time";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "at an unrecorded time";
  const hours = hoursBetween(at, now);
  if (hours < 1) return "in the last hour";
  if (hours < 24) return `${plural(Math.round(hours), "hour")} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  return `${plural(days, "day")} ago`;
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "no amount recorded";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * How an item that keeps coming back is described.
 *
 * The age is stated in the item rather than implied by position, because a
 * recap gets skimmed and position is the first thing skimming loses.
 */
export function ageNote(ageDays: number | undefined): string | null {
  if (!ageDays || ageDays < 1) return null;
  if (ageDays === 1) return "On this list since yesterday";
  return `On this list for ${plural(ageDays, "day")}`;
}

// ---------------------------------------------------------------------------
// Urgency
// ---------------------------------------------------------------------------

/**
 * The urgent items, before ages are applied.
 *
 * Exported separately from `buildRecap` because the caller has to know the
 * keys in order to look up how long each has been urgent, and computing them
 * twice with two copies of these rules is how the two copies diverge.
 */
export function collectUrgent(
  facts: RecapFacts,
  settings: RecapSettings,
  now: Date
): RecapItem[] {
  const items: RecapItem[] = [];
  const t = settings.urgent;

  // 1. Deadlines close enough to hurt, on work not yet submitted.
  for (const d of facts.deadlines) {
    if (d.submitted) continue;
    const hours = hoursBetween(now, new Date(d.deadline));
    if (!Number.isFinite(hours) || hours > t.deadline_hours) continue;
    const past = hours < 0;
    items.push({
      key: `deadline:${d.id}`,
      title: d.title,
      detail: [
        d.agency,
        d.quotesIn > 0 ? `${plural(d.quotesIn, "quote")} in` : "no quotes recorded yet",
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/opportunity/${d.id}`,
      reason: past ? "Deadline has passed" : "Deadline is close",
      when: past ? `Closed ${whenDue(d.deadline, now)}` : `Due ${whenDue(d.deadline, now)}`,
      severity: past || hours <= 24 ? "critical" : "warning",
    });
  }

  // 2. A subcontractor wrote back and nobody has answered.
  for (const r of facts.unansweredReplies) {
    const hours = hoursBetween(new Date(r.createdAt), now);
    if (!Number.isFinite(hours) || hours < t.unanswered_reply_hours) continue;
    items.push({
      key: `reply:${r.id}`,
      title: `${r.subcontractor ?? "A subcontractor"} is waiting on an answer`,
      detail: [r.opportunity, r.intent ? `they wrote about a ${r.intent}` : null]
        .filter(Boolean)
        .join(" · "),
      href: replyDestination(r),
      recordHref: r.subcontractorId ? `/subs/${r.subcontractorId}` : undefined,
      reason: "Reply unanswered",
      when: `They wrote ${whenSince(r.createdAt, now)}`,
      severity: hours >= t.unanswered_reply_hours * 2 ? "critical" : "warning",
    });
  }

  /*
   * 3. Mail that did not arrive.
   *
   * Grouped into one item rather than one per address. A mailbox outage
   * produces forty of these in a morning, and forty identical urgent lines is
   * a recap nobody finishes reading. The count is the story; the log has the
   * addresses.
   */
  if (facts.failedSends.length >= t.failed_send_count) {
    const first = facts.failedSends[0];
    const names = facts.failedSends
      .slice(0, 3)
      .map((f) => f.subcontractor ?? f.recipient ?? "an unnamed contact")
      .join(", ");
    items.push({
      key: "failed-sends",
      title: `${plural(facts.failedSends.length, "outreach email")} did not go out`,
      detail:
        facts.failedSends.length > 3
          ? `${names} and ${facts.failedSends.length - 3} more`
          : names,
      href: "/communications",
      reason: "Delivery failed",
      when: first ? `Most recent ${whenSince(first.createdAt, now)}` : undefined,
      severity: "critical",
    });
  }

  // 4. Compliance that is blocked, critical, or about to lapse.
  for (const c of facts.compliance) {
    const blocked = c.status === "blocked" || c.status === "critical";
    const days = c.dueAt ? hoursBetween(now, new Date(c.dueAt)) / 24 : Number.POSITIVE_INFINITY;
    if (!blocked && !(Number.isFinite(days) && days <= t.compliance_days)) continue;
    items.push({
      key: `compliance:${c.id}`,
      title: c.label,
      detail: c.category ? `Compliance · ${c.category}` : "Compliance",
      href: "/compliance",
      reason: blocked ? `Marked ${c.status}` : "Due soon",
      when: c.dueAt ? `Due ${whenDue(c.dueAt, now)}` : "No due date recorded",
      severity: blocked || days <= 1 ? "critical" : "warning",
    });
  }

  // 5. A review decision that expires if nobody makes it.
  for (const r of facts.reviewQueue) {
    if (!r.expiresAt) continue;
    const hours = hoursBetween(now, new Date(r.expiresAt));
    if (!Number.isFinite(hours) || hours > t.review_expiry_hours) continue;
    items.push({
      key: `review-expiry:${r.id}`,
      title: `${r.title} needs a pursue or pass decision`,
      detail:
        r.score != null ? `Scored ${r.score}${r.tier ? ` · ${r.tier}` : ""}` : (r.tier ?? undefined),
      href: `/opportunity/${r.id}`,
      reason: hours < 0 ? "Review window has closed" : "Review window closing",
      when: hours < 0 ? `Closed ${whenDue(r.expiresAt, now)}` : `Closes ${whenDue(r.expiresAt, now)}`,
      severity: hours <= 0 ? "critical" : "warning",
    });
  }

  return items;
}

const SEVERITY_RANK: Record<NonNullable<RecapItem["severity"]>, number> = {
  critical: 0,
  warning: 1,
  normal: 2,
};

/**
 * Oldest first inside each severity band.
 *
 * The thing that has been wrong longest is the thing most likely to have been
 * skipped on purpose, and it needs to stop being at the bottom of the list.
 */
function sortUrgent(items: RecapItem[]): RecapItem[] {
  return [...items].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity ?? "normal"] - SEVERITY_RANK[b.severity ?? "normal"];
    if (sev !== 0) return sev;
    return (b.ageDays ?? 0) - (a.ageDays ?? 0);
  });
}

// ---------------------------------------------------------------------------
// The recap
// ---------------------------------------------------------------------------

export interface BuildRecapContext {
  scope: "org" | "platform";
  localDate: string;
  timezone: string;
  dayLabel: string;
  now: Date;
  /** item key -> mornings it has already appeared on. */
  ages: Record<string, number>;
  /** The day is still running, so the totals are "so far". */
  partial: boolean;
}

export function buildRecap(
  facts: RecapFacts,
  settings: RecapSettings,
  ctx: BuildRecapContext
): Recap {
  const { now, ages } = ctx;
  const include = (key: RecapSectionKey) => settings.sections.includes(key);

  const urgent = sortUrgent(
    collectUrgent(facts, settings, now).map((i) => ({ ...i, ageDays: ages[i.key] ?? 0 }))
  );

  const problems: RecapItem[] = facts.problems.map((p) => ({
    key: p.key,
    title: p.title,
    detail: p.detail ?? undefined,
    href: p.href ?? "/agents",
    ageDays: ages[p.key] ?? 0,
    reason: p.count > 1 ? `${plural(p.count, "time")}` : undefined,
    when: p.lastAt ? `Most recent ${whenSince(p.lastAt, now)}` : undefined,
    severity: p.severity,
  }));

  const sections: RecapSection[] = [];

  for (const key of RECAP_SECTION_KEYS) {
    if (!include(key)) continue;
    sections.push(buildSection(key, facts, settings, ctx, { urgent, problems }));
  }

  /*
   * What makes a day quiet.
   *
   * Not "no rows anywhere": a day with an unanswered reply from Thursday and
   * no new activity is not quiet, it is a day somebody needs to act on. Quiet
   * means nothing needs a person and nothing happened worth reporting. Totals
   * alone do not disqualify it, because a batch of automated scoring runs
   * overnight on a Sunday and nobody wants eight sections about it.
   */
  const totals = facts.totals;
  const hadActivity =
    totals.outreachSent > 0 ||
    totals.repliesReceived > 0 ||
    totals.quotesRecorded > 0 ||
    totals.bidsSubmitted > 0 ||
    totals.callsLogged > 0 ||
    totals.decisionsMade > 0 ||
    totals.opportunitiesDiscovered > 0 ||
    totals.complianceResolved > 0 ||
    totals.subsAdded > 0;
  const quiet =
    urgent.length === 0 &&
    problems.length === 0 &&
    !hadActivity &&
    facts.reviewQueue.length === 0 &&
    facts.callQueue.length === 0 &&
    facts.draftsWaiting.length === 0;

  return {
    scope: ctx.scope,
    orgId: facts.orgId,
    orgName: facts.orgName,
    localDate: ctx.localDate,
    timezone: ctx.timezone,
    dayLabel: ctx.dayLabel,
    quiet,
    urgentCount: urgent.length,
    problemCount: problems.length,
    sections,
    generatedAt: now.toISOString(),
    partial: ctx.partial,
  };
}

function section(
  key: RecapSectionKey,
  emphasis: RecapSection["emphasis"],
  empty: string,
  items: RecapItem[],
  totals: RecapTotal[] = []
): RecapSection {
  return {
    key,
    title: RECAP_SECTION_TITLES[key],
    blurb: RECAP_SECTION_BLURBS[key],
    emphasis,
    items,
    totals,
    empty,
  };
}

function buildSection(
  key: RecapSectionKey,
  facts: RecapFacts,
  settings: RecapSettings,
  ctx: BuildRecapContext,
  pre: { urgent: RecapItem[]; problems: RecapItem[] }
): RecapSection {
  const now = ctx.now;
  const ages = ctx.ages;

  switch (key) {
    case "urgent":
      return section(
        key,
        "urgent",
        "Nothing is urgent. No deadline inside " +
          plural(settings.urgent.deadline_hours, "hour") +
          ", no unanswered reply, no failed send.",
        pre.urgent
      );

    case "problems":
      return section(
        key,
        "problem",
        "Every automation ran and every integration answered.",
        pre.problems
      );

    case "review": {
      const items: RecapItem[] = [];
      for (const r of facts.reviewQueue) {
        items.push({
          key: `review:${r.id}`,
          title: r.title,
          detail: [
            r.score != null ? `Scored ${r.score}` : null,
            r.tier ? `tier ${r.tier}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          href: reviewDestination(r.id),
          recordHref: `/opportunity/${r.id}`,
          ageDays: ages[`review:${r.id}`] ?? 0,
          when: r.expiresAt ? `Decision window closes ${whenDue(r.expiresAt, now)}` : undefined,
          severity: "normal",
        });
      }
      for (const c of facts.callQueue) {
        items.push({
          key: `call:${c.id}`,
          title: `Call ${c.subcontractor ?? "a subcontractor"}`,
          detail: c.opportunity ?? undefined,
          href: callDestination(c.id),
          recordHref: c.subcontractorId ? `/subs/${c.subcontractorId}` : undefined,
          ageDays: ages[`call:${c.id}`] ?? 0,
          when: `Queued ${whenSince(c.createdAt, now)}`,
          severity: "normal",
        });
      }
      for (const d of facts.draftsWaiting) {
        items.push({
          key: `draft:${d.id}`,
          title: `A reply to ${d.subcontractor ?? "a subcontractor"} is drafted and unsent`,
          detail: "Written for you, waiting on your read",
          href: draftDestination(d.subcontractorId),
          ageDays: ages[`draft:${d.id}`] ?? 0,
          when: `Drafted ${whenSince(d.generatedAt, now)}`,
          severity: "normal",
        });
      }
      return section(
        key,
        "normal",
        "No decisions, calls or drafts are waiting on a person.",
        items
      );
    }

    case "totals": {
      const t = facts.totals;
      /*
       * Only figures that come from rows somebody can go and look at, and each
       * one links to them. The obvious missing entry is a "tasks completed"
       * count: there is no task in this product, and the three things that
       * behave like one (the call queue, the review queue, compliance) are
       * reported under their own names above rather than added together into a
       * number that would mean nothing.
       */
      const totals: RecapTotal[] = [
        {
          label: "Solicitations found",
          value: t.opportunitiesDiscovered,
          href: "/pipeline",
        },
        { label: "Pursue or pass decisions", value: t.decisionsMade, href: "/pipeline" },
        {
          label: "Outreach emails sent",
          value: t.outreachSent,
          href: "/communications",
          note:
            t.outreachFailed > 0
              ? `${plural(t.outreachFailed, "failed to deliver")}`
              : t.outreachDelivered > 0
                ? `${t.outreachDelivered} confirmed delivered`
                : undefined,
        },
        {
          label: "Replies received",
          value: t.repliesReceived,
          href: "/communications",
          note:
            t.repliesNeedingReview > 0
              ? `${t.repliesNeedingReview} flagged for review`
              : undefined,
        },
        { label: "Calls logged", value: t.callsLogged, href: "/call-queue" },
        { label: "Quotes recorded", value: t.quotesRecorded, href: "/pipeline" },
        { label: "Bids submitted", value: t.bidsSubmitted, href: "/pipeline" },
        { label: "Notes added", value: t.notesAdded, href: "/communications" },
        { label: "Subcontractors added", value: t.subsAdded, href: "/subs" },
        { label: "Compliance items resolved", value: t.complianceResolved, href: "/compliance" },
        {
          label: "Automation runs",
          value: t.agentRuns,
          href: "/agents",
          note: t.agentRunErrors > 0 ? `${plural(t.agentRunErrors, "error")}` : undefined,
        },
      ];
      return section(key, "normal", "No activity was recorded.", [], totals);
    }

    case "bids": {
      const items: RecapItem[] = [];
      for (const o of facts.discovered.slice(0, 10)) {
        items.push({
          key: `discovered:${o.id}`,
          title: o.title,
          detail: [
            o.agency,
            o.score != null ? `scored ${o.score}` : null,
            o.value != null ? money(o.value) : null,
          ]
            .filter(Boolean)
            .join(" · "),
          href: `/opportunity/${o.id}`,
          when: o.deadline ? `Bid due ${whenDue(o.deadline, now)}` : undefined,
          severity: "normal",
        });
      }
      for (const o of facts.decided) {
        items.push({
          key: `decided:${o.id}`,
          title: `${o.decision === "pursuing" ? "Pursuing" : "Passed on"}: ${o.title}`,
          detail: o.agency ?? undefined,
          href: `/opportunity/${o.id}`,
          severity: "normal",
        });
      }
      for (const b of facts.submitted) {
        items.push({
          key: `submitted:${b.id}`,
          title: `Bid submitted: ${b.title}`,
          detail: money(b.amount),
          href: `/opportunity/${b.opportunityId}`,
          when: `Submitted ${whenSince(b.at, now)}`,
          severity: "normal",
        });
      }
      for (const b of facts.outcomes) {
        items.push({
          key: `outcome:${b.id}`,
          title: `${b.outcome === "won" ? "Won" : b.outcome === "lost" ? "Lost" : "Recorded"}: ${b.title}`,
          detail: money(b.amount),
          href: `/opportunity/${b.opportunityId}`,
          severity: "normal",
        });
      }
      const more = facts.discovered.length - 10;
      if (more > 0) {
        items.push({
          key: "discovered:more",
          title: `${plural(more, "more solicitation")} not listed here`,
          href: "/pipeline",
          severity: "normal",
        });
      }
      return section(key, "normal", "No solicitations arrived and no bids moved.", items);
    }

    case "outreach": {
      const items: RecapItem[] = [];
      const bySub = new Map<string, number>();
      for (const o of facts.outreachSent) {
        const name = o.subcontractor ?? "An unnamed contact";
        bySub.set(name, (bySub.get(name) ?? 0) + 1);
      }
      for (const r of facts.replies) {
        items.push({
          key: `reply-in:${r.id}`,
          title: `${r.subcontractor ?? "A subcontractor"} replied${
            r.intent ? `: ${r.intent.replace(/_/g, " ")}` : ""
          }`,
          detail: r.opportunity ?? undefined,
          href: r.subcontractorId ? `/subs/${r.subcontractorId}` : "/communications",
          when: whenSince(r.createdAt, now),
          severity: r.needsReview ? "warning" : "normal",
          reason: r.needsReview ? "Flagged for review" : undefined,
        });
      }
      if (bySub.size > 0) {
        const named = [...bySub.entries()]
          .slice(0, 6)
          .map(([name, n]) => (n > 1 ? `${name} (${n})` : name))
          .join(", ");
        items.push({
          key: "outreach-sent",
          title: `${plural(facts.outreachSent.length, "email")} went out to ${plural(
            bySub.size,
            "subcontractor"
          )}`,
          detail: bySub.size > 6 ? `${named} and others` : named,
          href: "/communications",
          severity: "normal",
        });
      }
      return section(key, "normal", "No outreach went out and nobody wrote back.", items);
    }

    case "completed": {
      const items: RecapItem[] = facts.completed.map((c) => ({
        key: c.key,
        title: c.label,
        detail: c.detail ?? undefined,
        href: c.href,
        when: whenSince(c.at, now),
        severity: "normal" as const,
      }));
      return section(key, "normal", "Nothing was completed.", items);
    }

    case "upcoming": {
      const items: RecapItem[] = [];
      for (const d of facts.deadlines.slice(0, 10)) {
        if (d.submitted) continue;
        items.push({
          key: `upcoming-deadline:${d.id}`,
          title: d.title,
          detail: [
            d.agency,
            d.quotesIn > 0 ? `${plural(d.quotesIn, "quote")} in` : "no quotes yet",
          ]
            .filter(Boolean)
            .join(" · "),
          href: `/opportunity/${d.id}`,
          when: `Bid due ${whenDue(d.deadline, now)}`,
          severity: "normal",
        });
      }
      for (const c of facts.compliance) {
        if (!c.dueAt) continue;
        items.push({
          key: `upcoming-compliance:${c.id}`,
          title: c.label,
          detail: c.category ? `Compliance · ${c.category}` : "Compliance",
          href: "/compliance",
          when: `Due ${whenDue(c.dueAt, now)}`,
          severity: "normal",
        });
      }
      return section(key, "normal", "Nothing is due in the days ahead.", items);
    }
  }
}

/**
 * The subject line.
 *
 * The urgent count goes first because that is the whole reason to open it
 * before coffee, and the date goes last so a threaded mailbox still sorts and
 * reads sensibly.
 */
export function recapSubject(recap: Recap, orgName: string | null): string {
  const who = recap.scope === "platform" ? "Platform" : (orgName ?? "Your account");
  if (recap.quiet) return `${who}: a quiet day, ${recap.dayLabel}`;
  if (recap.urgentCount > 0) {
    return `${who}: ${plural(recap.urgentCount, "item")} need${
      recap.urgentCount === 1 ? "s" : ""
    } attention, ${recap.dayLabel}`;
  }
  if (recap.problemCount > 0) {
    return `${who}: ${plural(recap.problemCount, "system problem")}, ${recap.dayLabel}`;
  }
  return `${who}: daily recap, ${recap.dayLabel}`;
}

/** The one-line summary under the heading, and the preview text in an inbox. */
export function recapPreheader(recap: Recap): string {
  if (recap.quiet) {
    return "Nothing needed you and nothing broke. This is the short version on purpose.";
  }
  const bits: string[] = [];
  if (recap.urgentCount > 0) bits.push(`${plural(recap.urgentCount, "urgent item")}`);
  if (recap.problemCount > 0) bits.push(`${plural(recap.problemCount, "system problem")}`);
  const totals = recap.sections.find((s) => s.key === "totals");
  const sent = totals?.totals.find((t) => t.label === "Outreach emails sent")?.value ?? 0;
  const replies = totals?.totals.find((t) => t.label === "Replies received")?.value ?? 0;
  if (sent > 0) bits.push(`${plural(sent, "email")} out`);
  if (replies > 0) bits.push(`${plural(replies, "reply", "replies")} in`);
  return bits.length > 0 ? bits.join(", ") : "A full record of the day is below.";
}
