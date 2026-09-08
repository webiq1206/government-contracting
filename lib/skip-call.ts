/**
 * Record that an operator chose not to place a queued call.
 *
 * Distinct from snooze (temporary hide) and from a completed call: the card
 * leaves the queue as status=skipped, Sub Detail gets a note, and agent_logs
 * keeps an audit trail — without pretending contact happened (no last_contacted).
 */
import { transaction } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import {
  CALL_STAGE,
  CALLS_DISABLED_REASON,
  STAGE_AFTER_CALLS,
} from "@/lib/domain/call-step";
import {
  SKIP_REASON_LABEL,
  suppressionForSkip,
  type SkipReason,
  type SuppressionScope,
} from "@/lib/domain/suppression";
import { suppress } from "@/lib/suppressions";

export interface SkipCallResult {
  opportunityId: string;
  subcontractorId: string;
  companyName: string;
}

export async function skipCallCard(
  callCardId: string,
  opts: {
    reason?: string;
    undo?: boolean;
    /** One of the structured reasons, so skips can be counted. */
    skipReason?: SkipReason | null;
    note?: string | null;
    /**
     * How far the decision reaches. `once` writes no suppression, which is
     * why it is the default: a one-time skip that quietly created a standing
     * rule is how an operator stops speaking to a firm because they were busy
     * on a Tuesday.
     */
    scope?: SuppressionScope;
    /** Whether somebody actually dialled before giving up. */
    dialed?: boolean;
    orgId: string;
    actor?: string;
  }
): Promise<SkipCallResult> {
  if (opts.undo) {
    return restoreSkippedCallCard(callCardId, opts.orgId, opts.actor);
  }

  const structured = opts.skipReason ?? null;
  const scope = opts.scope ?? "once";
  const reason = structured
    ? `${SKIP_REASON_LABEL[structured]}${opts.note?.trim() ? `: ${opts.note.trim()}` : ""}`
    : typeof opts.reason === "string" && opts.reason.trim().length > 0
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
        trade: string | null;
      }>(
        `select cc.opportunity_id, cc.subcontractor_id, cc.status, cc.response_json,
                s.company_name,
                (select os.trade from opportunity_subs os
                  where os.opportunity_id = cc.opportunity_id
                    and os.subcontractor_id = cc.subcontractor_id
                    and os.org_id = cc.org_id
                  order by os.created_at asc limit 1) as trade
           from call_cards cc
           join subcontractors s on s.id = cc.subcontractor_id and s.org_id = cc.org_id
          where cc.id = $1 and cc.org_id = $2
          for update`,
        [callCardId, opts.orgId]
      )
    ).rows[0];
    if (!card) throw new Error("Call card not found.");
    if (card.status === "called") {
      throw new Error("This call was already completed and cannot be skipped.");
    }

    const ensureSuppression = async () => {
      if (scope === "once") return;
      const proposed = suppressionForSkip({
        scope,
        subcontractorId: card.subcontractor_id,
        opportunityId: card.opportunity_id,
        trade: card.trade,
        reason: structured ?? "other",
        note: opts.note ?? null,
      });
      if (!proposed) return;
      await suppress(
        {
          orgId: opts.orgId,
          subcontractorId: proposed.subcontractorId,
          opportunityId: proposed.opportunityId,
          trade: proposed.trade,
          channel: proposed.channel,
          reason: proposed.reason,
          note: proposed.note,
          actor: opts.actor ?? "operator",
          sourceCallCardId: callCardId,
        },
        c
      );
    };

    // Idempotent: already skipped stays skipped without duplicate history rows.
    if (card.status === "skipped") {
      // Also repairs a historical partial skip whose standing suppression did
      // not commit. suppress() is idempotent for the same live scope.
      await ensureSuppression();
      return {
        opportunityId: card.opportunity_id,
        subcontractorId: card.subcontractor_id,
        companyName: card.company_name,
        trade: card.trade,
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
              snoozed_until = null,
              skip_reason = $3,
              skip_note = $4,
              skip_scope = $5,
              skipped_by = $6,
              -- Only a real dial counts. Without this a firm the queue offered
              -- four times and nobody rang reads as one that was chased four
              -- times and never answered, which is the opposite fact.
              dialed = $7
        where id = $1 and org_id = $8`,
      [
        callCardId,
        JSON.stringify(response),
        structured,
        opts.note?.trim() || null,
        scope,
        opts.actor ?? null,
        opts.dialed === true,
        opts.orgId,
      ]
    );

    // History on the sub, not last_contacted — we did not reach them.
    await c.query(
      `insert into communications
          (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body)
        values ($4, $1, $2, 'note', 'outbound', 'Skipped call', $3)`,
      [
        card.subcontractor_id,
        card.opportunity_id,
        reason,
        opts.orgId,
      ]
    );

    // The skip, its history, and any standing no-contact rule are one decision.
    // A failed suppression rolls the other writes back instead of leaving a
    // card that says "skipped everywhere" while future calls are still built.
    await ensureSuppression();

    return {
      opportunityId: card.opportunity_id,
      subcontractorId: card.subcontractor_id,
      companyName: card.company_name,
      trade: card.trade,
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

async function restoreSkippedCallCard(
  callCardId: string,
  orgId: string,
  actor?: string
): Promise<SkipCallResult> {
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
           join subcontractors s on s.id = cc.subcontractor_id and s.org_id = cc.org_id
          where cc.id = $1 and cc.org_id = $2
          for update`,
        [callCardId, orgId]
      )
    ).rows[0];
    if (!card) throw new Error("Call card not found.");
    if (card.status !== "skipped") {
      throw new Error("Only a skipped call can be restored to the queue.");
    }

    // Lift only the standing rule created by this exact card. A matching rule
    // that existed before the skip belongs to a separate operator decision and
    // must survive this undo.
    await c.query(
      `update outreach_suppressions
          set lifted_at = now(), lifted_by = $3
        where source_call_card_id = $1 and org_id = $2 and lifted_at is null`,
      [callCardId, orgId, actor ?? "operator"]
    );

    await c.query(
      `update call_cards
          set status = 'pending',
              response_json = coalesce(response_json, '{}'::jsonb)
                - 'outcome' - 'skipped_at',
              snoozed_until = null,
              skip_reason = null,
              skip_note = null,
              skip_scope = null,
              skipped_by = null,
              dialed = false
        where id = $1 and org_id = $2`,
      [callCardId, orgId]
    );

    await c.query(
      `insert into communications
          (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body)
        values ($3, $1, $2, 'note', 'outbound', 'Restored skipped call',
                'Operator undid skip; call returned to the queue.')`,
      [card.subcontractor_id, card.opportunity_id, orgId]
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
    reasoning: actor ? `Restored by ${actor}.` : undefined,
  });

  return result;
}

