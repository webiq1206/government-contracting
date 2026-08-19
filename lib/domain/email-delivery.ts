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
  // The standard automated senders.
  if (/mailer-daemon@|postmaster@/.test(from)) return true;
  // Subject lines the big providers use.
  if (
    /delivery status notification|undeliverable|delivery has failed|returned mail|mail delivery (failed|subsystem)|failure notice/.test(
      subject
    )
  ) {
    return true;
  }
  // A body carrying DSN fields, even when headers were lost in relaying.
  return /^\s*(Final-Recipient|Original-Recipient|Diagnostic-Code)\s*:/im.test(body);
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
