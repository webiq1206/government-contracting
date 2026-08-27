import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import { enqueue } from "@/lib/queue";
import { areCallsEnabled, AUTOMATION_PAUSED_ERROR, isAutomationStopped } from "@/lib/app-settings";
import { isEmailable } from "@/lib/domain/sub-contactability";
import { queryOne } from "@/lib/db";
import {
  correctContact,
  pairing,
  removePairing,
  restorePairing,
  setPairingRole,
} from "@/lib/opportunity-subs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The things an operator does to one subcontractor on one bid.
 *
 * Body: `{ action, ...action-specific fields }`.
 *
 *   resend           send the outreach email again
 *   call             queue a call for this firm on this bid
 *   correct_contact  fix the email or phone somebody mistyped
 *   remove           take them off the bid, with a reason, keeping the history
 *   restore          put them back on it
 *   mark_primary     the firm being priced for this trade
 *   mark_backup      the fallback
 *
 * Reading actions (see the packet, see the thread, enter a quote) are links
 * rather than posts, so they are not here: they go somewhere, they do not
 * change anything.
 *
 * The capability is `outreach` for anything that sends and `decide` for
 * anything that changes the shape of the bid. Ranking a subcontractor is a
 * bid decision; sending them another email is an outreach one, and an account
 * that has turned outreach off for somebody should not find that person able
 * to trigger a send from a different screen.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string; pairingId: string } }
) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    reason?: string;
    email?: string | null;
    phone?: string | null;
  };
  const action = body.action ?? "";

  /*
   * Written as two calls rather than one with a computed capability, so the
   * capability this route demands is readable without following a variable,
   * and so the sweep that checks every mutating route names one can see it.
   */
  const sends = action === "resend" || action === "call";
  const ctx = sends
    ? await requireOrgContext({ capability: "outreach" })
    : await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const row = await pairing(orgId, params.id, params.pairingId);
  // 404 rather than 403: a pairing in another organization must not be
  // distinguishable from one that does not exist.
  if (!row) return NextResponse.json({ error: "No such subcontractor on this bid." }, { status: 404 });

  switch (action) {
    case "resend":
    case "call": {
      /*
       * A paused account does not send. This is checked here rather than
       * trusted to the agent, because the pause is a promise made to an
       * operator on a different screen and a queued job that runs later is
       * still a send they did not expect.
       */
      if (await isAutomationStopped()) {
        return NextResponse.json({ error: AUTOMATION_PAUSED_ERROR }, { status: 409 });
      }
      if (row.removed_at) {
        return NextResponse.json(
          { error: "This firm is off the bid. Put them back on it first." },
          { status: 409 }
        );
      }
      if (action === "call") {
        if (!(await areCallsEnabled())) {
          return NextResponse.json(
            { error: "Calling is turned off for this account." },
            { status: 409 }
          );
        }
        if (!row.phone) {
          return NextResponse.json(
            { error: "No phone number on this firm. Add one first." },
            { status: 400 }
          );
        }
      } else {
        /*
         * Verified, not merely present. Outreach itself refuses an unverified
         * address, so queuing a send over one would produce a job that skips
         * this firm and an operator who thinks an email went out. The same
         * predicate the agent uses is the one checked here.
         */
        const sub = await queryOne<{ email: string | null; email_verified: boolean | null }>(
          `select email, email_verified from subcontractors where id = $1 and org_id = $2`,
          [row.subcontractor_id, orgId]
        );
        if (!sub || !isEmailable(sub)) {
          return NextResponse.json(
            {
              error: sub?.email
                ? "That address has not passed verification, so outreach will not send to it. Fix it or wait for the check to finish."
                : "No email on this firm. Fix the contact details first.",
            },
            { status: 400 }
          );
        }
      }

      const agent = action === "call" ? "call-prep" : "outreach";
      await enqueue(agent, {
        opportunityId: params.id,
        subcontractorId: row.subcontractor_id,
        trade: row.trade ?? "",
        source: "operator",
      });
      await logAgent({
        agent: "operator",
        action: action === "call" ? "sub-call-requested" : "sub-resend-requested",
        opportunityId: params.id,
        subcontractorId: row.subcontractor_id,
        level: "info",
        message:
          action === "call"
            ? `Queued a call to ${row.company_name} for ${row.trade ?? "this bid"}.`
            : `Queued another outreach email to ${row.company_name} for ${row.trade ?? "this bid"}.`,
      });
      return NextResponse.json({
        ok: true,
        // What actually happened, not what it looks like. Nothing has been
        // sent yet, and saying "Sent" here would be the screen claiming an
        // outcome the queue has not produced.
        message:
          action === "call"
            ? `Queued. ${row.company_name} will appear in the call queue once prep finishes.`
            : `Queued. The email to ${row.company_name} goes out on the next outreach run.`,
      });
    }

    case "correct_contact": {
      const res = await correctContact(orgId, params.id, params.pairingId, {
        email: body.email,
        phone: body.phone,
      });
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
      await logAgent({
        agent: "operator",
        action: "sub-contact-corrected",
        opportunityId: params.id,
        subcontractorId: row.subcontractor_id,
        level: "info",
        message: `Corrected contact details for ${row.company_name}.`,
      });
      /*
       * A corrected address is unverified by definition, and an unverified
       * address is one outreach refuses. Without this the correction would
       * leave the firm permanently unsendable until some unrelated sweep
       * happened to re-check them.
       */
      if (body.email !== undefined) {
        await enqueue("sub-verify", {
          opportunityId: params.id,
          subcontractorId: row.subcontractor_id,
          trade: row.trade ?? "",
          source: "operator",
        });
      }
      return NextResponse.json({
        ok: true,
        message:
          body.email !== undefined
            ? "Saved, and queued for verification. Outreach can send to it once the check passes."
            : "Saved.",
      });
    }

    case "remove": {
      const res = await removePairing(
        orgId,
        params.id,
        params.pairingId,
        body.reason ?? "",
        ctx.user.id
      );
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
      await logAgent({
        agent: "operator",
        action: "sub-removed-from-bid",
        opportunityId: params.id,
        subcontractorId: row.subcontractor_id,
        level: "info",
        message: `${row.company_name} came off ${row.trade ?? "this bid"}: ${(body.reason ?? "").trim()}`,
      });
      return NextResponse.json({
        ok: true,
        message: `${row.company_name} is off the bid. Their history stays on it.`,
      });
    }

    case "restore": {
      const res = await restorePairing(orgId, params.id, params.pairingId);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
      await logAgent({
        agent: "operator",
        action: "sub-restored-to-bid",
        opportunityId: params.id,
        subcontractorId: row.subcontractor_id,
        level: "info",
        message: `${row.company_name} is back on ${row.trade ?? "this bid"}.`,
      });
      return NextResponse.json({ ok: true, message: `${row.company_name} is back on the bid.` });
    }

    case "mark_primary":
    case "mark_backup": {
      const asked = action === "mark_primary" ? "primary" : "backup";
      const res = await setPairingRole(orgId, params.id, params.pairingId, asked);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
      await logAgent({
        agent: "operator",
        action: "sub-rank-changed",
        opportunityId: params.id,
        subcontractorId: row.subcontractor_id,
        level: "info",
        message: res.role
          ? `${row.company_name} is now the ${res.role} for ${row.trade ?? "this bid"}.`
          : `${row.company_name} is no longer ranked for ${row.trade ?? "this bid"}.`,
      });
      return NextResponse.json({ ok: true, role: res.role ?? null });
    }

    default:
      return NextResponse.json({ error: "That is not something to do here." }, { status: 400 });
  }
}
