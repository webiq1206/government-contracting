/**
 * Gmail client. Every tenant connects their own inbox and all of their outreach
 * sends from it, with reply detection and open/click tracking.
 *
 * Tokens are keyed by (provider, org_id) in integration_tokens, so one
 * customer's connection can never be used to send as another. The OAuth client
 * id/secret are platform-level (one Google app, many connected inboxes), which
 * is what makes Connect Google Inbox a single button for the customer.
 *
 * GMAIL_REFRESH_TOKEN remains supported as a headless escape hatch for the
 * founding tenant only. Degrades gracefully when not configured.
 */
import { google } from "googleapis";
import { config } from "../config";
import { queryOne, query } from "../db";
import { tryResolveTenantOrgId } from "../tenant";
import { LEGACY_ORG_ID } from "../tenant-context";

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

/**
 * Exchange an OAuth code for tokens and persist them against ONE organization.
 *
 * Google only returns a refresh token on the first consent for an account, so
 * a reconnect that omits it must not blank out the stored one. The insert
 * therefore merges into the existing token blob rather than replacing it.
 */
export async function exchangeCode(
  code: string,
  orgId: string
): Promise<{ email?: string }> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);

  let email: string | undefined;
  client.setCredentials(tokens);
  try {
    const api = google.gmail({ version: "v1", auth: client });
    const prof = await api.users.getProfile({ userId: "me" });
    email = prof.data.emailAddress ?? undefined;
  } catch {
    // A profile read failure is not a reason to discard a valid grant.
  }

  await query(
    `insert into integration_tokens (provider, org_id, data, email, status, last_error, updated_at)
     values ('gmail', $1, $2::jsonb, $3, 'connected', null, now())
     on conflict (provider, org_id) do update set
       -- Merge so a reconnect without a fresh refresh_token keeps the old one.
       data       = integration_tokens.data || excluded.data,
       email      = coalesce(excluded.email, integration_tokens.email),
       status     = 'connected',
       last_error = null,
       updated_at = now()`,
    [orgId, JSON.stringify(tokens), email ?? null]
  );

  return { email };
}

/** Which organization's inbox to act as, defaulting to the caller's tenant. */
async function resolveOrg(orgId?: string): Promise<string | null> {
  return orgId ?? (await tryResolveTenantOrgId());
}

async function getRefreshToken(orgId: string): Promise<string | null> {
  const row = await queryOne<{ data: { refresh_token?: string } }>(
    `select data from integration_tokens where provider = 'gmail' and org_id = $1`,
    [orgId]
  ).catch(() => null);
  if (row?.data?.refresh_token) return row.data.refresh_token;
  // Headless escape hatch, founding tenant only. Handing this env token to any
  // other org would let them send from the platform's own mailbox.
  if (orgId === LEGACY_ORG_ID && config.gmail.refreshToken) {
    return config.gmail.refreshToken;
  }
  return null;
}

/**
 * Record why an inbox stopped working. A user can revoke access from their
 * Google account at any time and we only learn about it when a call fails, so
 * the failure is stored rather than swallowed, and the UI can tell them to
 * reconnect instead of silently sending nothing.
 */
async function markConnectionError(orgId: string, message: string): Promise<void> {
  const revoked = /invalid_grant|unauthorized|invalid_client|Token has been expired or revoked/i.test(
    message
  );
  await query(
    `update integration_tokens
        set status = $2, last_error = $3, updated_at = now()
      where provider = 'gmail' and org_id = $1`,
    [orgId, revoked ? "revoked" : "error", message.slice(0, 500)]
  ).catch(() => {});
}

/** Authorized Gmail client for one organization, or null if not connected. */
async function gmailClient(orgId?: string) {
  if (!config.gmail.configured) return null;
  const org = await resolveOrg(orgId);
  if (!org) return null;
  const refresh = await getRefreshToken(org);
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
  /** Which tenant's connected inbox to send from. Defaults to the caller's. */
  orgId?: string;
  /**
   * Existing Gmail thread to reply inside. Both this and inReplyTo are needed:
   * threadId tells the API which conversation, while In-Reply-To/References are
   * what the RECIPIENT's mail client uses to thread it on their side.
   */
  threadId?: string;
  /** Message-Id of the message being replied to. */
  inReplyTo?: string;
  attachments?: { filename: string; content: Buffer; mime?: string }[];
}

