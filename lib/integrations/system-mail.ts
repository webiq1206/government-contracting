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

export interface SystemMailResult {
  disabled?: boolean;
  error?: string;
  messageId?: string;
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

export const systemMail = {
  /**
   * True when platform mail can actually be delivered. Callers check this
   * before composing an expensive digest.
   */
  async enabled(): Promise<boolean> {
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
    return gmail.canAuthenticate(LEGACY_ORG_ID).catch(() => false);
  },

  async send(params: {
    to: string | string[];
    subject: string;
    text: string;
    html?: string;
  }): Promise<SystemMailResult> {
    const to = Array.isArray(params.to) ? params.to.join(", ") : params.to;
    if (!to.trim()) return { disabled: true, error: "No recipient." };

    const res = await gmail.send({
      to,
      subject: params.subject,
      html: params.html ?? asHtml(params.text),
      text: params.text,
      // The platform's own inbox, explicitly. Falling back to ambient tenant
      // context here would send a password reset from a customer's mailbox.
      orgId: LEGACY_ORG_ID,
      ...(config.systemMail.from ? { from: config.systemMail.from } : {}),
    });

    if (res.disabled) {
      // Surface the transport's own reason when it gave one. "Not connected"
      // is the usual cause but not the only one, and reporting it for every
      // refusal sends whoever is debugging to reconnect an inbox that was
      // never the problem.
      return { disabled: true, error: res.error ?? "Platform inbox is not connected." };
    }
    return { error: res.error, messageId: res.messageId };
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
