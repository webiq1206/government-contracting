/**
 * Gmail client, all outreach sends from the real Gmail account, with reply
 * detection and open/click tracking (tracking pixel + wrapped links). OAuth 2.0
 * refresh-token flow. Tokens live in integration_tokens (or GMAIL_REFRESH_TOKEN
 * env for a headless setup). Degrades gracefully when not configured.
 */
import { google } from "googleapis";
import { config } from "../config";
import { queryOne, query } from "../db";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
];

function oauthClient() {
  return new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri
  );
}

/**
 * Consent URL for the operator to authorize Gmail (offline access for refresh
 * token). Accepts an opaque `state` so the callback can verify this browser
 * initiated the flow (CSRF protection, a logged-in operator who followed an
 * attacker-crafted callback URL would otherwise connect the attacker's Gmail).
 */
export function getAuthUrl(state?: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });
}

/** Exchange an OAuth code for tokens and persist the refresh token. */
export async function exchangeCode(code: string): Promise<{ email?: string }> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  await query(
    `insert into integration_tokens (provider, data, updated_at)
     values ('gmail', $1, now())
     on conflict (provider) do update set data = excluded.data, updated_at = now()`,
    [JSON.stringify(tokens)]
  );
  // Discover the authorized email address.
  client.setCredentials(tokens);
  try {
    const gmail = google.gmail({ version: "v1", auth: client });
    const prof = await gmail.users.getProfile({ userId: "me" });
    return { email: prof.data.emailAddress ?? undefined };
  } catch {
    return {};
  }
}

async function getRefreshToken(): Promise<string | null> {
  const row = await queryOne<{ data: { refresh_token?: string } }>(
    `select data from integration_tokens where provider = 'gmail'`
  ).catch(() => null);
  return row?.data?.refresh_token ?? config.gmail.refreshToken ?? null;
}

/** Authorized Gmail client, or null if not connected. */
async function gmailClient() {
  if (!config.gmail.configured) return null;
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: refresh });
  return google.gmail({ version: "v1", auth: client });
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Our tracking id; used to inject the open pixel + wrap links. */
  trackingId?: string;
  /**
   * Explicit From address (display name + bare address, e.g.
   * "BROSTCO <info@brostco.com>"). Overrides the ambient GMAIL_SENDER env
   * var. Use this when the outreach transport needs a canonical sender
   * regardless of which Gmail account is authenticated.
   */
  from?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; mime?: string }[];
}

