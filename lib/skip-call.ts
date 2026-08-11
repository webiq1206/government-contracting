/**
 * Record that an operator chose not to place a queued call.
 *
 * Distinct from snooze (temporary hide) and from a completed call: the card
 * leaves the queue as status=skipped, Sub Detail gets a note, and agent_logs
 * keeps an audit trail — without pretending contact happened (no last_contacted).
 */
import { transaction } from "@/lib/db";
import { logAgent } from "@/lib/logger";

export interface SkipCallResult {
  opportunityId: string;
  subcontractorId: string;
  companyName: string;
}

export async function skipCallCard(
  callCardId: string,
  opts: { reason?: string; undo?: boolean } = {}
): Promise<SkipCallResult> {
  if (opts.undo) {
    return restoreSkippedCallCard(callCardId);
  }

  const reason =
    typeof opts.reason === "string" && opts.reason.trim().length > 0
      ? opts.reason.trim()
      : "Operator chose not to call.";

  const result = await transaction(async (c) => {
    const card = (
      await c.query<{
        opportunity_id: string;
        subcontractor_id: string;
        status: string;
        response_json: Record<string, unknown> | null;
        company_name: string;
      }>(
        `select cc.opportunity_id, cc.subcontractor_id, cc.status, cc.response_json,
                s.company_name
           from call_cards cc
           join subcontractors s on s.id = cc.subcontractor_id
          where cc.id = $1`,
        [callCardId]
      )
    ).rows[0];
    if (!card) throw new Error("Call card not found.");
    if (card.status === "called") {
      throw new Error("This call was already completed and cannot be skipped.");
    }

    // Idempotent: already skipped stays skipped without duplicate history rows.
    if (card.status === "skipped") {
      return {
        opportunityId: card.opportunity_id,
        subcontractorId: card.subcontractor_id,
        companyName: card.company_name,
        alreadySkipped: true as const,
      };
    }

    const prev =
      card.response_json && typeof card.response_json === "object"
        ? card.response_json
        : {};
    const response = {
      ...prev,
      outcome: "skipped",
      notes: reason,
      skipped_at: new Date().toISOString(),
    };

    await c.query(
      `update call_cards
          set status = 'skipped',
              response_json = $2,
              snoozed_until = null
        where id = $1`,
      [callCardId, JSON.stringify(response)]
    );

    // History on the sub, not last_contacted — we did not reach them.
    await c.query(
      `insert into communications
          (subcontractor_id, opportunity_id, channel, direction, subject, body)
        values ($1, $2, 'note', 'outbound', 'Skipped call', $3)`,
      [
        card.subcontractor_id,
        card.opportunity_id,
        reason,
      ]
    );

    return {
      opportunityId: card.opportunity_id,
      subcontractorId: card.subcontractor_id,
      companyName: card.company_name,
      alreadySkipped: false as const,
    };
  });

  if (!result.alreadySkipped) {
    await logAgent({
      agent: "operator",
      action: "call-skipped",
      opportunityId: result.opportunityId,
      subcontractorId: result.subcontractorId,
      level: "info",
      message: `Skipped calling ${result.companyName}. ${reason}`,
    });
  }

  return {
    opportunityId: result.opportunityId,
    subcontractorId: result.subcontractorId,
    companyName: result.companyName,
  };
}

async function restoreSkippedCallCard(callCardId: string): Promise<SkipCallResult> {
  const result = await transaction(async (c) => {
    const card = (
      await c.query<{
        opportunity_id: string;
        subcontractor_id: string;
        status: string;
        company_name: string;
      }>(
        `select cc.opportunity_id, cc.subcontractor_id, cc.status, s.company_name
           from call_cards cc
           join subcontractors s on s.id = cc.subcontractor_id
          where cc.id = $1`,
        [callCardId]
      )
    ).rows[0];
    if (!card) throw new Error("Call card not found.");
    if (card.status !== "skipped") {
      throw new Error("Only a skipped call can be restored to the queue.");
    }

    await c.query(
      `update call_cards
          set status = 'pending',
              response_json = coalesce(response_json, '{}'::jsonb)
                - 'outcome' - 'skipped_at',
              snoozed_until = null
        where id = $1`,
      [callCardId]
    );

    await c.query(
      `insert into communications
          (subcontractor_id, opportunity_id, channel, direction, subject, body)
        values ($1, $2, 'note', 'outbound', 'Restored skipped call',
                'Operator undid skip; call returned to the queue.')`,
      [card.subcontractor_id, card.opportunity_id]
    );

    return {
      opportunityId: card.opportunity_id,
      subcontractorId: card.subcontractor_id,
      companyName: card.company_name,
    };
  });

  await logAgent({
    agent: "operator",
    action: "call-skip-undone",
    opportunityId: result.opportunityId,
    subcontractorId: result.subcontractorId,
    level: "info",
    message: `Restored skipped call to ${result.companyName} to the queue.`,
  });

  return result;
}

/** True when a call-card status should not be forced back to pending by Call Prep. */
export function shouldPreserveCallCardStatus(status: string): boolean {
  return status === "called" || status === "skipped";
}