/** Build a raw RFC 2822 message (base64url) with tracking baked in. */
export function buildGmailRawMessage(params: SendEmailParams, from: string): string {
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
      params.inReplyTo ? `In-Reply-To: ${params.inReplyTo}` : "",
      params.inReplyTo ? `References: ${params.inReplyTo}` : "",
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
      params.inReplyTo ? `In-Reply-To: ${params.inReplyTo}` : "",
      params.inReplyTo ? `References: ${params.inReplyTo}` : "",
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

  async isConnected(orgId?: string): Promise<boolean> {
    return (await gmailClient(orgId)) != null;
  },

  /** Connected address and health for one tenant, for the settings UI. */
  async connection(orgId?: string): Promise<{
    connected: boolean;
    email: string | null;
    status: string;
    lastError: string | null;
  }> {
    const org = await resolveOrg(orgId);
    if (!org) return { connected: false, email: null, status: "none", lastError: null };
    const row = await queryOne<{
      email: string | null;
      status: string;
      last_error: string | null;
      data: { refresh_token?: string };
    }>(
      `select email, status, last_error, data from integration_tokens
        where provider = 'gmail' and org_id = $1`,
      [org]
    ).catch(() => null);
    if (!row?.data?.refresh_token) {
      return { connected: false, email: null, status: "none", lastError: null };
    }
    return {
      // "revoked" means the grant is gone even though a row still exists, so
      // the UI must prompt a reconnect rather than claim it is working.
      connected: row.status !== "revoked",
      email: row.email,
      status: row.status,
      lastError: row.last_error,
    };
  },

  /** Forget a tenant's connection. Their inbox is untouched at Google. */
  async disconnect(orgId?: string): Promise<void> {
    const org = await resolveOrg(orgId);
    if (!org) return;
    await query(
      `delete from integration_tokens where provider = 'gmail' and org_id = $1`,
      [org]
    );
  },

  async send(
    params: SendEmailParams
  ): Promise<{ disabled?: boolean; messageId?: string; threadId?: string; error?: string }> {
    const { isAutomationPaused, AUTOMATION_PAUSED_ERROR } = await import("../app-settings");
    if (await isAutomationPaused()) {
      return { disabled: true, error: AUTOMATION_PAUSED_ERROR };
    }
    const org = await resolveOrg(params.orgId);
    const client = await gmailClient(org ?? undefined);
    if (!client) return { disabled: true };
    try {
      // params.from overrides GMAIL_SENDER so the outreach transport can lock
      // the sender to info@brostco.com regardless of which account is OAuth'd.
      const from = params.from ?? config.gmail.sender ?? "me";
      const raw = buildGmailRawMessage(params, from);
      const res = await client.users.messages.send({
        userId: "me",
        // threadId keeps the reply in the same conversation in the sender's
        // own mailbox, which is what the in-app thread view reads back.
        requestBody: { raw, ...(params.threadId ? { threadId: params.threadId } : {}) },
      });
      return { messageId: res.data.id ?? undefined, threadId: res.data.threadId ?? undefined };
    } catch (err) {
      const message = (err as Error).message;
      if (org) await markConnectionError(org, message);
      return { error: message };
    }
  },

  /**
   * Detect replies since a given time. Returns messages that are inbound (not
   * from us) grouped by threadId, so the Outreach agent can mark subs responsive.
   */
  async fetchReplies(
    sinceEpochSec: number,
    orgId?: string
  ): Promise<{ disabled?: boolean; replies: { threadId: string; from: string; snippet: string; messageId: string; body: string }[] }> {
    const client = await gmailClient(orgId);
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
