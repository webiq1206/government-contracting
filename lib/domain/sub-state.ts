/**
 * One answer to "where does this firm stand right now".
 *
 * The record header carried five separate signals: preferred, blocked,
 * contactability, licence, and whichever compliance documents had lapsed. All
 * five are true and none of them is the question an operator has when they
 * open the page, which is whether to put this firm on the bid in front of
 * them. Five badges is five things to weigh, and the weighing is the same
 * every time, so the platform should do it.
 *
 * The order below is the order the answers actually rank. A blocked firm is
 * blocked whatever their paperwork says; a firm with no working phone or email
 * cannot be sent anything however good their documents are; and preferred is
 * only worth saying about a firm that is otherwise ready.
 *
 * Two separate permissions, not one. Reaching a firm and awarding one are
 * different acts with different gates, and collapsing them into a single
 * "sendable" flag would have this header contradict the compliance panel,
 * which correctly refuses an award without current coverage.
 *
 * Pure.
 */

export const SUB_STATES = [
  "do_not_use",
  "put_aside",
  "bad_contact",
  "missing_documents",
  "preferred",
  "ready",
] as const;

export type SubState = (typeof SUB_STATES)[number];

export const SUB_STATE_LABEL: Record<SubState, string> = {
  do_not_use: "Do not use",
  put_aside: "Put aside",
  bad_contact: "Bad contact information",
  missing_documents: "Missing documents",
  preferred: "Preferred",
  ready: "Ready",
};

export interface SubStateFacts {
  /**
   * On the federal excluded parties list. Ranked above a local block because
   * the two have different fixes: this one is not the organization's to lift.
   */
  samExcluded?: boolean;
  blacklisted: boolean;
  blacklistReason?: string | null;
  archivedAt?: string | Date | null;
  archivedReason?: string | null;
  mergedInto?: string | null;
  email?: string | null;
  emailVerified?: boolean | null;
  phone?: string | null;
  /**
   * Compliance documents that have lapsed or were never supplied, already in
   * the words a person would use. Labels rather than column values, because
   * this string goes straight in front of somebody.
   */
  missingDocuments: string[];
  /** True when this firm has earned the preferred mark. */
  preferred: boolean;
}

export interface SubStateVerdict {
  state: SubState;
  label: string;
  /** Why, in a sentence, always. Never a bare badge. */
  detail: string;
  /** What to do about it, when there is something. */
  fix: string | null;
  /** Whether anybody can reach this firm to ask for a price. */
  canContact: boolean;
  /** Whether this firm can be sent a bid package or given an award. */
  canAward: boolean;
}

export function subState(f: SubStateFacts): SubStateVerdict {
  if (f.samExcluded) {
    return {
      state: "do_not_use",
      label: "Federally excluded",
      detail: "They are on the federal excluded parties list and cannot be used on this work.",
      /*
       * No fix offered, because there is not one here. The exclusion is the
       * government's record, not this roster's, and an operator who thinks it
       * is wrong has to take that up with SAM.
       */
      fix: null,
      canContact: false,
      canAward: false,
    };
  }

  if (f.blacklisted) {
    const reason = f.blacklistReason?.trim();
    return {
      state: "do_not_use",
      label: SUB_STATE_LABEL.do_not_use,
      detail: reason
        ? `Somebody blocked this firm: ${reason}`
        : "Somebody blocked this firm. No reason was recorded.",
      /*
       * Naming the missing reason rather than hiding it. A block with nothing
       * behind it is one nobody can lift with any confidence, and saying so is
       * how it gets fixed.
       */
      fix: reason ? null : "Add the reason, so somebody can judge it later.",
      canContact: false,
      canAward: false,
    };
  }

  if (f.mergedInto) {
    return {
      state: "put_aside",
      label: "Folded into another record",
      detail: "This is a pointer. Everything that was on it lives on the surviving record.",
      fix: "Open the surviving record, or undo the merge from there.",
      canContact: false,
      canAward: false,
    };
  }

  if (f.archivedAt) {
    const reason = f.archivedReason?.trim();
    return {
      state: "put_aside",
      label: SUB_STATE_LABEL.put_aside,
      detail: reason ? `Off the roster: ${reason}` : "Off the roster.",
      // Deliberately not the same as blocked, and the wording says so.
      fix: "Bring them back onto the roster if they should be in play again.",
      canContact: false,
      canAward: false,
    };
  }

  const emailOnFile = Boolean((f.email ?? "").trim());
  const usableEmail = emailOnFile && Boolean(f.emailVerified);
  const usablePhone = Boolean((f.phone ?? "").trim());
  if (!usableEmail && !usablePhone) {
    return {
      state: "bad_contact",
      label: SUB_STATE_LABEL.bad_contact,
      detail: emailOnFile
        ? "The address on file has not passed verification and there is no phone number."
        : "No usable email and no phone number.",
      fix: "Find a working address or number before anybody tries to reach them.",
      canContact: false,
      // Not an award gate of its own, but nothing gets that far unreached.
      canAward: false,
    };
  }

  if (f.missingDocuments.length > 0) {
    const n = f.missingDocuments.length;
    return {
      state: "missing_documents",
      label: SUB_STATE_LABEL.missing_documents,
      detail: `${n} ${n === 1 ? "document is" : "documents are"} missing or lapsed: ${f.missingDocuments.join(", ")}.`,
      fix: "Chase the paperwork before award. It does not stop you asking for a price.",
      /*
       * Reachable. Paperwork blocks an award, not a conversation, and treating
       * a missing certificate as a reason not to ask for a price is how a bid
       * ends up with one quote.
       */
      canContact: true,
      canAward: false,
    };
  }

  if (f.preferred) {
    return {
      state: "preferred",
      label: SUB_STATE_LABEL.preferred,
      detail: "Reachable, paperwork in order, and a record good enough to go to first.",
      fix: null,
      canContact: true,
      canAward: true,
    };
  }

  return {
    state: "ready",
    label: SUB_STATE_LABEL.ready,
    detail: "Reachable and nothing outstanding on their paperwork.",
    fix: null,
    canContact: true,
    canAward: true,
  };
}

/** The badge tone for each state, so every screen colours them the same. */
export const SUB_STATE_TONE: Record<SubState, string> = {
  do_not_use: "bg-risk/15 text-risk",
  put_aside: "bg-surface-raised text-slate-600",
  bad_contact: "bg-risk/10 text-risk",
  missing_documents: "bg-review/15 text-review",
  preferred: "bg-gold/20 text-gold-text",
  ready: "bg-pursue-soft text-pursue-strong",
};
