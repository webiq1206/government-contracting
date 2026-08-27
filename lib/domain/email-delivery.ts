/**
 * What actually happened to an email after we handed it over.
 *
 * The platform could previously only say "we called the Gmail API and it did
 * not throw". That is not delivery, and treating it as delivery is how an
 * operator ends up waiting on a quote from an address that has been dead for
 * a year: the outreach looked sent, the follow-up looked sent, and nothing
 * anywhere said the mail had been rejected on arrival.
 *
 * The states below are deliberately arranged around one rule: NEVER claim a
 * message reached somebody without evidence. A successful send is `sent` and
 * stays `sent`. Only a signal that could not exist unless a human received it
 * (an open, a click, a reply) promotes a message to `delivered`, and only a
 * bounce demotes it. Everything else stays honestly unknown.
 */

export type DeliveryState =
  /** Handed to the provider without error. NOT proof anyone received it. */
  | "sent"
  /** Positive evidence it arrived: opened, clicked, or replied to. */
  | "delivered"
  /** Permanently refused (5.x.x). The address is bad; stop mailing it. */
  | "bounced"
  /** Temporarily refused (4.x.x): full mailbox, greylisting, throttling. */
  | "deferred"
  /** The send itself failed; nothing ever left the building. */
  | "failed";

/** A bounce notice parsed out of a delivery-status report. */
export interface BounceReport {
  /** The address that failed, from Final-Recipient / Original-Recipient. */
  recipient: string | null;
  /** RFC822 Message-ID of the message that bounced, when the DSN quotes it. */
  originalMessageId: string | null;
  /** The SMTP enhanced status code, e.g. "5.1.1". */
  status: string | null;
  /** Permanent (5.x.x) vs transient (4.x.x). */
  permanent: boolean;
  /** A short human-readable reason for the operator. */
  reason: string;
}

/**
 * Is this inbox message a delivery-status notification rather than a reply?
 *
 * Checked before reply handling, because a bounce that falls through to the
 * reply path is worse than useless: it gets matched to a subcontractor and
 * read as if the sub had written back, so a dead address can mark an outreach
 * "responsive" and quietly satisfy trade coverage nobody actually has.
 */
export function looksLikeBounce(input: {
  from?: string | null;
  subject?: string | null;
  contentType?: string | null;
  body?: string | null;
}): boolean {
  const from = (input.from ?? "").toLowerCase();
  const subject = (input.subject ?? "").toLowerCase();
  const ctype = (input.contentType ?? "").toLowerCase();
  const body = input.body ?? "";

  // The authoritative signal: RFC 3464 report type.
  if (/report-type\s*=\s*"?delivery-status"?/.test(ctype)) return true;
  /*
   * The standard automated senders. The `@` is deliberately not required:
   * plenty of systems send as a bare `MAILER-DAEMON` with no domain, and
   * requiring the sigil let those through as ordinary mail.
   */
  if (/mailer[-\s]?daemon|postmaster|^\s*<?bounce[s+-]/.test(from)) return true;
  // Security gateways reject on the recipient's behalf and sign the notice
  // themselves, so nothing above matches them.
  if (/mimecast|proofpoint|barracuda|messagelabs|quarantine@|spamfilter|antispam/.test(from)) {
    return true;
  }
  /*
   * Subject lines, kept deliberately wide.
   *
   * The cost of the two mistakes is not symmetric. A missed bounce is
   * recorded as a REPLY: it marks the outreach responsive, satisfies trade
   * coverage nobody has, and leaves the operator waiting for a quote that can
   * never arrive. A false positive is one message filed as a delivery report
   * instead of a reply, on a thread the operator can still read.
   *
   * The narrow list this replaces missed the ordinary cases. "Undelivered
   * Mail Returned to Sender" is Postfix's own wording and matched neither
   * `undeliverable` nor `returned mail`; "Message blocked" and "Delivery
   * Failure" matched nothing at all. Each alternative below is a real subject
   * line from a provider in use.
   */
  if (
    /delivery (status notification|failure|failed|incomplete|has failed)|undeliver(able|ed)|returned (mail|to sender)|mail delivery (failed|subsystem)|failure notice|message (?:was )?(?:blocked|rejected|not delivered)|could ?n'?o?t be delivered|unable to deliver|blocked by|quarantine|recipient (rejected|unknown|not found)|address (rejected|not found)/.test(
      subject
    )
  ) {
    return true;
  }
  // A body carrying DSN fields, even when headers were lost in relaying.
  if (/^\s*(Final-Recipient|Original-Recipient|Diagnostic-Code)\s*:/im.test(body)) return true;
  /*
   * Last resort, for gateway notices that carry no DSN part at all.
   *
   * This has to recognise a machine quoting SMTP without catching a person
   * quoting numbers, and the obvious version of it does not: "an SMTP-looking
   * number somewhere near a delivery-ish word" matched
   *
   *     "Our price is 550 per square, delivery in 3 weeks."
   *
   * which is a quote, from a real subcontractor, and discarding it as a
   * delivery report is the expensive direction of this decision. That
   * sentence was caught by running the history repair against real-shaped
   * data, not by reasoning about the regex.
   *
   * So the signal has to be SMTP's own grammar rather than its vocabulary.
   * A server rejection is a reply code followed by an enhanced status code
   * ("550 5.1.1 ..."), or an enhanced status code introduced by the phrasing
   * mail systems use when quoting one. Prose does not accidentally produce
   * either.
   */
  const smtpRejection = /(?:^|[\s>])[45]\d{2}[ -][45]\.\d{1,3}\.\d{1,3}\b/.test(body);
  const quotedByAMailSystem =
    /\b[45]\.\d{1,3}\.\d{1,3}\b/.test(body) &&
    /(smtp error|remote (?:server|host)|host .{0,40}said|server said|reporting-mta|delivery attempt|message could not be delivered|recipient(?:'s)? server)/i.test(
      body
    );
  return smtpRejection || quotedByAMailSystem;
}

