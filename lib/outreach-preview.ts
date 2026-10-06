import { queryOne } from "./db";
import type { Opportunity, Subcontractor } from "./types";

export class OutreachPreviewUnavailable extends Error {
  constructor(message: string, readonly status: 404 | 422 = 422) {
    super(message);
  }
}

/** Real quote previews use saved associations, never guessed firm/trade matches. */
export async function loadOutreachPreviewPair(orgId: string, pair: {
  opportunityId: string; subcontractorId: string; trade?: string | null;
}) {
  const opp = await queryOne<Opportunity>(
    "select * from opportunities where id=$1 and org_id=$2", [pair.opportunityId, orgId]);
  const sub = await queryOne<Subcontractor>(
    "select * from subcontractors where id=$1 and org_id=$2", [pair.subcontractorId, orgId]);
  if (!opp || !sub) {
    throw new OutreachPreviewUnavailable("The selected records could not be found on this account. Nothing was sent.", 404);
  }
  if (opp.is_sources_sought || opp.status !== "open") {
    throw new OutreachPreviewUnavailable("Real bid previews require an open solicitation, not a Sources Sought or closed record. Use sample values instead. Nothing was sent.");
  }
  const saved = await queryOne<{ trade: string | null }>(
    `select trade from opportunity_subs
      where opportunity_id=$1 and subcontractor_id=$2 and removed_at is null
        and coalesce(trade,'')=$3
      order by created_at desc limit 1`,
    [pair.opportunityId, pair.subcontractorId, pair.trade ?? ""]);
  if (!saved) {
    throw new OutreachPreviewUnavailable("This subcontractor has no active saved association with the selected bid and trade. Use sample values instead. Nothing was sent.");
  }
  return { opp, sub, trade: saved.trade };
}
