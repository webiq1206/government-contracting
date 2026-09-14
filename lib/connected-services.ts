/**
 * Connected apps: storage, OAuth, and token upkeep.
 *
 * One table for every provider, one encrypted token blob per connection,
 * and one place that knows how to turn a stored refresh token into a live
 * access token for each provider family. The provider-specific work
 * (calendar events, file uploads, channel messages) lives in
 * lib/integrations/calendar-sync.ts, file-export.ts and team-notify.ts and
 * only ever receives a row plus a fresh access token from here.
 *
 * The organization is always the signed-in user's; a callback URL never
 * chooses the tenant. A personal connection belongs to one user; a
 * company-wide one to the organization, managed by anyone who may manage
 * integrations.
 */
import { google } from "googleapis";
import { query, queryOne } from "./db";
import { config } from "./config";
import { encryptSecret, decryptSecret } from "./integration-settings";
import { fetchJson, HttpError } from "./integrations/http";
import {
  SERVICE_BY_ID,
  providerAvailable,
  type ConnectionScope,
  type ServiceDefinition,
  type ServiceProvider,
  type ServiceStatus,
} from "./domain/connected-services";

export interface ServiceRow {
  id: string;
  org_id: string;
  user_id: string | null;
  provider: ServiceProvider;
  status: ServiceStatus;
  account_label: string | null;
  external_id: string | null;
  scopes: string[];
  token_enc: string | null;
  settings: Record<string, unknown>;
  last_error: string | null;
  last_synced_at: string | null;
  paused_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredTokens {
  refresh_token?: string;
  access_token?: string;
  /** Epoch ms when access_token stops working. */
  expires_at?: number;
  /** Slack: the channel's incoming webhook URL. Teams: the workflow URL. */
  webhook_url?: string;
}

/** Whether the platform can offer this provider on this deployment. */
export function serviceAvailable(def: ServiceDefinition): boolean {
  return providerAvailable(def, process.env as Record<string, string | undefined>);
}

export function readTokens(row: Pick<ServiceRow, "token_enc">): StoredTokens {
  if (!row.token_enc) return {};
  try {
    const plain = decryptSecret(row.token_enc);
    return plain ? (JSON.parse(plain) as StoredTokens) : {};
  } catch {
    return {};
  }
}

function writeTokens(t: StoredTokens): string {
  return encryptSecret(JSON.stringify(t));
}

/** Connections visible to this person: the company's plus their own personal ones. */
export async function listServices(orgId: string, userId: string): Promise<ServiceRow[]> {
  return query<ServiceRow>(
    `select * from connected_services
      where org_id=$1 and status <> 'disconnected' and (user_id is null or user_id=$2)
      order by provider, user_id nulls first`,
    [orgId, userId]
  );
}

/** Every live connection in an organization, for the sync agent. */
export async function activeServices(orgId: string, provider?: ServiceProvider): Promise<ServiceRow[]> {
  return query<ServiceRow>(
    `select * from connected_services
      where org_id=$1 and status='connected' and ($2::text is null or provider=$2)`,
    [orgId, provider ?? null]
  );
}

export async function getService(id: string, orgId: string): Promise<ServiceRow | null> {
  return queryOne<ServiceRow>(`select * from connected_services where id=$1 and org_id=$2`, [id, orgId]);
}

/** Whether this person may change a connection: their own, or a company one with the integrations permission. */
export function mayManage(row: ServiceRow, user: { id: string; canManageIntegrations: boolean }): boolean {
  return row.user_id ? row.user_id === user.id : user.canManageIntegrations;
}

export interface SaveConnectionInput {
  orgId: string;
  userId: string | null;
  createdBy: string;
  provider: ServiceProvider;
  tokens: StoredTokens;
  accountLabel: string | null;
  externalId: string | null;
  scopes: string[];
  settings?: Record<string, unknown>;
}

/** Create or refresh a connection. A reconnect keeps preferences and the old refresh token when the new grant omits one. */
export async function saveConnection(input: SaveConnectionInput): Promise<ServiceRow> {
  const existing = await queryOne<ServiceRow>(
    `select * from connected_services
      where org_id=$1 and provider=$2 and status <> 'disconnected'
        and (($3::uuid is null and user_id is null) or user_id=$3)
      limit 1`,
    [input.orgId, input.provider, input.userId]
  );
  if (existing) {
    const prior = readTokens(existing);
    const merged: StoredTokens = { ...prior, ...input.tokens };
    if (!input.tokens.refresh_token && prior.refresh_token) merged.refresh_token = prior.refresh_token;
    const row = await queryOne<ServiceRow>(
      `update connected_services
          set token_enc=$2, account_label=$3, external_id=$4, scopes=$5,
              settings = settings || $6::jsonb, status='connected', last_error=null,
              paused_at=null, updated_at=now()
        where id=$1 returning *`,
      [existing.id, writeTokens(merged), input.accountLabel, input.externalId, input.scopes, JSON.stringify(input.settings ?? {})]
    );
    return row!;
  }
  const row = await queryOne<ServiceRow>(
    `insert into connected_services
       (org_id, user_id, provider, status, account_label, external_id, scopes, token_enc, settings, created_by)
     values ($1,$2,$3,'connected',$4,$5,$6,$7,$8::jsonb,$9)
     returning *`,
    [input.orgId, input.userId, input.provider, input.accountLabel, input.externalId, input.scopes, writeTokens(input.tokens), JSON.stringify(input.settings ?? {}), input.createdBy]
  );
  return row!;
}

/** Stop future access and syncing. Pushed events and files are left where they are. */
export async function disconnectService(id: string, orgId: string): Promise<void> {
  await query(
    `update connected_services
        set status='disconnected', token_enc=null, disconnected_at=now(), updated_at=now()
      where id=$1 and org_id=$2`,
    [id, orgId]
  );
}

export async function setPaused(id: string, orgId: string, paused: boolean): Promise<void> {
  await query(
    `update connected_services
        set status=$3, paused_at=case when $3='paused' then now() else null end, updated_at=now()
      where id=$1 and org_id=$2 and status <> 'disconnected'`,
    [id, orgId, paused ? "paused" : "connected"]
  );
}

export async function updateSettings(id: string, orgId: string, patch: Record<string, unknown>): Promise<void> {
  await query(`update connected_services set settings = settings || $3::jsonb, updated_at=now() where id=$1 and org_id=$2`, [
    id,
    orgId,
    JSON.stringify(patch),
  ]);
}

export async function markServiceError(id: string, message: string): Promise<void> {
  await query(
    `update connected_services set status='needs_attention', last_error=$2, updated_at=now() where id=$1 and status='connected'`,
    [id, message.slice(0, 500)]
  );
}

export async function markSynced(id: string): Promise<void> {
  await query(`update connected_services set last_synced_at=now(), last_error=null, updated_at=now() where id=$1`, [id]);
}

async function storeTokens(id: string, t: StoredTokens): Promise<void> {
  await query(`update connected_services set token_enc=$2, updated_at=now() where id=$1`, [id, writeTokens(t)]);
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export type OAuthFamily = "google" | "microsoft" | "slack" | "dropbox" | "box";

export function familyOf(provider: ServiceProvider): OAuthFamily | "teams" {
  return SERVICE_BY_ID[provider].family;
}

function googleClient() {
  return new google.auth.OAuth2(config.gmail.clientId, config.gmail.clientSecret, config.services.google.redirectUri);
}

/** Where to send the person to approve. `state` carries the CSRF token; provider and scope ride in it too. */
export function authUrl(provider: ServiceProvider, state: string): string {
  const def = SERVICE_BY_ID[provider];
  switch (def.family) {
    case "google":
      return googleClient().generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: true,
        scope: def.oauthScopes,
        state,
      });
    case "microsoft": {
      const u = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
      u.searchParams.set("client_id", config.services.microsoft.clientId);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("redirect_uri", config.services.microsoft.redirectUri);
      u.searchParams.set("response_mode", "query");
      u.searchParams.set("scope", def.oauthScopes.join(" "));
      u.searchParams.set("state", state);
      return u.toString();
    }
    case "slack": {
      const u = new URL("https://slack.com/oauth/v2/authorize");
      u.searchParams.set("client_id", config.services.slack.clientId);
      u.searchParams.set("scope", def.oauthScopes.join(","));
      u.searchParams.set("redirect_uri", config.services.slack.redirectUri);
      u.searchParams.set("state", state);
      return u.toString();
    }
    case "dropbox": {
      const u = new URL("https://www.dropbox.com/oauth2/authorize");
      u.searchParams.set("client_id", config.services.dropbox.clientId);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("redirect_uri", config.services.dropbox.redirectUri);
      u.searchParams.set("token_access_type", "offline");
      u.searchParams.set("scope", def.oauthScopes.join(" "));
      u.searchParams.set("state", state);
      return u.toString();
    }
    case "box": {
      const u = new URL("https://account.box.com/api/oauth2/authorize");
      u.searchParams.set("client_id", config.services.box.clientId);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("redirect_uri", config.services.box.redirectUri);
      u.searchParams.set("state", state);
      return u.toString();
    }
    default:
      throw new Error("This provider does not use sign-in.");
  }
}

