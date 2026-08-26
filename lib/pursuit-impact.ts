/**
 * What aborting this pursuit actually stops, and what it cannot undo.
 *
 * A confirmation dialog that only asks "are you sure?" is a speed bump. The
 * question an operator is really asking is "what happens if I do this", and
 * the two halves of the answer matter for different reasons:
 *
 *   what stops    so they know what they are giving up
 *   what stands   so they are not surprised later
 *
 * The second is the one products get wrong. Eleven quote requests already sent
 * cannot be recalled: those subcontractors are expecting an answer, and an
 * abort that implied otherwise would leave somebody believing the emails had
 * been pulled back. They have not been, and the summary says so in those
 * words.
 *
 * Everything here is counted from records rather than estimated. A number in
 * this list is a number an operator can go and look at.
 */
import { query, queryOne } from "./db";

export interface PursuitImpact {
  title: string | null;
  solicitationNumber: string | null;
  deadline: string | null;
  stage: string;
  /** Work that will stop the moment the abort commits. */
  stops: { label: string; count: number }[];
  /** Work already done that an abort cannot reverse. */
  stands: { label: string; count: number }[];
  /** Everything kept and readable afterwards. */
  retained: string[];
  /**
   * Typed confirmation target. The solicitation number when there is one,
   * because it is on the screen and is specific to this record; the title's
   * first words otherwise, because typing "ABORT" is muscle memory and proves
   * nothing about which opportunity is being looked at.
   */
  confirmPhrase: string;
}

export async function pursuitImpact(opportunityId: string): Promise<PursuitImpact | null> {
  const opp = await queryOne<{
    title: string | null;
    solicitation_number: string | null;
    deadline: string | null;
    stage: string;
  }>(
    `select title, solicitation_number, deadline::text as deadline, stage
       from opportunities where id = $1`,
    [opportunityId]
  );
  if (!opp) return null;

  const counts = await queryOne<{
    pending_calls: number;
    awaiting_reply: number;
    sent_messages: number;
    replies: number;
    quotes: number;
    documents: number;
  }>(
    `select
       (select count(*)::int from call_cards
         where opportunity_id = $1 and status = 'pending') as pending_calls,
       (select count(*)::int from opportunity_subs
         where opportunity_id = $1 and outreach_state = 'sent') as awaiting_reply,
       (select count(*)::int from communications
         where opportunity_id = $1 and direction = 'outbound') as sent_messages,
       (select count(*)::int from communications
         where opportunity_id = $1 and direction = 'inbound') as replies,
       (select count(*)::int from quotes where opportunity_id = $1) as quotes,
       (select count(*)::int from documents where opportunity_id = $1) as documents`,
    [opportunityId]
  ).catch(() => null);

  const n = {
    pending_calls: counts?.pending_calls ?? 0,
    awaiting_reply: counts?.awaiting_reply ?? 0,
    sent_messages: counts?.sent_messages ?? 0,
    replies: counts?.replies ?? 0,
    quotes: counts?.quotes ?? 0,
    documents: counts?.documents ?? 0,
  };

  /*
   * Only non-zero rows. "0 calls will stop" is noise that makes the two or
   * three lines that matter harder to find, and this list is read in the
   * moment somebody is deciding.
   */
  const stops = [
    { label: "queued call, which will close unanswered", count: n.pending_calls },
    { label: "follow-up still scheduled to send", count: n.awaiting_reply },
  ].filter((r) => r.count > 0);

  const stands = [
    {
      label: "message already sent, which cannot be recalled",
      count: n.sent_messages,
    },
    {
      label: "subcontractor still waiting on an answer from us",
      count: n.awaiting_reply,
    },
  ].filter((r) => r.count > 0);

  const retained = [
    `${n.replies} repl${n.replies === 1 ? "y" : "ies"} received`,
    `${n.quotes} quote${n.quotes === 1 ? "" : "s"}`,
    `${n.documents} document${n.documents === 1 ? "" : "s"}`,
    "every email, note and log line",
  ];

  const confirmPhrase =
    opp.solicitation_number?.trim() ||
    (opp.title ?? "").trim().split(/\s+/).slice(0, 3).join(" ") ||
    "ABORT";

  return {
    title: opp.title,
    solicitationNumber: opp.solicitation_number,
    deadline: opp.deadline,
    stage: opp.stage,
    stops,
    stands,
    retained,
    confirmPhrase,
  };
}
