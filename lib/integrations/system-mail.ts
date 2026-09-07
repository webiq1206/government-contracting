/**
 * Platform system email: password resets, digests, operator alerts.
 *
 * Distinct from outreach. Outreach goes out through the TENANT's connected
 * inbox so subcontractors hear from the company they are bidding with; system
 * mail goes out through the PLATFORM's own connected inbox, because it is from
 * us and because the recipient may not belong to a tenant with a connection
 * yet (a password reset is the obvious case).
 *
 * Never throws. A failed digest must not take down the agent that produced it.
 */
import { gmail } from "./gmail";
import { config } from "../config";
import { LEGACY_ORG_ID } from "../tenant-context";
import { resolveOutreachSender } from "../domain/sender-identity";

export interface SystemMailResult {
  disabled?: boolean;
  error?: string;
  /** Gmail's API id, useful only for later Gmail API calls. */
  messageId?: string;
  /** Internet Message-ID used by delivery status notifications and threading. */
  rfc822MessageId?: string;
}

/** Minimal HTML wrapper so plain-text system mail is still readable. */
function asHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5">${escaped.replace(
    /\n/g,
    "<br />"
  )}</div>`;
}

/**
 * The From header for platform mail.
 *
 * Same address subcontractors see on outreach, because it is the same
 * company: a password reset arriving from a different address than every
 * other email we send reads as a phishing attempt, and looks like one to a
 * spam filter too.
 *
 * SYSTEM_MAIL_FROM still wins where it is set, so an operator can split the
 * two deliberately. Otherwise the chosen sending address for the platform's
 * own inbox is required. Omitting it would let Gmail silently substitute the
 * authorized account, which may be a different identity from the one users
 * trust and from the mailbox where the platform expects replies.
 */
type SystemMailFromResult =
  | { ok: true; from: string }
  | { ok: false; unavailable: boolean; error: string };

async function systemMailFrom(): Promise<SystemMailFromResult> {
  if (config.systemMail.from) return { ok: true, from: config.systemMail.from };

  let sender: Awaited<ReturnType<typeof resolveOutreachSender>>;
  try {
    sender = await resolveOutreachSender(LEGACY_ORG_ID);
  } catch {
    return {
      ok: false,
      unavailable: true,
      error:
        "The platform sender identity could not be checked because its settings could not be read. No email was sent. Check the platform Gmail connection and retry.",
    };
  }
  if (sender.unknown) {
    return {
      ok: false,
      unavailable: true,
      error:
        "The platform sender identity could not be checked because its settings could not be read. No email was sent. Check the platform Gmail connection and retry.",
    };
  }
  if (!sender.connected || !sender.from) {
    return {
      ok: false,
      unavailable: false,
      error:
        "No verified platform sender identity is available. No email was sent. Reconnect the platform Gmail inbox or configure SYSTEM_MAIL_FROM, then retry.",
    };
  }
  return { ok: true, from: sender.from };
}

export const systemMail = {
  /**
   * True when platform mail can actually be delivered now. Callers check this
   * before composing an expensive digest.
   *
   * A saved refresh token is only configuration, not readiness. Google can
   * revoke that token without removing our database row, so isConnected()
   * alone made every notification screen and scheduled sender report green
   * while every real send was guaranteed to fail.
   */
  async enabled(): Promise<boolean> {
    return this.deliverable();
  },

  /** Whether an inbox credential is stored, without claiming it still works. */
  async configured(): Promise<boolean> {
    return gmail.isConnected(LEGACY_ORG_ID);
  },

  /**
   * Whether mail can actually go out right now, as opposed to whether an inbox
   * is on file.
   *
   * `enabled()` only says a client can be built; a refresh token that Google
   * has revoked passes it and then fails on every send. The difference matters
   * wherever the answer is shown to someone: telling a locked-out user a reset
   * link is on its way, when the inbox that would send it is dead, leaves them
   * waiting on nothing.
   *
   * It asks Google whether our own grant still works, and reads nothing that a
   * request can move: not the stored status a failed send writes, not any
   * per-recipient outcome. Both of those are only observable for an address
   * that has an account, so deriving a public answer from them would let
   * someone learn which addresses those are. This answer is a fact about us,
   * identical for every address and every instance.
   */
  async deliverable(): Promise<boolean> {
    // Database and tenant-resolution failures propagate. Callers with a UI
    // can then label readiness unknown; background jobs fail visibly instead
    // of recording a clean "mail disabled" skip for an unreadable setting.
    // Google rejecting the actual grant remains a definite false from Gmail.
    if (!(await gmail.canAuthenticate(LEGACY_ORG_ID))) return false;
    const sender = await systemMailFrom();
    if (!sender.ok && sender.unavailable) throw new Error(sender.error);
    return sender.ok;
  },

  async send(params: {
    to: string | string[];
    subject: string;
    text: string;
    html?: string;
  }): Promise<SystemMailResult> {
    const to = Array.isArray(params.to) ? params.to.join(", ") : params.to;
    if (!to.trim()) return { disabled: true, error: "No recipient." };

    const from = await systemMailFrom();
    if (!from.ok) return { disabled: true, error: from.error };
    let res: Awaited<ReturnType<typeof gmail.send>>;
    try {
      res = await gmail.send({
        to,
        subject: params.subject,
        html: params.html ?? asHtml(params.text),
        text: params.text,
        // The platform's own inbox, explicitly. Falling back to ambient tenant
        // context here would send a password reset from a customer's mailbox.
        orgId: LEGACY_ORG_ID,
        from: from.from,
      });
    } catch (err) {
      console.error("[system-mail] Gmail send did not return a result:", err);
      return {
        error:
          "The platform mail connection could not be checked, so no delivery was confirmed. Check the platform Gmail connection and Sent folder before retrying.",
      };
    }

    if (res.disabled) {
      // Surface the transport's own reason when it gave one. "Not connected"
      // is the usual cause but not the only one, and reporting it for every
      // refusal sends whoever is debugging to reconnect an inbox that was
      // never the problem.
      return { disabled: true, error: res.error ?? "Platform inbox is not connected." };
    }
    return {
      error: res.error,
      messageId: res.messageId,
      rfc822MessageId: res.rfc822MessageId,
    };
  },

  /** Digest helper: subject plus prebuilt HTML, with a plain-text fallback. */
  async sendDigest(params: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
  }): Promise<SystemMailResult> {
    return this.send({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text ?? params.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    });
  },
};
