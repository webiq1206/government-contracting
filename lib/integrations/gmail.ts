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
import { encryptSecret, decryptSecret } from "../integration-settings";

/**
 * Gmail OAuth grants are the platform's single most sensitive stored secret:
 * a refresh token is a standing, long-lived key to read and send from a
 * customer's entire mailbox. Storing it as plaintext JSON meant anyone with a
 * read of the integration_tokens table held live inbox access for every
 * tenant. These two helpers wrap the token object so the refresh_token is
 * AES-256-GCM encrypted at rest (same scheme as UI-managed API keys), while
 * staying compatible with rows written before this change.
 */
function encryptTokenData(tokens: Record<string, unknown>): Record<string, unknown> {
  const rt = tokens.refresh_token;
  if (typeof rt === "string" && rt && !rt.startsWith("v1:")) {
    return { ...tokens, refresh_token: encryptSecret(rt) };
  }
  return tokens;
}

/** Read a stored refresh_token, decrypting v1 rows and passing legacy plaintext through. */
function readRefreshToken(data: { refresh_token?: string } | null | undefined): string | null {
  const rt = data?.refresh_token;
  if (!rt) return null;
  // A row written before encryption shipped is plaintext; a decrypt attempt on
  // it returns null, so fall back to the raw value. New rows start "v1:".
  if (rt.startsWith("v1:")) return decryptSecret(rt);
  return rt;
}

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
    [orgId, JSON.stringify(encryptTokenData(tokens as Record<string, unknown>)), email ?? null]
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
  ).catch((err) => {
    // A DB blip here reads as "inbox not connected" downstream; leave a trace
    // so a run of held drafts is attributable to the outage, not the user.
    console.error(`[gmail] token read failed for org ${orgId}: ${(err as Error).message}`);
    return null;
  });
  const stored = readRefreshToken(row?.data);
  if (stored) return stored;
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

/**
 * Cached answer to "can this org's grant still produce an access token".
 *
 * Kept small and short-lived: this is asked on a public endpoint, so it must
 * not turn into a Google call per request.
 */
const authProbeCache = new Map<string, { ok: boolean; at: number }>();
const AUTH_PROBE_TTL_MS = 60 * 1000;