export interface ExchangeResult {
  tokens: StoredTokens;
  accountLabel: string | null;
  externalId: string | null;
  scopes: string[];
  settings?: Record<string, unknown>;
}

function form(body: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  };
}

/** Turn the consent code into stored tokens plus the identity of the account that approved. */
export async function exchangeCode(provider: ServiceProvider, code: string): Promise<ExchangeResult> {
  const def = SERVICE_BY_ID[provider];
  switch (def.family) {
    case "google": {
      const client = googleClient();
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);
      const me = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
      return {
        tokens: {
          refresh_token: tokens.refresh_token ?? undefined,
          access_token: tokens.access_token ?? undefined,
          expires_at: tokens.expiry_date ?? undefined,
        },
        accountLabel: me.data.email ?? null,
        externalId: me.data.id ?? null,
        scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
      };
    }
    case "microsoft": {
      const t = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        form({
          client_id: config.services.microsoft.clientId,
          client_secret: config.services.microsoft.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: config.services.microsoft.redirectUri,
          scope: def.oauthScopes.join(" "),
        })
      );
      const me = await fetchJson<{ id: string; mail?: string; userPrincipalName?: string }>("https://graph.microsoft.com/v1.0/me", {
        headers: { authorization: `Bearer ${t.access_token}` },
      });
      return {
        tokens: { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 },
        accountLabel: me.mail ?? me.userPrincipalName ?? null,
        externalId: me.id,
        scopes: (t.scope ?? "").split(" ").filter(Boolean),
      };
    }
    case "slack": {
      const t = await fetchJson<{
        ok: boolean;
        error?: string;
        team?: { id: string; name: string };
        incoming_webhook?: { url: string; channel: string; channel_id: string };
        access_token?: string;
      }>(
        "https://slack.com/api/oauth.v2.access",
        form({
          client_id: config.services.slack.clientId,
          client_secret: config.services.slack.clientSecret,
          code,
          redirect_uri: config.services.slack.redirectUri,
        })
      );
      if (!t.ok || !t.incoming_webhook?.url) throw new Error(`Slack did not complete the connection (${t.error ?? "no webhook"}).`);
      return {
        tokens: { webhook_url: t.incoming_webhook.url, access_token: t.access_token },
        accountLabel: `${t.team?.name ?? "Slack"} ${t.incoming_webhook.channel}`,
        externalId: t.team?.id ?? null,
        scopes: def.oauthScopes,
        settings: { channel: t.incoming_webhook.channel, channel_id: t.incoming_webhook.channel_id },
      };
    }
    case "dropbox": {
      const t = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number; account_id?: string; scope?: string }>(
        "https://api.dropboxapi.com/oauth2/token",
        form({
          client_id: config.services.dropbox.clientId,
          client_secret: config.services.dropbox.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: config.services.dropbox.redirectUri,
        })
      );
      const me = await fetchJson<{ email?: string; account_id?: string }>("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: { authorization: `Bearer ${t.access_token}` },
      });
      return {
        tokens: { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 },
        accountLabel: me.email ?? null,
        externalId: me.account_id ?? t.account_id ?? null,
        scopes: (t.scope ?? "").split(" ").filter(Boolean),
      };
    }
    case "box": {
      const t = await fetchJson<{ access_token: string; refresh_token: string; expires_in: number }>(
        "https://api.box.com/oauth2/token",
        form({
          client_id: config.services.box.clientId,
          client_secret: config.services.box.clientSecret,
          grant_type: "authorization_code",
          code,
        })
      );
      const me = await fetchJson<{ id: string; login?: string }>("https://api.box.com/2.0/users/me", {
        headers: { authorization: `Bearer ${t.access_token}` },
      });
      return {
        tokens: { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 },
        accountLabel: me.login ?? null,
        externalId: me.id,
        scopes: def.oauthScopes,
      };
    }
    default:
      throw new Error("This provider does not use sign-in.");
  }
}

