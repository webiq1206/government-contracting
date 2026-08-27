import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { outcomeComplete, outcomeEffect } from "@/lib/domain/call-outcome";
import { pricingFromCall } from "@/lib/domain/call-capture";
import { fillPricingFromCall } from "@/lib/pricing-rows";
import { transaction, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";
import { closeOutDeclinedSub } from "@/lib/domain/decline-closeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CallResponse {
  can_perform?: "yes" | "no" | "";
  interested?: "yes" | "no" | "";
  bid_submitted?: "yes" | "no" | "";
  quote_amount?: string | number;
  price_type?: string;
  start_date?: string;
  completion_date?: string;
  availability?: string;
  certs_confirmed?: boolean;
  insurance_confirmed?: boolean;
  bonding_confirmed?: boolean;
  experience_level?: string;
  confidence?: number;
  recommendation?: string;
  followup_required?: boolean;
  followup_date?: string;
  followup_reason?: string;
  outcome?: string;
  /** How long the call ran, when the operator timed it. Absent when not. */
  call_seconds?: number;
  /**
   * When they asked to be called back, to the minute. Required by
   * `outcomeComplete` for the outcome that promises one, because "Tuesday" and
   * "Tuesday at 7am before the crew leaves" are different promises and only
   * one of them can be kept.
   */
  call_back_at?: string;
  /** The person who actually handles this, when the one called does not. */
  contact_name?: string;
  assumptions?: string;
  notes?: string;
  /**
   * Answers to the job-specific questions the call guide assembled for this
   * card, keyed by question id. Kept apart from the fixed fields above: those
   * are read by quotes, coverage and the reply pipeline, while these vary per
   * opportunity and are only ever read back as a record of the call.
   */
  answers?: Record<string, string | number | boolean | null>;
  /** The questions actually put to this sub, so the answers stay legible. */
  questions_asked?: { id: string; ask: string }[];
}

