/**
 * Subcontractor Onboarding: the paperwork gate moves from bidding to working.
 *
 * Before an award, compliance gates outreach: a sub without a current
 * certificate does not get sent a bid package. That is a soft cost. After an
 * award it is a different problem entirely. The contract is signed, the prime
 * is on the hook for its subcontractors' coverage, and a sub who starts work
 * with a lapsed policy exposes the whole job. Nobody notices until a claim.
 *
 * So on a win this runs and asks one question per subcontractor: is their
 * paperwork good enough to put them on this job? What it does about the answer
 * depends on how certain we are that they are actually on it:
 *
 *   - Named on the contract (primary or backup): unambiguous. They get emailed
 *     a paperwork link automatically.
 *   - Quoted the job but not named: ambiguous, and emailing them "send your
 *     W-9, you are on the job" would be wrong for everyone who is not. Those
 *     are reported for a human to designate.
 *
 * Runs on the queue when a bid is won, and daily as a sweep so a sub added to
 * a contract weeks later is chased too.
 */
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { runWithOrg } from "../tenant-context";
import { sendOutreachEmail } from "../integrations/email-transport";
import { subPortalUrl, PORTAL_TTL_SECONDS } from "../domain/sub-portal-link";
import { DOC_LABEL, type DocType } from "../domain/sub-compliance";
import {
  loadAwardCompliance,
  needsAttentionOnWonWork,
  type AwardComplianceRow,
} from "../sub-compliance-store";
import { isEmailable } from "../domain/sub-contactability";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

/** How long to leave a sub alone after chasing them. */
const CHASE_COOLDOWN_DAYS = 5;

/**
 * True when this sub was already chased recently enough to leave alone.
 *
 * Only chases that actually went out count. A send that failed because the
 * inbox was disconnected is recorded for the audit trail but must not start a
 * cooldown: that would turn one broken send into five days of silence about a
 * sub who is on a job with no insurance, which is precisely the case this
 * agent exists to catch.
 */
async function chasedRecently(subId: string): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from communications
      where subcontractor_id = $1
        and meta->>'kind' = 'compliance-chase'
        and meta->>'sent' = 'true'
        and created_at > now() - ($2 || ' days')::interval`,
    [subId, String(CHASE_COOLDOWN_DAYS)]
  ).catch(() => null);
  return (row?.n ?? 0) > 0;
}

/** What is outstanding, in the words the sub will read. */
function missingList(row: AwardComplianceRow): string {
  const a = row.assessment;
  const label = (types: DocType[]) => types.map((t) => DOC_LABEL[t]).join(", ");
  const parts: string[] = [];
  if (a.missing.length) parts.push(label(a.missing));
  if (a.expired.length) parts.push(`${label(a.expired)} (out of date)`);
  if (a.awaitingVerification.length) {
    parts.push(`${label(a.awaitingVerification)} (received, being checked)`);
  }
  if (a.expiringSoon.length) {
    parts.push(
      `${label(a.expiringSoon.map((e) => e.docType))} (expiring, send the renewal when you have it)`
    );
  }
  return parts.join("; ");
}

/**
 * Ask a named subcontractor for what is missing.
 *
 * Written as one specific request rather than a generic compliance notice: the
 * recipient just won work with us and the email should read that way. The link
 * is the only call to action.
 */
async function chase(row: AwardComplianceRow, needed: string): Promise<boolean> {
  const url = subPortalUrl(row.subcontractorId);
  const job = row.opportunityTitle ?? "a job we have just been awarded";
  const subject = `Before we can start on ${job}: your paperwork`;
  const text = [
    `Good news, we won ${job} and we have you down for it.`,
    "",
    `Before work can start we need this on file for ${row.companyName}: ${needed}.`,
    "",
    "You can send it here, it takes about five minutes and there is no account to make:",
    url,
    "",
    `That link works for ${Math.round(PORTAL_TTL_SECONDS / 86_400)} days. Reply to this email if anything is not right.`,
    "",
    "Brost Co",
  ].join("\n");
  const html = `<div>${text
    .split("\n")
    .map((l) =>
      l === url
        ? `<p><a href="${url}">${url}</a></p>`
        : l
          ? `<p>${l}</p>`
          : ""
    )
    .join("")}</div>`;

  const res = await sendOutreachEmail({
    to: row.email as string,
    subject,
    text,
    html,
    orgId: row.orgId ?? undefined,
  });
  const sent = Boolean(res.provider) && !res.error;

  await query(
    `insert into communications
       (subcontractor_id, opportunity_id, channel, direction, subject, body,
        gmail_message_id, gmail_thread_id, provider, recipient_email, meta)
     values ($1,$2,'email','outbound',$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      row.subcontractorId,
      row.opportunityId,
      subject,
      text,
      res.messageId ?? null,
      res.threadId ?? null,
      res.provider,
      row.email,
      // The marker the cooldown reads. Written whether or not delivery
      // succeeded, so a broken inbox does not turn into a send every hour.
      JSON.stringify({ kind: "compliance-chase", sent }),
    ]
  ).catch(() => {});

  return sent;
}

