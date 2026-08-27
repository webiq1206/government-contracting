import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import { enqueue } from "@/lib/queue";
import { queryOne } from "@/lib/db";
import { AUTOMATION_PAUSED_ERROR, isAutomationStopped } from "@/lib/app-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Find more firms for one trade on this bid.
 *
 * Body: `{ trade }`. Sub Finder already accepts a single trade, and it has
 * done since re-sourcing after partial coverage was built. What was missing
 * was any way for an operator to ask for it: the only trigger was an agent
 * deciding coverage had come up short, so an operator looking at three
 * electricians who had all declined had nothing to press.
 *
 * Scoped to one trade rather than the whole job. A fresh sweep of every trade
 * would re-approach firms already mid-conversation, which is how a bid ends up
 * emailing the same company twice about the same work.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const body = (await req.json().catch(() => ({}))) as { trade?: string };
  const trade = (body.trade ?? "").trim();
  if (!trade) {
    return NextResponse.json({ error: "Say which trade needs more firms." }, { status: 400 });
  }

  const opp = await queryOne<{ id: string }>(
    `select id from opportunities where id = $1 and org_id = $2`,
    [params.id, orgId]
  );
  if (!opp) return NextResponse.json({ error: "No such opportunity." }, { status: 404 });

  if (await isAutomationStopped()) {
    return NextResponse.json({ error: AUTOMATION_PAUSED_ERROR }, { status: 409 });
  }

  await enqueue("sub-finder", { opportunityId: params.id, trade, source: "operator" });
  await logAgent({
    agent: "operator",
    action: "sub-sourcing-requested",
    opportunityId: params.id,
    level: "info",
    message: `Asked Sub Finder for more ${trade} firms on this bid.`,
  });

  return NextResponse.json({
    ok: true,
    // Queued, not found. Sourcing takes a run, and a message that says firms
    // were found would have an operator refreshing at an unchanged list.
    message: `Queued. New ${trade} firms appear here once Sub Finder has run.`,
  });
}
