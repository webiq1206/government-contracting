/**
 * An alert when work keeps arriving but nothing comes out the other end.
 *
 * The pipeline stall alert watches whether each job runs. In October 2026
 * every job ran, succeeded, and held what it was given for a person: 206
 * opportunities in a week, none sourced, no quote request for two months, and
 * no alert, because nothing had stopped. This watches the results instead,
 * and deliberately counts records parked for a person, since parking is how
 * that outage hid.
 *
 * Pure. The counts come from the continuation sweep.
 */

export const OUTCOME_STALL_CAUSE = "pursuit_outcome_stall";
/** Discovery working, no sourcing: judged over three days, so a quiet weekend is not an outage. */
export const SOURCING_OUTCOME_HOURS = 72;
/** Below this many new notices a quiet sourcing window is plausible, not a fault. */
export const MIN_DISCOVERED_FOR_ALERT = 10;
/** A verified email waits this long before an empty send log counts. */
export const EMAILABLE_WAIT_HOURS = 6;
/** No quote request at all in this window, while verified emails wait. */
export const RFQ_OUTCOME_HOURS = 24;

export interface OutcomeCounts {
  /** Notices that arrived in the sourcing window. */
  discovered: number;
  /** Opportunities that got their first subcontractor pairing in the window. */
  sourced: number;
  /** Open records held in scoring or analysis for a person. */
  parkedForPerson: number;
  /** Pairings with a verified email and no quote request, older than the wait. */
  emailableWaiting: number;
  /** Quote requests the mailbox accepted in the send window. */
  rfqSent: number;
  outboundPaused: boolean;
}

export function sourcingOutcomeStalled(c: OutcomeCounts): boolean {
  return c.discovered >= MIN_DISCOVERED_FOR_ALERT && c.sourced === 0;
}

export function sendingOutcomeStalled(c: OutcomeCounts): boolean {
  return !c.outboundPaused && c.emailableWaiting > 0 && c.rfqSent === 0;
}

export function outcomeStallEligible(c: OutcomeCounts): boolean {
  return sourcingOutcomeStalled(c) || sendingOutcomeStalled(c);
}

export function outcomeStallText(c: OutcomeCounts): string {
  const parts: string[] = [];
  if (sourcingOutcomeStalled(c)) {
    parts.push(
      `${c.discovered} new opportunities arrived in the last ${SOURCING_OUTCOME_HOURS / 24} days and none reached subcontractor sourcing.` +
        (c.parkedForPerson > 0
          ? ` ${c.parkedForPerson} open record(s) are held in scoring or analysis for a person; their latest Automation Log entry names the gate.`
          : " Check the Automation Log for scoring and the solicitation analyst.")
    );
  }
  if (sendingOutcomeStalled(c)) {
    parts.push(
      `${c.emailableWaiting} subcontractor(s) with a verified email have waited over ${EMAILABLE_WAIT_HOURS} hours, and no quote request was sent in the last ${RFQ_OUTCOME_HOURS} hours. Check the Automation Log for outreach: its latest entries name what is holding the send.`
    );
  }
  return parts.join(" ");
}