/**
 * Pull the useful facts out of a delivery-status report.
 *
 * Tolerant by design: DSN formatting varies between providers and some of it
 * arrives wrapped or partially quoted, so every field is optional and a
 * missing one degrades the report rather than discarding it. A bounce we can
 * only half-read still tells the operator the address failed.
 */
export function parseBounce(body: string): BounceReport {
  const text = body ?? "";

  const recipient =
    matchFirst(text, /^\s*(?:Final|Original)-Recipient\s*:\s*(?:rfc822\s*;\s*)?(.+)$/im) ??
    matchFirst(text, /\b(?:to|for)\s+<([^>]+@[^>]+)>/i);

  const originalMessageId =
    matchFirst(text, /^\s*(?:Original-)?Message-ID\s*:\s*(<[^>]+>)/im) ??
    matchFirst(text, /(<[^<>\s@]+@[^<>\s]+>)/);

  // Enhanced status first (5.1.1); fall back to the bare SMTP reply (550).
  const status =
    matchFirst(text, /^\s*Status\s*:\s*([245]\.\d{1,3}\.\d{1,3})/im) ??
    matchFirst(text, /\b([245]\.\d{1,3}\.\d{1,3})\b/) ??
    matchFirst(text, /\b([45]\d{2})[ -]\d\.\d\.\d/);

  const diagnostic = matchFirst(text, /^\s*Diagnostic-Code\s*:\s*(?:smtp\s*;\s*)?(.+)$/im);
  const action = matchFirst(text, /^\s*Action\s*:\s*(\w+)/im);

  // 5.x.x is permanent, 4.x.x is transient. An explicit "Action: delayed"
  // means transient even when the code looks otherwise, and an unreadable
  // code is treated as TRANSIENT so a parsing miss never suppresses a real
  // address on our guess.
  const permanent =
    action?.toLowerCase() === "delayed"
      ? false
      : status
        ? status.startsWith("5")
        : /permanent(ly)? (failed|fail|error)|does not exist|no such (user|address)|user unknown|address not found|mailbox unavailable/i.test(
            text
          );

  const reason =
    clean(diagnostic) ||
    clean(matchFirst(text, /^\s*(?:550|551|552|553|554|450|451|452)[ -](.+)$/im)) ||
    (permanent ? "Address rejected the message permanently." : "Delivery was temporarily deferred.");

  return {
    recipient: recipient ? clean(recipient).replace(/^<|>$/g, "").toLowerCase() || null : null,
    originalMessageId: originalMessageId ? clean(originalMessageId) : null,
    status: status ?? null,
    permanent,
    reason: reason.slice(0, 300),
  };
}

/**
 * The state to display for one message, from the evidence on its row.
 *
 * Kept in one place so every surface tells the same story. In particular a
 * bounced message that was ALSO opened stays bounced: a bounce is a fact
 * about delivery, while an open can be a scanner or a proxy prefetch, and
 * between the two the failure is the one the operator must act on.
 */