/**
 * Save the Call Workspace capture form. One atomic transaction updates ALL
 * related records so every view stays in sync:
 *   - call_cards: response_json + quote_amount + status (called/pending)
 *   - subcontractors: last_contacted, and appends a note if internal notes given
 *   - quotes: upsert a quote row when a price was captured (feeds the bid builder)
 *   - communications: append an inbound "call" record so Sub Detail history reflects it
 *   - opportunity_subs: stamp responded_at so downstream state advances correctly
 * Fires-and-forgets an agent log so the Activity Feed shows the call.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;
  const body = await req.json().catch(() => ({}));
  const response = (body.response ?? {}) as CallResponse;
  const closeCard = body.closeCard === true;

  /*
   * The obligation two outcomes carry, checked on the server as well as in
   * the form. The button that would have been disabled is not the enforcement:
   * this route is reachable without it, and a card closed on a promise nobody
   * wrote down leaves the next person exactly where the call started.
   *
   * Only on close. A draft is allowed to be half-finished, which is what a
   * draft is for.
   */
  if (closeCard) {
    const ready = outcomeComplete(body.response?.outcome, {
      callBackAt: body.response?.call_back_at,
      contactName: body.response?.contact_name,
    });
    if (!ready.ok) {
      return NextResponse.json({ error: ready.reason }, { status: 400 });
    }
  }

  // All money is whole US dollars. Reject obviously wrong magnitudes early.
  const rawQuote = Number(response.quote_amount);
  if (Number.isFinite(rawQuote) && rawQuote > 100_000_000) {
    return NextResponse.json(
      { error: "Quote is over $100M. Enter dollars, not cents." },
      { status: 400 }
    );
  }
  const quoteAmountNum = Number.isFinite(rawQuote) && rawQuote > 0 ? rawQuote : null;

  // Clamp structured fields that have a defined range.
  if (response.confidence != null) {
    const c = Number(response.confidence);
    response.confidence = Number.isFinite(c) ? Math.min(5, Math.max(1, Math.round(c))) : undefined;
  }

  const cardStatus = closeCard
    ? response.outcome === "skipped"
      ? "skipped"
      : "called"
    : "pending";

  const summaryLines: string[] = [];
  if (response.outcome) summaryLines.push(`Outcome: ${response.outcome}`);
  if (response.can_perform) summaryLines.push(`Can perform: ${response.can_perform}`);
  if (response.interested) summaryLines.push(`Interested: ${response.interested}`);
  if (quoteAmountNum != null)
    summaryLines.push(
      `Quote: $${quoteAmountNum.toLocaleString()}${response.price_type ? ` (${response.price_type})` : ""}`
    );
  if (response.recommendation) summaryLines.push(`Rec: ${response.recommendation}`);

  // Job-specific answers go into the logged call record in the operator's own
  // terms. Without the question text a reader six weeks later finds a bare
  // "yes" against a key nobody remembers.
  const askedById = new Map(
    (response.questions_asked ?? []).map((q) => [q.id, q.ask])
  );
  const answerLines = Object.entries(response.answers ?? {})
    .filter(([, v]) => v != null && v !== "" && v !== false)
    .map(([id, v]) => `${askedById.get(id) ?? id} ${v === true ? "Yes" : v}`);

  const callBody = [
    summaryLines.join(" · "),
    answerLines.length ? answerLines.join("\n") : "",
    response.notes,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await transaction(async (c) => {
      // 1) Look up the card + related ids.
      const card = (
        await c.query<{ opportunity_id: string; subcontractor_id: string; status: string }>(
          `select opportunity_id, subcontractor_id, status from call_cards where id=$1 and org_id=$2`,
          [params.id, orgId]
        )
      ).rows[0];
      if (!card) throw new Error("Call card not found.");
      const { opportunity_id, subcontractor_id } = card;

      // Prefer the trade already recorded on the opp_subs pairing (Sub Finder set it).
      const trade =
        (
          await c.query<{ trade: string | null }>(
            `select trade from opportunity_subs
              where opportunity_id=$1 and subcontractor_id=$2 limit 1`,
            [opportunity_id, subcontractor_id]
          )
        ).rows[0]?.trade ?? null;

      // 2) Update the call card (response_json + status + quote_amount + called_at).
      await c.query(
        `update call_cards
            set response_json=$2, quote_amount=$3, status=$4,
                called_at = case when $4 = 'called' then now() else called_at end
          where id=$1`,
        [params.id, JSON.stringify(response), quoteAmountNum, cardStatus]
      );

      // 3) Update the sub row. A real call stamps last_contacted; skipping does
      // not (we never reached them). Notes still append when provided.
      const appendedNote =
        response.notes && response.notes.trim().length > 0
          ? `[${new Date().toISOString().slice(0, 10)}] ${response.notes.trim()}`
          : null;
      if (cardStatus === "skipped") {
        if (appendedNote) {
          await c.query(
            `update subcontractors
                set notes = case
                  when notes is null or notes = '' then $2
                  else notes || E'\n\n' || $2
                end
              where id=$1`,
            [subcontractor_id, appendedNote]
          );
        }
      } else {
        await c.query(
          `update subcontractors
              set last_contacted = now(),
                  notes = case
                    when $2::text is null then notes
                    when notes is null or notes = '' then $2
                    else notes || E'\n\n' || $2
                  end
            where id=$1`,
          [subcontractor_id, appendedNote]
        );
      }

      // 4) Upsert a quote if a price was captured, Bid Builder reads from here.
      let quoteRowId: string | null = null;
      if (quoteAmountNum != null) {
        const existing = (
          await c.query<{ id: string }>(
            `select id from quotes
              where opportunity_id=$1 and subcontractor_id=$2
              order by created_at desc limit 1`,
            [opportunity_id, subcontractor_id]
          )
        ).rows[0];
        const quoteNotes = [
          response.price_type ? `Price type: ${response.price_type}` : null,
          response.assumptions ? `Assumptions: ${response.assumptions}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        if (existing) {
          await c.query(
            `update quotes
                set trade=$2, quote_amount=$3, payment_terms=$4, notes=$5
              where id=$1`,
            [
              existing.id,
              trade,
              quoteAmountNum,
              response.price_type ?? null,
              quoteNotes || null,
            ]
          );
          quoteRowId = existing.id;
        } else {
          const inserted = (
            await c.query<{ id: string }>(
              `insert into quotes
                  (opportunity_id, subcontractor_id, trade, quote_amount, payment_terms, notes)
                values ($1,$2,$3,$4,$5,$6)
                returning id`,
              [
                opportunity_id,
                subcontractor_id,
                trade,
                quoteAmountNum,
                response.price_type ?? null,
                quoteNotes || null,
              ]
            )
          ).rows[0];
          quoteRowId = inserted?.id ?? null;
        }
      }

      // 5) Append a communication record so Sub Detail history reflects the call
      // (or the decision to skip calling).
      if (closeCard && cardStatus === "called") {
        await c.query(
          `insert into communications
              (subcontractor_id, opportunity_id, channel, direction, subject, body, replied_at)
            values ($1, $2, 'call', 'inbound', $3, $4, now())`,
          [
            subcontractor_id,
            opportunity_id,
            `Call: ${response.outcome ?? "logged"}`,
            callBody || "Call completed.",
          ]
        );

        /*
         * Map the call outcome onto the pairing so Coverage and Today stay
         * accurate. What each outcome means lives in lib/domain/call-outcome
         * rather than in string comparisons here: there are eleven of them
         * now, this route used to decide their meaning in four separate
         * places, and the failure mode of missing one is silent. A firm that
         * said "wrong number" would read as a firm that engaged.
         *
         * `unchanged` is a real answer and the important one. A ringing phone
         * has told us nothing, and moving the pairing to responsive on the
         * strength of it is the platform inventing a conversation.
         *
         * The two answer fields still count: a sub who said they cannot
         * perform the work has declined it whatever the operator picked from
         * the outcome list.
         */
        const effect = outcomeEffect(response.outcome);
        const declined =
          effect.pairing === "declined" ||
          response.interested === "no" ||
          response.can_perform === "no";
        const noAnswer = effect.pairing === "unchanged";
        if (declined) {
          await c.query(
            `update opportunity_subs
                set outreach_state='declined', responded_at=now()
              where opportunity_id=$1 and subcontractor_id=$2
                and ($3::text is null or trade = $3)`,
            [opportunity_id, subcontractor_id, trade]
          );
        } else if (!noAnswer) {
          await c.query(
            `update opportunity_subs
                set outreach_state='responsive', responded_at=now()
              where opportunity_id=$1 and subcontractor_id=$2
                and ($3::text is null or trade = $3)`,
            [opportunity_id, subcontractor_id, trade]
          );
        }

        // A completed call that captured a price advances the opportunity to
        // quote entry, exactly like the Quote Entry form does, so no path
        // leaves the pipeline stuck in call_queue with quotes in hand.
        if (quoteAmountNum != null) {
          await c.query(
            `update opportunities
                set stage='quote_entry', human_action_required=false
              where id=$1 and stage in ('outreach','call_queue')`,
            [opportunity_id]
          );
        }
      } else if (closeCard && cardStatus === "skipped") {
        await c.query(
          `insert into communications
              (subcontractor_id, opportunity_id, channel, direction, subject, body)
            values ($1, $2, 'note', 'outbound', 'Skipped call', $3)`,
          [
            subcontractor_id,
            opportunity_id,
            response.notes?.trim() || "Operator chose not to call.",
          ]
        );
      }

      const declined =
        closeCard &&
        cardStatus === "called" &&
        (outcomeEffect(response.outcome).closeOut ||
          response.interested === "no" ||
          response.can_perform === "no");
      return { opportunity_id, subcontractor_id, quoteRowId, trade, declined };
    });

    /*
     * What the call learned about the price, filed where a bid can read it.
     *
     * The workspace asks about tax, freight, mobilization, payment terms,
     * validity and lead time, and every one of those changes what a number
     * means. Leaving them in the call record would be worse than not asking:
     * the screen would look like the platform had them.
     *
     * Gap-filling only, and outside the transaction on purpose. This is a
     * convenience over the pricing workspace rather than part of the call
     * record, so a failure here must not lose the call: it is logged and the
     * operator can enter the same six fields on the Pricing tab.
     */
    if (closeCard && cardStatus === "called" && result.trade) {
      try {
        const capture = pricingFromCall(
          { ...(response as Record<string, unknown>), ...(response.answers ?? {}) },
          new Date()
        );
        const wrote = await fillPricingFromCall({
          orgId,
          opportunityId: result.opportunity_id,
          trade: result.trade,
          subcontractorId: result.subcontractor_id,
          sourceQuoteId: result.quoteRowId,
          capture,
        });
        if (wrote === "written" || wrote === "filled") {
          await logAgent({
            agent: "operator",
            action: "call-pricing-capture",
            opportunityId: result.opportunity_id,
            subcontractorId: result.subcontractor_id,
            level: "info",
            message: `Filled the ${result.trade} pricing row from the call. Anything already entered was left alone.`,
          });
        }
      } catch (e) {
        await logAgent({
          agent: "operator",
          action: "call-pricing-capture",
          opportunityId: result.opportunity_id,
          level: "warn",
          message: `The call saved, but its price details did not reach the ${result.trade} pricing row: ${(e as Error).message}`,
        });
      }
    }

    // Kick the Bid Builder whenever a completed call produced a price. It is
    // idempotent (one bid per opportunity) and re-prices with the latest quotes.
    if (closeCard && cardStatus === "called" && quoteAmountNum != null) {
      await enqueue("bid-builder", { opportunityId: result.opportunity_id });
    }

    if (result.declined) {
      // Operator notes were already appended on the sub row inside the
      // transaction; only pass structured decline flags here.
      const capabilityNotes = [
        response.can_perform === "no" ? "Operator logged: cannot perform." : null,
        response.interested === "no" ? "Operator logged: not interested." : null,
        response.outcome ? `Outcome: ${response.outcome}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      await closeOutDeclinedSub({
        opportunityId: result.opportunity_id,
        subcontractorId: result.subcontractor_id,
        trade: result.trade,
        source: "call_workspace",
        capabilityNotes: capabilityNotes || null,
        sendThankYou: true,
      });
    }

    await logAgent({
      agent: "operator",
      action: closeCard && cardStatus === "skipped" ? "call-skipped" : "call-logged",
      opportunityId: result.opportunity_id,
      subcontractorId: result.subcontractor_id,
      level: "info",
      message: !closeCard
        ? "Call draft saved."
        : cardStatus === "skipped"
          ? "Skipped calling (chose not to call)."
          : `Call ${response.outcome ?? "completed"}${quoteAmountNum != null ? `, quote $${quoteAmountNum.toLocaleString()}` : ""}.`,
    });

    // Dialer mode: after completing a call, offer the next one in the queue
    // (same ordering as the Call Queue page, snoozed cards excluded).
    let nextCall: { id: string; company_name: string } | null = null;
    if (closeCard) {
      nextCall =
        (await queryOne<{ id: string; company_name: string }>(
          `select cc.id, s.company_name
             from call_cards cc
             join subcontractors s on s.id = cc.subcontractor_id
             join opportunities o on o.id = cc.opportunity_id
            where cc.status='pending' and cc.id <> $1
              and (cc.snoozed_until is null or cc.snoozed_until <= now())
            order by (cc.source='reply') desc, (o.deadline is null), o.deadline asc
            limit 1`,
          [params.id]
        )) ?? null;
    }

    return NextResponse.json({ ok: true, ...result, nextCall });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}
