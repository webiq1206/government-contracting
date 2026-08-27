import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import { setRequirementConfirmed } from "@/lib/bid-package-state";
import { requirementHistory, updateRequirement } from "@/lib/requirement-states";
import {
  REQUIREMENT_STATES,
  REQUIREMENT_STATE_LABEL,
  VERIFICATION_KINDS,
  type RequirementState,
  type VerificationKind,
} from "@/lib/domain/requirement-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record where one submission requirement has got to.
 *
 * Body: `{ requirement_id, state?, owner_id?, due_at?, verification?,
 * human_verified?, blocking_reason?, note? }`. Every field is optional except
 * the id, so the same route serves "I have started this", "this is Dana's",
 * "this is due before the bid is" and "we are stuck, here is why".
 *
 * Unrecognised values are refused rather than coerced. A misspelled state that
 * quietly became `not_started` would be a checklist silently forgetting what
 * somebody just told it, and one that quietly became `done` would be worse.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as {
    requirement_id?: string;
    state?: string;
    owner_id?: string | null;
    due_at?: string | null;
    verification?: string;
    human_verified?: boolean;
    blocking_reason?: string | null;
    note?: string | null;
  };

  const requirementId = (body.requirement_id ?? "").trim();
  if (!requirementId) {
    return NextResponse.json({ error: "requirement_id is required." }, { status: 400 });
  }

  if (body.state !== undefined && !(REQUIREMENT_STATES as readonly string[]).includes(body.state)) {
    return NextResponse.json({ error: "That is not a state a requirement can be in." }, { status: 400 });
  }
  if (
    body.verification !== undefined &&
    !(VERIFICATION_KINDS as readonly string[]).includes(body.verification)
  ) {
    return NextResponse.json(
      { error: "That is not a way of proving a requirement." },
      { status: 400 }
    );
  }

  let dueAt: Date | null | undefined;
  if (body.due_at !== undefined) {
    if (body.due_at === null || body.due_at === "") {
      dueAt = null;
    } else {
      const parsed = new Date(body.due_at);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "That due date could not be read." }, { status: 400 });
      }
      dueAt = parsed;
    }
  }

  const result = await updateRequirement(
    params.id,
    requirementId,
    {
      state: body.state as RequirementState | undefined,
      verification: body.verification as VerificationKind | undefined,
      humanVerified: body.human_verified,
      ownerId: body.owner_id,
      dueAt,
      blockingReason:
        body.blocking_reason === undefined ? undefined : (body.blocking_reason?.trim() || null),
      note: body.note === undefined ? undefined : (body.note?.trim() || null),
    },
    { kind: "person", id: ctx.user.id, label: ctx.user.email }
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  /*
   * Keep the submission gate and the checklist saying the same thing.
   *
   * A requirement that came out of the compliance matrix exists in two places
   * once a bid row is built: here, and in the package the Submit gate reads.
   * Marking it done in one and not the other is the failure this mirror
   * exists to prevent, and the direction that matters most is the reopening:
   * an operator who reopens an item must not be able to submit a package that
   * still counts it as satisfied.
   *
   * "No package to update." is not an error here. Most requirements are worked
   * long before a bid row exists, and refusing the checklist because the
   * package has not been built yet would make the checklist unusable for
   * exactly the period it is most useful.
   */
  let packageWarning: string | null = null;
  if (body.state !== undefined) {
    const confirmed = result.record.state === "done";
    const mirror = await setRequirementConfirmed(params.id, ctx.orgId, requirementId, confirmed);
    if (!mirror.ok && mirror.error && mirror.error !== "No package to update.") {
      // Surfaced, not swallowed. The checklist did save; the package did not,
      // and the operator has to know which of the two they are looking at.
      packageWarning =
        "Saved on the checklist. The submission package still shows the old answer for this item.";
      await logAgent({
        agent: "operator",
        action: "requirement-state",
        opportunityId: params.id,
        level: "warn",
        message: `Checklist set ${requirementId} to ${result.record.state} but the package did not update: ${mirror.error}`,
      });
    }
  }

  await logAgent({
    agent: "operator",
    action: "requirement-state",
    opportunityId: params.id,
    level: "info",
    message: `${requirementId} is now ${REQUIREMENT_STATE_LABEL[result.record.state]}.`,
  });

  return NextResponse.json({
    ok: true,
    record: result.record,
    history: await requirementHistory(params.id, requirementId),
    warning: packageWarning,
  });
}
