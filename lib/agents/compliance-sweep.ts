/**
 * Compliance Sweep: notice when a subcontractor's insurance is about to lapse,
 * before it does.
 *
 * The rest of the compliance code evaluates correctly whenever something asks
 * it. This is the thing that asks. Without it a certificate expires quietly on
 * a Tuesday and nobody finds out until a claim, which on federal work is the
 * prime's problem rather than the sub's.
 *
 * Three jobs, in order of how much they matter:
 *   1. Chase certificates that are about to lapse, while there is still time.
 *   2. Pull work from subs whose coverage has actually lapsed.
 *   3. Keep the stored status column in step with the computed one, so lists
 *      and filters elsewhere do not have to recompute every row.
 */
import { query } from "../db";
import { logAgent } from "../logger";
import { systemMail } from "../integrations/system-mail";
import { config } from "../config";
import {
  currentStatus,
  DOC_LABEL,
  EXPIRING_SOON_DAYS,
  type ComplianceDoc,
  type DocType,
} from "../domain/sub-compliance";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

interface Row extends ComplianceDoc {
  id: string;
  org_id: string | null;
  subcontractor_id: string;
  company_name: string | null;
  sub_email: string | null;
  carrier: string | null;
  /**
   * True when this subcontractor is named on a live contract.
   *
   * The same lapsed certificate means two different things depending on this
   * flag. On a sub we have not yet put to work it blocks outreach, which costs
   * a phone call. On a sub who is on site tomorrow it is uninsured work on
   * federal ground, which can void coverage and put the prime in breach. The
   * sweep says so differently for each.
   */
  on_active_contract: boolean;
}

/** Documents on live subcontractors that could change state. */
async function loadDocuments(): Promise<Row[]> {
  return query<Row>(
    `select d.id, d.org_id, d.subcontractor_id, d.doc_type, d.status,
            d.expires_at::text as expires_at, d.signed_at::text as signed_at,
            d.verified_at::text as verified_at, d.carrier,
            s.company_name, s.email as sub_email,
            exists(
              select 1 from contracts c
               where c.status = 'active'
                 and s.id in (c.primary_sub_id, c.backup_sub_id)
            ) as on_active_contract
       from subcontractor_documents d
       join subcontractors s on s.id = d.subcontractor_id
      where d.status <> 'rejected'
      order by d.expires_at asc nulls last`
  ).catch(() => []);
}

