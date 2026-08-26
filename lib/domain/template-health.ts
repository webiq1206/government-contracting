/**
 * Whether a template will reach an inbox, and what it has done when it has.
 *
 * The editor already refuses a template with an unknown variable, and previews
 * it against a real subcontractor. Both are about correctness. Neither says
 * anything about the thing that actually decides whether a subcontractor ever
 * reads it: a subject in block capitals with three exclamation marks lands in
 * a junk folder no matter how correct its variables are, and nothing on this
 * page mentioned it.
 *
 * Two rules govern everything here. Nothing is scored out of a hundred,
 * because a spam score is a number people optimise instead of a sentence they
 * act on; each finding says what is wrong and what to do. And no rate is ever
 * nought over nothing: a template nobody has sent has no open rate, which is a
 * different fact from an open rate of nought and reads very differently to
 * somebody deciding whether to rewrite it.
 */

export interface DeliverabilityFinding {
  severity: "warning" | "note";
  /** What is wrong, in one sentence. */
  message: string;
  /** What to do about it. */
  fix: string;
}

/**
 * Subject lines shorter than this get cut off less, but say too little; longer
 * than this is truncated in most mobile clients, which is where subcontractors
 * read their mail from a van.
 */
const SUBJECT_MIN = 20;
const SUBJECT_MAX = 60;

/** Below this the message reads as a blast rather than a request for a price. */
const BODY_MIN_WORDS = 40;
/** Above this nobody finishes it, and a quote request that is not read is not sent. */
const BODY_MAX_WORDS = 400;

/**
 * Phrases that mark a message as bulk marketing to a filter.
 *
 * Deliberately short and specific to this context. A long generic list would
 * flag ordinary construction words ("free" appears in "free issue material")
 * and train the operator to ignore the panel, which costs more than it saves.
 */
const BULK_PHRASES: { re: RegExp; what: string }[] = [
  { re: /\bact now\b/i, what: "act now" },
  { re: /\blimited time\b/i, what: "limited time" },
  { re: /\bno obligation\b/i, what: "no obligation" },
  { re: /\bthis is not spam\b/i, what: "this is not spam" },
  { re: /\bclick here\b/i, what: "click here" },
  { re: /\bdear (sir|madam|sir or madam)\b/i, what: "dear sir or madam" },
  { re: /\bunsubscribe\b/i, what: "unsubscribe" },
  { re: /\b(100%|guaranteed) (free|risk[- ]free)\b/i, what: "guaranteed free" },
  { re: /\bwinner\b/i, what: "winner" },
  { re: /\bcongratulations\b/i, what: "congratulations" },
];

function words(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/** Letters only, so "RFQ 4472" is not read as shouting. */
function shoutiness(s: string): number {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6) return 0;
  const caps = letters.replace(/[^A-Z]/g, "").length;
  return caps / letters.length;
}

/**
 * Everything that would make this template less likely to be read, or more
 * likely to be filtered, with the variable placeholders left in place: they
 * are what the operator is editing, and they expand to ordinary text.
 */
