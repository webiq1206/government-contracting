import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { transaction } from "@/lib/db";
import { logAgent } from "@/lib/logger";

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
  assumptions?: string;
  notes?: string;
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
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const response = (body.response ?? {}) as CallResponse;
  const closeCard = body.closeCard === true;

  const quoteAmountNum = (() => {
    const v = Number(response.quote_amount);
    return Number.isFinite(v) && v > 0 ? v : null;
  })();

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
  const callBody = [summaryLines.join(" · "), response.notes]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await transaction(async (c) => {
      // 1) Look up the card + related ids.
      const card = (
        await c.query<{ opportunity_id: string; subcontractor_id: string; status: string }>(
          `select opportunity_id, subcontractor_id, status from call_cards where id=$1`,
          [params.id]
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

      // 3) Update the sub row (last_contacted; append notes).
      const appendedNote =
        response.notes && response.notes.trim().length > 0
          ? `[${new Date().toISOString().slice(0, 10)}] ${response.notes.trim()}`
          : null;
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

      // 4) Upsert a quote if a price was captured — Bid Builder reads from here.
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

      // 5) Append a communication record so Sub Detail history reflects the call.
      if (closeCard && cardStatus === "called") {
        await c.query(
          `insert into communications
              (subcontractor_id, opportunity_id, channel, direction, subject, body, replied_at)
            values ($1, $2, 'call', 'inbound', $3, $4, now())`,
          [
            subcontractor_id,
            opportunity_id,
            `Call — ${response.outcome ?? "logged"}`,
            callBody || "Call completed.",
          ]
        );

        // Mark the sub as responsive on the pairing (drives sub reliability scoring).
        await c.query(
          `update opportunity_subs
              set outreach_state='responsive', responded_at=now()
            where opportunity_id=$1 and subcontractor_id=$2`,
          [opportunity_id, subcontractor_id]
        );
      }

      return { opportunity_id, subcontractor_id, quoteRowId };
    });

    await logAgent({
      agent: "operator",
      action: "call-logged",
      opportunityId: result.opportunity_id,
      subcontractorId: result.subcontractor_id,
      level: "info",
      message: closeCard
        ? `Call ${response.outcome ?? "completed"}${quoteAmountNum != null ? `, quote $${quoteAmountNum.toLocaleString()}` : ""}.`
        : "Call draft saved.",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}
