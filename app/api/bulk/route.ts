import { NextResponse } from "next/server";
import { requireSubscriber } from "@/lib/api-auth";
import { AUTOMATION_PAUSED_ERROR, isAutomationPaused } from "@/lib/app-settings";
import { query, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";
import { skipCallCard } from "@/lib/skip-call";
import {
  resolveSnoozeUntil,
  type SnoozeUntilChoice,
} from "@/lib/domain/snooze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 100;

type BulkBody =
  | { action: "skip_calls"; ids: string[] }
  | {
      action: "snooze";
      kind: "opportunity" | "call_card";
      ids: string[];
      until: SnoozeUntilChoice;
    }
  | { action: "pursue"; ids: string[] }
  | { action: "dismiss"; ids: string[] };

function parseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, MAX_IDS);
  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}

/**
 * Batch operator actions for Call Queue / Today / Review.
 * Body shapes: skip_calls | snooze | pursue | dismiss (see BulkBody).
 */
export async function POST(req: Request) {
  const auth = await requireSubscriber();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as Partial<BulkBody> & {
    ids?: unknown;
  };
  const ids = parseIds(body.ids);
  if (!ids) {
    return NextResponse.json(
      { error: "ids must be a non-empty array (max 100)." },
      { status: 400 }
    );
  }

  if (body.action === "skip_calls") {
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await skipCallCard(id, { reason: "Skipped in bulk by operator." });
        ok += 1;
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    await logAgent({
      agent: "operator",
      action: "bulk-skip-calls",
      level: "info",
      message: `Operator ${auth.email} skipped ${ok} of ${ids.length} call card(s).`,
    });
    return NextResponse.json({ ok: true, processed: ok, failed: errors.length, errors });
  }

  if (body.action === "snooze") {
    if (body.kind !== "opportunity" && body.kind !== "call_card") {
      return NextResponse.json(
        { error: 'kind must be "opportunity" or "call_card".' },
        { status: 400 }
      );
    }
    let until: Date;
    try {
      until = resolveSnoozeUntil(body.until as SnoozeUntilChoice)!;
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    const untilIso = until.toISOString();

    if (body.kind === "call_card") {
      const result = await query<{ id: string }>(
        `update call_cards
            set snoozed_until = $2
          where id = any($1::uuid[])
      returning id`,
        [ids, untilIso]
      );
      await logAgent({
        agent: "operator",
        action: "bulk-snooze-calls",
        level: "info",
        message: `Operator ${auth.email} snoozed ${result.length} call card(s) until ${untilIso.slice(0, 10)}.`,
      });
      return NextResponse.json({
        ok: true,
        processed: result.length,
        until: untilIso,
      });
    }

    const result = await query<{ id: string }>(
      `update opportunities
          set snoozed_until = $2,
              review_expires_at = case
                when $2::timestamptz is not null
                     and review_expires_at is not null
                     and review_expires_at < $2::timestamptz + interval '4 hours'
                then $2::timestamptz + interval '4 hours'
                else review_expires_at
              end
        where id = any($1::uuid[])
    returning id`,
      [ids, untilIso]
    );
    await logAgent({
      agent: "operator",
      action: "bulk-snooze-opps",
      level: "info",
      message: `Operator ${auth.email} snoozed ${result.length} opportunity(ies) until ${untilIso.slice(0, 10)}.`,
    });
    return NextResponse.json({
      ok: true,
      processed: result.length,
      until: untilIso,
    });
  }

  if (body.action === "pursue" || body.action === "dismiss") {
    if (body.action === "pursue" && (await isAutomationPaused())) {
      return NextResponse.json({ error: AUTOMATION_PAUSED_ERROR }, { status: 409 });
    }

    let processed = 0;
    for (const id of ids) {
      const opp = await queryOne<{ id: string }>(
        `select id from opportunities where id = $1 and org_id = $2`,
        [id, auth.organizationId]
      );
      if (!opp) continue;

      if (body.action === "pursue") {
        await query(
          `update opportunities
              set tier='pursue', stage='analysis', human_action_required=false, review_expires_at=null
            where id=$1`,
          [id]
        );
        await enqueue("solicitation-analyst", { opportunityId: id });
        await enqueue("pricing-research", { opportunityId: id });
      } else {
        await query(
          `update opportunities set tier='dismiss', stage='dismissed', status='archived',
                  human_action_required=false, review_expires_at=null where id=$1`,
          [id]
        );
      }
      processed += 1;
    }

    await logAgent({
      agent: "operator",
      action: body.action === "pursue" ? "bulk-pursue" : "bulk-dismiss",
      level: "info",
      message: `Operator ${auth.email} ${body.action === "pursue" ? "pursued" : "dismissed"} ${processed} of ${ids.length} opportunity(ies).`,
    });
    return NextResponse.json({ ok: true, processed });
  }

  return NextResponse.json(
    { error: 'action must be "skip_calls", "snooze", "pursue", or "dismiss".' },
    { status: 400 }
  );
}
