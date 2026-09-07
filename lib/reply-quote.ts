import { transaction } from "./db";
import { saveProposedRow } from "./pricing-rows";
import { QUOTE_EDIT_STAGES } from "./domain/opportunity-lifecycle";
import type { ProposedRow } from "./domain/quote-fields";

/** A captured quote, its pricing row and the resulting stage are one write. */
export async function persistReplyQuote(input: {
  orgId: string;
  opportunityId: string;
  subcontractorId: string;
  proposal: ProposedRow;
  notes: string;
  receivedAt: Date;
}): Promise<"saved" | "kept_existing" | "not_editable"> {
  return transaction(async (client) => {
    const { orgId, opportunityId, subcontractorId, proposal } = input;
    // Serialize with operator changes to the opportunity. A reply received
    // after cancellation or approval belongs in history, not live pricing.
    const editable = await client.query(
      `select id from opportunities o
        where o.id=$1 and o.org_id=$2 and o.status='open'
          and coalesce(o.pursuit_state, 'active')='active'
          and o.stage=any($3::text[])
          and not exists (select 1 from bids b
            where b.opportunity_id=o.id and b.org_id=o.org_id
              and b.submission_state <> 'package_ready')
        for update`,
      [opportunityId, orgId, QUOTE_EDIT_STAGES],
    );
    if (!editable.rows.length) return "not_editable";

    const activePair = await client.query(
      `select id from opportunity_subs
        where org_id=$1 and opportunity_id=$2 and subcontractor_id=$3
          and removed_at is null and coalesce(trade, '')=coalesce($4::text, '')
        for update`,
      [orgId, opportunityId, subcontractorId, proposal.trade],
    );
    if (!activePair.rows.length) return "not_editable";

    const quote = await client.query<{ id: string }>(
      `insert into quotes
        (org_id, opportunity_id, subcontractor_id, trade, quote_amount, payment_terms, notes)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (opportunity_id, subcontractor_id, (coalesce(trade,''))) do nothing
       returning id`,
      [orgId, opportunityId, subcontractorId, proposal.trade,
        proposal.baseQuote, proposal.paymentTerms, input.notes],
    );
    if (!quote.rows.length) return "kept_existing";

    const pricing = await saveProposedRow({
      orgId, opportunityId, subcontractorId,
      sourceQuoteId: quote.rows[0]!.id, proposal, onlyIfAbsent: true,
    }, client);
    if (pricing === "not_editable") {
      throw new Error("The pricing row could not be applied; the quote transaction was rolled back.");
    }
    await client.query(
      `update opportunity_subs
          set quoted_at=coalesce(quoted_at,$5::timestamptz),
              quote_full_scope=coalesce(quote_full_scope,true)
        where org_id=$1 and opportunity_id=$2 and subcontractor_id=$3
          and removed_at is null and coalesce(trade,'')=coalesce($4::text,'')`,
      [orgId, opportunityId, subcontractorId, proposal.trade, input.receivedAt],
    );
    await client.query(
      `update opportunities
          set stage='quote_entry', human_action_required=false, updated_at=now()
        where id=$1 and org_id=$2 and stage in ('outreach','call_queue')`,
      [opportunityId, orgId],
    );
    return "saved";
  });
}