export function deliveryStateFor(comm: {
  delivery_state?: string | null;
  replied_at?: string | Date | null;
  opened_at?: string | Date | null;
  clicked_at?: string | Date | null;
}): DeliveryState {
  const stored = comm.delivery_state;
  if (stored === "bounced" || stored === "failed" || stored === "deferred") {
    return stored;
  }
  if (comm.replied_at || comm.clicked_at || comm.opened_at) return "delivered";
  if (stored === "delivered") return "delivered";
  return "sent";
}

/** Plain-English label + whether it needs attention, for the UI. */
export function describeDeliveryState(state: DeliveryState): {
  label: string;
  detail: string;
  attention: boolean;
} {
  switch (state) {
    case "delivered":
      return {
        label: "Delivered",
        detail: "They opened, clicked or replied, so this reached them.",
        attention: false,
      };
    case "bounced":
      return {
        label: "Bounced",
        detail: "The address rejected this permanently. Find another contact.",
        attention: true,
      };
    case "deferred":
      return {
        label: "Delayed",
        detail: "Temporarily refused, e.g. a full mailbox. May still arrive.",
        attention: true,
      };
    case "failed":
      return {
        label: "Not sent",
        detail: "The send itself failed, so nothing left the building.",
        attention: true,
      };
    default:
      return {
        label: "Sent",
        detail: "Handed to the mail provider. Not confirmation it was received.",
        attention: false,
      };
  }
}

function matchFirst(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m?.[1] ? m[1].trim() : null;
}

function clean(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}


/**
 * What an SMTP status code actually means, and what to do about it.
 *
 * The raw diagnostic a remote mail server returns is written for a
 * postmaster: "550 5.1.1 The email account that you tried to reach does not
 * exist" and "550 5.7.1 Message rejected due to content" both read as
 * rejection to an estimator, and they need opposite responses. One means find
 * a different address; the other means the address is fine and the message
 * was the problem.
 *
 * Matched on the enhanced status code's subject and detail, so an unlisted
 * code still gets the right family rather than nothing.
 */
export interface DeliveryReading {
  /** One sentence, in the words somebody using this would use. */
  meaning: string;
  /** What to do next, when there is something. */
  fix: string | null;
  /** True when the address itself is the problem. */
  addressAtFault: boolean;
}

const CODE_READINGS: { prefix: string; reading: DeliveryReading }[] = [
  {
    prefix: "5.1.1",
    reading: {
      meaning: "There is no mailbox at that address.",
      fix: "Find a working address, or call them.",
      addressAtFault: true,
    },
  },
  {
    prefix: "5.1.2",
    reading: {
      meaning: "The domain in that address does not accept mail.",
      fix: "Check the spelling of the domain, or find another address.",
      addressAtFault: true,
    },
  },
  {
    prefix: "5.2.2",
    reading: {
      meaning: "Their mailbox is full.",
      // Not the address's fault, and suppressing it would lose a live firm.
      fix: "Try again in a few days, or call them.",
      addressAtFault: false,
    },
  },
  {
    prefix: "5.4",
    reading: {
      meaning: "Their mail server could not be reached.",
      fix: "Try again later. If it keeps happening, call them.",
      addressAtFault: false,
    },
  },
  {
    prefix: "5.7",
    reading: {
      meaning: "Their server accepted the address but refused the message.",
      /*
       * The distinction that matters most here. This is a deliverability
       * problem on our side, and treating it as a bad address sends somebody
       * hunting for a new contact who was reachable all along.
       */
      fix: "The address is fine. Something about the message or our sending domain was refused.",
      addressAtFault: false,
    },
  },
  {
    prefix: "4.2.2",
    reading: {
      meaning: "Their mailbox is full, and their server will keep trying.",
      fix: null,
      addressAtFault: false,
    },
  },
  {
    prefix: "4.",
    reading: {
      meaning: "A temporary problem. Their server will accept it later.",
      fix: null,
      addressAtFault: false,
    },
  },
  {
    prefix: "5.",
    reading: {
      meaning: "Their server refused the message and will not try again.",
      fix: "Read the technical detail, or call them.",
      addressAtFault: false,
    },
  },
];

export function readDeliveryCode(status: string | null | undefined): DeliveryReading | null {
  const code = (status ?? "").trim();
  if (!code) return null;
  // Longest prefix first, so 5.1.1 beats 5. and 4.2.2 beats 4.
  const found = [...CODE_READINGS]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((r) => code.startsWith(r.prefix));
  return found?.reading ?? null;
}

/**
 * The status code inside a stored delivery detail, when there is one.
 *
 * The column holds whatever the remote server said, so the code has to be
 * found rather than assumed.
 */
export function statusFromDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return matchFirst(detail, /\b([245]\.\d{1,3}\.\d{1,3})\b/) ?? null;
}