/** Test seam: forget cached auth probes. */
export function __resetAuthProbeCache(): void {
  authProbeCache.clear();
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
  filename?: string | null;
  body?: { data?: string | null; attachmentId?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
};

/** An attachment reference found on a message, before its bytes are fetched. */
export interface GmailAttachmentRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

/**
 * Walk a payload for real file attachments.
 *
 * Inline images and the message's own body parts are skipped: a signature logo
 * is not a quote, and pulling every one of them would burn API calls and
 * memory for nothing.
 */
export function collectAttachments(
  payload: GmailPart | null | undefined
): GmailAttachmentRef[] {
  if (!payload) return [];
  const out: GmailAttachmentRef[] = [];
  const stack: GmailPart[] = [payload];
  while (stack.length) {
    const p = stack.shift()!;
    if (p.parts) stack.push(...p.parts);
    const id = p.body?.attachmentId;
    const name = p.filename?.trim();
    if (!id || !name) continue;
    out.push({
      filename: name,
      mimeType: p.mimeType ?? "application/octet-stream",
      attachmentId: id,
      size: p.body?.size ?? 0,
    });
  }
  return out;
}

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

  /**
   * Whether the stored grant can still get an access token from Google.
   *
   * Unlike `isConnected`, which only says a row with a refresh token exists,
   * this catches the common dead connection: a grant the user revoked, or one
   * that expired. It asks Google directly and changes nothing here, neither the
   * stored status nor anything else, which is what makes it usable as a public
   * signal: no request, for any address, can move it. A failure recorded by a
   * send is deliberately not consulted, because sends only happen for addresses
   * that have accounts.
   */
  async canAuthenticate(orgId?: string): Promise<boolean> {
    const org = await resolveOrg(orgId);
    if (!org) return false;
    const cached = authProbeCache.get(org);
    if (cached && Date.now() - cached.at < AUTH_PROBE_TTL_MS) return cached.ok;

    const refresh = await getRefreshToken(org);
    let ok = false;
    if (refresh) {
      const client = oauthClient();
      client.setCredentials({ refresh_token: refresh });
      ok = await client
        .getAccessToken()
        .then((res) => Boolean(res?.token))
        .catch((err) => {
          console.error(`[gmail] auth probe failed for org ${org}: ${(err as Error).message}`);
          return false;
        });
    }
    authProbeCache.set(org, { ok, at: Date.now() });
    return ok;
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
    if (!row || !readRefreshToken(row.data)) {
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
  ): Promise<{
    disabled?: boolean;
    messageId?: string;
    threadId?: string;
    /** The real RFC822 Message-ID header, for In-Reply-To on later sends. */
    rfc822MessageId?: string;
    error?: string;
  }> {
    // Nothing reaches a real inbox from a development process.
    //
    // This is the lowest point every sender passes through: tenant outreach,
    // platform system mail (password resets, digests, alerts), and backlink
    // outreach all end up here. Guarding a caller instead would protect one of
    // them and quietly leave the others live, which is exactly what happened
    // when the workspace shared production's database and its worker was
    // emailing real subcontractors.
    //
    // No exemption for the test suite: tests that mock this module never reach
    // this line, and a test that does reach it is attempting a real send.
    if (config.database.isIsolatedDev && !config.email.allowRealSendsFromDev) {
      return {
        disabled: true,
        error:
          "Blocked: this is the development environment, which does not send real email. Set ALLOW_REAL_EMAIL_FROM_DEV to test delivery deliberately.",
      };
    }

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

      /**
       * Read back the RFC822 Message-ID, which is NOT the Gmail API id.
       *
       * `res.data.id` is Gmail's internal handle ("18f2a3b..."). The
       * In-Reply-To / References headers that make a RECIPIENT's mail client
       * thread a follow-up must carry the real Message-ID
       * ("<CAF...@mail.gmail.com>"), and Gmail assigns that itself at send
       * time. Without it we can only thread inside our own mailbox: a
       * subcontractor on Outlook would see every follow-up as a brand new,
       * context-free email. One metadata read is cheap next to that.
       */
      let rfc822MessageId: string | undefined;
      if (res.data.id) {
        try {
          const meta = await client.users.messages.get({
            userId: "me",
            id: res.data.id,
            format: "metadata",
            metadataHeaders: ["Message-ID"],
          });
          rfc822MessageId =
            meta.data.payload?.headers?.find(
              (h) => (h.name ?? "").toLowerCase() === "message-id"
            )?.value ?? undefined;
        } catch {
          // The message is already sent; not knowing its Message-ID costs
          // recipient-side threading on the NEXT follow-up, not this send.
        }
      }
      return {
        messageId: res.data.id ?? undefined,
        threadId: res.data.threadId ?? undefined,
        rfc822MessageId,
      };
    } catch (err) {
      const message = (err as Error).message;
      if (org) await markConnectionError(org, message);
      return { error: message };
    }
  },

  /**
   * Download one attachment's bytes.
   *
   * Size-capped: a subcontractor's quote is a few pages, and pulling a 40 MB
   * scan into memory inside a polling loop would take the worker down.
   */
  async getAttachment(
    messageId: string,
    attachmentId: string,
    orgId?: string,
    maxBytes = 10 * 1024 * 1024
  ): Promise<Buffer | null> {
    const client = await gmailClient(orgId);
    if (!client) return null;
    try {
      const res = await client.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: attachmentId,
      });
      const data = res.data.data;
      if (!data) return null;
      const buf = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      return buf.length > maxBytes ? null : buf;
    } catch {
      // A failed attachment must not lose the reply itself.
      return null;
    }
  },

  /**
   * Detect replies since a given time. Returns messages that are inbound (not
   * from us) grouped by threadId, so the Outreach agent can mark subs responsive.
   */
  async fetchReplies(
    sinceEpochSec: number,
    orgId?: string
  ): Promise<{
    disabled?: boolean;
    /**
     * The poll FAILED; the empty reply list is not "nobody wrote back".
     * Callers must treat this as an outage: a revoked grant that only ever
     * surfaced here once read as "0 matched" for weeks while quotes piled up
     * unread in the inbox.
     */
    error?: string;
    replies: {
      threadId: string;
      from: string;
      snippet: string;
      messageId: string;
      body: string;
      attachments: GmailAttachmentRef[];
      /** Subject + Content-Type, so a bounce can be told from a reply. */
      subject: string;
      contentType: string;
    }[];
  }> {
    const client = await gmailClient(orgId);
    if (!client) return { disabled: true, replies: [] };
    try {
      const q = `in:inbox newer_than:7d -from:me after:${sinceEpochSec}`;
      const list = await client.users.messages.list({ userId: "me", q, maxResults: 50 });
      const replies: {
        threadId: string;
        from: string;
        snippet: string;
        messageId: string;
        body: string;
        attachments: GmailAttachmentRef[];
        subject: string;
        contentType: string;
      }[] = [];
      for (const m of list.data.messages ?? []) {
        // format:"full" so we get the real body (price extraction needs more
        // than the ~200-char snippet).
        const msg = await client.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "full",
        });
        const header = (name: string) =>
          msg.data.payload?.headers?.find(
            (h) => (h.name ?? "").toLowerCase() === name
          )?.value ?? "";
        const from = header("from");
        replies.push({
          threadId: msg.data.threadId ?? "",
          from,
          // A delivery-status report is not a reply, and telling them apart
          // needs the Content-Type report-type and the subject line.
          subject: header("subject"),
          contentType: header("content-type"),
          snippet: msg.data.snippet ?? "",
          messageId: msg.data.id ?? "",
          body: extractBodyText(msg.data.payload) || (msg.data.snippet ?? ""),
          attachments: collectAttachments(msg.data.payload as GmailPart),
        });
      }
      return { replies };
    } catch (err) {
      const message = (err as { message?: string }).message ?? "Gmail poll failed";
      // Record the failure on the connection the same way a failed SEND does,
      // so a revoked grant flips integration_tokens.status and the settings
      // page (and the pipeline pulse) tell the operator to reconnect.
      const org = await resolveOrg(orgId);
      if (org) await markConnectionError(org, message);
      return { replies: [], error: message };
    }
  },
};
