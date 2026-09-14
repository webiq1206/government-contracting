/**
 * Channel messages to Slack and Teams. Both are plain POSTs to a URL the
 * provider gave us (Slack, during OAuth) or the person pasted (Teams). The
 * URL is treated as an outside address and goes through the same guard as
 * every other fetch of a URL we did not write ourselves.
 */
import { guardedFetch, GuardedFetchError } from "./guarded-fetch";
import { readTokens, type ServiceRow } from "../connected-services";

export function webhookUrlOf(row: ServiceRow): string | null {
  return readTokens(row).webhook_url ?? null;
}

/** A URL that looks like a Slack or Teams webhook and not something else. */
export function acceptableWebhookUrl(provider: "slack" | "teams", url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (provider === "slack") return u.hostname === "hooks.slack.com";
    // Teams workflow links live on Power Automate / Logic Apps hosts.
    return /(\.logic\.azure\.com|\.powerautomate\.com|\.flow\.microsoft\.com|\.webhook\.office\.com|\.azure-api\.net)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export async function postChannelMessage(row: ServiceRow, text: string): Promise<void> {
  const url = webhookUrlOf(row);
  if (!url) throw new Error("No channel address is stored for this connection; reconnect it.");
  const body =
    row.provider === "teams"
      ? JSON.stringify({
          type: "message",
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: {
                type: "AdaptiveCard",
                version: "1.4",
                body: [{ type: "TextBlock", text, wrap: true }],
              },
            },
          ],
        })
      : JSON.stringify({ text });
  try {
    await guardedFetch(url, {
      maxBytes: 64 * 1024,
      timeoutMs: 15_000,
      maxRedirects: 0,
      headers: { "content-type": "application/json" },
      method: "POST",
      body,
    });
  } catch (err) {
    if (err instanceof GuardedFetchError && (err.status === 404 || err.status === 410 || err.status === 403)) {
      throw new Error(`The channel address no longer works (HTTP ${err.status}). Reconnect the channel.`);
    }
    throw err;
  }
}