/** Build a raw RFC 2822 message (base64url) with tracking baked in. */
function buildRaw(params: SendEmailParams, from: string): string {
  let html = params.html;
  if (params.trackingId) {
    const base = config.appUrl.replace(/\/$/, "");
    const pixel = `<img src="${base}/api/track/open/${params.trackingId}" width="1" height="1" style="display:none" alt="" />`;
    // Wrap http(s) links through the click tracker.
    html = html.replace(
      /href="(https?:\/\/[^"]+)"/g,
      (_m, url) =>
        `href="${base}/api/track/click/${params.trackingId}?u=${encodeURIComponent(url)}"`
    );
    html = html.includes("</body>")
      ? html.replace("</body>", `${pixel}</body>`)
      : html + pixel;
  }
  const boundary = "brostco_" + Math.random().toString(36).slice(2);
  const altParts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    params.text ?? stripHtml(params.html),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    "",
    `--${boundary}--`,
  ];

  const attachments = params.attachments ?? [];
  let headers: string[];
  let body: string[];
  if (attachments.length === 0) {
    headers = [
      `From: ${from}`,
      `To: ${params.to}`,
      params.replyTo ? `Reply-To: ${params.replyTo}` : "",
      `Subject: ${params.subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].filter(Boolean);
    body = altParts;
  } else {
    // multipart/mixed wrapping the alternative part + one part per attachment.
    const mixed = "brostco_mx_" + Math.random().toString(36).slice(2);
    headers = [
      `From: ${from}`,
      `To: ${params.to}`,
      params.replyTo ? `Reply-To: ${params.replyTo}` : "",
      `Subject: ${params.subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
    ].filter(Boolean);
    body = [
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      ...altParts,
      "",
    ];
    for (const a of attachments) {
      const safeName = a.filename.replace(/["\r\n]/g, "");
      body.push(
        `--${mixed}`,
        `Content-Type: ${a.mime ?? "application/octet-stream"}; name="${safeName}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${safeName}"`,
        "",
        // 76-char lines per RFC 2045.
        a.content.toString("base64").replace(/(.{76})/g, "$1\r\n"),
        ""
      );
    }
    body.push(`--${mixed}--`);
  }
  const message = headers.join("\r\n") + "\r\n\r\n" + body.join("\r\n");
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
};

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Walk a message payload for the best text body (text/plain, else stripped text/html). */
export function extractBodyText(payload: GmailPart | null | undefined): string {
  if (!payload) return "";
  const stack: GmailPart[] = [payload];
  let htmlFallback = "";
  while (stack.length) {
    const p = stack.shift()!;
    if (p.mimeType === "text/plain" && p.body?.data) return decodeB64Url(p.body.data).trim();
    if (p.mimeType === "text/html" && p.body?.data && !htmlFallback) {
      htmlFallback = stripHtml(decodeB64Url(p.body.data));
    }
    if (p.parts) stack.push(...p.parts);
  }
  if (htmlFallback) return htmlFallback;
  // Single-part message with data on the root payload.
  if (payload.body?.data) {
    const text = decodeB64Url(payload.body.data);
    return payload.mimeType === "text/html" ? stripHtml(text) : text.trim();
  }
  return "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const gmail = {
  configured: () => config.gmail.configured,

  async isConnected(): Promise<boolean> {
    return (await gmailClient()) != null;
  },

  async send(
    params: SendEmailParams
  ): Promise<{ disabled?: boolean; messageId?: string; threadId?: string; error?: string }> {
    const client = await gmailClient();
    if (!client) return { disabled: true };
    try {
      // params.from overrides GMAIL_SENDER so the outreach transport can lock
      // the sender to info@brostco.com regardless of which account is OAuth'd.
      const from = params.from ?? config.gmail.sender ?? "me";
      const raw = buildRaw(params, from);
      const res = await client.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });
      return { messageId: res.data.id ?? undefined, threadId: res.data.threadId ?? undefined };
    } catch (err) {
      return { error: (err as Error).message };
    }
  },

  /**
   * Detect replies since a given time. Returns messages that are inbound (not
   * from us) grouped by threadId, so the Outreach agent can mark subs responsive.
   */
  async fetchReplies(
    sinceEpochSec: number
  ): Promise<{ disabled?: boolean; replies: { threadId: string; from: string; snippet: string; messageId: string; body: string }[] }> {
    const client = await gmailClient();
    if (!client) return { disabled: true, replies: [] };
    try {
      const q = `in:inbox newer_than:7d -from:me after:${sinceEpochSec}`;
      const list = await client.users.messages.list({ userId: "me", q, maxResults: 50 });
      const replies: { threadId: string; from: string; snippet: string; messageId: string; body: string }[] = [];
      for (const m of list.data.messages ?? []) {
        // format:"full" so we get the real body (price extraction needs more
        // than the ~200-char snippet).
        const msg = await client.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "full",
        });
        const from =
          msg.data.payload?.headers?.find((h) => h.name === "From")?.value ?? "";
        replies.push({
          threadId: msg.data.threadId ?? "",
          from,
          snippet: msg.data.snippet ?? "",
          messageId: msg.data.id ?? "",
          body: extractBodyText(msg.data.payload) || (msg.data.snippet ?? ""),
        });
      }
      return { replies };
    } catch (err) {
      return { replies: [], error: (err as { message?: string }).message } as never;
    }
  },
};