/** Whether a provider failure means the grant is gone, so the card says "reconnect" rather than "retrying". */
export function isAuthFailure(err: unknown): boolean {
  const status = err instanceof HttpError ? err.status : (err as { code?: number; status?: number })?.status ?? (err as { code?: number })?.code;
  const text = String((err as Error)?.message ?? "");
  return status === 401 || status === 403 || /invalid_grant|expired_token|invalid_token|revoked|unauthorized/i.test(text);
}

/**
 * A working access token for this connection, refreshed and stored when the
 * old one is spent. Throws on a revoked grant; the caller marks the row.
 */
export async function accessToken(row: ServiceRow): Promise<string> {
  const def = SERVICE_BY_ID[row.provider];
  const t = readTokens(row);
  const fresh = t.access_token && t.expires_at && t.expires_at - Date.now() > 60_000;
  if (fresh) return t.access_token!;
  switch (def.family) {
    case "google": {
      if (!t.refresh_token) throw new Error("No refresh token stored; reconnect.");
      const client = googleClient();
      client.setCredentials({ refresh_token: t.refresh_token });
      const r = await client.getAccessToken();
      const token = r.token;
      if (!token) throw new Error("Google did not return an access token.");
      const creds = client.credentials;
      await storeTokens(row.id, { ...t, access_token: token, expires_at: creds.expiry_date ?? Date.now() + 50 * 60_000 });
      return token;
    }
    case "microsoft": {
      if (!t.refresh_token) throw new Error("No refresh token stored; reconnect.");
      const r = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number }>(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        form({
          client_id: config.services.microsoft.clientId,
          client_secret: config.services.microsoft.clientSecret,
          grant_type: "refresh_token",
          refresh_token: t.refresh_token,
          scope: def.oauthScopes.join(" "),
        })
      );
      await storeTokens(row.id, { ...t, refresh_token: r.refresh_token ?? t.refresh_token, access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000 });
      return r.access_token;
    }
    case "dropbox": {
      if (!t.refresh_token) throw new Error("No refresh token stored; reconnect.");
      const r = await fetchJson<{ access_token: string; expires_in: number }>(
        "https://api.dropboxapi.com/oauth2/token",
        form({
          client_id: config.services.dropbox.clientId,
          client_secret: config.services.dropbox.clientSecret,
          grant_type: "refresh_token",
          refresh_token: t.refresh_token,
        })
      );
      await storeTokens(row.id, { ...t, access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000 });
      return r.access_token;
    }
    case "box": {
      if (!t.refresh_token) throw new Error("No refresh token stored; reconnect.");
      const r = await fetchJson<{ access_token: string; refresh_token: string; expires_in: number }>(
        "https://api.box.com/oauth2/token",
        form({
          client_id: config.services.box.clientId,
          client_secret: config.services.box.clientSecret,
          grant_type: "refresh_token",
          refresh_token: t.refresh_token,
        })
      );
      // Box rotates refresh tokens on every use; the new one must be kept.
      await storeTokens(row.id, { ...t, refresh_token: r.refresh_token, access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000 });
      return r.access_token;
    }
    default:
      throw new Error("This provider has no access token.");
  }
}

/** A Google client bound to this connection, for the googleapis SDK. */
export async function googleAuthFor(row: ServiceRow) {
  const token = await accessToken(row);
  const client = googleClient();
  client.setCredentials({ access_token: token, refresh_token: readTokens(row).refresh_token });
  return client;
}

export function parseScope(v: unknown): ConnectionScope {
  return v === "personal" ? "personal" : "company";
}

/** Record a Teams workflow link as a connection. It is a URL somebody pasted, so it is stored like a token. */
export async function saveWebhookConnection(input: {
  orgId: string;
  createdBy: string;
  provider: "teams";
  url: string;
  label: string;
}): Promise<ServiceRow> {
  return saveConnection({
    orgId: input.orgId,
    userId: null,
    createdBy: input.createdBy,
    provider: input.provider,
    tokens: { webhook_url: input.url },
    accountLabel: input.label,
    externalId: null,
    scopes: [],
    settings: {},
  });
}
