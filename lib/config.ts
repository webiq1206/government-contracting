/**
 * Central runtime configuration. Secret-bearing fields are getters that read
 * process.env on every access, so UI-managed integration settings (hydrated
 * into process.env by lib/integration-settings.ts) take effect without a
 * restart. Applies sane defaults,
 * and exposes typed helpers. Nothing here throws at import time, the platform
 * must boot even with a partially-filled .env and degrade gracefully.
 */
import "./env";

function str(key: string, fallback = ""): string {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  // Treat an un-replaced `.env.example` placeholder (a bare <...> token) as
  // unset, so a forgotten field degrades gracefully (feature disabled + logged)
  // instead of firing a bogus credential at the API. Angle brackets never occur
  // in real secrets, so this can't strip a legitimate value. Note: a value like
  // "BROSTCO <alerts@brostco.com>" is NOT a bare token and is left intact.
  if (/^<[^>]*>$/.test(v.trim())) return fallback;
  return v;
}

function bool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function list(key: string): string[] {
  return str(key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Hostname of a Postgres URL, or "" when it cannot be parsed. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** "host:port" for a Postgres URL, or "" when it cannot be parsed. */
function endpointOf(url: string): string {
  const u = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();
  if (!u || !u.hostname) return "";
  return `${u.hostname.toLowerCase()}:${u.port || "5432"}`;
}

/** Characters a hostname or database name may contain for us to build a URL. */
const SAFE_PG_PART = /^[A-Za-z0-9._-]+$/;

/**
 * Which Postgres this process talks to.
 *
 * Development must never point at the production database. It used to: the
 * workspace and the published app both read DATABASE_URL, so the workspace
 * worker executed real customer jobs against live data, every workspace
 * restart killed work that was in flight, and two schedulers double-enqueued
 * every cron.
 *
 * DATABASE_URL is managed by the platform and carries the same value in both
 * environments, so it cannot be repointed per environment. The split is
 * therefore opt-in from the development side only: setting USE_REPLIT_DEV_DB
 * there resolves to the repl's own built-in Postgres (the PG* variables)
 * instead. Production never has that flag, so it keeps reading DATABASE_URL
 * exactly as it always has.
 */
function resolveDatabaseUrl(): string {
  const primary = str("DATABASE_URL");
  if (!bool("USE_REPLIT_DEV_DB")) return primary;

  // Fail closed if the flag ever reaches a deployed environment. It exists only
  // to keep the workspace off live data; in production it would quietly serve
  // customers from an empty development database, so not starting is by far
  // the better outcome. This is the one failure mode worth crashing over.
  if (str("REPLIT_DEPLOYMENT") !== "") {
    throw new Error(
      "USE_REPLIT_DEV_DB is set in a deployed environment. That flag belongs to the workspace only. Refusing to start rather than serving production traffic from the development database."
    );
  }

  const host = str("PGHOST");
  const name = str("PGDATABASE");
  const user = str("PGUSER");
  const password = str("PGPASSWORD");
  const port = str("PGPORT", "5432");
  if (!host || !name || !user) {
    throw new Error(
      "USE_REPLIT_DEV_DB is set but PGHOST/PGDATABASE/PGUSER are missing, so there is no separate development database to point at. Provision the built-in database or unset the flag."
    );
  }
  if (!SAFE_PG_PART.test(host) || !SAFE_PG_PART.test(name) || !/^\d+$/.test(port)) {
    throw new Error(
      "The built-in database settings (PGHOST/PGDATABASE/PGPORT) are malformed, so a connection cannot be built from them safely."
    );
  }

  // Built through URL rather than string interpolation so the credentials are
  // escaped by the same rules that will parse them back out.
  const built = new URL("postgres://placeholder");
  built.hostname = host;
  built.port = port;
  built.username = user;
  built.password = password;
  built.pathname = `/${name}`;
  // The built-in database is in-container and speaks plain TCP. Say so in the
  // URL itself, so no later code has to guess from the shape of a hostname
  // whether a given database wants TLS.
  built.searchParams.set("sslmode", "disable");
  const url = built.toString();

  // Never claim isolation we do not have. A flag that says "you are safely on
  // development" while the writes land in production is worse than sharing
  // openly, so anything short of proof that these are different servers is a
  // refusal rather than a warning.
  const primaryEndpoint = endpointOf(primary);
  if (primary && !primaryEndpoint) {
    throw new Error(
      "DATABASE_URL could not be parsed, so there is no way to confirm the development database is a different server. Refusing to continue."
    );
  }
  if (primaryEndpoint && endpointOf(url) === primaryEndpoint) {
    throw new Error(
      "USE_REPLIT_DEV_DB is set but the built-in database is the same server as DATABASE_URL, so development would still be reading and writing production data. Refusing to continue."
    );
  }
  return url;
}

/**
 * TLS settings for a Postgres connection. Managed providers require TLS and
 * present certificates we do not pin.
 *
 * Plain TCP is only ever used where the connection says so outright, via
 * sslmode=disable or a loopback address. Inferring it from the shape of a
 * hostname would silently downgrade a real remote database that happens to sit
 * behind a private DNS name, and send its credentials over that network in the
 * clear.
 */
export function pgSslFor(url: string): { rejectUnauthorized: boolean } | undefined {
  const host = hostOf(url);
  if (!host) return undefined;
  if (/[?&]sslmode=disable\b/.test(url)) return undefined;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return undefined;
  return { rejectUnauthorized: false };
}

export const config = {
  env: str("NODE_ENV", "development"),
  isProd: str("NODE_ENV") === "production",
  appUrl: str("APP_URL", "http://localhost:3000"),
  port: Number(str("PORT", "3000")),

  database: {
    get url(): string {
      return resolveDatabaseUrl();
    },
    /**
     * True when this process was deliberately pointed away from production
     * data. Also used to keep outbound side effects (real email) switched off,
     * since a process on the development database has no business sending to
     * a real subcontractor.
     */
    get isIsolatedDev(): boolean {
      return bool("USE_REPLIT_DEV_DB");
    },
  },

  auth: {
    // Session-signing + integration-encryption secret. Accept SESSION_SECRET as
    // a fallback so either common name works (Replit auto-generates
    // SESSION_SECRET; our docs use AUTH_SECRET). Getter so a value hydrated
    // later is picked up.
    get secret() {
      return str("AUTH_SECRET") || str("SESSION_SECRET") || "dev-insecure-secret-change-me";
    },
    // True when no real secret is set (still the public source default). Used
    // to disable the forgeable env-operator cookie path in production.
    get secretIsDefault() {
      return this.secret === "dev-insecure-secret-change-me";
    },
    operatorEmail: str("OPERATOR_EMAIL"),
    operatorPasswordHash: str("OPERATOR_PASSWORD_HASH"),
  },

  supabase: {
    get url() { return str("SUPABASE_URL"); },
    get serviceKey() { return str("SUPABASE_SERVICE_ROLE_KEY"); },
    bucket: str("SUPABASE_STORAGE_BUCKET", "brostco-documents"),
    get enabled() {
      return Boolean(this.url && this.serviceKey);
    },
  },

  claude: {
    get apiKey() { return str("ANTHROPIC_API_KEY"); },
    // Default tier, high-volume, lower-stakes agents (scoring, outreach, call
    // prep, sub-verify, digests). Fast and cheap.
    model: str("CLAUDE_MODEL", "claude-haiku-4-5"),
    // High-stakes tier, the bid-critical path where a missed requirement or a
    // fabricated fact costs a bid: the Solicitation Analyst (bid brief) and the
    // Learning Loop (rubric-weight analysis). Stronger model.
    modelSmart: str("CLAUDE_MODEL_SMART", "claude-sonnet-5"),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  sam: {
    get apiKey() { return str("SAM_API_KEY"); },
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  // Ahrefs API v3 — powers the autonomous Site Authority / backlink module
  // (authority snapshots, competitor referring-domain mining, backlink monitoring).
  ahrefs: {
    get apiKey() { return str("AHREFS_API_KEY"); },
    // The domain we're building authority for (our own site).
    get target() { return str("AHREFS_TARGET", "brostco.com"); },
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  usaspending: {
    baseUrl: str("USASPENDING_BASE_URL", "https://api.usaspending.gov"),
  },

  bls: {
    get apiKey() { return str("BLS_API_KEY"); },
  },

  googleMaps: {
    get apiKey() { return str("GOOGLE_MAPS_API_KEY") || str("GOOGLE_PLACES_API_KEY"); },
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  hunter: {
    get apiKey() { return str("HUNTER_API_KEY"); },
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  email: {
    /**
     * Escape hatch for deliberately testing real delivery from the workspace.
     * Off by default: a process on the development database should not be able
     * to put mail in a real subcontractor's inbox just because credentials
     * happen to be present.
     */
    get allowRealSendsFromDev() {
      return bool("ALLOW_REAL_EMAIL_FROM_DEV");
    },
  },

  gmail: {
    get clientId() { return str("GMAIL_CLIENT_ID"); },
    get clientSecret() { return str("GMAIL_CLIENT_SECRET"); },
    get refreshToken() { return str("GMAIL_REFRESH_TOKEN"); },
    get sender() { return str("GMAIL_SENDER"); },
    get redirectUri() {
      return `${config.appUrl}/api/integrations/gmail/callback`;
    },
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  twilio: {
    get accountSid() { return str("TWILIO_ACCOUNT_SID"); },
    get authToken() { return str("TWILIO_AUTH_TOKEN"); },
    get fromNumber() { return str("TWILIO_FROM_NUMBER"); },
    get alertTo() { return str("ALERT_SMS_TO"); },
    get enabled() {
      return Boolean(this.accountSid && this.authToken && this.fromNumber);
    },
  },

  /**
   * Platform system email (password resets, digests, alerts). Delivered
   * through the platform's own connected Gmail inbox, not a tenant's.
   */
  systemMail: {
    /** Optional explicit From. Defaults to the connected platform address. */
    get from() { return str("SYSTEM_MAIL_FROM"); },
    /** Where operator digests and alerts go. */
    get digestTo() { return str("DIGEST_EMAIL_TO"); },
  },

  stripe: {
    get secretKey() { return str("STRIPE_SECRET_KEY"); },
    get webhookSecret() { return str("STRIPE_WEBHOOK_SECRET"); },
    get priceStandard() { return str("STRIPE_PRICE_STANDARD"); },
    get priceFounding() { return str("STRIPE_PRICE_FOUNDING"); },
    get enabled() {
      return Boolean(this.secretKey);
    },
  },

  queue: {
    redisUrl: str("REDIS_URL"),
    get backend(): "bullmq" | "pgboss" {
      return this.redisUrl ? "bullmq" : "pgboss";
    },
  },

  worker: {
    enabled: bool("RUN_WORKER", true),
    disabledAgents: list("DISABLED_AGENTS"),
    enableScrapers: bool("ENABLE_SCRAPERS", false),
  },
} as const;

/** Human-readable readiness report used by the /settings/integrations view and boot logs. */
export function integrationStatus() {
  return {
    database: Boolean(config.database.url),
    claude: config.claude.enabled,
    sam: config.sam.enabled,
    ahrefs: config.ahrefs.enabled,
    usaspending: true, // public API, always available
    bls: true, // works unauthenticated at low volume
    googleMaps: config.googleMaps.enabled,
    hunter: config.hunter.enabled,
    gmail: config.gmail.configured,
    twilio: config.twilio.enabled,
    supabaseStorage: config.supabase.enabled,
    queue: config.queue.backend,
  };
}