function fmt(iso: string | null): string {
  if (!iso) return "no expiry on file";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "an unreadable date"
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export const complianceSweep: AgentDefinition = {
  name: "compliance-sweep",
  label: "Compliance Sweep",
  description:
    "Checks every subcontractor's W-9 and insurance certificates daily. Chases anything lapsing within 30 days while there is still time to fix it, flags anything already lapsed so no work goes out behind it, and keeps each document's status accurate.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const docs = await loadDocuments();
    if (docs.length === 0) {
      return { ok: true, summary: "No compliance documents on file yet." };
    }

    const now = new Date();
    const expiringSoon: Row[] = [];
    const justExpired: Row[] = [];
    let restatused = 0;

    for (const doc of docs) {
      const computed = currentStatus(doc, now);
      if (computed !== doc.status) {
        await query(
          `update subcontractor_documents set status = $2, updated_at = now() where id = $1`,
          [doc.id, computed]
        ).catch(() => {});
        restatused++;
        // Only the transition into expired is news. A document that was
        // already expired yesterday has been reported once and should not be
        // reported again every single day.
        if (computed === "expired") justExpired.push(doc);
      }
      if (computed === "expiring") expiringSoon.push(doc);
    }

    // Both lists are per document. A sub with two lapsing certificates is one
    // problem to a human, so group before saying anything.
    const bySub = new Map<
      string,
      { name: string; items: string[]; expired: boolean; working: boolean }
    >();
    const add = (r: Row, expired: boolean) => {
      const key = r.subcontractor_id;
      const entry = bySub.get(key) ?? {
        name: r.company_name ?? "A subcontractor",
        items: [],
        expired: false,
        working: false,
      };
      entry.items.push(
        `${DOC_LABEL[r.doc_type as DocType] ?? r.doc_type} ${expired ? "lapsed" : "expires"} ${fmt(r.expires_at)}`
      );
      entry.expired = entry.expired || expired;
      entry.working = entry.working || r.on_active_contract;
      bySub.set(key, entry);
    };
    for (const r of justExpired) add(r, true);
    for (const r of expiringSoon) add(r, false);

    for (const [subId, entry] of bySub) {
      // On a sub who is on a live contract, an expiry is not a future
      // inconvenience: work is happening now, so both cases escalate.
      const level = entry.expired || entry.working ? "error" : "warn";
      let message: string;
      if (entry.expired && entry.working) {
        message = `${entry.name} is ON A LIVE CONTRACT and is not covered right now: ${entry.items.join("; ")}. Stop their work and get a current certificate today. Uninsured subcontractor work on a federal job puts us in breach.`;
      } else if (entry.expired) {
        message = `${entry.name} is not covered right now: ${entry.items.join("; ")}. No work can go out to them until a current certificate is on file.`;
      } else if (entry.working) {
        message = `${entry.name} is on a live contract and their cover runs out shortly: ${entry.items.join("; ")}. Get the renewal in before it lapses, not after.`;
      } else {
        message = `${entry.name} needs a renewed certificate soon: ${entry.items.join("; ")}. Ask for it now while there is time.`;
      }
      await logAgent({
        agent: "compliance-sweep",
        action: entry.expired ? "coverage-lapsed" : "coverage-expiring",
        subcontractorId: subId,
        level,
        message,
      });
    }

    // One digest per run rather than one email per document, so a bad week
    // does not bury the operator.
    if (bySub.size > 0 && config.systemMail.digestTo && (await systemMail.enabled())) {
      // Subs who are actually on a job first. A digest read on a phone at
      // 06:30 gets skimmed, so the item that can stop work has to be at the
      // top rather than alphabetically wherever it fell.
      const entries = [...bySub.values()].sort(
        (a, b) => Number(b.working) - Number(a.working) || Number(b.expired) - Number(a.expired)
      );
      const lines = entries.map(
        (e) =>
          `${e.working ? "[ON A LIVE CONTRACT] " : ""}${e.expired ? "LAPSED" : "Expiring"}: ${e.name} - ${e.items.join("; ")}`
      );
      const working = entries.filter((e) => e.working && e.expired).length;
      await systemMail
        .send({
          to: config.systemMail.digestTo,
          subject: working
            ? `Subcontractor insurance: ${working} uninsured on live contracts`
            : `Subcontractor insurance: ${justExpired.length} lapsed, ${expiringSoon.length} expiring`,
          text: [
            "Insurance and tax documents that need attention:",
            "",
            ...lines,
            "",
            "Anyone listed as LAPSED is blocked from receiving work until a current certificate is on file.",
            working
              ? "Anyone marked ON A LIVE CONTRACT is already working. Stop their work until a current certificate is in hand."
              : "",
          ]
            .filter((l) => l !== "")
            .join("\n"),
        })
        .catch(() => undefined);
    }

    const workingAndLapsing = [...bySub.values()].filter((e) => e.working).length;

    return {
      ok: true,
      summary: `Checked ${docs.length} document${docs.length === 1 ? "" : "s"}: ${justExpired.length} newly lapsed, ${expiringSoon.length} expiring within ${EXPIRING_SOON_DAYS} days, ${restatused} status${restatused === 1 ? "" : "es"} corrected.${
        workingAndLapsing
          ? ` ${workingAndLapsing} of them ${workingAndLapsing === 1 ? "is" : "are"} on a live contract.`
          : ""
      }`,
      // A lapsed certificate is a person-shaped problem: somebody has to ring
      // the sub. Expiring alone usually is not, since the chase can wait a day,
      // unless the sub is already on a job, where the days are the whole point.
      humanActionRequired: justExpired.length > 0 || workingAndLapsing > 0,
    };
  },
};