export interface ClearCallWorkResult {
  /** Pending cards taken out of the queue. */
  cardsSkipped: number;
  /** Opportunities moved off the call stage to collecting quotes. */
  opportunitiesAdvanced: number;
}

/**
 * Clear the call work an organization has already accumulated, because the
 * operator just turned calling off.
 *
 * Turning the preference off only stops new call work; without this the queue
 * keeps whatever was in it, which is precisely the "unnecessary call tasks"
 * the setting exists to remove. Completed calls are left alone: they are
 * history, not a task. Skipped is reused rather than deleting the rows so the
 * cards can be read back later and so re-enabling calling does not resurrect a
 * stale queue.
 */
export async function clearCallWorkForOrg(orgId: string): Promise<ClearCallWorkResult> {
  const reason = CALLS_DISABLED_REASON;

  const { cards, advanced } = await transaction(async (client) => {
    const cardsResult = await client.query<{ id: string }>(
      `update call_cards cc
          set status = 'skipped',
              snoozed_until = null,
              response_json = coalesce(cc.response_json, '{}'::jsonb)
                              || jsonb_build_object('outcome', 'skipped', 'notes', $2::text)
        from opportunities o
       where o.id = cc.opportunity_id
         and o.org_id = $1
         and cc.status = 'pending'
       returning cc.id`,
      [orgId, reason]
    );

    // Nothing is going to move these forward now that the stage is gone from
    // their pipeline, so they go where the email step would have sent them.
    const advancedResult = await client.query<{ id: string }>(
      `update opportunities
          set stage = $2, human_action_required = false, updated_at = now()
        where org_id = $1 and stage = $3 and status = 'open'
        returning id`,
      [orgId, STAGE_AFTER_CALLS, CALL_STAGE]
    );
    return { cards: cardsResult.rows, advanced: advancedResult.rows };
  });

  if (cards.length > 0 || advanced.length > 0) {
    await logAgent({
      agent: "operator",
      action: "calls-disabled-cleanup",
      level: "info",
      message:
        `Calling was turned off: ${cards.length} queued call${cards.length === 1 ? "" : "s"} cleared` +
        ` and ${advanced.length} opportunit${advanced.length === 1 ? "y" : "ies"} moved on to collecting quotes.`,
      reasoning: reason,
    });
  }

  return { cardsSkipped: cards.length, opportunitiesAdvanced: advanced.length };
}

/** True when a call-card status should not be forced back to pending by Call Prep. */
export function shouldPreserveCallCardStatus(status: string): boolean {
  return status === "called" || status === "skipped";
}