export function deliverabilityFindings(input: {
  subject?: string | null;
  body: string;
}): DeliverabilityFinding[] {
  const out: DeliverabilityFinding[] = [];
  const subject = (input.subject ?? "").trim();
  const body = input.body ?? "";
  // Placeholders stand in for real values, so they are measured as one short
  // word each rather than as their own literal length.
  const rendered = body.replace(/\{\{\s*\w+\s*\}\}/g, "value");
  const renderedSubject = subject.replace(/\{\{\s*\w+\s*\}\}/g, "value");

  if (subject) {
    if (renderedSubject.length > SUBJECT_MAX) {
      out.push({
        severity: "warning",
        message: `The subject runs to about ${renderedSubject.length} characters once the values are filled in, and most phone mail apps cut off around ${SUBJECT_MAX}.`,
        fix: "Put the trade and the town first, so the part that survives truncation is the part that makes somebody open it.",
      });
    } else if (renderedSubject.length < SUBJECT_MIN) {
      out.push({
        severity: "note",
        message: `The subject is about ${renderedSubject.length} characters, which is short enough to read as a mass mailing.`,
        fix: "Name the work and the place. A subcontractor scanning an inbox decides on the subject alone.",
      });
    }
    if (shoutiness(renderedSubject) > 0.6) {
      out.push({
        severity: "warning",
        message: "The subject is mostly capital letters, which filters treat as shouting.",
        fix: "Use sentence case. Capitals do not make it more urgent, they make it less likely to arrive.",
      });
    }
    const bangs = (subject.match(/[!?]/g) ?? []).length;
    if (bangs >= 2) {
      out.push({
        severity: "warning",
        message: `The subject has ${bangs} exclamation or question marks, which is a strong bulk-mail signal.`,
        fix: "One at most, and usually none. This is a request for a price, not an announcement.",
      });
    }
  }

  const w = words(rendered);
  if (w > 0 && w < BODY_MIN_WORDS) {
    out.push({
      severity: "note",
      message: `The body is about ${w} words, which is short enough that a filter has little to weigh and a reader has little to answer.`,
      fix: "Say what the work is, where, and by when you need the number. Under forty words rarely covers all three.",
    });
  }
  if (w > BODY_MAX_WORDS) {
    out.push({
      severity: "note",
      message: `The body is about ${w} words. Subcontractors read these on a phone between jobs.`,
      fix: "Move the detail into the attached scope and keep the email to the ask.",
    });
  }

  const shouty = shoutiness(rendered);
  if (shouty > 0.35 && w > 20) {
    out.push({
      severity: "warning",
      message: "Much of the body is in capital letters.",
      fix: "Reserve capitals for the odd acronym. Whole sentences in capitals score badly and read worse.",
    });
  }

  const hits = BULK_PHRASES.filter((p) => p.re.test(rendered) || p.re.test(renderedSubject));
  if (hits.length > 0) {
    out.push({
      severity: "warning",
      message: `Contains bulk-mail wording: ${hits.map((h) => `"${h.what}"`).join(", ")}.`,
      fix: "Write it the way you would say it on the phone. These phrases belong to marketing mail and are scored as such.",
    });
  }

  const links = (rendered.match(/https?:\/\//g) ?? []).length;
  if (links >= 4) {
    out.push({
      severity: "warning",
      message: `There are ${links} links in the body. A high link count in a first contact is a common filter trigger.`,
      fix: "Attach the documents, or send one link to everything rather than one per file.",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// What the template has done
// ---------------------------------------------------------------------------

export interface TemplateCounts {
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  bounced: number;
  /** The most recent send, so a figure can say how current it is. */
  lastSentAt: string | null;
}

export interface TemplateMetrics extends TemplateCounts {
  /** Null when nothing was sent. Never nought over nothing. */
  openRate: number | null;
  replyRate: number | null;
  bounceRate: number | null;
  /** True when there is too little history for the rates to mean much. */
  thin: boolean;
}

/** Below this a rate is arithmetic rather than evidence. */
export const MIN_SENDS_FOR_RATE = 10;

function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function templateMetrics(c: TemplateCounts): TemplateMetrics {
  return {
    ...c,
    // Opens are measured against what was actually delivered: counting a
    // bounced message as an unopened one blames the wording for an address.
    openRate: rate(c.opened, c.delivered),
    replyRate: rate(c.replied, c.sent),
    bounceRate: rate(c.bounced, c.sent),
    thin: c.sent > 0 && c.sent < MIN_SENDS_FOR_RATE,
  };
}

/** A rate, or the reason there is not one. Never a zero standing in for silence. */
export function formatMetric(r: number | null, sent: number): string {
  if (r == null) return sent === 0 ? "Never sent" : "Not measurable";
  return `${r}%`;
}

/**
 * The open rate specifically, which needs a fourth reading the others do not.
 *
 * A reply rate of nought is a measurement: replies arrive through the inbox
 * poll, so nought replies means nought people wrote back, and that is exactly
 * the fact somebody rewriting a template wants. Opens are different. They are
 * counted by an image, and an account whose tracking never fires, whose
 * recipients all block images, or that is sending plain text produces the same
 * nought as an account nobody opens. Printing `0%` there invites somebody to
 * rewrite wording that may be working fine, so a zero says it was recorded as
 * nothing rather than measured as nought.
 */
export function openRateLabel(m: TemplateMetrics): string {
  if (m.sent === 0) return "Never sent";
  if (m.delivered === 0) return "Not measurable";
  if (m.opened === 0) return "None recorded";
  return `${m.openRate}%`;
}

/**
 * The sentence under the open rate.
 *
 * Open tracking is a pixel, and a great many mail clients now fetch images
 * before a person sees the message or block them entirely. Presenting the
 * number without that is presenting a guess as a measurement.
 */
export const OPEN_RATE_CAVEAT =
  "Opens are counted by an image the mail client loads, which some clients fetch automatically and others block, so treat this as a floor with noise rather than a count of people who read it. None recorded can equally mean the tracking image is not being loaded at all.";

export function metricsSummary(m: TemplateMetrics): string {
  if (m.sent === 0) {
    return "Never sent, so there is nothing to judge it by yet.";
  }
  if (m.thin) {
    return `Sent ${m.sent} time${m.sent === 1 ? "" : "s"}. Too few to draw a rate from, so the percentages below are arithmetic rather than evidence.`;
  }
  const reply = m.replyRate == null ? "no reply rate" : `${m.replyRate}% replied`;
  const bounce =
    m.bounceRate == null
      ? ""
      : m.bounceRate > 0
        ? `, ${m.bounceRate}% bounced`
        : ", nothing bounced";
  return `Sent ${m.sent} times: ${reply}${bounce}.`;
}