export const subOnboarding: AgentDefinition = {
  name: "sub-onboarding",
  label: "Subcontractor Onboarding",
  description:
    "When a bid is won, checks that every subcontractor going on the job has a signed W-9 and current insurance. Emails a paperwork link to the subs named on the contract, and reports anyone who quoted but has not been designated yet so no work starts behind missing coverage.",
  worksWithoutClaude: true,
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string | undefined;
    // Tenant scoping. With an opportunityId the runner has already set the
    // owning org's context; the daily cron has no payload, so without an
    // explicit per-org loop this read spanned EVERY organization's contracts
    // and chased other tenants' subcontractors from whatever context was
    // ambient. One org at a time, each inside its own context.
    let candidates: Awaited<ReturnType<typeof loadAwardCompliance>> = [];
    if (opportunityId) {
      candidates = await loadAwardCompliance({ opportunityId });
    } else {
      const { listActiveOrganizations } = await import("../organizations");
      const orgs = await listActiveOrganizations().catch(() => []);
      for (const org of orgs) {
        const rows = await runWithOrg(org.id, () =>
          loadAwardCompliance({ orgId: org.id })
        ).catch(() => []);
        candidates.push(...rows);
      }
    }
    if (candidates.length === 0) {
      return {
        ok: true,
        summary: opportunityId
          ? "No subcontractors are attached to this contract yet."
          : "No active contracts with subcontractors attached.",
      };
    }

    let chased = 0;
    let alreadyClear = 0;
    const undesignated: string[] = [];
    const unreachable: string[] = [];
    const blocked: string[] = [];

    for (const row of candidates) {
      if (!needsAttentionOnWonWork(row)) {
        alreadyClear++;
        continue;
      }

      const needed = missingList(row);
      blocked.push(`${row.companyName}: ${needed}`);

      if (!row.namedOnContract) {
        // They quoted, and they may or may not be on the job. That is a
        // decision, and decisions belong to the operator.
        undesignated.push(`${row.companyName} (${needed})`);
        continue;
      }

      if (!isEmailable({ email: row.email, email_verified: row.emailVerified })) {
        unreachable.push(row.companyName);
        continue;
      }
      if (await chasedRecently(row.subcontractorId)) continue;

      const inRowOrg = <T,>(fn: () => Promise<T>): Promise<T> =>
        row.orgId ? runWithOrg(row.orgId, fn) : fn();
      const sent = await inRowOrg(() => chase(row, needed));
      if (sent) chased++;
      else unreachable.push(row.companyName);

      await inRowOrg(() =>
        logAgent({
          agent: "sub-onboarding",
          action: "paperwork-requested",
          subcontractorId: row.subcontractorId,
          opportunityId: row.opportunityId,
          level: "warn",
          message: sent
            ? `${row.companyName} is on won work without complete paperwork (${needed}). Sent them a link to put it right.`
            : `${row.companyName} is on won work without complete paperwork (${needed}), and the email could not go out. Ring them.`,
        })
      );
    }

    for (const line of undesignated) {
      // One line per sub rather than a digest, so it can be read next to the
      // opportunity it belongs to.
      await logAgent({
        agent: "sub-onboarding",
        action: "designation-needed",
        level: "warn",
        message: `${line} quoted work we have won but is not named on the contract. Confirm whether they are on the job, then chase their paperwork.`,
      });
    }

    const summary = [
      `${candidates.length} subcontractor${candidates.length === 1 ? "" : "s"} on won work checked`,
      `${alreadyClear} already clear`,
      `${chased} chased`,
      undesignated.length ? `${undesignated.length} awaiting designation` : null,
      unreachable.length ? `${unreachable.length} could not be emailed` : null,
    ]
      .filter(Boolean)
      .join(", ");

    return {
      ok: true,
      summary: `${summary}.`,
      // Somebody has to designate subs or pick up a phone. An automated chase
      // that went out cleanly is not, by itself, a person's problem.
      humanActionRequired: undesignated.length > 0 || unreachable.length > 0,
      data: blocked.length ? { blocked } : undefined,
    };
  },
};
