import Link from "next/link";
import { subState, SUB_STATE_TONE } from "@/lib/domain/sub-state";
import { DetailDrawer, DrawerFact, DrawerSection } from "@/components/detail-drawer";
import {
  EVIDENCE_LABEL,
  NO_RELIABILITY_LABEL,
  reliabilityBreakdown,
} from "@/lib/domain/reliability";
import { shortDate } from "@/lib/format";
import type { SubPeekRow } from "@/lib/data";

function n(v: string | number | null | undefined): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/**
 * One line for whether outreach can actually reach this firm.
 *
 * `Connected` was banned for integrations for the same reason it is avoided
 * here: an address that exists and an address that has been confirmed to work
 * are different facts, and reading them as one is how a bid package goes to
 * nobody.
 */
function contactHealth(s: SubPeekRow): { label: string; tone: string; detail: string } {
  if (!s.email) {
    return {
      label: "No address on file",
      tone: "text-risk",
      detail: "Outreach cannot include this firm. Find an address or call them.",
    };
  }
  if (s.email_verified) {
    return {
      label: "Address verified",
      tone: "text-pursue",
      detail: "Confirmed deliverable when it was last checked.",
    };
  }
  return {
    label: "Address unverified",
    tone: "text-review",
    detail: "On file but never confirmed. The first send is the test.",
  };
}

/**
 * The record's operational state, worked out exactly once.
 *
 * This drawer used to run its own ladder over the same five facts as the
 * record header, in a different order and with different words, so the same
 * firm could read one way in the drawer and another way on its own page.
 */
function stateOf(s: SubPeekRow) {
  return subState({
    samExcluded: s.sam_excluded,
    blacklisted: s.blacklisted,
    blacklistReason: s.blacklist_reason,
    archivedAt: s.archived_at,
    archivedReason: s.archived_reason,
    mergedInto: s.merged_into,
    email: s.email,
    emailVerified: s.email_verified,
    phone: s.phone,
    /*
     * A count, not the names: the drawer does not load the document rows. The
     * record page names them, and this says how many to expect.
     */
    missingDocuments:
      n(s.unmet_required_docs) > 0
        ? [`${n(s.unmet_required_docs)} required for award`]
        : [],
    preferred: s.is_preferred,
  });
}

/** What to do about this firm next, given everything else in the drawer. */
function nextAction(s: SubPeekRow): string {
  const state = stateOf(s);
  if (!state.canContact) return `Nothing. ${state.detail}`;
  if (!s.email) return "Find an email address, or call them.";
  if (!state.canAward) return "Chase the lapsed paperwork. It does not stop you asking for a price.";
  if (n(s.outreach) === 0) return "Nothing yet. They have never been contacted.";
  if (n(s.quote_count) === 0 && n(s.responded_any) === 0) {
    return "They have never answered. Try a call before spending more outreach on them.";
  }
  return "Include them in the next bid that needs this trade.";
}

