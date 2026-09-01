/**
 * The subcontractor readiness plan: what it takes before a company in the
 * sub database can actually be sent work, as the same numbered checklist the
 * opportunity page uses.
 *
 * The sub record shows contact badges, compliance panels, and touch counts,
 * but never the throughline: reach them, verify them, build the relationship,
 * get their paperwork, use them. This module computes that story, pure, so
 * "why can't I send this company a bid?" is answered by a red step with a
 * fix link instead of a scavenger hunt.
 */

import { DOC_LABEL, type DocType } from "./sub-compliance";
import { assemblePlan, type PlanBlocker, type PlanStep, type StepPlan } from "./step-plan";

function howToCollectMissing(d: DocType): string {
  if (d === "w9") {
    return "Request it in the Compliance section; a signed W-9 can be collected by link.";
  }
  if (d.startsWith("coi_")) {
    return "Request a current certificate in the Compliance section.";
  }
  if (d === "license") {
    return "Request a current license in the Compliance section.";
  }
  return "Request it in the Compliance section.";
}

export interface SubPlanInput {
  hasEmail: boolean;
  hasPhone: boolean;
  emailVerified: boolean;
  /** 'verified' | 'unverified' | 'no_email_found' | 'no_website' | null. */
  contactStatus: string | null;
  samExcluded: boolean;
  /** All communications on record: emails, calls, notes, skips. */
  touches: number;
  openPairings: number;
  totalPairings: number;
  quoteCount: number;
  compliance: {
    clearedForAward: boolean;
    missing: DocType[];
    expired: DocType[];
    awaitingVerification: DocType[];
  };
}

const DEFS: { key: string; title: string; plain: string; owner: PlanStep["owner"] }[] = [
  {
    key: "add",
    title: "Add the company",
    plain: "The company is in your sub database with its trades and location.",
    owner: "brost",
  },
  {
    key: "reach",
    title: "Get a way to reach them",
    plain: "An email address or phone number turns a listing into someone you can actually contact.",
    owner: "you",
  },
  {
    key: "verify",
    title: "Verify the email",
    plain: "Brost Co checks the address really receives mail, so outreach does not bounce.",
    owner: "brost",
  },
  {
    key: "touch",
    title: "Make first contact",
    plain: "An email, call, or note on record starts the relationship and the paper trail.",
    owner: "you",
  },
  {
    key: "docs",
    title: "Collect their paperwork",
    plain: "A W-9 and current insurance certificates are required before they can be sent a bid package.",
    owner: "you",
  },
  {
    key: "work",
    title: "Send them work",
    plain: "Pair them to opportunities and collect their quotes; the history builds here.",
    owner: "brost",
  },
];

export function buildSubPlan(input: SubPlanInput): StepPlan {
  const c = input.compliance;

  const done: Record<string, boolean> = {
    add: true,
    reach: input.hasEmail || input.hasPhone,
    // Phone-only subs can still be worked; a missing email shouldn't hold the
    // whole plan hostage on a verification that can never happen.
    verify: input.emailVerified || (!input.hasEmail && input.hasPhone),
    touch: input.touches > 0,
    docs: c.clearedForAward,
    // A SAM-excluded company is never "done" being sent work, whatever its
    // history says; the exclusion blocker below must stay visible.
    work: (input.totalPairings > 0 || input.quoteCount > 0) && !input.samExcluded,
  };

  const blockers: Record<string, PlanBlocker[]> = {};

  if (!done.reach) {
    blockers.reach = [
      {
        what: "No email or phone is on file, so nobody can contact this company.",
        how: "Add an email or phone number in Company details below.",
        href: "#sub-contact",
      },
    ];
  }

  if (input.hasEmail && !input.emailVerified && input.contactStatus === "no_email_found") {
    blockers.verify = [
      {
        what: "Verification could not confirm this address receives mail.",
        how: "Double-check the address in Company details, or add a phone number instead.",
        href: "#sub-contact",
      },
    ];
  }

  if (!done.docs) {
    const items: PlanBlocker[] = [];
    for (const d of c.missing)
      items.push({
        what: `${DOC_LABEL[d]} is not on file.`,
        how: howToCollectMissing(d),
        href: "#compliance",
      });
    for (const d of c.expired)
      items.push({
        what: `${DOC_LABEL[d]} has expired.`,
        how: "Ask for a current certificate in the Compliance section.",
        href: "#compliance",
      });
    for (const d of c.awaitingVerification)
      items.push({
        what: `${DOC_LABEL[d]} was uploaded but nobody has checked it yet.`,
        how: "Open the Compliance section and verify the document.",
        href: "#compliance",
      });
    if (items.length > 0) blockers.docs = items;
  }

  if (input.samExcluded) {
    blockers.work = [
      {
        what: "This company is on the federal exclusion list (SAM), so it cannot be used on government work.",
        how: "Do not send them federal work. Keep the record for history, or remove them from your database.",
        href: "#sub-contact",
      },
    ];
  }

  const activeIdx = DEFS.findIndex((d) => !done[d.key]);

  const detailFor = (key: string): string | undefined => {
    switch (key) {
      case "reach": {
        const ch = [input.hasEmail ? "email" : null, input.hasPhone ? "phone" : null]
          .filter(Boolean)
          .join(" and ");
        return ch ? `Reachable by ${ch}` : undefined;
      }
      case "verify":
        if (input.emailVerified) return "Email verified";
        if (!input.hasEmail && input.hasPhone) return "Phone only, nothing to verify";
        return input.hasEmail ? "Not confirmed yet" : undefined;
      case "touch":
        return input.touches > 0
          ? `${input.touches} touch${input.touches === 1 ? "" : "es"} on record`
          : undefined;
      case "docs": {
        const open = c.missing.length + c.expired.length + c.awaitingVerification.length;
        if (c.clearedForAward) return "Cleared to be sent work";
        return open > 0 ? `${open} document${open === 1 ? "" : "s"} to resolve` : undefined;
      }
      case "work": {
        const parts = [
          input.openPairings > 0
            ? `${input.openPairings} open job${input.openPairings === 1 ? "" : "s"}`
            : null,
          input.quoteCount > 0
            ? `${input.quoteCount} quote${input.quoteCount === 1 ? "" : "s"}`
            : null,
        ].filter(Boolean);
        return parts.length ? parts.join(" · ") : undefined;
      }
      default:
        return undefined;
    }
  };

  const actionFor = (key: string): PlanStep["action"] => {
    switch (key) {
      case "reach":
        return { label: "Add contact info", href: "#sub-contact" };
      case "verify":
        return { label: "Open company details", href: "#sub-contact" };
      case "touch":
        return { label: "Log a note or email", href: "#notes" };
      case "docs":
        return { label: "Open compliance", href: "#compliance" };
      case "work":
        return { label: "See paired jobs", href: "#pairings" };
      default:
        return undefined;
    }
  };

  const steps: PlanStep[] = DEFS.map((def, i) => {
    let status: PlanStep["status"];
    if (done[def.key]) status = "done";
    else if (i === activeIdx) status = blockers[def.key]?.length ? "blocked" : "current";
    else status = blockers[def.key]?.length ? "blocked" : "upcoming";
    return {
      key: def.key,
      n: i + 1,
      title: def.title,
      plain: def.plain,
      status,
      owner: def.owner,
      detail: detailFor(def.key),
      action: status === "done" || status === "upcoming" ? undefined : actionFor(def.key),
      blockers: status === "done" ? undefined : blockers[def.key],
    };
  });

  return assemblePlan(steps, {
    allDoneHeadline: "All set: this sub is job-ready",
  });
}
