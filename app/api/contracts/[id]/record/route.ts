import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import {
  ContractRefusal,
  completeMilestone,
  logCoordination,
  removeMilestone,
  resolveIssue,
  saveInvoice,
  saveIssue,
  saveMilestone,
  saveModification,
  settleInvoice,
  updateContractTerms,
} from "@/lib/contract-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything a contract accumulates after award.
 *
 * One route because these are one working session on one record: an estimator
 * off a site call records the milestone that landed, the modification that
 * moved the end date, and the conversation it came out of, in the same two
 * minutes. Three endpoints would mean three ways for part of it to save.
 *
 * Two of these fields were rendered on the card and had no write path at all,
 * so the richest parts of the contract were permanently empty.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "manage_contracts" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const base = { orgId: ctx.orgId, contractId: params.id };
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const n = (k: string) => {
    const v = body[k];
    if (v == null || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  try {
    switch (action) {
      case "milestone": {
        const res = await saveMilestone({
          ...base,
          milestoneId: s("milestone_id") || null,
          kind: s("kind") || "milestone",
          name: s("name"),
          detail: s("detail"),
          dueAt: s("due_at") || null,
          amountCents: n("amount_cents"),
          evidenceNote: s("evidence_note"),
        });
        return respond(res, "Saved.");
      }

      case "complete_milestone": {
        const res = await completeMilestone({
          ...base,
          milestoneId: s("milestone_id"),
          actorId: ctx.user.id,
          evidenceNote: s("evidence_note"),
          undo: Boolean(body.undo),
        });
        return respond(res, body.undo ? "Marked outstanding again." : "Marked delivered.");
      }

      case "remove_milestone":
        return respond(
          await removeMilestone({ ...base, milestoneId: s("milestone_id") }),
          "Removed."
        );

      case "modification": {
        const res = await saveModification({
          ...base,
          modNumber: s("mod_number"),
          kind: s("kind"),
          summary: s("summary"),
          valueDeltaCents: n("value_delta_cents"),
          newEndDate: s("new_end_date") || null,
          effectiveAt: s("effective_at") || null,
          sourceDocument: s("source_document"),
          sourceNote: s("source_note"),
          supersedes: s("supersedes") || null,
          actorId: ctx.user.id,
        });
        if (res.ok) {
          await logAgent({
            agent: "operator",
            action: "contract-modification",
            level: "info",
            // Names the number and the change, so the log answers what a
            // modification log is read for.
            message: `Recorded modification ${s("mod_number")} on a contract: ${s("summary")}`,
          });
        }
        return respond(res, "Recorded.");
      }

      case "invoice": {
        const amount = n("amount_cents");
        if (amount == null) {
          return NextResponse.json({ error: "An invoice needs an amount." }, { status: 400 });
        }
        return respond(
          await saveInvoice({
            ...base,
            invoiceId: s("invoice_id") || null,
            invoiceNumber: s("invoice_number"),
            amountCents: amount,
            periodStart: s("period_start") || null,
            periodEnd: s("period_end") || null,
            submittedAt: s("submitted_at") || null,
            note: s("note"),
          }),
          "Saved."
        );
      }

      case "settle_invoice":
        return respond(
          await settleInvoice({
            ...base,
            invoiceId: s("invoice_id"),
            paidCents: n("paid_cents"),
            paidAt: s("paid_at") || null,
            rejectedReason: s("rejected_reason") || null,
          }),
          s("rejected_reason") ? "Recorded as refused." : "Recorded as paid."
        );

      case "issue":
        return respond(
          await saveIssue({
            ...base,
            issueId: s("issue_id") || null,
            title: s("title"),
            detail: s("detail"),
            severity: s("severity") || "normal",
            actorId: ctx.user.id,
          }),
          "Saved."
        );

      case "resolve_issue":
        return respond(
          await resolveIssue({ ...base, issueId: s("issue_id"), resolution: s("resolution") }),
          "Resolved."
        );

      case "coordination":
        return respond(
          await logCoordination({
            ...base,
            channel: s("channel") || "other",
            withWhom: s("with_whom"),
            summary: s("summary"),
            happenedAt: s("happened_at") || null,
            subcontractorId: s("subcontractor_id") || null,
            actorId: ctx.user.id,
          }),
          "Logged."
        );

      case "terms":
        return respond(
          await updateContractTerms({
            ...base,
            fields: (body.fields ?? {}) as Record<string, unknown>,
          }),
          "Saved."
        );

      default:
        return NextResponse.json({ error: "That is not something to do here." }, { status: 400 });
    }
  } catch (e) {
    // A constraint the database caught first still reaches the operator as a
    // sentence rather than as an index name.
    if (e instanceof ContractRefusal) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}

function respond(
  res: { ok: true; id?: string } | { ok: false; status: number; error: string },
  message: string
) {
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, id: res.id, message });
}
