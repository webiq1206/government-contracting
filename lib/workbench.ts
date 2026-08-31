/**
 * What the workbench needs to show one task, loaded per task rather than per
 * page.
 *
 * The queue itself is `workQueue()`: cheap, bounded, and drawn every time.
 * This loads only the record the operator has open, which is what makes a
 * queue of fifty affordable to render. Nothing here decides anything; the
 * pure rules live in `lib/domain/workbench.ts` and are tested without a
 * database.
 */

import { queryOne } from "./db";
import { opportunityDetail } from "./data";
import { THREAD_KEY_SQL } from "./thread-key";
import { paneFor, type WorkbenchPane } from "./domain/workbench";
import type { WorkItem } from "./domain/work-queue";
import type { Bid, Opportunity, SolicitationAnalysis } from "./types";

/** A reply the automatic reader would not act on. */
export interface ReplyDetail {
  id: string;
  subcontractorId: string | null;
  companyName: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  trade: string | null;
  intent: string | null;
  reason: string | null;
  reviewReason: string | null;
  originalMessage: string | null;
  confidence: string | null;
  receivedAt: string | null;
}

/** Outreach that has gone and not come back. */
export interface PairingDetail {
  id: string;
  subcontractorId: string | null;
  companyName: string | null;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  trade: string | null;
  opportunityId: string;
  opportunityTitle: string | null;
  sentAt: string | null;
  threadKey: string | null;
}

/** Everything one opportunity-shaped pane needs, loaded once. */
export interface OpportunityDetail {
  opp: Opportunity;
  bid: Bid | null;
  analysis: SolicitationAnalysis | null;
  quotes: Record<string, unknown>[];
  subs: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  kindToPath: Record<string, string>;
  proofOptions: { id: string; name: string }[];
}

export type WorkbenchDetail =
  | { pane: "decide" | "quote" | "bid" | "blocker"; opportunity: OpportunityDetail }
  | { pane: "reply"; reply: ReplyDetail }
  | { pane: "call"; cardId: string }
  | { pane: "waiting"; pairing: PairingDetail }
  /**
   * The record went while the queue was on screen.
   *
   * A real and frequent state on a shared account: somebody else took the
   * decision, or the automation resolved the blocker, between the list being
   * drawn and the row being clicked. Named rather than rendered as an empty
   * pane, because an empty pane reads as a fault in the product.
   */
  | { pane: "gone"; why: string };