export function SubPeek({
  sub,
  closeHref,
}: {
  sub: SubPeekRow;
  closeHref: string;
}) {
  const inputs = {
    outreach: n(sub.outreach),
    respondedWithin48h: n(sub.responded_48h),
    respondedEver: n(sub.responded_any),
    quotes: n(sub.quote_count),
    blacklisted: sub.blacklisted,
  };
  const rel = reliabilityBreakdown(inputs);
  const state = stateOf(sub);
  const health = contactHealth(sub);
  const trades = sub.trade_categories ?? [];
  const area = [sub.city, sub.state].filter(Boolean).join(", ");

  /*
   * The stored score and the one this drawer computes can differ: the learning
   * loop writes the column on a schedule, and outreach has happened since.
   * Saying so is better than silently showing one of them, because an operator
   * comparing the roster column to this drawer would otherwise find two
   * numbers and no way to tell which is current.
   */
  const stale =
    sub.reliability_score != null && sub.reliability_score !== rel.reliability;

  return (
    <DetailDrawer
      title={`${sub.is_preferred ? "★ " : ""}${sub.company_name}`}
      subtitle={sub.owner_name}
      closeHref={closeHref}
      openHref={`/subs/${sub.id}`}
      openLabel="Open the full record"
    >
      <DrawerSection title="Operational status">
        <DrawerFact
          label="Can we use them"
          value={<span className={`badge ${SUB_STATE_TONE[state.state]}`}>{state.label}</span>}
          hint={state.detail}
        />
        <DrawerFact
          label="Contact health"
          value={<span className={health.tone}>{health.label}</span>}
          hint={health.detail}
        />
        <DrawerFact label="Email" value={sub.email} unknown="None found" />
        <DrawerFact label="Phone" value={sub.phone} unknown="None found" />
        <DrawerFact
          label="Last contacted"
          value={sub.last_contacted ? shortDate(sub.last_contacted) : null}
          unknown="Never"
        />
      </DrawerSection>

      <DrawerSection title="What they do, and where">
        <DrawerFact
          label="Trades"
          value={
            trades.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {trades.map((t) => (
                  <span key={t} className="badge bg-muted text-muted-foreground">
                    {t}
                  </span>
                ))}
              </span>
            ) : null
          }
          unknown="No trades recorded, so they will not be matched to any scope"
        />
        <DrawerFact label="Service area" value={area || null} unknown="No location on file" />
        <DrawerFact
          label="Licence"
          value={
            sub.license_number
              ? `${sub.license_number}${sub.license_status ? ` (${sub.license_status})` : ""}`
              : null
          }
          unknown="Not recorded"
        />
        <DrawerFact
          label="Public rating"
          value={
            sub.google_rating != null
              ? `${Number(sub.google_rating).toFixed(1)} from ${n(sub.review_count)} review${n(sub.review_count) === 1 ? "" : "s"}`
              : null
          }
          unknown="No reviews found"
        />
      </DrawerSection>

      {/*
        * The breakdown the audit asked for. A number out of a hundred with
        * nothing behind it is a number nobody can argue with, which sounds
        * like an advantage right up until somebody disagrees with it.
        */}
      <DrawerSection title="Reliability">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Score</dt>
          {/*
            Null is not zero and must not render as one. A firm nobody has
            dealt with has not scored badly, and a roster somebody sorts by
            this column would put them below a firm that walked off a job.
          */}
          {rel.reliability == null ? (
            <dd className="text-lg text-muted-foreground">{NO_RELIABILITY_LABEL}</dd>
          ) : (
            <dd className="num text-3xl text-foreground">{rel.reliability}</dd>
          )}
          <p className="text-xs text-slate-500">{rel.caveat}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {EVIDENCE_LABEL[rel.evidence]}
            {rel.evidenceCount > 0 ? ` · ${rel.evidenceCount} dealings on record` : ""}
          </p>
          {stale && (
            <p className="mt-1 text-xs text-slate-500">
              The roster column reads {sub.reliability_score}. It is rewritten nightly;
              this is computed from what is on record right now.
            </p>
          )}
        </div>
        <div className="space-y-2">
          {/*
            All six, including the ones with nothing behind them. A breakdown
            that lists only what it measured reads as a complete account of the
            firm, and the gaps are the most useful thing on it: they say what
            to go and find out.
          */}
          {rel.dimensions.map((d) => (
            <div key={d.key} className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{d.label}</p>
                <p className="text-xs text-slate-500">{d.detail}</p>
              </div>
              <span
                className={`num shrink-0 text-sm ${
                  d.score == null ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                {d.score == null ? "Not measured" : `${d.score}/100`}
              </span>
            </div>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection title="Paperwork">
        <DrawerFact
          label="On file and current"
          value={n(sub.open_docs) > 0 ? `${n(sub.open_docs)} document${n(sub.open_docs) === 1 ? "" : "s"}` : null}
          unknown="Nothing on file"
        />
        <DrawerFact
          label="Lapsed"
          value={
            n(sub.expired_docs) > 0 ? (
              <span className="text-risk">
                {n(sub.expired_docs)} document{n(sub.expired_docs) === 1 ? "" : "s"}
              </span>
            ) : (
              "None"
            )
          }
        />
      </DrawerSection>

      <DrawerSection title="Next">
        <DrawerFact label="Do this" value={nextAction(sub)} />
      </DrawerSection>

      <Link href={`/communications?q=${encodeURIComponent(sub.company_name)}`} className="btn-ghost inline-flex text-xs">
        See the conversation
      </Link>
    </DetailDrawer>
  );
}
