import Link from "next/link";
import { DetailDrawer, DrawerFact, DrawerSection } from "@/components/detail-drawer";
import { reliabilityBreakdown } from "@/lib/domain/reliability";
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

/** What to do about this firm next, given everything else in the drawer. */
function nextAction(s: SubPeekRow): string {
  if (s.blacklisted) return "Nothing. This firm is marked do not use.";
  if (s.sam_excluded) return "Nothing. Federally excluded parties cannot be used on this work.";
  if (!s.email) return "Find an email address, or call them.";
  if (n(s.expired_docs) > 0) return "Chase the lapsed paperwork before sending any more work.";
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
          value={
            sub.blacklisted ? (
              <span className="text-risk">Marked do not use</span>
            ) : sub.sam_excluded ? (
              <span className="text-risk">Federally excluded</span>
            ) : sub.is_preferred ? (
              <span className="text-pursue">Preferred</span>
            ) : (
              "Available"
            )
          }
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
          <dd className="num text-3xl text-foreground">{rel.reliability}</dd>
          <p className="text-xs text-slate-500">{rel.caveat}</p>
          {stale && (
            <p className="mt-1 text-xs text-slate-500">
              The roster column reads {sub.reliability_score}. It is rewritten nightly;
              this is computed from what is on record right now.
            </p>
          )}
        </div>
        <div className="space-y-2">
          {rel.components.map((c) => (
            <div key={c.label} className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{c.label}</p>
                <p className="text-xs text-slate-500">{c.detail}</p>
              </div>
              <span className="num shrink-0 text-sm text-foreground">
                {c.points > 0 ? `+${c.points}` : c.points}
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