export async function loadWorkbenchDetail(
  item: WorkItem,
  orgId: string
): Promise<WorkbenchDetail> {
  const pane: WorkbenchPane = paneFor(item);

  if (pane === "call") {
    const id = item.record?.id;
    if (!id) return { pane: "gone", why: "This call card is no longer in the queue." };
    return { pane: "call", cardId: id };
  }

  if (pane === "reply") {
    const id = item.record?.id;
    if (!id) return { pane: "gone", why: "This reply has already been read." };
    const row = await queryOne<{
      id: string;
      subcontractor_id: string | null;
      company_name: string | null;
      opportunity_id: string | null;
      opportunity_title: string | null;
      trade: string | null;
      intent: string | null;
      reason: string | null;
      review_reason: string | null;
      original_message: string | null;
      confidence: string | null;
      created_at: string | null;
    }>(
      `select e.id, e.subcontractor_id, s.company_name,
              e.opportunity_id, o.title as opportunity_title, e.trade,
              e.intent, e.reason, e.review_reason, e.original_message,
              e.confidence::text as confidence, e.created_at
         from subcontractor_reply_events e
         left join subcontractors s on s.id = e.subcontractor_id
         left join opportunities o on o.id = e.opportunity_id
        where e.id = $1
          and e.reviewed_at is null
          and (e.org_id = $2 or (e.org_id is null and o.org_id = $2))`,
      [id, orgId]
    ).catch(() => null);
    if (!row) {
      return { pane: "gone", why: "This reply has already been read by somebody." };
    }
    return {
      pane: "reply",
      reply: {
        id: row.id,
        subcontractorId: row.subcontractor_id,
        companyName: row.company_name,
        opportunityId: row.opportunity_id,
        opportunityTitle: row.opportunity_title,
        trade: row.trade,
        intent: row.intent,
        reason: row.reason,
        reviewReason: row.review_reason,
        originalMessage: row.original_message,
        confidence: row.confidence,
        receivedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      },
    };
  }

  if (pane === "waiting") {
    const id = item.record?.id;
    if (!id) return { pane: "gone", why: "That outreach is no longer waiting." };
    const row = await queryOne<{
      id: string;
      subcontractor_id: string | null;
      company_name: string | null;
      email: string | null;
      email_verified: boolean | null;
      phone: string | null;
      trade: string | null;
      opportunity_id: string;
      opportunity_title: string | null;
      sent_at: string | null;
      thread_key: string | null;
    }>(
      `select os.id, os.subcontractor_id, s.company_name, s.email, s.email_verified,
              s.phone, os.trade, os.opportunity_id, o.title as opportunity_title,
              last_out.created_at as sent_at, last_out.thread_key
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
         join subcontractors s on s.id = os.subcontractor_id
         left join lateral (
           select c.created_at, ${THREAD_KEY_SQL} as thread_key
             from communications c
            where c.opportunity_id = os.opportunity_id
              and c.subcontractor_id = os.subcontractor_id
              and c.direction = 'outbound'
            order by c.created_at desc
            limit 1
         ) last_out on true
        where os.id = $1 and o.org_id = $2`,
      [id, orgId]
    ).catch(() => null);
    if (!row) return { pane: "gone", why: "That outreach is no longer waiting on anybody." };
    return {
      pane: "waiting",
      pairing: {
        id: row.id,
        subcontractorId: row.subcontractor_id,
        companyName: row.company_name,
        email: row.email,
        emailVerified: Boolean(row.email_verified),
        phone: row.phone,
        trade: row.trade,
        opportunityId: row.opportunity_id,
        opportunityTitle: row.opportunity_title,
        sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
        threadKey: row.thread_key,
      },
    };
  }

  const oppId = item.opportunityId ?? item.record?.id ?? null;
  if (!oppId) return { pane: "gone", why: "This task is no longer attached to a solicitation." };
  const detail = await opportunityDetail(oppId).catch(() => null);
  if (!detail) return { pane: "gone", why: "That solicitation is no longer on this account." };

  const documents = detail.documents as Record<string, unknown>[];
  const kindToPath: Record<string, string> = {};
  for (const d of documents) {
    const kind = String(d.kind);
    const path = d.storage_path ? String(d.storage_path) : "";
    if (path && !kindToPath[kind]) kindToPath[kind] = path;
  }

  return {
    pane,
    opportunity: {
      opp: detail.opp,
      bid: (detail.bid as Bid | null) ?? null,
      analysis: (detail.opp.solicitation_analysis as SolicitationAnalysis | null) ?? null,
      quotes: detail.quotes as Record<string, unknown>[],
      subs: detail.subs as unknown as Record<string, unknown>[],
      documents,
      kindToPath,
      proofOptions: documents
        .filter((d) => String(d.kind) !== "solicitation" && d.storage_path)
        .map((d) => ({ id: String(d.id), name: String(d.name) })),
    },
  };
}

/**
 * Trades this solicitation needs priced, and the ones already priced.
 *
 * Read from the same two places the record page reads them, so a trade that
 * counts as covered there counts as covered here. A quote entry form that
 * disagrees with the coverage strip about what is still missing is worse than
 * one with no guidance at all.
 */
export function tradeState(detail: OpportunityDetail): {
  required: string[];
  quoted: string[];
} {
  const required = detail.analysis?.required_trades?.map((t) => String(t)) ?? [];
  const quoted = Array.from(
    new Set(
      detail.quotes
        .map((q) => (q.trade == null ? "" : String(q.trade)))
        .filter((t) => t.trim() !== "")
    )
  );
  return { required, quoted };
}

/** Subcontractors on this bid, as the quote form's picker wants them. */
export function quoteSubOptions(
  detail: OpportunityDetail
): { subcontractor_id: string; company_name: string; trade: string | null }[] {
  return detail.subs
    .map((s) => ({
      subcontractor_id: String(s.subcontractor_id ?? ""),
      company_name: String(s.company_name ?? "Unnamed firm"),
      trade: s.trade == null ? null : String(s.trade),
    }))
    .filter((s) => s.subcontractor_id !== "");
}

/** Quotes already recorded, newest first, for the pane that lists them. */
export function recordedQuotes(
  detail: OpportunityDetail
): { id: string; company: string; trade: string | null; amount: number | null }[] {
  return detail.quotes.map((q) => {
    const n = Number(q.quote_amount);
    return {
      id: String(q.id),
      company: String(q.company_name ?? "Unnamed firm"),
      trade: q.trade == null ? null : String(q.trade),
      amount: Number.isFinite(n) ? n : null,
    };
  });
}

/** Whether this account has anything at all in the queue, for the empty state. */
export async function hasAnyOpenWork(orgId: string): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from opportunities where org_id = $1 and status = 'open'`,
    [orgId]
  ).catch(() => null);
  return (row?.n ?? 0) > 0;
}
