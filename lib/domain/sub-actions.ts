/**
 * What an operator can do to one subcontractor on one bid, and when.
 *
 * The panel listed status and offered one control: stop outreach. Everything
 * else an operator actually does with a subcontractor at this point -- send
 * the email again because it bounced, phone them because they never replied,
 * fix the address somebody mistyped, swap them for a firm that answers, decide
 * which of three quoting firms is the one being priced -- had to be done from
 * the subcontractor's own record, one at a time, with no way back to the bid
 * they were being done for.
 *
 * Pure. Every function here answers "is this offer honest right now" without
 * touching a database, so the answer is the same in a test, on the server and
 * in the browser.
 */

export const SUB_ACTIONS = [
  "resend",
  "call",
  "correct_contact",
  "replace",
  "source_more",
  "mark_primary",
  "mark_backup",
  "enter_quote",
  "view_packet",
  "view_thread",
] as const;

export type SubAction = (typeof SUB_ACTIONS)[number];

export const SUB_ACTION_LABEL: Record<SubAction, string> = {
  resend: "Send again",
  call: "Queue a call",
  correct_contact: "Fix contact",
  replace: "Take off the bid",
  source_more: "Find more firms",
  mark_primary: "Make primary",
  mark_backup: "Make backup",
  enter_quote: "Enter quote",
  view_packet: "See what they got",
  view_thread: "See the thread",
};

/** The pairing facts an offer depends on. Nothing else is read. */
export interface PairingFacts {
  outreachState: string | null;
  role: "primary" | "backup" | null;
  removed: boolean;
  /** Whether outreach can actually send: an address, and it passed the check. */
  hasEmail: boolean;
  /** Whether there is an address at all, verified or not. */
  emailOnFile: boolean;
  hasPhone: boolean;
  /** Whether anything was ever sent, so "See what they got" is not a lie. */
  emailsSent: number;
  hasQuote: boolean;
  /**
   * The inbox thread to open, keyed the way the Communications page groups by.
   * Null when nothing has been exchanged, which is why `hasThread` exists
   * separately: a key with no messages behind it is a link to an empty pane.
   */
  threadKey: string | null;
  hasThread: boolean;
  /** Calling is an account-level setting, and it can be off. */
  callsEnabled: boolean;
}

export interface ActionOffer {
  action: SubAction;
  label: string;
  /** Null when the action is available. Otherwise why it is not. */
  unavailable: string | null;
}

/**
 * Why an action is off, in words that say what to do instead.
 *
 * A greyed control with no explanation is the thing an operator files a
 * support ticket about, and the answer is almost always something they could
 * have fixed in ten seconds if the screen had said it.
 */
function reasonFor(a: SubAction, f: PairingFacts): string | null {
  if (f.removed && a !== "view_thread" && a !== "view_packet" && a !== "source_more") {
    return "This firm is off the bid. Their history stays here.";
  }
  switch (a) {
    case "resend":
      if (f.hasEmail) return null;
      /*
       * Three different problems, three different next steps. Collapsing them
       * into "no usable email" sends an operator to fix an address that is
       * already correct and merely waiting on a check.
       */
      if (f.emailOnFile) {
        return "The address on file has not passed verification, so outreach will not send to it.";
      }
      return f.hasPhone
        ? "No email for this firm. Call them, or add an address."
        : "No email and no phone. Fix the contact details first.";
    case "call":
      if (!f.callsEnabled) return "Calling is turned off for this account.";
      if (!f.hasPhone) return "No phone number on this firm.";
      return null;
    case "mark_primary":
      if (f.role === "primary") return "Already the primary for this trade.";
      return null;
    case "mark_backup":
      if (f.role === "backup") return "Already a backup for this trade.";
      return null;
    case "enter_quote":
      // Available whether or not one exists: a quote that came in wrong has to
      // be correctable, and refusing the second entry is how a typo becomes
      // the number on a federal bid.
      return null;
    case "view_packet":
      if (f.emailsSent === 0) return "Nothing has been sent to this firm yet.";
      return null;
    case "view_thread":
      if (!f.hasThread) return "No messages with this firm yet.";
      return null;
    case "replace":
    case "correct_contact":
    case "source_more":
      return null;
  }
}

/** Every action, in a fixed order, each saying whether it is available. */
export function offersFor(f: PairingFacts): ActionOffer[] {
  return SUB_ACTIONS.map((action) => ({
    action,
    label: SUB_ACTION_LABEL[action],
    unavailable: reasonFor(action, f),
  }));
}

export function isSubAction(v: string): v is SubAction {
  return (SUB_ACTIONS as readonly string[]).includes(v);
}

/**
 * The role a pairing should end up in, given what was asked and what it is.
 *
 * Asking for the role a pairing already has clears it rather than repeating
 * it. A control that does nothing when pressed twice is one an operator
 * presses twice, and unranking is a real thing to want: three firms quoted and
 * none of them is the one yet.
 */
export function nextRole(
  current: "primary" | "backup" | null,
  asked: "primary" | "backup"
): "primary" | "backup" | null {
  return current === asked ? null : asked;
}

/**
 * How to describe a pairing's role where there is room for two words.
 *
 * Null is "Not ranked", never blank and never "Backup". A trade where nobody
 * has been picked reads identically to one where somebody has, if the absence
 * renders as nothing at all.
 */
export function roleLabel(role: "primary" | "backup" | null): string {
  if (role === "primary") return "Primary";
  if (role === "backup") return "Backup";
  return "Not ranked";
}
