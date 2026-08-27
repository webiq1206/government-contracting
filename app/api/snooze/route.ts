import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import { resolveSnoozeUntil } from "@/lib/domain/snooze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Snooze / wake Today items.
 * Body: { kind: "opportunity" | "call_card", id, until: "tomorrow" | "3d" | null }
 * (null = wake now), or { at: <ISO timestamp> } for a time the operator chose.
 * Body: { wakeAll: true } wakes everything at once.
 *
 * `at` is what "Call later" uses. It is deliberately the same mechanism rather
 * than a second one: the requirement is exactly one future call task, and
 * moving the existing card is one task where creating a new one is two.
 *
 * Snoozing hides the item from Today and the queues until the time passes,
 * then it returns on its own. Automation (deadline alerts, follow-ups,
 * sweeps) is never paused by a snooze. Review-tier opportunities get their
 * auto-dismiss timer pushed past the snooze so an item can't quietly expire
 * while hidden.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;
  const body = (await req.json().catch(() => ({}))) as {
    kind?: string;
    id?: string;
    until?: string | null;
    /** An explicit moment, from a picker. Takes precedence over `until`. */
    at?: string | null;
    wakeAll?: boolean;
  };

  if (body.wakeAll) {
    await query(`update opportunities set snoozed_until=null where snoozed_until is not null and org_id=$1`, [orgId]);
    await query(`update call_cards set snoozed_until=null where snoozed_until is not null and org_id=$1`, [orgId]);
    return NextResponse.json({ ok: true });
  }

  if (body.kind !== "opportunity" && body.kind !== "call_card") {
    return NextResponse.json({ error: 'kind must be "opportunity" or "call_card".' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  let until: Date | null = null;
  if (typeof body.at === "string" && body.at.trim()) {
    const at = new Date(body.at);
    if (Number.isNaN(at.getTime())) {
      return NextResponse.json({ error: "That is not a time." }, { status: 400 });
    }
    /*
     * Bounded on both sides. A time already past would put the card straight
     * back on the queue, which reads as the control having done nothing; a
     * time years out is a typo, and a call task nobody sees again is the same
     * as one deleted without a record.
     */
    if (at.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "Pick a time in the future, or use Skip if the call is not happening." },
        { status: 400 }
      );
    }
    if (at.getTime() > Date.now() + 365 * 86_400_000) {
      return NextResponse.json({ error: "That is more than a year away." }, { status: 400 });
    }
    until = at;
  } else if (body.until === "tomorrow" || body.until === "3d") {
    until = resolveSnoozeUntil(body.until);
  } else if (body.until != null) {
    return NextResponse.json(
      { error: 'until must be "tomorrow", "3d", or null.' },
      { status: 400 }
    );
  }

  if (body.kind === "opportunity") {
    const row = await queryOne<{ id: string; title: string | null }>(
      `update opportunities
          set snoozed_until = $2,
              review_expires_at = case
                -- Don't let a hidden review item auto-dismiss while snoozed.
                when $2::timestamptz is not null
                     and review_expires_at is not null
                     and review_expires_at < $2::timestamptz + interval '4 hours'
                then $2::timestamptz + interval '4 hours'
                else review_expires_at
              end
        where id = $1 and org_id = $3 returning id, title`,
      [body.id, until ? until.toISOString() : null, orgId]
    );
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await logAgent({
      agent: "operator",
      action: until ? "snooze" : "wake",
      opportunityId: body.id,
      level: "info",
      message: until
        ? `Snoozed "${row.title ?? body.id}" until ${until.toISOString().slice(0, 10)}. It returns to Today automatically; deadline alerts still run.`
        : `Woke "${row.title ?? body.id}" from snooze.`,
    });
  } else {
    const row = await queryOne<{ id: string; opportunity_id: string }>(
      `update call_cards set snoozed_until = $2 where id = $1 and org_id = $3 returning id, opportunity_id`,
      [body.id, until ? until.toISOString() : null, orgId]
    );
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await logAgent({
      agent: "operator",
      action: until ? "snooze-call" : "wake-call",
      opportunityId: row.opportunity_id,
      level: "info",
      message: until
        ? `Call moved to ${until.toISOString().slice(0, 16).replace("T", " ")} UTC. The card stays pending and returns then; nothing about the subcontractor changed.`
        : "Woke a call card from snooze.",
    });
  }

  return NextResponse.json({ ok: true, until: until ? until.toISOString() : null });
}
